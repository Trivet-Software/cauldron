// The collection repository: every SQL statement the walking skeleton needs
// (01.7-walking-skeleton task 5.2, design.md, "Collection repository"). Functions take a
// Scoped, so they run under the caller's RLS context; `createCollectionStore` in ./store wraps
// them in withActor(). Hand-written SQL with tagged-template parameters only, no named
// prepared statements (the pooler is transaction-mode).
//
// RLS also lets a user read public demo tenants' items and every app goal, so each statement
// that reads user data names `tenant_id` explicitly instead of relying on policies alone.
import { type CompileState, deriveCompileState, type JobSnapshot } from '../compile'
import { SYSTEM_OWNER, type Scoped } from '../db'
import { type GoalFile, goalFields } from '../goals'
import { enqueue, type JobStatus } from '../queue'

import { escapeLike } from './like'
import {
  type CaptureClient,
  type CaptureKind,
  type CaptureMetadata,
  type CompileInput,
  type GoalRecord,
  type ItemEntry,
  type ItemRecord,
  type ListItemsQuery,
  type NewCapture,
  type NewItem,
  type NewUsage,
  type SourceStatus,
} from './types'

// The driver's JSON parameter type, taken from the scope so this module needn't import the
// raw driver (ESLint confines that to core/src/db and core/src/queue).
type JsonParam = Parameters<Scoped['sql']['json']>[0]

const UNTITLED_CAPTURE = 'Untitled capture'

function userScope(scope: Scoped, fn: string): { userId: string; tenantId: string } {
  if (scope.actor.kind !== 'user' || scope.tenantId === null) {
    throw new TypeError(`${fn}() needs a user scope.`)
  }
  return { userId: scope.actor.userId, tenantId: scope.tenantId }
}

// The latest compile job's columns, all null when the source has no job.
interface JobColumns {
  status: JobStatus | null
  stage: string | null
  outcome: string | null
  failure_reason: string | null
}

function stateOf(
  hasItem: boolean,
  row: JobColumns,
): { state: CompileState; failureReason: string | null } {
  const job: JobSnapshot | null =
    row.status === null
      ? null
      : {
          status: row.status,
          stage: row.stage,
          outcome: row.outcome,
          failureReason: row.failure_reason,
        }
  return deriveCompileState(hasItem, job)
}

// ---------------------------------------------------------------------------------------
// Goals

interface GoalRow {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  accent_color: string | null
  latest_version: number
  spec: unknown
}

function toGoalRecord(row: GoalRow): GoalRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    accentColor: row.accent_color,
    version: row.latest_version,
    // Only registerGoal writes app-goal versions, and only after goalFileSchema accepted them.
    spec: row.spec as GoalFile,
  }
}

/** App goals by name. Readable by every actor, anonymous included (RLS `goals_system_read`). */
export async function listGoals(scope: Scoped): Promise<GoalRecord[]> {
  const rows = await scope.sql<GoalRow[]>`
    select g.id, g.slug, g.name, g.description, g.icon, g.accent_color,
           g.latest_version, v.spec
    from public.goals g
    join public.goal_versions v
      on v.tenant_id = g.tenant_id and v.goal_id = g.id and v.version = g.latest_version
    where g.tenant_id = ${SYSTEM_OWNER} and g.kind = 'app' and g.latest_version is not null
    order by g.name`
  return rows.map(toGoalRecord)
}

export async function getGoal(scope: Scoped, slug: string): Promise<GoalRecord | null> {
  const rows = await scope.sql<GoalRow[]>`
    select g.id, g.slug, g.name, g.description, g.icon, g.accent_color,
           g.latest_version, v.spec
    from public.goals g
    join public.goal_versions v
      on v.tenant_id = g.tenant_id and v.goal_id = g.id and v.version = g.latest_version
    where g.tenant_id = ${SYSTEM_OWNER} and g.kind = 'app' and g.slug = ${slug}
      and g.latest_version is not null`
  return rows[0] ? toGoalRecord(rows[0]) : null
}

// ---------------------------------------------------------------------------------------
// Capture and status

/**
 * Inserts the source and enqueues its `compile` job in the caller's transaction, so a failure
 * in either leaves neither (Requirements 2.4 and 2.5). The dedupe key makes a repeated enqueue
 * for one source a no-op.
 */
export async function createCapture(
  scope: Scoped,
  input: NewCapture,
): Promise<{ sourceId: string; state: CompileState }> {
  const { userId, tenantId } = userScope(scope, 'createCapture')
  const { sql } = scope
  const metadata = sql.json(input.metadata as unknown as JsonParam)

  await sql`
    insert into public.sources
      (id, tenant_id, user_id, goal_id, kind, storage_paths, client, metadata)
    values (${input.sourceId}, ${tenantId}, ${userId}, ${input.goalId}, ${input.kind},
            ${[input.storagePath]}::text[], ${input.client}, ${metadata})`

  const job = await enqueue(scope, {
    type: 'compile',
    payload: { sourceId: input.sourceId },
    dedupeKey: `compile:${input.sourceId}`,
  })
  if (job === null) {
    // Only possible if a compile job for this source ID already exists; rolling back keeps
    // "one source, one job" true.
    throw new Error(`A compile job for source ${input.sourceId} already exists.`)
  }

  const { state } = deriveCompileState(false, {
    status: job.status,
    stage: job.stage,
    outcome: job.outcome,
    failureReason: job.failureReason,
  })
  return { sourceId: input.sourceId, state }
}

