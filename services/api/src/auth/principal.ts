// Who is calling a /v1 route (01.5-backend-foundation task 9.5, Requirements
// 2.1-2.4). Only the Authorization header is read: the `__session` cookie and
// query-string tokens are ignored, which keeps the API free of CSRF.
import { type MiddlewareHandler } from 'hono'
import { type Logger } from 'pino'
import { type RequestActor } from '@cauldron/core/db'
import { type AppBindings, type Principal } from '../http/bindings'
import { ApiError } from '../http/errors'
import { SessionTokenError, type VerifySessionToken } from './verify-token'

// One message for every 401, so a caller can't tell an expired token from a
// forged one. The specific reason goes to the log only.
const UNAUTHORIZED_MESSAGE = 'A valid session token is required.'

const ANONYMOUS: Principal = { kind: 'anonymous' }

/**
 * `Bearer <token>` → the token. Scheme is case-insensitive; exactly one
 * non-empty token must follow a single space. Anything else → null.
 */
export function parseBearer(header: string): string | null {
  const match = /^Bearer ([^\s]+)$/i.exec(header)
  return match ? match[1] : null
}

export interface ResolvePrincipalOptions {
  /** Used when the request has no `logger` variable. */
  logger?: Logger
}

/**
 * Sets `principal` on every request: anonymous without an Authorization
 * header, the verified user with a valid one. A header that is present but
 * malformed or fails verification is a 401 even on anonymous routes: a client
 * sending a broken token should learn about it, not silently get public data.
 */
export function resolvePrincipal(
  verify: VerifySessionToken,
  options: ResolvePrincipalOptions = {},
): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const header = c.req.header('Authorization')
    if (header === undefined) {
      c.set('principal', ANONYMOUS)
      return next()
    }

    // The request logger (requestLog) already carries requestId.
    const log = c.get('logger') ?? options.logger?.child({ requestId: c.get('requestId') })
    const token = parseBearer(header)
    if (token === null) {
      log?.warn({ reason: 'malformed-authorization-header' }, 'session token rejected')
      throw new ApiError(401, 'unauthorized', UNAUTHORIZED_MESSAGE)
    }

    let session
    try {
      session = await verify(token)
    } catch (err) {
      if (err instanceof SessionTokenError && err.kind === 'unavailable') {
        log?.error({ reason: err.reason, err: err.cause }, 'session token verification unavailable')
        throw new ApiError(503, 'internal', 'Sign-in could not be checked right now. Try again shortly.')
      }
      const reason = err instanceof SessionTokenError ? err.reason : 'verification-error'
      log?.warn({ reason }, 'session token rejected')
      throw new ApiError(401, 'unauthorized', UNAUTHORIZED_MESSAGE)
    }

    c.set('principal', {
      kind: 'user',
      userId: session.sub,
      tenantId: session.sub,
      sessionId: session.sid,
    })
    return next()
  }
}

/**
 * Route middleware for `access: 'user'` (attached by defineRoute): 401 before
 * the handler runs when the caller is anonymous (Requirement 2.3). A missing
 * principal means resolvePrincipal didn't run, which is treated the same way.
 */
export function requireUser(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (c.get('principal')?.kind !== 'user') {
      throw new ApiError(401, 'unauthorized', UNAUTHORIZED_MESSAGE)
    }
    return next()
  }
}

/** The database actor for a principal, for `withActor(db, actorFor(principal), ...)`. */
export function actorFor(principal: Principal): RequestActor {
  return principal.kind === 'user'
    ? { kind: 'user', userId: principal.userId, tenantId: principal.tenantId }
    : { kind: 'anonymous' }
}
