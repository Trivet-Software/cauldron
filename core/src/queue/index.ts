// `@cauldron/core/queue`: the Postgres job queue shared by the API and the worker
// (01.5-backend-foundation task 6.1, Requirements 6.1 and 6.2). Node-only.
export { NonRetryableError } from './errors'
export {
  claim,
  complete,
  enqueue,
  fail,
  heartbeat,
  reapExpired,
  release,
  setStage,
} from './queue'
export {
  JOB_STATUSES,
  LEASE_SECONDS,
  type ClaimedJob,
  type EnqueueOptions,
  type FailOptions,
  type FailResult,
  type Job,
  type JobStatus,
  type ReapedJob,
} from './types'
