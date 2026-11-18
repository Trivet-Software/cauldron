// Dev auth mode (01.7-walking-skeleton Requirement 8): a static bearer token
// that stands in for a Clerk session in local development, so a local MCP
// server can act as one configured user. The result is an ordinary verified
// session, so resolvePrincipal, defineRoute and RLS behave as for Clerk.
import { createHash, timingSafeEqual } from 'node:crypto'
import { type VerifySessionToken } from './verify-token'

/** Clerk session IDs start with `sess_`, so this can't collide with a real one. */
export const DEV_SESSION_ID = 'dev'

export interface DevTokenOptions {
  token: string
  /** Becomes both the user ID and the tenant ID. */
  userId: string
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * Accepts `opts.token` as `opts.userId`; every other token goes to `verify`
 * unchanged (Requirement 8.2). Both sides are hashed first, so the comparison
 * runs on fixed-length digests: timingSafeEqual needs equal lengths, and the
 * token's length isn't leaked.
 */
export function withDevToken(
  verify: VerifySessionToken,
  opts: DevTokenOptions,
): VerifySessionToken {
  const expected = digest(opts.token)
  return async (token) => {
    if (timingSafeEqual(digest(token), expected)) {
      return { sub: opts.userId, sid: DEV_SESSION_ID }
    }
    return verify(token)
  }
}
