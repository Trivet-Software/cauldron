// The API's Hono app, built from injected dependencies so tests swap the token
// verifier, database and probes (01.5-backend-foundation task 9.8,
// Requirements 1.1 and 1.2; design "API Service").
import { OpenAPIHono } from '@hono/zod-openapi'
import { type Logger } from 'pino'
import { type CollectionStore } from '@cauldron/core/collection'
import { type Db } from '@cauldron/core/db'
import { type DeveloperRoleLookup } from './auth/developer'
import { resolvePrincipal } from './auth/principal'
import { type VerifySessionToken } from './auth/verify-token'
import { type ApiEnv } from './env'
import { type AppBindings } from './http/bindings'
import { cors } from './http/cors'
import { errorHandler, notFoundHandler, validationErrorHook } from './http/errors'
import { registerOpenApi } from './http/openapi'
import { requestId } from './http/request-id'
import { requestLog } from './http/request-log'
import { type HealthProbe, healthRoutes } from './routes/health'
import { registerRoutes } from './routes'
import { type StorageFor } from './storage'

export interface ApiDeps {
  env: ApiEnv
  db: Db
  verifyToken: VerifySessionToken
  health: HealthProbe
  logger: Logger
  /** `GET /v1/me`'s role check: Clerk Backend API in production, a fake in tests. */
  developerRole: DeveloperRoleLookup
  /** Goals, sources and items (01.7 design, "Collection repository"): the real store, or an in-memory fake in tests. */
  collection: CollectionStore
  /** The caller's raw-source storage: `userStorage` for Clerk sessions, `serviceStorage` for the dev token. */
  storageFor: StorageFor
}

export function createApp(deps: ApiDeps): OpenAPIHono<AppBindings> {
  const { env, logger } = deps
  const app = new OpenAPIHono<AppBindings>({ defaultHook: validationErrorHook })
  app.use('*', requestId())
  app.use('*', requestLog(logger))

  // Outside /v1: Railway's probe sends no token and no Origin.
  app.route('/', healthRoutes({ env, health: deps.health }))

  const v1 = new OpenAPIHono<AppBindings>({ defaultHook: validationErrorHook })
  // CORS before auth, so a 401 still carries Access-Control-Allow-Origin and
  // the browser lets the app read the error envelope.
  v1.use('*', cors(env.APP_ORIGINS))
  v1.use('*', resolvePrincipal(deps.verifyToken, { logger }))
  registerRoutes(v1, deps)
  // After the routes, so the document includes them.
  registerOpenApi(v1)
  app.route('/v1', v1)

  // Hono applies the parent's handlers to errors and unmatched paths under a
  // mounted sub-app that sets none of its own (checked in app.test.ts).
  app.notFound(notFoundHandler)
  app.onError(errorHandler(logger))
  return app
}
