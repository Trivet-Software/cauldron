// The worker loop (01.5-backend-foundation task 7.3, Requirements 6.1, 6.2 and 6.4).
// See design.md, "Worker Service" and "Job Lifecycle (Worker)".
//
// One pump claims jobs while a slot is free, sleeping `pollIntervalMs` when nothing is
// claimable. A finishing job wakes the pump at once, because more work may be waiting.
// Each running job heartbeats every 20 s; a lost lease aborts the job's signal and its
// result is discarded, since the fenced writes would match nothing anyway.
//
// The worker never sees the Db: queue operations arrive pre-bound as QueueOps, and handler
// contexts come from a factory. That keeps the loop testable with an in-memory queue
// (task 7.6). stop() runs the shutdown sequence but does not close the pool. The entry
// point (task 7.5) closes it after stop() resolves, because it created the pool.
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'

import { type Logger } from 'pino'

import { type Db } from '@cauldron/core/db'
import { type Providers } from '@cauldron/core/providers'
import {
  type ClaimedJob,
  type FailOptions,
  type FailResult,
  type Job,
  type ReapedJob,
  NonRetryableError,
  claim,
  complete,
  fail,
  heartbeat,
  reapExpired,
  release,
  setStage,
} from '@cauldron/core/queue'
import { type ServiceStorageConfig } from '@cauldron/core/storage'

import {
  type HandlerContext,
  type HandlerRegistry,
  createHandlerContext,
  registeredTypes,
} from './handlers'

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000

/** The queue operations the worker needs, already bound to a database. */
export interface QueueOps {
  claim(workerId: string, types: readonly string[]): Promise<Job | null>
  heartbeat(job: ClaimedJob): Promise<boolean>
  setStage(job: ClaimedJob, stage: string): Promise<boolean>
  complete(job: ClaimedJob, outcome?: string): Promise<boolean>
  fail(job: ClaimedJob, error: unknown, options?: FailOptions): Promise<FailResult>
  release(job: ClaimedJob): Promise<boolean>
  reapExpired(): Promise<ReapedJob[]>
}

/** QueueOps backed by `@cauldron/core/queue` on the privileged pool. */
export function queueOps(db: Db): QueueOps {
  return {
    claim: (workerId, types) => claim(db, workerId, types),
    heartbeat: (job) => heartbeat(db, job),
    setStage: (job, stage) => setStage(db, job, stage),
    complete: (job, outcome) => complete(db, job, outcome),
    fail: (job, error, options) => fail(db, job, error, options),
    release: (job) => release(db, job),
    reapExpired: () => reapExpired(db),
  }
}

export interface ContextArgs {
  job: Job
  signal: AbortSignal
  setStage: (stage: string) => Promise<void>
  log: Logger
}

export type ContextFactory = (args: ContextArgs) => HandlerContext

/** The production context factory: scope and storage bound to each job's own tenant. */
export function contextFactory(deps: {
  db: Db
  storageConfig: ServiceStorageConfig
  providers: Providers
}): ContextFactory {
  return (args) => createHandlerContext({ ...deps, ...args })
}

