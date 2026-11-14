// Unit tests for the lease reaper timer (01.5-backend-foundation task 7.6, Requirement 6.2).
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ReapedJob } from '@cauldron/core/queue'

import { DEFAULT_REAP_INTERVAL_MS, createMaintenance } from './maintenance'

const log = pino({ enabled: false })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createMaintenance', () => {
  it('reaps once at start and then every interval', async () => {
    const reapExpired = vi.fn(async (): Promise<ReapedJob[]> => [])
    const m = createMaintenance({ queue: { reapExpired }, log })
    m.start()
    expect(reapExpired).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(DEFAULT_REAP_INTERVAL_MS - 1)
    expect(reapExpired).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(reapExpired).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(DEFAULT_REAP_INTERVAL_MS)
    expect(reapExpired).toHaveBeenCalledTimes(3)

    await m.stop()
    await vi.advanceTimersByTimeAsync(DEFAULT_REAP_INTERVAL_MS * 3)
    expect(reapExpired).toHaveBeenCalledTimes(3)
  })

  it('keeps running after a reap fails', async () => {
    const reapExpired = vi.fn(async (): Promise<ReapedJob[]> => [])
    reapExpired.mockRejectedValueOnce(new Error('db down'))
    const m = createMaintenance({ queue: { reapExpired }, log, reapIntervalMs: 100 })
    m.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(reapExpired).toHaveBeenCalledTimes(2)
    await m.stop()
  })

  it('does not overlap a slow reap, and stop() waits for the one in flight', async () => {
    let finish!: () => void
    const reapExpired = vi.fn(
      () => new Promise<ReapedJob[]>((resolve) => { finish = () => resolve([]) }),
    )
    const m = createMaintenance({ queue: { reapExpired }, log, reapIntervalMs: 100 })
    m.start()
    await vi.advanceTimersByTimeAsync(300)
    expect(reapExpired).toHaveBeenCalledTimes(1)

    let stopped = false
    const stopping = m.stop().then(() => { stopped = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(stopped).toBe(false)
    finish()
    await stopping
    expect(stopped).toBe(true)
    expect(reapExpired).toHaveBeenCalledTimes(1)
  })
})
