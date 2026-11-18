// Walking-skeleton migration tests (01.7-walking-skeleton task 2.2, Requirement 3.6).
import { PostgresError } from 'postgres'
import { describe, expect, it } from 'vitest'

import { seedChain, uniqueTenant } from './test-fixtures'
import { asSystem, withRollback } from './testing'

describe('walking-skeleton migration', () => {
  it('rejects a second item at the same (tenant, source, ordinal) and accepts another ordinal', async () => {
    const tenant = uniqueTenant('skeleton')
    await withRollback(async (tx) => {
      // seedChain inserts one item for the source, at the default ordinal 0.
      const chain = await tx.asSystem(({ sql }) => seedChain(sql, tenant))
      const insertItem = (ordinal: number) =>
        tx.asSystem(
          ({ sql }) => sql<{ ordinal: number }[]>`
            insert into public.items
              (tenant_id, user_id, goal_id, source_id, ordinal, goal_version, data, title)
            select ${tenant}, ${tenant}, goal_id, id, ${ordinal}, 1, '{}'::jsonb, 'Item'
            from public.sources where id = ${chain.sourceId}
            returning ordinal`,
        )

      const error = await insertItem(0).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PostgresError)
      expect((error as PostgresError).code).toBe('23505')
      expect((error as PostgresError).constraint_name).toBe('items_tenant_source_ordinal_key')

      // The failed step rolled back to its savepoint, so the transaction is still usable.
      await expect(insertItem(1)).resolves.toEqual([{ ordinal: 1 }])
      const rows = await tx.asSystem(
        ({ sql }) => sql<{ ordinal: number }[]>`
          select ordinal from public.items
          where tenant_id = ${tenant} and source_id = ${chain.sourceId}
          order by ordinal`,
      )
      expect(rows.map((r) => r.ordinal)).toEqual([0, 1])
    })
  })

  it('allows the same ordinal for different sources', async () => {
    const tenant = uniqueTenant('skeleton')
    await withRollback(async (tx) => {
      const chain = await tx.asSystem(({ sql }) => seedChain(sql, tenant))
      const rows = await tx.asSystem(
        ({ sql }) => sql<{ ordinal: number }[]>`
          with other as (
            insert into public.sources (tenant_id, user_id, goal_id, kind, client)
            values (${tenant}, ${tenant}, ${chain.goalId}, 'text', 'web')
            returning id
          )
          insert into public.items
            (tenant_id, user_id, goal_id, source_id, ordinal, goal_version, data, title)
          select ${tenant}, ${tenant}, ${chain.goalId}, id, 0, 1, '{}'::jsonb, 'Other'
          from other
          returning ordinal`,
      )
      expect(rows).toEqual([{ ordinal: 0 }])
    })
  })

  it('rejects a negative ordinal', async () => {
    const tenant = uniqueTenant('skeleton')
    const error = await withRollback(async (tx) => {
      const chain = await tx.asSystem(({ sql }) => seedChain(sql, tenant))
      return tx
        .asSystem(
          ({ sql }) => sql`
            insert into public.items
              (tenant_id, user_id, goal_id, source_id, ordinal, goal_version, data, title)
            values (${tenant}, ${tenant}, ${chain.goalId}, ${chain.sourceId}, -1, 1, '{}'::jsonb, 'Item')`,
        )
        .catch((e: unknown) => e)
    })
    expect(error).toBeInstanceOf(PostgresError)
    expect((error as PostgresError).code).toBe('23514')
  })

  it('creates the title trigram index and the compile-job lookup index', async () => {
    const rows = await asSystem(
      ({ sql }) => sql<{ name: string; def: string }[]>`
        select indexname as name, indexdef as def from pg_indexes
        where schemaname = 'public'
          and indexname in ('items_search_text_trgm', 'jobs_compile_source')
        order by indexname`,
    )
    expect(rows.map((r) => r.name)).toEqual(['items_search_text_trgm', 'jobs_compile_source'])
    const [trgm, compile] = rows.map((r) => r.def)
    expect(trgm).toMatch(/ON public\.items USING gin \(search_text (extensions\.)?gin_trgm_ops\)/)
    expect(compile).toMatch(/ON public\.jobs/)
    expect(compile).toMatch(/WHERE \(type = 'compile'/)
  })
})
