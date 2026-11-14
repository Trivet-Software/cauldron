// Cross-tenant isolation, shared reads and grants (01.5-backend-foundation task 3.6,
// Requirements 4.2 and 4.4; auth-abuse Requirements 2.3 and 10).
//
// Every test seeds tenants A and B as the system owner inside one rolled-back transaction,
// then acts as user B (or anonymously) against A's rows. Outcomes differ by layer:
// - a command with no table grant rejects with ForbiddenError (SQLSTATE 42501);
// - RLS hides rows from select, update and delete, so those affect 0 rows without an error;
// - an insert failing an RLS WITH CHECK rejects with ForbiddenError;
// - a composite foreign key to another tenant's row fails with 23503.
import { PostgresError, type TransactionSql } from 'postgres'
import { describe, expect, it } from 'vitest'

import { ForbiddenError } from './errors'
import {
  type Chain,
  type UserDataTable,
  USER_DATA_TABLES,
  seedChain,
  snapshot,
  uniqueTenant,
} from './test-fixtures'
import { type RollbackTx, withRollback } from './testing'

interface Tenants {
  a: Chain
  b: Chain
}

/** Seeds A and B, runs `fn`, rolls everything back. */
function withTenants(fn: (tx: RollbackTx, t: Tenants) => Promise<void>): Promise<void> {
  return withRollback(async (tx) => {
    const t = await tx.asSystem(async ({ sql }) => ({
      a: await seedChain(sql, uniqueTenant('iso_a')),
      b: await seedChain(sql, uniqueTenant('iso_b')),
    }))
    await fn(tx, t)
  })
}

function table(sql: TransactionSql, name: UserDataTable) {
  return sql(`public.${name}`)
}

async function expectForbidden(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(ForbiddenError)
}

async function expectFkViolation(promise: Promise<unknown>, constraint: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(PostgresError)
  expect((error as PostgresError).code).toBe('23503')
  expect((error as PostgresError).constraint_name).toBe(constraint)
}

// Which write commands `authenticated` holds a grant for, per the grants migration.
const GRANTS: Record<UserDataTable, { update: boolean; delete: boolean }> = {
  goals: { update: true, delete: true },
  goal_versions: { update: true, delete: true },
  sources: { update: true, delete: true },
  jobs: { update: false, delete: false },
  items: { update: true, delete: true },
  drafts: { update: true, delete: true },
  pages: { update: true, delete: true },
  page_items: { update: true, delete: true },
  usage: { update: false, delete: false },
  api_keys: { update: true, delete: false },
}

/**
 * A new row claiming tenant A, pointing at A's own parents so that only RLS can stop it.
 * Unique columns get fresh values; page_items reuses A's (page, item) pair, which is safe
 * because Postgres checks RLS before unique constraints.
 */
function forgedRow(sql: TransactionSql, name: UserDataTable, a: Chain): Record<string, unknown> {
  const owner = { tenant_id: a.tenantId, user_id: a.tenantId }
  const fresh = crypto.randomUUID()
  switch (name) {
    case 'goals':
      return { ...owner, kind: 'draft', slug: fresh, name: fresh }
    case 'goal_versions':
      return {
        ...owner,
        goal_id: a.goalId,
        version: 2,
        schema_version: 1,
        spec: sql.json({}),
        content_hash: 'hash',
        author: a.tenantId,
      }
    case 'sources':
      return { ...owner, goal_id: a.goalId, kind: 'text', client: 'web' }
    case 'jobs':
      return { ...owner, type: 'ping' }
    case 'items':
      return {
        ...owner,
        goal_id: a.goalId,
        source_id: a.sourceId,
        goal_version: 1,
        data: sql.json({}),
        title: 'Forged',
      }
    case 'drafts':
      return { ...owner, goal_id: a.goalId, source_id: a.sourceId, data: sql.json({}) }
    case 'pages':
      return { ...owner, goal_id: a.goalId, group_key: fresh, title: 'Forged' }
    case 'page_items':
      return { ...owner, page_id: a.pageId, item_id: a.itemId }
    case 'usage':
      return { ...owner, operation: 'compile', provider: 'mock', model: 'mock-1' }
    case 'api_keys':
      return { ...owner, name: 'Forged', prefix: `ck_${fresh}`, key_hash: 'hash' }
  }
}

