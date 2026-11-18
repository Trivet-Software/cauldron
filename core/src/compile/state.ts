// Compile state derivation (01.7-walking-skeleton task 3.12, Requirements 4.1, 4.2).
// The user-facing state is derived, never stored, and this is the only place the mapping
// lives (design.md, "Compile State"). Pure and isomorphic; the queue import is type-only.
import type { JobStatus } from '../queue/types'

export type CompileState = 'queued' | 'extracting' | 'ready' | 'failed'

export interface JobSnapshot {
  status: JobStatus
  stage: string | null
  outcome: string | null
  failureReason: string | null
}

export const DEFAULT_FAILURE_REASON = 'The capture could not be compiled.'
export const DONE_WITHOUT_ITEM_REASON = 'The capture finished without producing an item.'

export function deriveCompileState(
  hasItem: boolean,
  job: JobSnapshot | null,
): { state: CompileState; failureReason: string | null } {
  if (hasItem) return { state: 'ready', failureReason: null }
  // Capture inserts the source and its job in one transaction, so a missing job is a
  // transient read and looks like a queued one.
  if (job === null) return { state: 'queued', failureReason: null }

  switch (job.status) {
    case 'queued':
      return { state: 'queued', failureReason: null }
    case 'running':
      return { state: 'extracting', failureReason: null }
    case 'failed':
      return { state: 'failed', failureReason: job.failureReason ?? DEFAULT_FAILURE_REASON }
    case 'done':
      // Defensive: a finished job should have left an item behind.
      return { state: 'failed', failureReason: DONE_WITHOUT_ITEM_REASON }
  }
}
