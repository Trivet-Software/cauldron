// CORS for /v1 (01.5-backend-foundation Requirement 1.5, task 9.4).
// Only exact APP_ORIGINS matches get Access-Control-Allow-Origin; any other
// origin gets no CORS headers, so the browser blocks the response while
// server-to-server calls are unaffected. Credentials stay off because auth
// uses the Authorization header, not cookies. hono/cors adds `Vary: Origin`
// whenever the origin option isn't '*'.
import { type MiddlewareHandler } from 'hono'
import { cors as honoCors } from 'hono/cors'

export const CORS_MAX_AGE_SECONDS = 600

export function cors(appOrigins: readonly string[]): MiddlewareHandler {
  const allowed = new Set(appOrigins)
  return honoCors({
    // Returning null omits Access-Control-Allow-Origin entirely.
    origin: (origin) => (allowed.has(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    exposeHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: CORS_MAX_AGE_SECONDS,
  })
}
