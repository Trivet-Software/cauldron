// Seed data for the schema and isolation suites (01.5-backend-foundation task 3.6).
// For *.db.test.ts only. Seeding runs as the system owner (the connection role), which
// bypasses RLS, so callers pass the `sql` of an asSystem step or a withSystem transaction.
import { randomUUID } from 'node:crypto'
import { type TransactionSql } from 'postgres'

/** The ten shared tables (Requirement 3.1), each holding user data with tenant_id and user_id. */
export const USER_DATA_TABLES = [
  'goals',
  'goal_versions',
  'sources',
  'jobs',
  'items',
  'drafts',
  'pages',
  'page_items',
  'usage',
  'api_keys',
] as const

export type UserDataTable = (typeof USER_DATA_TABLES)[number]

/** The IDs of one tenant's full chain of rows, one row per table. */
export interface Chain {
  tenantId: string
  goalId: string
  goalVersionId: string
  sourceId: string
  jobId: string
  itemId: string
  draftId: string
  pageId: string
  apiKeyId: string
  usageId: string
}

/** A tenant ID that no other test run uses, e.g. `user_iso_a_1f3c...`. */
export function uniqueTenant(label: string): string {
  return `user_${label}_${randomUUID().replaceAll('-', '')}`
}

async function insertId(
  sql: TransactionSql,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const [inserted] = await sql<{ id: string }[]>`
    insert into ${sql(`public.${table}`)} ${sql(row as Record<string, never>)} returning id`
  return inserted.id
}

/**
 * Inserts one row in every user-data table for `tenantId`, linked the way real data is:
 * a draft goal owned by the tenant → goal version, source → item and draft, job, page →
 * page_item, api key → usage. Must run as the system owner.
 */
export async function seedChain(sql: TransactionSql, tenantId: string): Promise<Chain> {
  const owner = { tenant_id: tenantId, user_id: tenantId }
  const goalId = await insertId(sql, 'goals', {
    ...owner,
    kind: 'draft',
    slug: `goal-${randomUUID()}`,
    name: `Goal ${randomUUID()}`,
  })
  const goalVersionId = await insertId(sql, 'goal_versions', {
    ...owner,
    goal_id: goalId,
    version: 1,
    schema_version: 1,
    spec: sql.json({}),
    content_hash: 'hash',
    author: tenantId,
  })
  const sourceId = await insertId(sql, 'sources', {
    ...owner,
    goal_id: goalId,
    kind: 'text',
    client: 'web',
  })
  const jobId = await insertId(sql, 'jobs', { ...owner, type: 'ping' })
  const itemId = await insertId(sql, 'items', {
    ...owner,
    goal_id: goalId,
    source_id: sourceId,
    goal_version: 1,
    data: sql.json({}),
    title: 'Item',
  })
  const draftId = await insertId(sql, 'drafts', {
    ...owner,
    goal_id: goalId,
    source_id: sourceId,
    job_id: jobId,
    data: sql.json({}),
  })
  const pageId = await insertId(sql, 'pages', {
    ...owner,
    goal_id: goalId,
    group_key: 'group',
    title: 'Page',
  })
  await sql`
    insert into public.page_items (page_id, item_id, tenant_id, user_id)
    values (${pageId}, ${itemId}, ${tenantId}, ${tenantId})`
  const apiKeyId = await insertId(sql, 'api_keys', {
    ...owner,
    name: 'Key',
    prefix: `ck_${randomUUID()}`,
    key_hash: 'hash',
  })
  const usageId = await insertId(sql, 'usage', {
    ...owner,
    api_key_id: apiKeyId,
    job_id: jobId,
    operation: 'compile',
    provider: 'mock',
    model: 'mock-1',
  })
  return {
    tenantId,
    goalId,
    goalVersionId,
    sourceId,
    jobId,
    itemId,
    draftId,
    pageId,
    apiKeyId,
    usageId,
  }
}

/** Every row of `tenantId` in `table`, as JSON, in a stable order. Run as the system owner. */
export async function snapshot(
  sql: TransactionSql,
  table: UserDataTable,
  tenantId: string,
): Promise<unknown[]> {
  const rows = await sql<{ row: unknown }[]>`
    select to_jsonb(t) as row from ${sql(`public.${table}`)} t
    where t.tenant_id = ${tenantId}
    order by to_jsonb(t)::text`
  return rows.map((r) => r.row)
}

/** Deletes every row of the given tenants, children first. Run as the system owner. */
export async function deleteTenants(sql: TransactionSql, tenantIds: string[]): Promise<void> {
  for (const table of [
    'page_items',
    'pages',
    'drafts',
    'items',
    'sources',
    'usage',
    'api_keys',
    'jobs',
    'goal_versions',
    'goals',
  ] as const) {
    await sql`delete from ${sql(`public.${table}`)} where tenant_id in ${sql(tenantIds)}`
  }
}
