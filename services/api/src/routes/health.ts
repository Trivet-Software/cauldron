// Railway health check (01.5-backend-foundation task 9.7, Requirements 1.2 and 7.6).
// Mounted at `/` by createApp, outside the `/v1` sub-app, so it gets no CORS and no
// auth: Railway's probe sends no token and no Origin.
import { Hono } from 'hono'
import { type Logger, pino } from 'pino'
import { type Db, withActor } from '@cauldron/core/db'
import { type AppBindings } from '../http/bindings'
import { type ApiEnv } from '../env'

export const HEALTH_PATH = '/health'
export const DEFAULT_HEALTH_TIMEOUT_MS = 2000

export type CheckStatus = 'ok' | 'error'

export interface HealthBody {
  status: CheckStatus
  service: 'api'
  version: string
  checks: { database: CheckStatus }
  embeddings: {
    model: string
    dimensions: number
    // itemsNeedingReembed (cached 60 s) lands here with task 3.2's embedding columns.
  }
}

/** What `/health` asks of its dependencies. Tests pass a fake. */
export interface HealthProbe {
  /** Resolves true when the database answered in time; never rejects. */
  checkDatabase(): Promise<boolean>
}

export interface HealthProbeOptions {
  timeoutMs?: number
  logger?: Logger
}

/**
 * Probes the database with `select 1` as the anonymous actor, so the probe goes through
 * the same withActor() path as every request. Gives up after `timeoutMs` (default 2 s).
 * Logs at warn only when the result changes, so a probe every few seconds against a
 * down database writes one line rather than one per probe.
 */
export function createHealthProbe(db: Db, options: HealthProbeOptions = {}): HealthProbe {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  const log = options.logger ?? pino({ name: 'api' })
  let lastHealthy = true

  async function selectOne(): Promise<void> {
    await withActor(db, { kind: 'anonymous' }, async ({ sql }) => {
      await sql`select 1`
    })
  }

  return {
    async checkDatabase() {
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`database did not answer within ${timeoutMs} ms`)),
          timeoutMs,
        )
      })
      const query = selectOne()
      // If the timeout wins, the query may still reject later; keep that from
      // surfacing as an unhandled rejection.
      query.catch(() => {})
      try {
        await Promise.race([query, timeout])
        if (!lastHealthy) log.info('health: database reachable again')
        lastHealthy = true
        return true
      } catch (err) {
        if (lastHealthy) log.warn({ err }, 'health: database check failed')
        lastHealthy = false
        return false
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export interface HealthRouteDeps {
  env: Pick<ApiEnv, 'RAILWAY_GIT_COMMIT_SHA' | 'EMBEDDING_MODEL' | 'EMBEDDING_DIMENSIONS'>
  health: HealthProbe
}

/** `GET /health`: 200 when the database is reachable, otherwise 503 with the same body. */
export function healthRoutes(deps: HealthRouteDeps): Hono<AppBindings> {
  const app = new Hono<AppBindings>()
  app.get(HEALTH_PATH, async (c) => {
    const databaseOk = await deps.health.checkDatabase()
    const body: HealthBody = {
      status: databaseOk ? 'ok' : 'error',
      service: 'api',
      version: deps.env.RAILWAY_GIT_COMMIT_SHA,
      checks: { database: databaseOk ? 'ok' : 'error' },
      embeddings: {
        model: deps.env.EMBEDDING_MODEL,
        dimensions: deps.env.EMBEDDING_DIMENSIONS,
      },
    }
    c.header('Cache-Control', 'no-store')
    return c.json(body, databaseOk ? 200 : 503)
  })
  return app
}
