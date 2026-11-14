// Route definitions that carry their access level (01.5-backend-foundation
// task 9.3, Requirements 1.3 and 2.4). One `access` field decides both the
// auth middleware and the OpenAPI `security` entry, so the document can't
// drift from what the server enforces. Omitting it yields a protected route.
import { type RouteConfig, createRoute } from '@hono/zod-openapi'
import { type MiddlewareHandler } from 'hono'
import { requireUser } from '../auth/principal'
import { type AppBindings } from './bindings'
import { BEARER_AUTH } from './openapi'

/** `user`: a verified session token is required. `anonymous`: no token needed. */
export type Access = 'user' | 'anonymous'

type AppMiddleware = MiddlewareHandler<AppBindings>

/**
 * `createRoute()` config minus `security` (derived from `access`) and with
 * `middleware` narrowed to the app's bindings.
 */
export type DefineRouteConfig = Omit<RouteConfig, 'security' | 'middleware'> & {
  /** Defaults to `'user'`: closed by default. */
  access?: Access
  /** Runs after the access check, so it always sees an authorized caller. */
  middleware?: AppMiddleware | AppMiddleware[]
}

/**
 * `createRoute()` with an access level. Use the result with
 * `app.openapi(route, handler)`; request and response types are inferred as
 * with `createRoute()`.
 */
export function defineRoute<
  P extends string,
  R extends Omit<DefineRouteConfig, 'path'> & { path: P },
>(config: R & { security?: never }) {
  const { access = 'user', middleware, ...rest } = config
  const extra: AppMiddleware[] =
    middleware === undefined ? [] : Array.isArray(middleware) ? middleware : [middleware]
  const isUser = access === 'user'
  const route: DefinedRouteConfig<R> = {
    ...(rest as Omit<R, 'access' | 'middleware'>),
    // `security: []` is how OpenAPI marks an operation public; setting it on
    // every route keeps the document explicit about which ones need a token.
    security: isUser ? [{ [BEARER_AUTH]: [] }] : [],
    // Auth first, so caller middleware never runs for an anonymous request.
    middleware: isUser ? [requireUser(), ...extra] : extra,
  }
  return createRoute(route)
}

/** What defineRoute passes to createRoute(): the caller's config with access resolved. */
type DefinedRouteConfig<R extends { path: string }> = Omit<R, 'access' | 'middleware'> & {
  path: R['path']
  security: Record<string, string[]>[]
  middleware: AppMiddleware[]
}
