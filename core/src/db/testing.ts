// Database integration-test harness (01.5-backend-foundation task 3.5, Requirement 4.4).
//
// For *.db.test.ts suites only (run by `pnpm test:db`, see core/vitest.db.config.ts). Not
// exported from ./index.ts or core's exports map: it hands out the privileged pool and the
// RLS-bypassing system actor, and lives in core/src/db because ESLint (task 1.3) confines
// those to this directory.
//
// Every helper runs inside one transaction that is always rolled back, even when the test
// passes, so suites leave the local stack exactly as `pnpm db:reset` left it. Within a
// withRollback() transaction, each asUser/asAnon/asSystem step runs in its own savepoint
// with the role and JWT claims withActor() would set, so one test can seed as the system,
// write as user A and read as user B, and a step that fails doesn't abort the rest.
import { type TransactionSql } from 'postgres'

import { type Actor, SYSTEM_OWNER, tenantOf } from './actor'
import { createDb } from './connection'
import { mapDbError } from './errors'
import { type Db, rawSql } from './internal'
import { type Scoped } from './scoped'

const MISSING_URL_MESSAGE =
  'TEST_DATABASE_URL is not set. Start the local stack with `pnpm db:start`, then set ' +
  'TEST_DATABASE_URL to its direct database URL (`supabase status` prints it, e.g. ' +
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres).'

/** Reads TEST_DATABASE_URL, throwing a message that says how to set it. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error(MISSING_URL_MESSAGE)
  return url
}

let shared: Db | undefined

/** The pool every helper uses by default, opened on first use from TEST_DATABASE_URL. */
export function testDb(): Db {
  shared ??= createDb(testDatabaseUrl(), { max: 4 })
  return shared
}

/** Closes the shared pool. The db setup file calls it after each test file. */
export async function closeTestDb(): Promise<void> {
  const db = shared
  shared = undefined
  await db?.close({ timeoutSeconds: 5 })
}

/** A rolled-back transaction in which steps run as different actors, one after another. */
export interface RollbackTx {
  /** Runs `fn` as the signed-in user `userId` (role `authenticated`, `sub = userId`). */
  asUser<T>(userId: string, fn: (scope: Scoped) => Promise<T>): Promise<T>
  /** Runs `fn` as an anonymous caller (role `anon`). */
  asAnon<T>(fn: (scope: Scoped) => Promise<T>): Promise<T>
  /** Runs `fn` as the system owner: the connection role, which bypasses RLS. Use it to seed. */
  asSystem<T>(fn: (scope: Scoped) => Promise<T>): Promise<T>
  /** Adds `tenantId` to public_tenants for the rest of this transaction (the demo-account case). */
  addPublicTenant(tenantId: string, note?: string): Promise<void>
}

const SYSTEM: Actor = { kind: 'system' }

class Rollback extends Error {}

/**
 * Runs `fn` in a transaction that is rolled back when `fn` settles, and returns its result.
 * Steps must be awaited one at a time: the transaction holds a single connection.
 * Insufficient-privilege errors (SQLSTATE 42501) reject with ForbiddenError, as withActor does.
 */
export async function withRollback<T>(
  fn: (tx: RollbackTx) => Promise<T>,
  db: Db = testDb(),
): Promise<T> {
  let result: T | undefined
  try {
    await rawSql(db).begin(async (sql) => {
      result = await fn(rollbackTx(sql))
      throw new Rollback()
    })
  } catch (error) {
    if (error instanceof Rollback) return result as T
    throw mapDbError(error)
  }
  // begin() only resolves if the callback returns, and the callback always throws.
  throw new Error('withRollback: transaction committed unexpectedly.')
}

/** One step as user `userId` in its own rolled-back transaction. */
export function asUser<T>(userId: string, fn: (scope: Scoped) => Promise<T>): Promise<T> {
  return withRollback((tx) => tx.asUser(userId, fn))
}

/** One step as an anonymous caller in its own rolled-back transaction. */
export function asAnon<T>(fn: (scope: Scoped) => Promise<T>): Promise<T> {
  return withRollback((tx) => tx.asAnon(fn))
}

/** One step as the system owner in its own rolled-back transaction. */
export function asSystem<T>(fn: (scope: Scoped) => Promise<T>): Promise<T> {
  return withRollback((tx) => tx.asSystem(fn))
}

function rollbackTx(sql: TransactionSql): RollbackTx {
  const step = async <T>(actor: Actor, fn: (scope: Scoped) => Promise<T>): Promise<T> => {
    try {
      return (await sql.savepoint(async (sp) => {
        await enterActor(sp, actor)
        return fn({ sql: sp, actor, tenantId: tenantOf(actor) })
      })) as T
    } catch (error) {
      // A rejected step has rolled back to its savepoint, which also undid its role and
      // claims, so the transaction is usable for the next step.
      throw mapDbError(error)
    } finally {
      // A step that succeeded released its savepoint, keeping its `set local` settings.
      // Reset them so the next step (and addPublicTenant) starts as the connection role.
      await sql`select set_config('request.jwt.claims', '', true)`
      await sql.unsafe('reset role')
    }
  }

  return {
    asUser: async (userId, fn) => {
      if (userId === '') throw new TypeError('asUser() needs a non-empty user ID.')
      return step({ kind: 'user', userId, tenantId: userId }, fn)
    },
    asAnon: (fn) => step({ kind: 'anonymous' }, fn),
    asSystem: (fn) => step(SYSTEM, fn),
    addPublicTenant: async (tenantId, note = 'test fixture') => {
      await sql`insert into public.public_tenants (tenant_id, note) values (${tenantId}, ${note})`
    },
  }
}

// Mirrors withActor(): the same claims and roles, so policies see what a request would.
async function enterActor(sql: TransactionSql, actor: Actor): Promise<void> {
  if (actor.kind === 'system') return
  const claims =
    actor.kind === 'user'
      ? JSON.stringify({ sub: actor.userId, role: 'authenticated' })
      : JSON.stringify({ role: 'anon' })
  const role = actor.kind === 'user' ? 'authenticated' : 'anon'
  await sql`select set_config('request.jwt.claims', ${claims}, true)`
  // Identifiers can't be parameters. `role` is one of two literals chosen above.
  await sql.unsafe(`set local role ${role}`)
}

export { SYSTEM_OWNER }
