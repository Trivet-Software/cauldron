// The developer role (01.5-backend-foundation task 9.6, Requirement 2.5;
// auth-abuse Requirement 11). Session tokens don't carry email verification
// status, so the role is computed on the server from Clerk's Backend API and
// never read from a request body or header.
import { type Logger } from 'pino'
import { ApiError } from '../http/errors'

/** Resolves whether a verified user has the developer role. Throws ApiError 503 when it can't tell. */
export type DeveloperRoleLookup = (userId: string) => Promise<boolean>

/** The fields of a Clerk `User` the role check reads. `@clerk/backend`'s `User` satisfies it. */
export interface DeveloperRoleUser {
  publicMetadata: Record<string, unknown> | null | undefined
  emailAddresses: ReadonlyArray<{
    emailAddress: string
    verification: { status: string } | null
  }>
}

export interface DeveloperRoleLookupOptions {
  /** E.g. `(id) => clerk.users.getUser(id)`. */
  getUser: (userId: string) => Promise<DeveloperRoleUser>
  /** Emails granted the role when verified. Compared lower-cased. */
  developerEmails: readonly string[]
  /** How long a result is reused. Defaults to 60 s. */
  ttlMs?: number
  /** Most users kept in the cache; the oldest entry is dropped first. Defaults to 1000. */
  maxEntries?: number
  /** Clock, for tests. */
  now?: () => number
  logger?: Logger
}

export const DEVELOPER_ROLE_TTL_MS = 60_000
export const DEVELOPER_ROLE_MAX_ENTRIES = 1000

const UNAVAILABLE_MESSAGE = 'Could not check the developer role right now.'

/** The role rule: `publicMetadata.role === 'developer'`, or a verified email on the list. */
export function hasDeveloperRole(user: DeveloperRoleUser, developerEmails: ReadonlySet<string>): boolean {
  if (user.publicMetadata?.role === 'developer') return true
  return user.emailAddresses.some(
    (email) =>
      email.verification?.status === 'verified' &&
      developerEmails.has(email.emailAddress.toLowerCase()),
  )
}

/**
 * A cached lookup: one Clerk call per user per `ttlMs`. Concurrent lookups for
 * the same user share one call. Only successes are cached, so a Clerk outage
 * doesn't pin a wrong answer; a failure throws ApiError 503 rather than
 * guessing, because a guessed `true` would be a privilege bug.
 */
export function createDeveloperRoleLookup(options: DeveloperRoleLookupOptions): DeveloperRoleLookup {
  const ttlMs = options.ttlMs ?? DEVELOPER_ROLE_TTL_MS
  const maxEntries = options.maxEntries ?? DEVELOPER_ROLE_MAX_ENTRIES
  const now = options.now ?? Date.now
  const emails = new Set(options.developerEmails.map((email) => email.toLowerCase()))
  // Map keeps insertion order, so the first key is the oldest entry.
  const cache = new Map<string, { value: boolean; expiresAt: number }>()
  const inFlight = new Map<string, Promise<boolean>>()

  async function fetchRole(userId: string): Promise<boolean> {
    let user: DeveloperRoleUser
    try {
      user = await options.getUser(userId)
    } catch (err) {
      options.logger?.error({ err, userId }, 'developer role lookup failed')
      throw new ApiError(503, 'internal', UNAVAILABLE_MESSAGE)
    }
    const value = hasDeveloperRole(user, emails)
    cache.delete(userId)
    cache.set(userId, { value, expiresAt: now() + ttlMs })
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return value
  }

  return (userId) => {
    const hit = cache.get(userId)
    if (hit && hit.expiresAt > now()) return Promise.resolve(hit.value)
    if (hit) cache.delete(userId)

    const pending = inFlight.get(userId)
    if (pending) return pending
    const lookup = fetchRole(userId).finally(() => inFlight.delete(userId))
    inFlight.set(userId, lookup)
    return lookup
  }
}
