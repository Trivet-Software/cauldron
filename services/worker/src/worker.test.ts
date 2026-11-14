// Unit tests for the worker loop (01.5-backend-foundation task 7.6, Requirements 6.2 and 6.4).
// An in-memory queue stands in for `@cauldron/core/queue`; handlers block on deferred
// promises so every ordering is explicit and nothing depends on wall-clock sleeps.
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type Job, NonRetryableError } from '@cauldron/core/queue'

import { type HandlerContext, type HandlerRegistry } from './handlers'
import { type QueueOps, type Worker, type WorkerOptions, LeaseLostError, ShutdownError, createWorker } from './worker'

function job(id: string, type = 'ping'): Job {
  const now = new Date()
  return {
    id, tenantId: 'user_a', userId: 'user_a', type, payload: {}, status: 'queued',
    stage: null, outcome: null, attempts: 1, maxAttempts: 3, runAfter: now,
    leaseExpiresAt: now, lockedBy: null, lastError: null, failureReason: null,
    dedupeKey: null, startedAt: now, finishedAt: null, createdAt: now, updatedAt: now,
  }
}

interface Deferred<T = void> {
  promise: Promise<T>
  resolve(value: T): void
  reject(err: unknown): void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Rejects with the signal's reason once aborted, like a well-behaved handler would. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason)
    signal.addEventListener('abort', () => reject(signal.reason))
  })
}

/**
 * An in-memory queue. `held` is the set of jobs whose lease this worker owns; the fenced
 * operations succeed only for held jobs, so `loseLease()` makes them match nothing, as a
 * reaper re-queueing the job would.
 */
function memoryQueue(jobs: Job[] = []) {
  const pending = [...jobs]
  const held = new Set<string>()
  /** Ids handed out by claim(), in order; empty polls are not recorded. */
  const claimed: string[] = []
  function settle(id: string): boolean {
    return held.delete(id)
  }
  const ops = {
    claim: vi.fn(async (): Promise<Job | null> => {
      const next = pending.shift() ?? null
      if (next) {
        held.add(next.id)
        claimed.push(next.id)
      }
      return next
    }),
    heartbeat: vi.fn(async (j: Job) => held.has(j.id)),
    setStage: vi.fn(async (j: Job) => held.has(j.id)),
    complete: vi.fn(async (j: Job) => settle(j.id)),
    // Typed from QueueOps so mock.calls carries the error and options arguments.
    fail: vi.fn<QueueOps['fail']>(async (j) => (settle(j.id) ? 'failed' : null)),
    release: vi.fn(async (j: Job) => settle(j.id)),
    reapExpired: vi.fn(async () => []),
  } satisfies QueueOps
  return {
    ops,
    held,
    claimed,
    push: (...more: Job[]) => pending.push(...more),
    loseLease: (id: string) => held.delete(id),
  }
}

const workers: Worker[] = []
afterEach(async () => {
  // A failed assertion must not leave a pump polling into the next test.
  await Promise.all(workers.splice(0).map((w) => w.stop()))
})

function worker(queue: QueueOps, handlers: HandlerRegistry, overrides: Partial<WorkerOptions> = {}): Worker {
  const w = createWorker({
    queue,
    handlers,
    createContext: (args) => args as unknown as HandlerContext,
    concurrency: 2,
    pollIntervalMs: 5,
    shutdownGraceMs: 1000,
    workerId: 'test-worker',
    log: pino({ enabled: false }),
    ...overrides,
  })
  workers.push(w)
  return w
}

