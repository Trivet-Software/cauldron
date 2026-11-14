// Job handler contract and registry (01.5-backend-foundation task 7.2, Requirements 4.3
// and 6.3; design: "Worker Service").
//
// Handlers get a database scope and a storage client bound to their job's own user and
// tenant, never a privileged handle (Requirement 4.3, auth-abuse Requirement 8.1). The
// worker loop holds the Db and the queue functions; handlers see only what
// createHandlerContext() gives them.
import { type Logger } from 'pino'

import { type Db, type Scoped, type UserActor, withActor } from '@cauldron/core/db'
import { type Providers } from '@cauldron/core/providers'
import { type Job } from '@cauldron/core/queue'
import {
  type ServiceStorageConfig,
  type TenantStorage,
  serviceStorage,
} from '@cauldron/core/storage'

import { pingHandler } from './ping'

export interface HandlerContext<P = unknown> {
  readonly job: Job<P>
  /** Runs `fn` in a transaction as the job's user, so RLS applies to every statement. */
  scope<T>(fn: (scope: Scoped) => Promise<T>): Promise<T>
  /** Raw-source storage; rejects any path outside the job's tenant. */
  readonly storage: TenantStorage
  readonly providers: Providers
  /** Aborted when the worker loses the job's lease or the shutdown grace period ends. */
  readonly signal: AbortSignal
  /** Reports progress in the job's `stage` column (fenced to this claim). */
  setStage(stage: string): Promise<void>
  readonly log: Logger
}

/** Resolving marks the job done, with `outcome` if given. Throwing fails or retries it. */
export type JobHandler<P = unknown> = (
  ctx: HandlerContext<P>,
) => Promise<{ outcome?: string } | void>

export type HandlerRegistry = Readonly<Record<string, JobHandler>>

export const handlers: HandlerRegistry = {
  ping: pingHandler, // Requirement 6.3
  // reembed: reembedHandler registers here (task 7.4, Requirement 7.6).
}

/**
 * The job types the worker may claim. claim() filters on these, so a job whose type has
 * no handler here stays queued for a worker that has one.
 */
export function registeredTypes(registry: HandlerRegistry): string[] {
  return Object.keys(registry)
}

export interface HandlerContextOptions<P = unknown> {
  db: Db
  job: Job<P>
  storageConfig: ServiceStorageConfig
  providers: Providers
  signal: AbortSignal
  setStage: (stage: string) => Promise<void>
  log: Logger
}

/**
 * Builds the context for one claimed job. `db` is captured in the `scope` closure and not
 * exposed. Jobs store the owner in both tenant_id and user_id (one tenant per account), so
 * the actor passes withActor()'s tenantId === userId check.
 */
export function createHandlerContext<P>(
  options: HandlerContextOptions<P>,
): HandlerContext<P> {
  const { db, job, storageConfig, providers, signal, setStage, log } = options
  const actor: UserActor = { kind: 'user', userId: job.userId, tenantId: job.tenantId }
  return {
    job,
    scope: (fn) => withActor(db, actor, fn),
    storage: serviceStorage(storageConfig, job.tenantId),
    providers,
    signal,
    setStage,
    log,
  }
}