interface SourceRow extends JobColumns {
  id: string
  goal_slug: string
  kind: CaptureKind
  client: CaptureClient | 'api'
  captured_at: Date
  item_id: string | null
}

export async function getSource(scope: Scoped, sourceId: string): Promise<SourceStatus | null> {
  const { tenantId } = userScope(scope, 'getSource')
  const rows = await scope.sql<SourceRow[]>`
    select s.id, g.slug as goal_slug, s.kind, s.client, s.captured_at, i.id as item_id,
           j.status, j.stage, j.outcome, j.failure_reason
    from public.sources s
    join public.goals g on g.id = s.goal_id
    left join public.items i
      on i.tenant_id = s.tenant_id and i.source_id = s.id and i.ordinal = 0
    left join lateral (
      select status, stage, outcome, failure_reason
      from public.jobs
      where tenant_id = s.tenant_id and type = 'compile' and payload->>'sourceId' = s.id::text
      order by created_at desc
      limit 1
    ) j on true
    where s.tenant_id = ${tenantId} and s.id = ${sourceId}`
  const row = rows[0]
  if (!row) return null

  const { state, failureReason } = stateOf(row.item_id !== null, row)
  return {
    id: row.id,
    goal: row.goal_slug,
    kind: row.kind,
    client: row.client,
    capturedAt: row.captured_at.toISOString(),
    state,
    failureReason,
    itemId: row.item_id,
  }
}

// ---------------------------------------------------------------------------------------
// Items

interface EntryRow extends JobColumns {
  source_id: string
  item_id: string | null
  title: string
  captured_at: Date
}

/**
 * One entry per source in the goal, newest capture first, so pending and failed captures
 * appear (Requirements 6.1 and 4.1). With `q`, only compiled items whose `search_text`
 * contains `q` case-insensitively, best trigram match first (Requirement 6.2).
 */
export async function listItems(scope: Scoped, query: ListItemsQuery): Promise<ItemEntry[]> {
  const { tenantId } = userScope(scope, 'listItems')
  const { sql } = scope
  const term = query.q?.trim() ?? ''
  const hasTerm = term !== ''
  const pattern = `%${escapeLike(term)}%`

  const filter = hasTerm
    ? sql`and i.id is not null and i.search_text ilike ${pattern}::text escape '\\'`
    : sql``
  const order = hasTerm
    ? sql`order by extensions.similarity(i.search_text, ${term}::text) desc, s.captured_at desc`
    : sql`order by s.captured_at desc`

  const rows = await sql<EntryRow[]>`
    select s.id as source_id, i.id as item_id,
           coalesce(i.title, s.metadata->>'label', ${UNTITLED_CAPTURE}) as title,
           s.captured_at,
           j.status, j.stage, j.outcome, j.failure_reason
    from public.sources s
    join public.goals g
      on g.id = s.goal_id and g.tenant_id = ${SYSTEM_OWNER} and g.kind = 'app'
      and g.slug = ${query.goalSlug}
    left join public.items i
      on i.tenant_id = s.tenant_id and i.source_id = s.id and i.ordinal = 0
    left join lateral (
      select status, stage, outcome, failure_reason
      from public.jobs
      where tenant_id = s.tenant_id and type = 'compile' and payload->>'sourceId' = s.id::text
      order by created_at desc
      limit 1
    ) j on true
    where s.tenant_id = ${tenantId}
    ${filter}
    ${order}
    limit ${query.limit}`

  return rows.map((row) => {
    const { state, failureReason } = stateOf(row.item_id !== null, row)
    return {
      id: row.item_id,
      sourceId: row.source_id,
      title: row.title,
      state,
      failureReason,
      capturedAt: row.captured_at.toISOString(),
    }
  })
}

interface ItemRow {
  id: string
  source_id: string
  goal_slug: string
  goal_version: number
  title: string
  data: Record<string, unknown>
  captured_at: Date
  spec: GoalFile | null
}

