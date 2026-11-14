// Periodic queue maintenance (01.5-backend-foundation task 7.3, Requirement 6.2).
// See design.md, "Worker Service": the reaper runs every 15 s, so an abandoned job
// returns to `queued` 60 to 75 s after its last heartbeat.
//
// The re-embed scheduler (task 7.4, Requirement 7.6) runs every 5 minutes and registers
// here as a second timer when it exists.
import { type Logger } from 'pino'

import { type Db, withActor } from '@cauldron/core/db'
import { selectStaleItems } from '@cauldron/core/db/maintenance'
import { enqueue } from '@cauldron/core/queue'

import { type QueueOps } from './worker'

export const DEFAULT_REAP_INTERVAL_MS = 15_000
export const DEFAULT_REEMBED_INTERVAL_MS = 5 * 60_000
export const REEMBED_MAX_ITEMS = 1000
export const REEMBED_BATCH_SIZE = 100
export const REEMBED_JOB_TYPE = 'reembed'

/** Payload of a `reembed` job: the items of one tenant, at most REEMBED_BATCH_SIZE. */
export interface ReembedPayload {
  itemIds: string[]
}

export interface ReembedScheduleOptions {
  db: Db
  /** The configured embedding model; items embedded with any other model are stale. */
  model: string
  log: Logger
  maxItems?: number
  batchSize?: number
}

/**
 * One scheduler pass. Returns how many jobs it enqueued (a batch whose job is already
 * queued or running counts as zero, thanks to the dedupe key).
 */
export async function scheduleReembed(options: ReembedScheduleOptions): Promise<number> {
  const { db, model, log, maxItems = REEMBED_MAX_ITEMS, batchSize = REEMBED_BATCH_SIZE } =
    options
  const stale = await selectStaleItems(db, model, maxItems)
  // selectStaleItems orders by tenant, then id, so consecutive items share a tenant and a
  // batch's first item id is stable between passes (which makes the dedupe key work).
  const batches: { tenantId: string; userId: string; itemIds: string[] }[] = []
  for (const item of stale) {
    const last = batches.at(-1)
    if (last && last.tenantId === item.tenantId && last.itemIds.length < batchSize) {
      last.itemIds.push(item.id)
    } else {
      batches.push({ tenantId: item.tenantId, userId: item.userId, itemIds: [item.id] })
    }
  }
  let enqueued = 0
  for (const batch of batches) {
    try {
      const actor = { kind: 'user', userId: batch.userId, tenantId: batch.tenantId } as const
      const job = await withActor(db, actor, (scope) =>
        enqueue<ReembedPayload>(scope, {
          type: REEMBED_JOB_TYPE,
          payload: { itemIds: batch.itemIds },
          dedupeKey: `reembed:${model}:${batch.itemIds[0]}`,
        }),
      )
      if (job) enqueued += 1
    } catch (err) {
      // One tenant's failure must not stop the others' batches.
      log.error({ err, tenantId: batch.tenantId }, 're-embed batch could not be enqueued')
    }
  }
  if (stale.length > 0) {
    log.info({ stale: stale.length, batches: batches.length, enqueued }, 're-embed scheduled')
  }
  return enqueued
}

export interface MaintenanceOptions {
  queue: Pick<QueueOps, 'reapExpired'>
  log: Logger
  reapIntervalMs?: number
  /** Enables the re-embed scheduler. */
  reembed?: { db: Db; model: string; intervalMs?: number }
}

export interface Maintenance {
  start(): void
  /** Clears the timers and waits for a reap already in flight. */
  stop(): Promise<void>
}

export function createMaintenance(options: MaintenanceOptions): Maintenance {
  const { queue, log, reapIntervalMs = DEFAULT_REAP_INTERVAL_MS } = options
  let timer: NodeJS.Timeout | undefined
  let reembedTimer: NodeJS.Timeout | undefined
  let reembedInFlight: Promise<void> | null = null
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

  function reembed(): void {
    const config = options.reembed
    if (!config || reembedInFlight) return
    reembedInFlight = (async () => {
      try {
        await scheduleReembed({ db: config.db, model: config.model, log })
      } catch (err) {
        log.error({ err }, 're-embed scheduling failed')
      } finally {
        reembedInFlight = null
      }
    })()
  }

  return {
    start() {
      if (timer) return
      // Reap once at startup: a crashed predecessor may have left jobs running.
      reap()
      timer = setInterval(reap, reapIntervalMs)
      if (options.reembed) {
        reembed()
        reembedTimer = setInterval(reembed, options.reembed.intervalMs ?? DEFAULT_REEMBED_INTERVAL_MS)
      }
    },
    async stop() {
      clearInterval(timer)
      timer = undefined
      clearInterval(reembedTimer)
      reembedTimer = undefined
      await Promise.all([inFlight, reembedInFlight])
    },
  }
}
