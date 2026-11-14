// Clerk session-token verification (01.5-backend-foundation task 9.5,
// Requirement 2.1). The API depends on the VerifySessionToken type, not on
// @clerk/backend, so tests inject a fake (createApp's `verifyToken` dep).
import { verifyToken } from '@clerk/backend'
import { TokenVerificationError, TokenVerificationErrorReason } from '@clerk/backend/errors'

/** The claims the API uses from a verified session token. */
export interface VerifiedSession {
  /** Clerk user ID; also the tenant ID (one tenant per account). */
  sub: string
  /** Clerk session ID. */
  sid: string
}

export type VerifySessionToken = (token: string) => Promise<VerifiedSession>

/**
 * `invalid`: the caller's token is bad (signature, expiry, azp, missing claims) → 401.
 * `unavailable`: the server can't verify any token right now (keys can't be
 * loaded, secret key rejected) → 503, so a Clerk outage doesn't read as
 * "your session is invalid".
 */
export type SessionTokenErrorKind = 'invalid' | 'unavailable'

/** Thrown by a VerifySessionToken. Never carries the token itself. */
export class SessionTokenError extends Error {
  constructor(
    readonly kind: SessionTokenErrorKind,
    /** Short machine-readable reason for logs, e.g. Clerk's `token-expired`. */
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Session token ${kind === 'invalid' ? 'rejected' : 'could not be verified'}: ${reason}`, options)
    this.name = 'SessionTokenError'
  }
}

export interface SessionTokenVerifierOptions {
  secretKey: string
  /** PEM public key; when set, verification is networkless and secretKey isn't used for JWKS. */
  jwtKey?: string
  /** Exact origins the token's `azp` claim must match (APP_ORIGINS). */
  authorizedParties: string[]
}

// Reasons that describe the server's key setup or Clerk's availability, not the token.
const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([
  TokenVerificationErrorReason.InvalidSecretKey,
  TokenVerificationErrorReason.LocalJWKMissing,
  TokenVerificationErrorReason.RemoteJWKFailedToLoad,
  TokenVerificationErrorReason.JWKFailedToResolve,
])

function classify(err: unknown): SessionTokenError {
  if (err instanceof TokenVerificationError) {
    const kind = UNAVAILABLE_REASONS.has(err.reason) ? 'unavailable' : 'invalid'
    return new SessionTokenError(kind, err.reason, { cause: err })
  }
  // Anything else (e.g. a fetch failure the SDK didn't wrap) is our problem, not the caller's.
  return new SessionTokenError('unavailable', 'verification-error', { cause: err })
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Wraps `verifyToken` from @clerk/backend: checks signature, `exp`, `nbf` (SDK
 * default clock skew) and `azp` against `authorizedParties`. Uses `jwtKey`
 * when provided, otherwise `secretKey` to fetch and cache the JWKS.
 */
export function createSessionTokenVerifier(
  options: SessionTokenVerifierOptions,
): VerifySessionToken {
  const { secretKey, jwtKey, authorizedParties } = options
  const clerkOptions = jwtKey ? { jwtKey, authorizedParties } : { secretKey, authorizedParties }

  return async (token) => {
    let payload: Awaited<ReturnType<typeof verifyToken>>
    try {
      payload = await verifyToken(token, clerkOptions)
    } catch (err) {
      throw classify(err)
    }
    // A verified token without both IDs isn't a session token we can use.
    if (!nonEmptyString(payload.sub) || !nonEmptyString(payload.sid)) {
      throw new SessionTokenError('invalid', 'missing-claims')
    }
    return { sub: payload.sub, sid: payload.sid }
  }
}
