// Stale-embedding reads and the model filter against Postgres (01.5-backend-foundation task
// 3.2, Requirement 7.6). The helpers take a Db and run on their own connection, so they can't
// see a rolled-back transaction: this suite commits rows for two unique tenants and deletes
// them in afterAll, as with-actor.db.test.ts does.
//
// countItemsNeedingReembed() counts every tenant, so the suite measures the change from a
// baseline taken before its own items get search_text, and compares against a model name no
// other run uses.
import { randomUUID } from 'node:crypto'
import { type TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type UserActor } from './actor'
import { embeddingScope } from './embeddings'
import { countItemsNeedingReembed, selectStaleItems } from './maintenance'
import { withActor } from './scoped'
import { withSystem } from './system'
import { type Chain, deleteTenants, seedChain, uniqueTenant } from './test-fixtures'
import { testDb } from './testing'

const A = uniqueTenant('embed_a')
const B = uniqueTenant('embed_b')
const MODEL = `test-embed-${randomUUID()}`
const userA: UserActor = { kind: 'user', userId: A, tenantId: A }

let baseline: number
// Item IDs by case.
const ids = {} as Record<
  'nullModel' | 'otherModel' | 'sameModel' | 'noSearchText' | 'otherTenant',
  string
>

async function addItem(
  sql: TransactionSql,
  chain: Chain,
  searchText: string | null,
  model: string | null,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into public.items
      (tenant_id, user_id, goal_id, source_id, goal_version, data, title, search_text, embedding_model)
    values
      (${chain.tenantId}, ${chain.tenantId}, ${chain.goalId}, ${chain.sourceId}, 1,
       ${sql.json({})}, 'Item', ${searchText}, ${model})
    returning id`
  return row.id
}

beforeAll(async () => {
  baseline = await countItemsNeedingReembed(testDb(), MODEL)
  await withSystem(testDb(), async ({ sql }) => {
    const chainA = await seedChain(sql, A)
    const chainB = await seedChain(sql, B)
    ids.nullModel = await addItem(sql, chainA, 'soup', null)
    ids.otherModel = await addItem(sql, chainA, 'stew', 'some-older-model')
    ids.sameModel = await addItem(sql, chainA, 'salad', MODEL)
    ids.noSearchText = await addItem(sql, chainA, null, null)
    ids.otherTenant = await addItem(sql, chainB, 'bread', null)
  })
})

afterAll(async () => {
  await withSystem(testDb(), ({ sql }) => deleteTenants(sql, [A, B]))
})

describe('countItemsNeedingReembed', () => {
  it('counts null and different models across tenants, not current or unindexed items', async () => {
    // nullModel, otherModel and otherTenant. seedChain's own items have no search_text.
    expect((await countItemsNeedingReembed(testDb(), MODEL)) - baseline).toBe(3)
  })
})

describe('selectStaleItems', () => {
  it('returns exactly the stale items, with their owners, ordered by tenant then id', async () => {
    const all = await selectStaleItems(testDb(), MODEL, 100_000)
    const ours = all.filter((i) => i.tenantId === A || i.tenantId === B)
    expect(new Set(ours.map((i) => i.id))).toEqual(
      new Set([ids.nullModel, ids.otherModel, ids.otherTenant]),
    )
    expect(ours.find((i) => i.id === ids.otherTenant)).toEqual({
      id: ids.otherTenant,
      tenantId: B,
      userId: B,
    })
    const sorted = [...ours].sort((x, y) =>
      x.tenantId === y.tenantId ? cmp(x.id, y.id) : cmp(x.tenantId, y.tenantId),
    )
    expect(ours).toEqual(sorted)
  })

  it('respects the limit', async () => {
    expect(await selectStaleItems(testDb(), MODEL, 1)).toHaveLength(1)
  })
})

describe('embeddingScope().filter', () => {
  const scope = embeddingScope({ model: MODEL, dimensions: 1536 })

  it('keeps only items embedded with the configured model', async () => {
    const rows = await withActor(testDb(), userA, ({ sql }) => sql<{ id: string }[]>`
      select id from public.items where ${scope.filter(sql)}`)
    expect(rows.map((r) => r.id)).toEqual([ids.sameModel])
  })

  it('qualifies the column with a table alias', async () => {
    const rows = await withActor(testDb(), userA, ({ sql }) => sql<{ id: string }[]>`
      select i.id from public.items i where ${scope.filter(sql, 'i')}`)
    expect(rows.map((r) => r.id)).toEqual([ids.sameModel])
  })
})

// Postgres orders text by collation and uuids by bytes. The suite's two tenant IDs differ
// first at one letter (embed_a / embed_b) and uuids print as lower-case hex, so plain
// code-unit order matches here; tenants from other suites may not, so they're left out.
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
