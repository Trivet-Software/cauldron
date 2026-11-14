// Schema smoke tests (01.5-backend-foundation task 3.6, Requirements 3.1, 3.2, 3.3, 4.2).
import { PostgresError } from 'postgres'
import { describe, expect, it } from 'vitest'

import { USER_DATA_TABLES, uniqueTenant } from './test-fixtures'
import { asSystem, withRollback } from './testing'

describe('shared schema', () => {
  it('has the ten shared tables', async () => {
    const rows = await asSystem(
      ({ sql }) => sql<{ name: string }[]>`
        select table_name as name from information_schema.tables
        where table_schema = 'public' and table_name in ${sql([...USER_DATA_TABLES])}`,
    )
    expect(rows.map((r) => r.name).sort()).toEqual([...USER_DATA_TABLES].sort())
  })

  it('enables the vector and pg_trgm extensions', async () => {
    const rows = await asSystem(
      ({ sql }) => sql<{ name: string }[]>`
        select extname as name from pg_extension where extname in ('vector', 'pg_trgm')`,
    )
    expect(rows.map((r) => r.name).sort()).toEqual(['pg_trgm', 'vector'])
  })

  it('has one full-text and one vector index on items', async () => {
    const rows = await asSystem(
      ({ sql }) => sql<{ name: string; def: string }[]>`
        select indexname as name, indexdef as def from pg_indexes
        where schemaname = 'public' and tablename = 'items'
          and indexname in ('items_fts_gin', 'items_embedding_hnsw')
        order by indexname`,
    )
    expect(rows.map((r) => r.name)).toEqual(['items_embedding_hnsw', 'items_fts_gin'])
    expect(rows[0].def).toMatch(/USING hnsw \(embedding (extensions\.)?vector_cosine_ops\)/)
    expect(rows[1].def).toMatch(/USING gin \(fts\)/)
  })

  it('requires tenant_id and user_id on every user-data table', async () => {
    const rows = await asSystem(
      ({ sql }) => sql<{ table: string; column: string; nullable: string }[]>`
        select table_name as table, column_name as column, is_nullable as nullable
        from information_schema.columns
        where table_schema = 'public' and table_name in ${sql([...USER_DATA_TABLES])}
          and column_name in ('tenant_id', 'user_id')`,
    )
    expect(rows).toHaveLength(USER_DATA_TABLES.length * 2)
    expect(rows.filter((r) => r.nullable !== 'NO')).toEqual([])
  })

  it('enables RLS on every user-data table', async () => {
    const rows = await asSystem(
      ({ sql }) => sql<{ name: string; rls: boolean }[]>`
        select relname as name, relrowsecurity as rls from pg_class
        where relnamespace = 'public'::regnamespace and relname in ${sql([...USER_DATA_TABLES])}`,
    )
    expect(rows).toHaveLength(USER_DATA_TABLES.length)
    expect(rows.filter((r) => !r.rls)).toEqual([])
  })

  it('reserves the system owner for app goals and only app goals', async () => {
    const tenant = uniqueTenant('schema')
    const insertGoal = (kind: string, owner: string) =>
      withRollback((tx) =>
        tx.asSystem(
          ({ sql }) => sql`
            insert into public.goals (tenant_id, user_id, kind, slug, name)
            values (${owner}, ${owner}, ${kind}, ${tenant}, ${tenant})`,
        ),
      )
    for (const [kind, owner] of [
      ['app', tenant],
      ['draft', 'system'],
    ]) {
      const error = await insertGoal(kind, owner).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PostgresError)
      expect((error as PostgresError).code).toBe('23514')
      expect((error as PostgresError).constraint_name).toBe('goals_app_owned_by_system')
    }
    await expect(insertGoal('app', 'system')).resolves.toBeDefined()
  })
})