describe('createWorker', () => {
  it('never runs more than `concurrency` jobs at once', async () => {
    const q = memoryQueue(['1', '2', '3', '4', '5'].map((id) => job(id)))
    const gates = new Map<string, Deferred>()
    let inFlight = 0
    let peak = 0
    const w = worker(q.ops, {
      ping: async (ctx) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        const gate = deferred()
        gates.set(ctx.job.id, gate)
        await gate.promise
        inFlight--
      },
    }, { concurrency: 2 })
    const claimed = () => q.claimed.length
    w.start()

    for (let done = 0; done < 5; done++) {
      // Each round: the free slots fill, the worker stops claiming, then one job finishes.
      await vi.waitFor(() => expect(w.running).toBe(Math.min(2, 5 - done)))
      // Count claims that handed out a job; empty polls after the queue drains are fine.
      expect(claimed()).toBe(Math.min(done + 2, 5))
      const [id, gate] = [...gates].find(([, g]) => g !== undefined)!
      gates.delete(id)
      gate.resolve()
      await vi.waitFor(() => expect(q.ops.complete).toHaveBeenCalledTimes(done + 1))
    }
    expect(peak).toBe(2)
    expect(q.held.size).toBe(0)
  })

  it('aborts the handler with LeaseLostError and discards its result when a heartbeat returns false', async () => {
    const q = memoryQueue([job('1')])
    let signal: AbortSignal | undefined
    const w = worker(q.ops, {
      ping: async (ctx) => {
        signal = ctx.signal
        await untilAborted(ctx.signal)
      },
    }, { heartbeatIntervalMs: 5 })
    w.start()
    await vi.waitFor(() => expect(w.running).toBe(1))

    q.loseLease('1')
    await vi.waitFor(() => expect(w.running).toBe(0))
    expect(q.ops.heartbeat).toHaveBeenCalled()
    expect(signal?.aborted).toBe(true)
    expect(signal?.reason).toBeInstanceOf(LeaseLostError)
    expect(q.ops.complete).not.toHaveBeenCalled()
    expect(q.ops.fail).not.toHaveBeenCalled()
    expect(q.ops.release).not.toHaveBeenCalled()
  })

  it('discards a successful result after the lease was lost', async () => {
    const q = memoryQueue([job('1')])
    const w = worker(q.ops, {
      // Ignores the abort and returns normally: the result must still be dropped.
      ping: async (ctx) => {
        await vi.waitFor(() => expect(ctx.signal.aborted).toBe(true))
        return { outcome: 'ready' }
      },
    }, { heartbeatIntervalMs: 5 })
    w.start()
    await vi.waitFor(() => expect(w.running).toBe(1))
    q.loseLease('1')
    await vi.waitFor(() => expect(w.running).toBe(0))
    expect(q.ops.complete).not.toHaveBeenCalled()
    expect(q.ops.fail).not.toHaveBeenCalled()
  })

  it('aborts the job when setStage returns false', async () => {
    const q = memoryQueue([job('1')])
    let signal: AbortSignal | undefined
    const w = worker(q.ops, {
      ping: async (ctx) => {
        signal = ctx.signal
        q.loseLease(ctx.job.id)
        await ctx.setStage('fetching')
        await untilAborted(ctx.signal)
      },
    })
    w.start()
    await vi.waitFor(() => {
      expect(signal?.aborted).toBe(true)
      expect(w.running).toBe(0)
    })
    expect(q.ops.setStage).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), 'fetching')
    expect(signal?.reason).toBeInstanceOf(LeaseLostError)
    expect(q.ops.complete).not.toHaveBeenCalled()
    expect(q.ops.fail).not.toHaveBeenCalled()
  })

  it('completes with the outcome, fails NonRetryableError without retry and plain errors with retry', async () => {
    const q = memoryQueue([job('1', 'ok'), job('2', 'boom'), job('3', 'fatal')])
    const w = worker(q.ops, {
      ok: async () => ({ outcome: 'ready' }),
      boom: async () => { throw new Error('transient') },
      fatal: async () => { throw new NonRetryableError('bad input') },
    })
    w.start()
    await vi.waitFor(() => {
      expect(q.ops.fail).toHaveBeenCalledTimes(2)
      expect(q.ops.complete).toHaveBeenCalledTimes(1)
    })
    expect(q.ops.claim).toHaveBeenCalledWith('test-worker', ['ok', 'boom', 'fatal'])
    expect(q.ops.complete).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), 'ready')
    expect(q.ops.fail).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }), expect.any(Error), { retryable: true })
    const [, fatalErr, fatalOpts] = q.ops.fail.mock.calls.find(([j]) => j.id === '3')!
    expect(fatalErr).toBeInstanceOf(NonRetryableError)
    expect(fatalOpts).toEqual({ retryable: false })
    expect(q.ops.fail.mock.calls.find(([j]) => j.id === '2')![1]).not.toBeInstanceOf(NonRetryableError)
  })

  it('keeps polling after claim errors', async () => {
    const q = memoryQueue()
    q.ops.claim.mockRejectedValueOnce(new Error('db down'))
    const w = worker(q.ops, { ping: async () => {} })
    w.start()
    await vi.waitFor(() => expect(q.ops.claim.mock.calls.length).toBeGreaterThan(2))
    await w.stop()
  })

  describe('stop()', () => {
    it('stops claiming, lets a handler that finishes within grace complete, and releases the rest', async () => {
      const q = memoryQueue([job('fast'), job('slow')])
      const fastGate = deferred()
      let slowSignal: AbortSignal | undefined
      const w = worker(q.ops, {
        ping: async (ctx) => {
          if (ctx.job.id === 'fast') {
            await fastGate.promise
            return { outcome: 'ready' }
          }
          slowSignal = ctx.signal
          await untilAborted(ctx.signal)
        },
      }, { shutdownGraceMs: 50 })
      w.start()
      await vi.waitFor(() => expect(w.running).toBe(2))
      q.push(job('late'))
      const claimsAtStop = q.ops.claim.mock.calls.length

      const stopped = w.stop()
      // Finishes in microtasks, long before the 50 ms grace timer can fire.
      fastGate.resolve()
      await stopped

      expect(q.ops.claim).toHaveBeenCalledTimes(claimsAtStop)
      expect(q.ops.complete).toHaveBeenCalledTimes(1)
      expect(q.ops.complete).toHaveBeenCalledWith(expect.objectContaining({ id: 'fast' }), 'ready')
      expect(slowSignal?.aborted).toBe(true)
      expect(slowSignal?.reason).toBeInstanceOf(ShutdownError)
      expect(q.ops.release).toHaveBeenCalledTimes(1)
      expect(q.ops.release).toHaveBeenCalledWith(expect.objectContaining({ id: 'slow' }))
      // The aborted handler's rejection is not recorded as a failure.
      await vi.waitFor(() => expect(w.running).toBe(0))
      expect(q.ops.fail).not.toHaveBeenCalled()
      expect(q.held.size).toBe(0)
    })

    it('waits for running handlers without releasing when they all finish in time', async () => {
      const q = memoryQueue([job('1')])
      const gate = deferred()
      const w = worker(q.ops, { ping: () => gate.promise })
      w.start()
      await vi.waitFor(() => expect(w.running).toBe(1))

      let resolved = false
      const stopped = w.stop().then(() => { resolved = true })
      await new Promise((r) => setTimeout(r, 10))
      expect(resolved).toBe(false)
      gate.resolve()
      await stopped
      expect(q.ops.complete).toHaveBeenCalledTimes(1)
      expect(q.ops.release).not.toHaveBeenCalled()
    })

    it('releases a job claimed while stop() was starting without running it', async () => {
      const q = memoryQueue()
      const claimGate = deferred<Job | null>()
      q.ops.claim.mockImplementationOnce(() => claimGate.promise)
      const handler = vi.fn(async () => {})
      const w = worker(q.ops, { ping: handler })
      w.start()
      await vi.waitFor(() => expect(q.ops.claim).toHaveBeenCalledTimes(1))

      const stopped = w.stop()
      q.held.add('1')
      claimGate.resolve(job('1'))
      await stopped
      expect(handler).not.toHaveBeenCalled()
      expect(q.ops.release).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
      expect(q.ops.claim).toHaveBeenCalledTimes(1)
    })

    it('is idempotent', async () => {
      const q = memoryQueue()
      const w = worker(q.ops, { ping: async () => {} })
      w.start()
      expect(w.stop()).toBe(w.stop())
      await w.stop()
    })
  })
})
