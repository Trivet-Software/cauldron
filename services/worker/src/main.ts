// Worker composition and process lifecycle (01.5-backend-foundation task 7.5,
// Requirements 6.4 and 8.3). See design.md, "Worker Service" and "Error Handling".
//
// startWorker() builds the dependencies and starts the loop and the reaper; it installs no
// process handlers, so a test (task 7.7) can run a worker in-process and stop() it.
// main() is the process glue around it: fail-fast env, signals, exit codes.
//
// The re-embed scheduler (task 7.4) starts here alongside the reaper once it exists.
import { type Logger, pino } from 'pino'

import { EMBEDDING_COLUMN_DIMENSIONS, createDb } from '@cauldron/core/db'
import { EnvError } from '@cauldron/core/env'
import { type Providers } from '@cauldron/core/providers'
import { createProviders } from '@cauldron/core/providers/mock'

import { type WorkerEnv, loadEnv } from './env'
import { type HandlerRegistry, handlers as defaultHandlers } from './handlers'
import { createMaintenance } from './maintenance'
import { contextFactory, createWorker, queueOps } from './worker'

/** A startup check failed. The message is safe to log; it names no secret values. */
export class StartupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StartupError'
  }
}

// Paths a log call could plausibly carry secrets under. Nothing logs env today; this keeps
// a careless `log.info({ env })` or a logged request from leaking keys.
const REDACT_PATHS = [
  'env.DATABASE_URL',
  'env.SUPABASE_SECRET_KEY',
  'env.OPENROUTER_API_KEY',
  '*.DATABASE_URL',
  '*.SUPABASE_SECRET_KEY',
  '*.OPENROUTER_API_KEY',
  '*.secretKey',
  '*.apiKey',
  '*.password',
  '*.headers.authorization',
  '*.headers.Authorization',
]

export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    base: { service: 'worker' },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  })
}

/** The vector column has a fixed size, so a different EMBEDDING_DIMENSIONS can't be stored. */
export function checkEmbeddingDimensions(dimensions: number): void {
  if (dimensions !== EMBEDDING_COLUMN_DIMENSIONS) {
    throw new StartupError(
      `EMBEDDING_DIMENSIONS is ${dimensions}, but items.embedding holds ` +
        `${EMBEDDING_COLUMN_DIMENSIONS} dimensions. Set EMBEDDING_DIMENSIONS=` +
        `${EMBEDDING_COLUMN_DIMENSIONS}, or add a migration for the new size.`,
    )
  }
}

export interface StartWorkerOptions {
  log?: Logger
  /** Overrides createProviders(env), e.g. mock providers on an in-memory store. */
  providers?: Providers
  handlers?: HandlerRegistry
  workerId?: string
}

export interface RunningWorker {
  readonly workerId: string
  /** Jobs currently held by the worker. */
  readonly running: number
  /** Stops claiming, drains or releases jobs, stops the reaper, closes the pool. Idempotent. */
  stop(): Promise<void>
}

/**
 * Runs the startup checks, then opens the pool and starts the loop and the reaper.
 * Throws StartupError (or the provider factory's error) before opening any connection.
 */
export function startWorker(env: WorkerEnv, options: StartWorkerOptions = {}): RunningWorker {
  const log = options.log ?? createLogger()
  checkEmbeddingDimensions(env.EMBEDDING_DIMENSIONS)
  // Built before the pool: PROVIDERS=openrouter throws here until task 5.2 lands.
  const providers = options.providers ?? createProviders(env)

  // One connection per job slot, plus one for the reaper and one spare for heartbeats.
  const db = createDb(env.DATABASE_URL, { max: env.WORKER_CONCURRENCY + 2 })
  const queue = queueOps(db)
  const worker = createWorker({
    queue,
    handlers: options.handlers ?? defaultHandlers,
    createContext: contextFactory({
      db,
      storageConfig: { url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY },
      providers,
    }),
    concurrency: env.WORKER_CONCURRENCY,
    pollIntervalMs: env.POLL_INTERVAL_MS,
    shutdownGraceMs: env.SHUTDOWN_GRACE_MS,
    workerId: options.workerId,
    log,
  })
  const maintenance = createMaintenance({ queue, log })

  worker.start()
  maintenance.start()

  let stopped: Promise<void> | null = null
  return {
    workerId: worker.workerId,
    get running() {
      return worker.running
    },
    stop() {
      stopped ??= (async () => {
        try {
          await Promise.all([worker.stop(), maintenance.stop()])
        } finally {
          // The pool is ours: close it even if shutdown threw.
          await db.close({ timeoutSeconds: 5 })
        }
      })()
      return stopped
    },
  }
}

export interface MainOptions {
  exit?: (code: number) => void
  writeStderr?: (text: string) => void
}

/**
 * Process entry: validates env (exit 1 with the variable names on EnvError), starts the
 * worker, and stops it on SIGTERM/SIGINT (exit 0). A second signal forces exit 1.
 */
export function main(
  source: Record<string, string | undefined> = process.env,
  options: MainOptions = {},
): RunningWorker | undefined {
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const writeStderr = options.writeStderr ?? ((text: string) => process.stderr.write(text))

  let env: WorkerEnv
  try {
    env = loadEnv(source)
  } catch (err) {
    if (err instanceof EnvError) {
      // Names only, never values (Requirement 8.3).
      writeStderr(`${err.message}\n`)
      exit(1)
      return undefined
    }
    throw err
  }

  const log = createLogger(source.LOG_LEVEL)

  let running: RunningWorker
  try {
    running = startWorker(env, { log })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.fatal({ errName: err instanceof Error ? err.name : undefined }, `worker failed to start: ${message}`)
    exit(1)
    return undefined
  }

  let shuttingDown = false
  function onSignal(signal: NodeJS.Signals): void {
    if (shuttingDown) {
      log.warn({ signal }, 'second signal; exiting without finishing shutdown')
      exit(1)
      return
    }
    shuttingDown = true
    log.info({ signal }, 'shutting down')
    running.stop().then(
      () => {
        log.info('shutdown complete')
        exit(0)
      },
      (err: unknown) => {
        log.error({ err }, 'shutdown failed')
        exit(1)
      },
    )
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'unhandled promise rejection')
    exit(1)
  })
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception')
    exit(1)
  })

  return running
}