describe('cross-tenant isolation', () => {
  describe.each(USER_DATA_TABLES)('%s', (name) => {
    it("user A sees their own rows (control for the tests below)", () =>
      withTenants(async (tx, { a }) => {
        const rows = await tx.asUser(
          a.tenantId,
          ({ sql }) => sql`select 1 from ${table(sql, name)} where tenant_id = ${a.tenantId}`,
        )
        expect(rows.length).toBeGreaterThan(0)
      }))

    it("user B can't select, update or delete A's rows, which stay unchanged", () =>
      withTenants(async (tx, { a, b }) => {
        const before = await tx.asSystem(({ sql }) => snapshot(sql, name, a.tenantId))
        expect(before.length).toBeGreaterThan(0)

        const selected = await tx.asUser(
          b.tenantId,
          ({ sql }) => sql`select * from ${table(sql, name)} where tenant_id = ${a.tenantId}`,
        )
        expect(selected).toHaveLength(0)

        const update = tx.asUser(
          b.tenantId,
          ({ sql }) => sql`
            update ${table(sql, name)} set user_id = ${b.tenantId}
            where tenant_id = ${a.tenantId}`,
        )
        if (GRANTS[name].update) expect((await update).count).toBe(0)
        else await expectForbidden(update)

        const del = tx.asUser(
          b.tenantId,
          ({ sql }) => sql`delete from ${table(sql, name)} where tenant_id = ${a.tenantId}`,
        )
        if (GRANTS[name].delete) expect((await del).count).toBe(0)
        else await expectForbidden(del)

        expect(await tx.asSystem(({ sql }) => snapshot(sql, name, a.tenantId))).toEqual(before)
      }))

    it("user B can't insert a row with tenant_id = A", () =>
      withTenants(async (tx, { a, b }) => {
        const before = await tx.asSystem(({ sql }) => snapshot(sql, name, a.tenantId))
        await expectForbidden(
          tx.asUser(
            b.tenantId,
            ({ sql }) => sql`
              insert into ${table(sql, name)}
              ${sql(forgedRow(sql, name, a) as Record<string, never>)}`,
          ),
        )
        expect(await tx.asSystem(({ sql }) => snapshot(sql, name, a.tenantId))).toEqual(before)
      }))
  })

  // Rows of B pointing at a row of A through a composite (tenant_id, x_id) foreign key.
  const fkCases: {
    name: string
    constraint: string
    insert: (sql: TransactionSql, t: Tenants) => Promise<unknown>
  }[] = [
    {
      name: 'goal_versions → A goal',
      constraint: 'goal_versions_goal_fkey',
      insert: (sql, { a, b }) => sql`
        insert into public.goal_versions
          (tenant_id, user_id, goal_id, version, schema_version, spec, content_hash, author)
        values (${b.tenantId}, ${b.tenantId}, ${a.goalId}, 9, 1, '{}', 'hash', 'b')`,
    },
    {
      name: 'items → A source',
      constraint: 'items_source_fkey',
      insert: (sql, { a, b }) => sql`
        insert into public.items (tenant_id, user_id, goal_id, source_id, goal_version, data, title)
        values (${b.tenantId}, ${b.tenantId}, ${b.goalId}, ${a.sourceId}, 1, '{}', 'x')`,
    },
    {
      name: 'drafts → A source',
      constraint: 'drafts_source_fkey',
      insert: (sql, { a, b }) => sql`
        insert into public.drafts (tenant_id, user_id, goal_id, source_id, data)
        values (${b.tenantId}, ${b.tenantId}, ${b.goalId}, ${a.sourceId}, '{}')`,
    },
    {
      name: 'drafts → A job',
      constraint: 'drafts_job_fkey',
      insert: (sql, { a, b }) => sql`
        insert into public.drafts (tenant_id, user_id, goal_id, source_id, job_id, data)
        values (${b.tenantId}, ${b.tenantId}, ${b.goalId}, ${b.sourceId}, ${a.jobId}, '{}')`,
    },
    {
      name: 'page_items → A page',
      constraint: 'page_items_page_fkey',
      insert: (sql, { a, b }) => sql`
        insert into public.page_items (page_id, item_id, tenant_id, user_id)
        values (${a.pageId}, ${b.itemId}, ${b.tenantId}, ${b.tenantId})`,
    },
    {
      name: 'page_items → A item',
      constraint: 'page_items_item_fkey',
      insert: (sql, { a, b }) => sql`
        insert into public.page_items (page_id, item_id, tenant_id, user_id)
        values (${b.pageId}, ${a.itemId}, ${b.tenantId}, ${b.tenantId})`,
    },
    {
      name: 'usage → A api key',
      constraint: 'usage_api_key_fkey',
      insert: (sql, { a, b }) => sql`
        insert into public.usage (tenant_id, user_id, api_key_id, operation, provider, model)
        values (${b.tenantId}, ${b.tenantId}, ${a.apiKeyId}, 'compile', 'mock', 'mock-1')`,
    },
    {
      name: 'usage → A job',
      constraint: 'usage_job_fkey',
      insert: (sql, { a, b }) => sql`
        insert into public.usage (tenant_id, user_id, job_id, operation, provider, model)
        values (${b.tenantId}, ${b.tenantId}, ${a.jobId}, 'compile', 'mock', 'mock-1')`,
    },
  ]

  it.each(fkCases)("user B can't reference A's rows: $name", ({ constraint, insert }) =>
    withTenants(async (tx, t) => {
      await expectFkViolation(
        tx.asUser(t.b.tenantId, ({ sql }) => insert(sql, t)),
        constraint,
      )
    }),
  )
})

