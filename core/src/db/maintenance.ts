// `@cauldron/core/db/maintenance`: cross-tenant reads for embedding-model changes
// (01.5-backend-foundation task 3.2, Requirement 7.6; design, "Embedding model changes").
//
// These run on the privileged pool, which bypasses RLS, because both callers look across
// every tenant: the API's /health counts stale items, and the worker's re-embed scheduler
// picks the next batch and enqueues one `reembed` job per tenant. They're kept off
// `@cauldron/core/db` so that subpath stays scoped-only, and ESLint lets only those two
// modules import this one. They return IDs and counts, never item content: the `reembed`
// handler loads the rows itself through its tenant's scope.
import { type Db, rawSql } from './internal'

/** An item whose embedding is missing or from another model, with its owner. */
export interface StaleItem {
  id: string
  tenantId: string
  userId: string
}

/** Items with `search_text` whose `embedding_model` is null or differs from `model`. */
export async function countItemsNeedingReembed(db: Db, model: string): Promise<number> {
  assertModel(model)
  const sql = rawSql(db)
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from public.items
    where search_text is not null and embedding_model is distinct from ${model}`
  return row.count
}

/**
 * Up to `limit` stale items (as countItemsNeedingReembed defines them), ordered by tenant and
 * then item ID so the scheduler's per-tenant batches and dedupe keys are stable between runs.
 */
export async function selectStaleItems(
  db: Db,
  model: string,
  limit: number,
): Promise<StaleItem[]> {
  assertModel(model)
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError(`selectStaleItems() needs a positive integer limit, got ${limit}.`)
  }
  const sql = rawSql(db)
  const rows = await sql<{ id: string; tenant_id: string; user_id: string }[]>`
    select id, tenant_id, user_id
    from public.items
    where search_text is not null and embedding_model is distinct from ${model}
    order by tenant_id, id
    limit ${limit}`
  return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, userId: r.user_id }))
}

function assertModel(model: string): void {
  if (typeof model !== 'string' || model === '') {
    throw new TypeError('An embedding model name is required.')
  }
}
