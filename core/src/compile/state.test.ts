import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { JOB_STATUSES } from '../queue/types'
import {
  DEFAULT_FAILURE_REASON,
  DONE_WITHOUT_ITEM_REASON,
  deriveCompileState,
  type CompileState,
  type JobSnapshot,
} from './state'

const COMPILE_STATES: readonly CompileState[] = ['queued', 'extracting', 'ready', 'failed']

const jobSnapshot = fc.record({
  status: fc.constantFrom(...JOB_STATUSES),
  stage: fc.option(fc.string(), { nil: null }),
  outcome: fc.option(fc.string(), { nil: null }),
  failureReason: fc.option(fc.string(), { nil: null }),
})

const maybeJob = fc.option(jobSnapshot, { nil: null })

describe('deriveCompileState', () => {
  // Feature: 01.7-walking-skeleton, Property 6: Compile state is derived from the item and the job
  // **Validates: Requirements 4.1, 4.2**
  it('derives the state from the item and the job, for any inputs', () => {
    fc.assert(
      fc.property(fc.boolean(), maybeJob, (hasItem, job) => {
        const { state, failureReason } = deriveCompileState(hasItem, job)

        expect(COMPILE_STATES).toContain(state)

        // ready if and only if an item is present
        expect(state === 'ready').toBe(hasItem)

        if (!hasItem) {
          if (job === null || job.status === 'queued') expect(state).toBe('queued')
          else if (job.status === 'running') expect(state).toBe('extracting')
          else expect(state).toBe('failed') // failed or done
        }

        // failureReason is non-null if and only if the state is failed
        expect(failureReason !== null).toBe(state === 'failed')
      }),
    )
  })

  it('reports the job failure reason, or the default when it is null', () => {
    fc.assert(
      fc.property(jobSnapshot, fc.string(), (job, reason) => {
        const failed: JobSnapshot = { ...job, status: 'failed', failureReason: reason }
        expect(deriveCompileState(false, failed).failureReason).toBe(reason)
        expect(deriveCompileState(false, { ...failed, failureReason: null }).failureReason).toBe(
          DEFAULT_FAILURE_REASON,
        )
      }),
    )
  })

  it('uses the defensive reason for a done job without an item', () => {
    fc.assert(
      fc.property(jobSnapshot, (job) => {
        expect(deriveCompileState(false, { ...job, status: 'done' })).toEqual({
          state: 'failed',
          failureReason: DONE_WITHOUT_ITEM_REASON,
        })
      }),
    )
  })
})