describe('shared reads', () => {
  async function seedAppGoal(tx: RollbackTx): Promise<{ goalId: string; versionId: string }> {
    return tx.asSystem(async ({ sql }) => {
      const slug = `app-${crypto.randomUUID()}`
      const [goal] = await sql<{ id: string }[]>`
        insert into public.goals (tenant_id, user_id, kind, slug, name)
        values ('system', 'system', 'app', ${slug}, ${slug}) returning id`
      const [version] = await sql<{ id: string }[]>`
        insert into public.goal_versions
          (tenant_id, user_id, goal_id, version, schema_version, spec, content_hash, author)
        values ('system', 'system', ${goal.id}, 1, 1, '{}', 'hash', 'system') returning id`
      return { goalId: goal.id, versionId: version.id }
    })
  }

  function systemGoalSnapshot(tx: RollbackTx, goalId: string) {
    return tx.asSystem(
      ({ sql }) => sql`
        select to_jsonb(g) as goal,
          (select jsonb_agg(to_jsonb(v)) from public.goal_versions v where v.goal_id = g.id)
            as versions
        from public.goals g where g.id = ${goalId}`,
    )
  }

  it('system app goals are readable by anon and by user B', () =>
    withTenants(async (tx, { b }) => {
      const { goalId, versionId } = await seedAppGoal(tx)
      const read = ({ sql }: { sql: TransactionSql }) => sql`
        select (select count(*)::int from public.goals where id = ${goalId}) as goals,
          (select count(*)::int from public.goal_versions where id = ${versionId}) as versions`
      expect(await tx.asAnon(read)).toEqual([{ goals: 1, versions: 1 }])
      expect(await tx.asUser(b.tenantId, read)).toEqual([{ goals: 1, versions: 1 }])
    }))

  it("system app goals aren't writable by user B", () =>
    withTenants(async (tx, { b }) => {
      const { goalId } = await seedAppGoal(tx)
      const before = await systemGoalSnapshot(tx, goalId)

      const updated = await tx.asUser(
        b.tenantId,
        ({ sql }) => sql`update public.goals set name = 'hijacked' where id = ${goalId}`,
      )
      expect(updated.count).toBe(0)
      const versionsUpdated = await tx.asUser(
        b.tenantId,
        ({ sql }) => sql`update public.goal_versions set spec = '{}' where goal_id = ${goalId}`,
      )
      expect(versionsUpdated.count).toBe(0)
      const deleted = await tx.asUser(
        b.tenantId,
        ({ sql }) => sql`delete from public.goals where id = ${goalId}`,
      )
      expect(deleted.count).toBe(0)
      await expectForbidden(
        tx.asUser(
          b.tenantId,
          ({ sql }) => sql`
            insert into public.goals (tenant_id, user_id, kind, slug, name)
            values ('system', 'system', 'app', ${crypto.randomUUID()}, 'x')`,
        ),
      )
      await expectForbidden(
        tx.asUser(
          b.tenantId,
          ({ sql }) => sql`
            insert into public.goal_versions
              (tenant_id, user_id, goal_id, version, schema_version, spec, content_hash, author)
            values ('system', 'system', ${goalId}, 2, 1, '{}', 'hash', 'b')`,
        ),
      )

      expect(await systemGoalSnapshot(tx, goalId)).toEqual(before)
    }))

  it("system app goals aren't writable by anon", () =>
    withTenants(async (tx) => {
      const { goalId } = await seedAppGoal(tx)
      const before = await systemGoalSnapshot(tx, goalId)
      await expectForbidden(
        tx.asAnon(({ sql }) => sql`update public.goals set name = 'x' where id = ${goalId}`),
      )
      await expectForbidden(
        tx.asAnon(({ sql }) => sql`delete from public.goals where id = ${goalId}`),
      )
      await expectForbidden(
        tx.asAnon(
          ({ sql }) => sql`
            insert into public.goals (tenant_id, user_id, kind, slug, name)
            values ('system', 'system', 'app', ${crypto.randomUUID()}, 'x')`,
        ),
      )
      await expectForbidden(
        tx.asAnon(
          ({ sql }) => sql`update public.goal_versions set spec = '{}' where goal_id = ${goalId}`,
        ),
      )
      expect(await systemGoalSnapshot(tx, goalId)).toEqual(before)
    }))

  it("anon can't read a user's draft goals", () =>
    withTenants(async (tx, { a }) => {
      const rows = await tx.asAnon(
        ({ sql }) => sql`select 1 from public.goals where id = ${a.goalId}`,
      )
      expect(rows).toHaveLength(0)
    }))

  it('items, pages and page_items of a public tenant are readable by anon and user B', () =>
    withTenants(async (tx, { a, b }) => {
      const read = ({ sql }: { sql: TransactionSql }) => sql`
        select (select count(*)::int from public.items where id = ${a.itemId}) as items,
          (select count(*)::int from public.pages where id = ${a.pageId}) as pages,
          (select count(*)::int from public.page_items where page_id = ${a.pageId}) as page_items`
      const none = [{ items: 0, pages: 0, page_items: 0 }]
      const all = [{ items: 1, pages: 1, page_items: 1 }]

      expect(await tx.asAnon(read)).toEqual(none)
      expect(await tx.asUser(b.tenantId, read)).toEqual(none)

      await tx.addPublicTenant(a.tenantId)
      expect(await tx.asAnon(read)).toEqual(all)
      expect(await tx.asUser(b.tenantId, read)).toEqual(all)

      // Public reads don't extend to writes or to the tenant's other tables.
      const updated = await tx.asUser(
        b.tenantId,
        ({ sql }) => sql`update public.items set title = 'x' where id = ${a.itemId}`,
      )
      expect(updated.count).toBe(0)
      const sources = await tx.asUser(
        b.tenantId,
        ({ sql }) => sql`select 1 from public.sources where tenant_id = ${a.tenantId}`,
      )
      expect(sources).toHaveLength(0)
    }))

  it.each(['sources', 'drafts', 'jobs', 'usage', 'api_keys'] as const)(
    'anon gets permission denied on %s',
    (name) =>
      withTenants(async (tx) => {
        await expectForbidden(tx.asAnon(({ sql }) => sql`select 1 from ${table(sql, name)}`))
      }),
  )
})

describe('grants', () => {
  it("authenticated can't update or delete its own usage rows", () =>
    withTenants(async (tx, { a }) => {
      const before = await tx.asSystem(({ sql }) => snapshot(sql, 'usage', a.tenantId))
      await expectForbidden(
        tx.asUser(
          a.tenantId,
          ({ sql }) => sql`update public.usage set cost_usd = 0 where id = ${a.usageId}`,
        ),
      )
      await expectForbidden(
        tx.asUser(a.tenantId, ({ sql }) => sql`delete from public.usage where id = ${a.usageId}`),
      )
      expect(await tx.asSystem(({ sql }) => snapshot(sql, 'usage', a.tenantId))).toEqual(before)
    }))

  it("authenticated can't update its own jobs", () =>
    withTenants(async (tx, { a }) => {
      const before = await tx.asSystem(({ sql }) => snapshot(sql, 'jobs', a.tenantId))
      await expectForbidden(
        tx.asUser(
          a.tenantId,
          ({ sql }) => sql`update public.jobs set status = 'done' where id = ${a.jobId}`,
        ),
      )
      expect(await tx.asSystem(({ sql }) => snapshot(sql, 'jobs', a.tenantId))).toEqual(before)
    }))
})
