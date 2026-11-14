// The Postgres job queue (01.5-backend-foundation task 6.1, Requirements 6.1 and 6.2).
// See design.md, "Job Queue" and "Job Lifecycle (Worker)".
//
// enqueue() runs inside a caller's withActor() scope, so RLS decides whose job it is. The
// rest run on the privileged pool: claim() and reapExpired() must cross tenants, and the
// post-claim writes belong to the worker, not to the job's user.
//
// Fencing: every write after a claim matches `id`, `attempts` and `status = 'running'`. A
// re-claim by another worker increments `attempts`, so a worker that lost its lease writes
// zero rows and learns it from the return value. Delivery is at least once; handlers must
// be idempotent.
import type postgres from 'postgres'

import { type Scoped } from '../db'
import { type Db, rawSql } from '../db/internal'

import { NonRetryableError } from './errors'
import {
  type ClaimedJob,
  type EnqueueOptions,
  type FailOptions,
  type FailResult,
  type Job,
  type JobStatus,
  LEASE_SECONDS,
  type ReapedJob,
} from './types'

const DEFAULT_MAX_ATTEMPTS = 3
/** Retry backoff is 2^attempts seconds, capped so a large max_attempts can't stall a job for days. */
const MAX_BACKOFF_SECONDS = 3600
/** last_error is for operators; keep a runaway message from bloating the row. */
const MAX_ERROR_LENGTH = 2000

interface JobRow {
  id: string
  tenant_id: string
  user_id: string
  type: string
  payload: unknown
  status: JobStatus
  stage: string | null
  outcome: string | null
  attempts: number
  max_attempts: number
  run_after: Date
  lease_expires_at: Date | null
  locked_by: string | null
  last_error: string | null
  failure_reason: string | null
  dedupe_key: string | null
  started_at: Date | null
  finished_at: Date | null
  created_at: Date
  updated_at: Date
}

function toJob<P>(row: JobRow): Job<P> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    type: row.type,
    payload: row.payload as P,
    status: row.status,
    stage: row.stage,
    outcome: row.outcome,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    leaseExpiresAt: row.lease_expires_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    failureReason: row.failure_reason,
    dedupeKey: row.dedupe_key,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Queues a job for the scope's user. With a `dedupeKey`, returns null instead of inserting
 * when that user already has a queued or running job with the same key.
 */
