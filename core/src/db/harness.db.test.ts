// Smoke test for the integration-test harness itself (task 3.5).
import { type TransactionSql } from 'postgres'
import { describe, expect, it } from 'vitest'

import { ForbiddenError } from './errors'
import { asAnon, asSystem, asUser, withRollback } from './testing'

const TENANT = 'user_harness_smoke'

async function currentRole(sql: TransactionSql) {
  const [row] = await sql<{ role: string; sub: string | null }[]>`
    select current_user as role, auth.jwt() ->> 'sub' as sub`
  return row
}

describe('db test harness', () => {
  it('runs asUser as authenticated with the user as sub', async () => {
    const row = await asUser(TENANT, async ({ sql, tenantId }) => {
      expect(tenantId).toBe(TENANT)
      return currentRole(sql)
    })
    expect(row).toEqual({ role: 'authenticated', sub: TENANT })
  })

  it('runs asAnon as anon with no sub', async () => {
    expect(await asAnon(({ sql }) => currentRole(sql))).toEqual({ role: 'anon', sub: null })
  })

  it('runs asSystem as the connection role', async () => {
    const row = await asSystem(({ sql }) => currentRole(sql))
    expect(row.role).not.toMatch(/^(anon|authenticated)$/)
  })

  it('rolls back writes after the test passes', async () => {
    await asSystem(async ({ sql }) => {
      await sql`insert into public.public_tenants (tenant_id) values (${TENANT})`
    })
    const rows = await asSystem(
      ({ sql }) => sql`select 1 from public.public_tenants where tenant_id = ${TENANT}`,
    )
    expect(rows).toHaveLength(0)
  })

  it('adds a public tenant visible to policies, then rolls it back', async () => {
    await withRollback(async (tx) => {
      const before = await tx.asAnon(
        ({ sql }) => sql`select private.is_public_tenant(${TENANT}) as yes`,
      )
      expect(before[0].yes).toBe(false)
      await tx.addPublicTenant(TENANT)
      const after = await tx.asAnon(
        ({ sql }) => sql`select private.is_public_tenant(${TENANT}) as yes`,
      )
      expect(after[0].yes).toBe(true)
    })
    const rows = await asSystem(
      ({ sql }) => sql`select 1 from public.public_tenants where tenant_id = ${TENANT}`,
    )
    expect(rows).toHaveLength(0)
  })

  it('maps permission errors to ForbiddenError and keeps the transaction usable', async () => {
    await withRollback(async (tx) => {
      await expect(
        tx.asAnon(({ sql }) => sql`select * from public.public_tenants`),
      ).rejects.toBeInstanceOf(ForbiddenError)
      // Roles switch per step, and the failed step didn't abort the transaction.
      expect((await tx.asUser(TENANT, ({ sql }) => currentRole(sql))).role).toBe('authenticated')
      expect((await tx.asAnon(({ sql }) => currentRole(sql))).role).toBe('anon')
    })
  })
})