/** Null for a missing item and for another tenant's, which the caller can't tell apart. */
export async function getItem(scope: Scoped, itemId: string): Promise<ItemRecord | null> {
  const { tenantId } = userScope(scope, 'getItem')
  const rows = await scope.sql<ItemRow[]>`
    select i.id, i.source_id, g.slug as goal_slug, i.goal_version, i.title, i.data,
           s.captured_at, v.spec
    from public.items i
    join public.sources s on s.tenant_id = i.tenant_id and s.id = i.source_id
    join public.goals g on g.id = i.goal_id
    left join public.goal_versions v
      on v.tenant_id = g.tenant_id and v.goal_id = g.id and v.version = i.goal_version
    where i.tenant_id = ${tenantId} and i.id = ${itemId}`
  const row = rows[0]
  if (!row) return null

  const imageKey = row.spec ? goalFields(row.spec).find((f) => f.kind === 'image')?.key : undefined
  const imageValue = imageKey === undefined ? undefined : row.data[imageKey]
  return {
    id: row.id,
    sourceId: row.source_id,
    goalSlug: row.goal_slug,
    goalVersion: row.goal_version,
    title: row.title,
    data: row.data,
    imagePath: typeof imageValue === 'string' && imageValue !== '' ? imageValue : null,
    capturedAt: row.captured_at.toISOString(),
  }
}

// ---------------------------------------------------------------------------------------
// Worker side: run inside the job user's `ctx.scope()`.

interface CompileInputRow {
  source_id: string
  kind: CaptureKind
  storage_path: string | null
  metadata: Partial<CaptureMetadata> | null
  goal_id: string
  goal_slug: string
  goal_version: number
  spec: GoalFile
}

/**
 * The source and its goal's latest version, or null when either is missing (the handler turns
 * that into a non-retryable failure). The goal may be an app goal or one of the user's own.
 */
export async function loadCompileInput(
  scope: Scoped,
  sourceId: string,
): Promise<CompileInput | null> {
  const { tenantId } = userScope(scope, 'loadCompileInput')
  const rows = await scope.sql<CompileInputRow[]>`
    select s.id as source_id, s.kind, s.storage_paths[1] as storage_path, s.metadata,
           g.id as goal_id, g.slug as goal_slug, g.latest_version as goal_version, v.spec
    from public.sources s
    join public.goals g
      on g.id = s.goal_id and g.tenant_id in (${SYSTEM_OWNER}, ${tenantId})
    join public.goal_versions v
      on v.tenant_id = g.tenant_id and v.goal_id = g.id and v.version = g.latest_version
    where s.tenant_id = ${tenantId} and s.id = ${sourceId}`
  const row = rows[0]
  if (!row) return null

  const stored = row.metadata ?? {}
  return {
    sourceId: row.source_id,
    kind: row.kind,
    storagePath: row.storage_path,
    metadata: {
      label: stored.label ?? UNTITLED_CAPTURE,
      ...(stored.filename === undefined ? {} : { filename: stored.filename }),
      contentType: stored.contentType ?? 'application/octet-stream',
      bytes: stored.bytes ?? 0,
    },
    goal: { id: row.goal_id, slug: row.goal_slug, version: row.goal_version, spec: row.spec },
  }
}

/**
 * Saves the source's one item (ordinal 0), replacing it when the job runs again, so a retry
 * or a lost-lease re-run leaves exactly one item (Requirement 3.6). `search_text` is the
 * title (Requirement 3.7); `fts` and `embedding` stay at their defaults until search fills them.
 */
export async function saveItem(scope: Scoped, item: NewItem): Promise<{ itemId: string }> {
  const { userId, tenantId } = userScope(scope, 'saveItem')
  const { sql } = scope
  const data = sql.json(item.data as JsonParam)
  const provenance = sql.json(item.provenance as JsonParam)

  const rows = await sql<{ id: string }[]>`
    insert into public.items
      (tenant_id, user_id, goal_id, source_id, ordinal, goal_version, data, provenance,
       title, search_text)
    values (${tenantId}, ${userId}, ${item.goalId}, ${item.sourceId}, 0, ${item.goalVersion},
            ${data}, ${provenance}, ${item.title}, ${item.title})
    on conflict (tenant_id, source_id, ordinal)
    do update set goal_version = excluded.goal_version,
                  data = excluded.data,
                  provenance = excluded.provenance,
                  title = excluded.title,
                  search_text = excluded.search_text
    returning id`
  const row = rows[0]
  if (!row) throw new Error('Saving the item returned no row.')
  return { itemId: row.id }
}

/**
 * Records one LLM call's spend. The idempotency key makes a retried compile count once; the
 * call cost money whether or not an earlier run recorded it first, so a conflict is not an error.
 */
export async function recordCompileUsage(scope: Scoped, usage: NewUsage): Promise<void> {
  const { userId, tenantId } = userScope(scope, 'recordCompileUsage')
  await scope.sql`
    insert into public.usage
      (tenant_id, user_id, job_id, operation, provider, model,
       input_tokens, output_tokens, cost_usd, idempotency_key)
    values (${tenantId}, ${userId}, ${usage.jobId ?? null}, 'compile', ${usage.provider},
            ${usage.model}, ${usage.inputTokens}, ${usage.outputTokens},
            ${Number(usage.costUsd.toFixed(6))}, ${`compile:${usage.sourceId}`})
    on conflict (idempotency_key) do nothing`
}
