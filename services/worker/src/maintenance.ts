// Periodic queue maintenance (01.5-backend-foundation task 7.3, Requirement 6.2).
// See design.md, "Worker Service": the reaper runs every 15 s, so an abandoned job
// returns to `queued` 60 to 75 s after its last heartbeat.
//
// The re-embed scheduler (task 7.4, Requirement 7.6) runs every 5 minutes and registers
// here as a second timer when it exists.
import { type Logger } from 'pino'

import { type QueueOps } from './worker'

export const DEFAULT_REAP_INTERVAL_MS = 15_000

export interface MaintenanceOptions {
  queue: Pick<QueueOps, 'reapExpired'>
  log: Logger
  reapIntervalMs?: number
}

export interface Maintenance {
  start(): void
  /** Clears the timers and waits for a reap already in flight. */
  stop(): Promise<void>
}

export function createMaintenance(options: MaintenanceOptions): Maintenance {
  const { queue, log, reapIntervalMs = DEFAULT_REAP_INTERVAL_MS } = options
  let timer: NodeJS.Timeout | undefined
  let inFlight: Promise<void> | null = null

  function reap(): void {
    if (inFlight) return // a slow reap must not overlap the next one
    inFlight = (async () => {
      try {
        const reaped = await queue.reapExpired()
        if (reaped.length > 0) log.warn({ reaped }, 'reaped jobs with expired leases')
      } catch (err) {
        log.error({ err }, 'reaping expired leases failed')
      } finally {
        inFlight = null
      }
    })()
  }

  return {
    start() {
      if (timer) return
      // Reap once at startup: a crashed predecessor may have left jobs running.
      reap()
      timer = setInterval(reap, reapIntervalMs)
    },
    async stop() {
      clearInterval(timer)
      timer = undefined
      await inFlight
    },
  }
}
