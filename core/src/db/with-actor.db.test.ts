// withActor() against the real policies (01.5-backend-foundation task 3.6, Requirements 4.3
// and 4.4). withActor() and withSystem() commit, so this suite seeds two tenants with unique
// IDs once and deletes every row they own in afterAll.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type UserActor } from './actor'
import { ForbiddenError } from './errors'
import { withActor } from './scoped'
import { withSystem } from './system'
import {
  type Chain,
  USER_DATA_TABLES,
  deleteTenants,
  seedChain,
  snapshot,
  uniqueTenant,
} from './test-fixtures'
import { testDb } from './testing'

const A = uniqueTenant('actor_a')
const B = uniqueTenant('actor_b')
const userA: UserActor = { kind: 'user', userId: A, tenantId: A }
const userB: UserActor = { kind: 'user', userId: B, tenantId: B }

let chainA: Chain

beforeAll(async () => {
  chainA = await withSystem(testDb(), ({ sql }) => seedChain(sql, A))
  await withSystem(testDb(), ({ sql }) => seedChain(sql, B))
})

afterAll(async () => {
  await withSystem(testDb(), ({ sql }) => deleteTenants(sql, [A, B]))
  const left = await withSystem(testDb(), async ({ sql }) => {
    let count = 0
    for (const name of USER_DATA_TABLES) count += (await snapshot(sql, name, A)).length
    for (const name of USER_DATA_TABLES) count += (await snapshot(sql, name, B)).length
    return count
  })
  expect(left).toBe(0)
})

describe('withActor', () => {
  it.each(USER_DATA_TABLES)('returns only the actor\'s rows from %s', async (name) => {
    for (const [actor, tenant] of [
      [userA, A],
      [userB, B],
    ] as const) {
      const rows = await withActor(
        testDb(),
        actor,
        ({ sql }) => sql<{ tenant_id: string }[]>`
          select tenant_id from ${sql(`public.${name}`)} where tenant_id in ${sql([A, B])}`,
      )
      expect(rows.length).toBeGreaterThan(0)
      expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([tenant]))
    }
  })

  it('exposes the actor\'s tenant on the scope', async () => {
    expect(await withActor(testDb(), userA, async (scope) => scope.tenantId)).toBe(A)
    expect(await withActor(testDb(), { kind: 'anonymous' }, async (s) => s.tenantId)).toBeNull()
  })

  it("leaves another tenant's rows unchanged when updating and deleting through them", async () => {
    const before = await withSystem(testDb(), ({ sql }) => snapshot(sql, 'items', A))
    const result = await withActor(testDb(), userB, async ({ sql }) => ({
      updated: (await sql`update public.items set title = 'x' where id = ${chainA.itemId}`).count,
      deleted: (await sql`delete from public.items where id = ${chainA.itemId}`).count,
    }))
    expect(result).toEqual({ updated: 0, deleted: 0 })
    expect(await withSystem(testDb(), ({ sql }) => snapshot(sql, 'items', A))).toEqual(before)
  })

  it('maps a write into another tenant to ForbiddenError', async () => {
    await expect(
      withActor(testDb(), userB, ({ sql }) => sql`
        insert into public.jobs (tenant_id, user_id, type) values (${A}, ${A}, 'ping')`),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('gives anonymous actors none of the tenants\' private rows', async () => {
    const goals = await withActor(
      testDb(),
      { kind: 'anonymous' },
      ({ sql }) => sql`select 1 from public.goals where tenant_id in ${sql([A, B])}`,
    )
    expect(goals).toHaveLength(0)
    await expect(
      withActor(testDb(), { kind: 'anonymous' }, ({ sql }) => sql`select 1 from public.sources`),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("doesn't leak the role or claims to the next use of a pooled connection", async () => {
    await withActor(testDb(), userA, ({ sql }) => sql`select 1`)
    // A pool of 4 connections; run enough transactions to reuse every one.
    for (let i = 0; i < 8; i++) {
      const [row] = await withSystem(
        testDb(),
        ({ sql }) => sql<{ role: string; claims: string | null }[]>`
          select current_user as role,
            nullif(current_setting('request.jwt.claims', true), '') as claims`,
      )
      expect(row.role).not.toMatch(/^(anon|authenticated)$/)
      expect(row.claims).toBeNull()
    }
  })
})
