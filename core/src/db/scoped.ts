import { type TransactionSql } from 'postgres'

import { type Actor, type RequestActor, tenantOf } from './actor'
import { mapDbError } from './errors'
import { type Db, rawSql } from './internal'

/** A transaction running under an actor's RLS context. Repository functions take one. */
export interface Scoped {
  readonly sql: TransactionSql
  readonly actor: Actor
  /** The actor's tenant, for explicit `tenant_id = ...` predicates; null when anonymous. */
  readonly tenantId: string | null
}

/**
 * Runs `fn` in a transaction as `actor` (task 3.1, Requirement 4.3, auth-abuse Requirement 1.6).
 * The single way to run user-data queries.
 *
 * The pool connects as the table owner, which bypasses RLS. Inside the transaction this sets
 * the JWT claims Supabase's auth.jwt() reads and switches to the `authenticated` or `anon`
 * role, so every policy in the grants/RLS migration applies to every statement `fn` runs.
 * Both settings are transaction-local, so they end at commit or rollback and never leak to
 * the next user of the pooled connection.
 *
 * Insufficient-privilege errors (RLS write violations, missing grants) reject with
 * ForbiddenError. The system actor is rejected here; it has its own entry point,
 * withSystem() in `@cauldron/core/db/system`.
 */
export async function withActor<T>(
  db: Db,
  actor: RequestActor,
  fn: (scope: Scoped) => Promise<T>,
): Promise<T> {
  const claims = claimsFor(actor)
  const role = actor.kind === 'user' ? 'authenticated' : 'anon'
  const sql = rawSql(db)
  try {
    return (await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`
      // Identifiers can't be parameters. `role` is one of two literals chosen above.
      await tx.unsafe(`set local role ${role}`)
      return fn({ sql: tx, actor, tenantId: tenantOf(actor) })
    })) as T
  } catch (error) {
    throw mapDbError(error)
  }
}

function claimsFor(actor: RequestActor): string {
  // Guards against callers that bypass the type, e.g. a cast `{ kind: 'system' }`.
  const kind: string = actor.kind
  if (kind === 'anonymous') return JSON.stringify({ role: 'anon' })
  if (kind !== 'user') {
    throw new TypeError(
      `withActor() accepts user and anonymous actors, got "${kind}". ` +
        'The system actor runs through withSystem() from @cauldron/core/db/system.',
    )
  }
  const { userId, tenantId } = actor as { userId: unknown; tenantId: unknown }
  if (typeof userId !== 'string' || userId === '') {
    throw new TypeError('A user actor needs a non-empty userId.')
  }
  // RLS derives the tenant from `sub`, so a different tenantId would make Scoped.tenantId
  // disagree with what the policies enforce (one tenant per account, Requirement 2.2).
  if (tenantId !== userId) {
    throw new TypeError('A user actor\'s tenantId must equal its userId.')
  }
  return JSON.stringify({ sub: userId, role: 'authenticated' })
}
