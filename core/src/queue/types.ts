// Job queue types (01.5-backend-foundation task 6.1, Requirements 6.1 and 6.2).
// See design.md, "Job Queue".

/**
 * The queue's own lifecycle. Handlers report progress in `stage` and their result in
 * `outcome`; capture-compile derives its user-facing state from the three together.
 */
export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export const JOB_STATUSES: readonly JobStatus[] = ['queued', 'running', 'done', 'failed']

/** How long a claim or heartbeat holds a job before the reaper may take it back. */
export const LEASE_SECONDS = 60

export interface Job<P = unknown> {
  id: string
  tenantId: string
  userId: string
  type: string
  payload: P
  status: JobStatus
  stage: string | null
  outcome: string | null
  attempts: number
  maxAttempts: number
  runAfter: Date
  leaseExpiresAt: Date | null
  lockedBy: string | null
  lastError: string | null
  failureReason: string | null
  dedupeKey: string | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * What a fenced write matches on. `attempts` is the claim's fencing token: a re-claim by
 * another worker increments it, so a stale worker's writes affect zero rows.
 */
export type ClaimedJob = Pick<Job, 'id' | 'attempts'>

export interface EnqueueOptions<P = unknown> {
  type: string
  /** Stored as jsonb. Must be JSON-serializable. */
  payload?: P
  /** At most one queued or running job per tenant and key. */
  dedupeKey?: string
  /** Earliest time the job may be claimed. Defaults to now. */
  runAfter?: Date
  /** Defaults to 3 (the column default). */
  maxAttempts?: number
}

export interface FailOptions {
  /**
   * Whether the job may run again. Defaults to false for a NonRetryableError and true for
   * anything else. A retryable failure still ends the job once attempts are used up.
   */
  retryable?: boolean
}

/** Where fail() left the job, or null when the fence matched nothing (lease lost). */
export type FailResult = 'queued' | 'failed' | null

export interface ReapedJob {
  id: string
  status: 'queued' | 'failed'
}