/** The abort reason when the worker loses a job's lease. */
export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lost the lease on job ${jobId}.`)
    this.name = 'LeaseLostError'
  }
}

/** The abort reason when shutdown's grace period ends before the handler does. */
export class ShutdownError extends Error {
  constructor() {
    super('The worker is shutting down.')
    this.name = 'ShutdownError'
  }
}

export interface WorkerOptions {
  queue: QueueOps
  handlers: HandlerRegistry
  createContext: ContextFactory
  concurrency: number
  pollIntervalMs: number
  shutdownGraceMs: number
  heartbeatIntervalMs?: number
  workerId?: string
  log: Logger
}

export interface Worker {
  readonly workerId: string
  /** Jobs currently held by this worker. */
  readonly running: number
  start(): void
  /**
   * Stops claiming, waits up to `shutdownGraceMs` for running jobs, then aborts and
   * releases the rest. Does not close the database pool.
   */
  stop(): Promise<void>
}

export function defaultWorkerId(): string {
  return `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`
}

interface ActiveJob {
  job: Job
  controller: AbortController
  /** Set when the lease is lost or shutdown released the job: skip complete/fail. */
  discarded: boolean
  done: Promise<void>
}

export function createWorker(options: WorkerOptions): Worker {
  const {
    queue,
    handlers,
    createContext,
    concurrency,
    pollIntervalMs,
    shutdownGraceMs,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    workerId = defaultWorkerId(),
    log,
  } = options
  const types = registeredTypes(handlers)
  const active = new Map<string, ActiveJob>()
  let started = false
  let stopping = false
  let pump: Promise<void> = Promise.resolve()
  let stopped: Promise<void> | null = null

  // A sleep that wake() ends early: a job finished or stop() was called.
  let wakeCurrent: (() => void) | null = null
  function wake(): void {
    wakeCurrent?.()
  }
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      function done(): void {
        clearTimeout(timer)
        wakeCurrent = null
        resolve()
      }
      wakeCurrent = done
    })
  }

  async function runPump(): Promise<void> {
    while (!stopping) {
      if (active.size >= concurrency) {
        await sleep(pollIntervalMs)
        continue
      }
      let job: Job | null
      try {
        job = await queue.claim(workerId, types)
      } catch (err) {
        log.error({ err }, 'claim failed; backing off')
        await sleep(pollIntervalMs)
        continue
      }
      if (job === null) {
        await sleep(pollIntervalMs)
        continue
      }
      if (stopping) {
        // Claimed while stop() was starting: hand it straight back.
        await safeRelease(job)
        break
      }
      runJob(job)
    }
  }

  async function safeRelease(job: Job): Promise<void> {
    try {
      if (!(await queue.release(job))) {
        log.warn({ jobId: job.id }, 'release matched nothing; lease already lost')
      }
    } catch (err) {
      // The reaper returns the job to `queued` once its lease expires.
      log.error({ err, jobId: job.id }, 'release failed')
    }
  }

  function runJob(job: Job): void {
    const jobLog = log.child({ jobId: job.id, type: job.type, attempt: job.attempts })
    const controller = new AbortController()
    const entry: ActiveJob = { job, controller, discarded: false, done: Promise.resolve() }

    function leaseLost(): void {
      if (entry.discarded) return
      entry.discarded = true
      jobLog.warn('lease lost; aborting and discarding the result')
      controller.abort(new LeaseLostError(job.id))
    }

    let beating = false
    const heartbeatTimer = setInterval(async () => {
      if (beating || entry.discarded) return
      beating = true
      try {
        if (!(await queue.heartbeat(job))) leaseLost()
      } catch (err) {
        // Keep running: the next beat may succeed before the 60 s lease runs out.
        jobLog.warn({ err }, 'heartbeat failed')
      } finally {
        beating = false
      }
    }, heartbeatIntervalMs)

    async function reportStage(stage: string): Promise<void> {
      if (!(await queue.setStage(job, stage))) leaseLost()
    }

    async function execute(): Promise<void> {
      const handler = handlers[job.type]
      if (handler === undefined) {
        // claim() filters on registered types, so this means the registry changed.
        jobLog.error('no handler for claimed job; releasing it')
        entry.discarded = true
        await safeRelease(job)
        return
      }
      let outcome: string | undefined
      let error: unknown
      let succeeded = false
      try {
        const ctx = createContext({ job, signal: controller.signal, setStage: reportStage, log: jobLog })
        const result = await handler(ctx)
        outcome = result?.outcome
        succeeded = true
      } catch (err) {
        error = err
      } finally {
        clearInterval(heartbeatTimer)
      }
      if (entry.discarded) return
      try {
        if (succeeded) {
          if (!(await queue.complete(job, outcome))) jobLog.warn('complete matched nothing; lease lost')
          else jobLog.info({ outcome }, 'job done')
        } else {
          const retryable = !(error instanceof NonRetryableError)
          const status = await queue.fail(job, error, { retryable })
          if (status === null) jobLog.warn('fail matched nothing; lease lost')
          else jobLog.warn({ err: error, status }, 'job failed')
        }
      } catch (err) {
        // The lease expires and the reaper re-queues the job; handlers are idempotent.
        jobLog.error({ err }, 'recording the job result failed')
      }
    }

    entry.done = execute().finally(() => {
      active.delete(job.id)
      wake()
    })
    active.set(job.id, entry)
  }

  return {
    workerId,
    get running() {
      return active.size
    },
    start() {
      if (started) throw new Error('Worker already started.')
      started = true
      log.info({ workerId, concurrency, types }, 'worker started')
      pump = runPump()
    },
    stop() {
      stopped ??= (async () => {
        stopping = true
        wake()
        log.info({ running: active.size }, 'worker stopping')

        let graceTimer: NodeJS.Timeout | undefined
        const graceOver = new Promise<'timeout'>((resolve) => {
          graceTimer = setTimeout(() => resolve('timeout'), shutdownGraceMs)
        })
        const drained = Promise.all([pump, ...[...active.values()].map((a) => a.done)])
        const result = await Promise.race([drained.then(() => 'drained' as const), graceOver])
        clearTimeout(graceTimer)

        if (result === 'timeout') {
          const remaining = [...active.values()].filter((a) => !a.discarded)
          log.warn({ count: remaining.length }, 'grace period over; releasing unfinished jobs')
          // Mark first so the handler's own failure on abort isn't recorded as fail().
          for (const a of remaining) a.discarded = true
          for (const a of remaining) a.controller.abort(new ShutdownError())
          await Promise.all(remaining.map((a) => safeRelease(a.job)))
          // Handlers that ignore the abort are not awaited; their results are discarded.
        }
        log.info('worker stopped')
      })()
      return stopped
    },
  }
}