export async function enqueue<P = unknown>(
  scope: Scoped,
  options: EnqueueOptions<P>,
): Promise<Job<P> | null> {
  if (scope.actor.kind !== 'user' || scope.tenantId === null) {
    throw new TypeError('enqueue() needs a user scope; jobs belong to a user.')
  }
  if (options.type === '') throw new TypeError('A job needs a non-empty type.')
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be a positive integer, got ${maxAttempts}.`)
  }

  const { sql } = scope
  // One tenant per account: tenant and user are both the actor's `sub` (Requirement 2.2).
  const owner = scope.actor.userId
  const payload = sql.json((options.payload ?? {}) as postgres.JSONValue)
  const runAfter = options.runAfter ?? null
  const dedupeKey = options.dedupeKey ?? null

  const rows =
    dedupeKey === null
      ? await sql<JobRow[]>`
          insert into public.jobs (tenant_id, user_id, type, payload, max_attempts, run_after)
          values (${owner}, ${owner}, ${options.type}, ${payload}, ${maxAttempts},
                  coalesce(${runAfter}::timestamptz, now()))
          returning *`
      : await sql<JobRow[]>`
          insert into public.jobs
            (tenant_id, user_id, type, payload, max_attempts, run_after, dedupe_key)
          values (${owner}, ${owner}, ${options.type}, ${payload}, ${maxAttempts},
                  coalesce(${runAfter}::timestamptz, now()), ${dedupeKey})
          on conflict (tenant_id, dedupe_key) where status in ('queued', 'running')
          do nothing
          returning *`
  return rows[0] ? toJob<P>(rows[0]) : null
}

/**
 * Claims the oldest runnable queued job of one of `types`, leasing it to `workerId` for
 * 60 s and counting the attempt. Returns null when nothing is claimable. Only types the
 * worker has handlers for should be passed, so jobs of newer types wait for a newer worker.
 */
export async function claim(
  db: Db,
  workerId: string,
  types: readonly string[],
): Promise<Job | null> {
  if (types.length === 0) return null
  const sql = rawSql(db)
  const rows = await sql<JobRow[]>`
    with next as (
      select id
      from public.jobs
      where status = 'queued'
        and run_after <= now()
        and type = any(${types as string[]}::text[])
      order by run_after, created_at
      for update skip locked
      limit 1
    )
    update public.jobs j
    set status = 'running',
        attempts = j.attempts + 1,
        locked_by = ${workerId},
        lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS}),
        started_at = now()
    from next
    where j.id = next.id
    returning j.*`
  return rows[0] ? toJob(rows[0]) : null
}

/** Extends the lease by 60 s. Returns false when the lease was lost. */
export async function heartbeat(db: Db, job: ClaimedJob): Promise<boolean> {
  const sql = rawSql(db)
  const result = await sql`
    update public.jobs
    set lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS})
    where id = ${job.id} and attempts = ${job.attempts} and status = 'running'`
  return result.count > 0
}

/** Records handler progress (e.g. `fetching`). Returns false when the lease was lost. */
export async function setStage(db: Db, job: ClaimedJob, stage: string): Promise<boolean> {
  const sql = rawSql(db)
  const result = await sql`
    update public.jobs
    set stage = ${stage}
    where id = ${job.id} and attempts = ${job.attempts} and status = 'running'`
  return result.count > 0
}

/** Marks the job done with an optional outcome. Returns false when the lease was lost. */
export async function complete(db: Db, job: ClaimedJob, outcome?: string): Promise<boolean> {
  const sql = rawSql(db)
  const result = await sql`
    update public.jobs
    set status = 'done',
        outcome = ${outcome ?? null},
        lease_expires_at = null,
        finished_at = now()
    where id = ${job.id} and attempts = ${job.attempts} and status = 'running'`
  return result.count > 0
}

/**
 * Records a handler failure. A retryable failure with attempts left goes back to `queued`
 * after 2^attempts seconds; otherwise the job ends `failed`. A NonRetryableError's reason
 * becomes `failure_reason`; exhausted retries get a generic reason, because the error
 * message (kept in `last_error`) may hold internal details.
 */
export async function fail(
  db: Db,
  job: ClaimedJob,
  error: unknown,
  options: FailOptions = {},
): Promise<FailResult> {
  const retryable = options.retryable ?? !(error instanceof NonRetryableError)
  const reason = error instanceof NonRetryableError ? error.reason : null
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_ERROR_LENGTH,
  )
  const sql = rawSql(db)
  // SET expressions all see the row's pre-update values, so every use of `retry` agrees.
  const retry = sql`(${retryable}::boolean and attempts < max_attempts)`
  const rows = await sql<{ status: 'queued' | 'failed' }[]>`
    update public.jobs
    set status = case when ${retry} then 'queued' else 'failed' end,
        run_after = case
          when ${retry}
            then now() + make_interval(secs => least(power(2, attempts), ${MAX_BACKOFF_SECONDS}))
          else run_after
        end,
        failure_reason = case
          when ${retry} then null
          else coalesce(
            ${reason}::text,
            'failed after ' || attempts || case when attempts = 1 then ' attempt' else ' attempts' end
          )
        end,
        finished_at = case when ${retry} then null else now() end,
        last_error = ${message},
        locked_by = null,
        lease_expires_at = null
    where id = ${job.id} and attempts = ${job.attempts} and status = 'running'
    returning status`
  return rows[0]?.status ?? null
}

/**
 * Shutdown path: returns the job to `queued` and gives back the attempt the claim counted,
 * so an interrupted run doesn't use up a retry. Returns false when the lease was lost.
 */
export async function release(db: Db, job: ClaimedJob): Promise<boolean> {
  const sql = rawSql(db)
  const result = await sql`
    update public.jobs
    set status = 'queued',
        attempts = attempts - 1,
        locked_by = null,
        lease_expires_at = null
    where id = ${job.id} and attempts = ${job.attempts} and status = 'running'`
  return result.count > 0
}

/**
 * Takes back running jobs whose lease expired: to `queued` while attempts remain, else to
 * `failed` with reason "timed out". The worker runs it every 15 s.
 */
export async function reapExpired(db: Db): Promise<ReapedJob[]> {
  const sql = rawSql(db)
  const rows = await sql<ReapedJob[]>`
    update public.jobs
    set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
        failure_reason = case
          when attempts >= max_attempts then 'timed out' else failure_reason
        end,
        finished_at = case when attempts >= max_attempts then now() else finished_at end,
        last_error = 'lease expired',
        locked_by = null,
        lease_expires_at = null
    where status = 'running' and lease_expires_at < now()
    returning id, status`
  return rows.map((row) => ({ id: row.id, status: row.status }))
}
