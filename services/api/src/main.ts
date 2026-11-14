// API composition and process lifecycle (01.5-backend-foundation task 9.8,
// Requirements 1.1, 1.2 and 8.3). Mirrors services/worker/src/main.ts:
// startApi() builds the dependencies and starts the server without installing
// process handlers, so a test can run it in-process; main() is the process
// glue around it: fail-fast env, signals, exit codes.
import { type AddressInfo } from 'node:net'
import { createClerkClient } from '@clerk/backend'
import { type ServerType, serve } from '@hono/node-server'
import { type Logger, pino } from 'pino'
import { EMBEDDING_COLUMN_DIMENSIONS, createDb } from '@cauldron/core/db'
import { EnvError } from '@cauldron/core/env'
import { createProviders } from '@cauldron/core/providers/mock'
import { createApp } from './app'
import { createDeveloperRoleLookup } from './auth/developer'
import { createSessionTokenVerifier } from './auth/verify-token'
import { type ApiEnv, loadEnv } from './env'
import { createHealthProbe } from './routes/health'

/** A startup check failed. The message is safe to log; it names no secret values. */
export class StartupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StartupError'
  }
}

export const DB_POOL_SIZE = 10
// In-flight requests get this long after SIGTERM before their connections are
// cut. Railway waits RAILWAY_DEPLOYMENT_DRAINING_SECONDS (default 0, set it
// above this) before SIGKILL.
export const SHUTDOWN_GRACE_MS = 10_000

// The Authorization header (session tokens) and every secret env var. Nothing
// logs env today; this keeps a careless `log.info({ env })` from leaking keys.
const REDACT_PATHS = [
  'req.headers.authorization',
  '*.headers.authorization',
  '*.headers.Authorization',
  'env.DATABASE_URL',
  'env.CLERK_SECRET_KEY',
  'env.CLERK_JWT_KEY',
  'env.SUPABASE_PUBLISHABLE_KEY',
  'env.OPENROUTER_API_KEY',
  '*.DATABASE_URL',
  '*.CLERK_SECRET_KEY',
  '*.CLERK_JWT_KEY',
  '*.OPENROUTER_API_KEY',
  '*.secretKey',
  '*.apiKey',
  '*.password',
  '*.token',
]

export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    base: { service: 'api' },
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

export interface StartApiOptions {
  log?: Logger
  /** Overrides env.PORT; 0 picks a free port (tests). */
  port?: number
  shutdownGraceMs?: number
}

export interface RunningApi {
  readonly server: ServerType
  /** Resolves once the server is listening, with the bound port. */
  readonly listening: Promise<number>
  /** Stops accepting, waits for in-flight requests, closes the pool. Idempotent. */
  stop(): Promise<void>
}

/**
 * Runs the startup checks, then opens the pool and starts listening.
 * Throws StartupError (or the provider factory's error) before opening any connection.
 */
export function startApi(env: ApiEnv, options: StartApiOptions = {}): RunningApi {
  const log = options.log ?? createLogger()
  checkEmbeddingDimensions(env.EMBEDDING_DIMENSIONS)
  // Built for its configuration check only: PROVIDERS=openrouter throws here
  // until task 5.2 lands. Routes that call providers (goal-engine) take it as a dep.
  createProviders(env)

  const db = createDb(env.DATABASE_URL, { max: DB_POOL_SIZE })
  // No network until the first lookup, so building it here opens nothing.
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
  const app = createApp({
    developerRole: createDeveloperRoleLookup({
      getUser: (id) => clerk.users.getUser(id),
      developerEmails: env.DEVELOPER_EMAILS,
      logger: log,
    }),
    env,
    db,
    verifyToken: createSessionTokenVerifier({
      secretKey: env.CLERK_SECRET_KEY,
      jwtKey: env.CLERK_JWT_KEY,
      authorizedParties: env.APP_ORIGINS,
    }),
    health: createHealthProbe(db, { logger: log }),
    logger: log,
  })

  let resolveListening: (port: number) => void = () => {}
  const listening = new Promise<number>((resolve) => {
    resolveListening = resolve
  })
  const server = serve({ fetch: app.fetch, port: options.port ?? env.PORT }, (info: AddressInfo) => {
    log.info({ port: info.port }, 'api listening')
    resolveListening(info.port)
  })

  const graceMs = options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS
  let stopped: Promise<void> | null = null
  return {
    server,
    listening,
    stop() {
      stopped ??= (async () => {
        try {
          await closeServer(server, graceMs)
        } finally {
          // The pool is ours: close it even if the server close failed.
          await db.close({ timeoutSeconds: 5 })
        }
      })()
      return stopped
    },
  }
}

/** close() stops accepting and waits for in-flight requests; after graceMs, cut what's left. */
function closeServer(server: ServerType, graceMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections()
    }, graceMs)
    server.close((err) => {
      clearTimeout(timer)
      if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(err)
      else resolve()
    })
    // Keep-alive sockets with no request in flight would otherwise hold close() open.
    if ('closeIdleConnections' in server) server.closeIdleConnections()
  })
}

export interface MainOptions {
  exit?: (code: number) => void
  writeStderr?: (text: string) => void
}

/**
 * Process entry: validates env (exit 1 with the variable names on EnvError), starts the
 * server, and stops it on SIGTERM/SIGINT (exit 0). A second signal forces exit 1.
 */
export function main(
  source: Record<string, string | undefined> = process.env,
  options: MainOptions = {},
): RunningApi | undefined {
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const writeStderr = options.writeStderr ?? ((text: string) => process.stderr.write(text))

  let env: ApiEnv
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

  let running: RunningApi
  try {
    running = startApi(env, { log })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.fatal({ errName: err instanceof Error ? err.name : undefined }, `api failed to start: ${message}`)
    exit(1)
    return undefined
  }

  // A port already in use surfaces here, after serve() returned.
  running.server.on('error', (err) => {
    log.fatal({ err }, 'api server error')
    exit(1)
  })

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
