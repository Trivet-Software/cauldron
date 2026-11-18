// Dev auth mode, verifier side (01.7-walking-skeleton task 6.3, Requirements
// 8.1, 8.2 and 8.7). Property 9 runs over withDevToken alone; the app-level
// tests check that the dev user is an ordinary principal.
import fc from 'fast-check'
import { pino } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { type Db } from '@cauldron/core/db'
import { createApp } from '../app'
import { loadEnv } from '../env'
import { ErrorResponseSchema } from '../http/errors'
import { createInMemoryCollection, createInMemoryStorage } from '../testing'
import { DEV_SESSION_ID, withDevToken } from './dev-token'
import { SessionTokenError, type VerifiedSession, type VerifySessionToken } from './verify-token'

const DEV_TOKEN = 'dev-token-0123456789-0123456789-abcdef'
const DEV_USER_ID = 'user_dev_1'

const CLERK_SESSION: VerifiedSession = { sub: 'user_clerk', sid: 'sess_clerk' }

// A configured token and a presented one. Half the cases are the exact token and
// most of the rest are near misses (prefix, suffix, case change, truncation), so
// both branches of the property get many runs.
const tokenPair = fc.string().chain((d) =>
  fc.record({
    d: fc.constant(d),
    t: fc.oneof(
      fc.constant(d),
      fc.constant(d),
      fc.string(),
      fc.string({ minLength: 1 }).map((suffix) => d + suffix),
      fc.string({ minLength: 1 }).map((prefix) => prefix + d),
      fc.constant(d.slice(0, -1)),
      fc.constant(d.toUpperCase()),
      fc.constant(d.toLowerCase()),
    ),
  }),
)

const verifyOutcome = fc.oneof(
  fc.record({ sub: fc.string(), sid: fc.string() }).map((session) => ({ session })),
  fc.string().map((reason) => ({ error: new SessionTokenError('invalid', reason) })),
)

describe('withDevToken', () => {
  // Feature: 01.7-walking-skeleton, Property 9: The dev token authenticates only the exact token
  // **Validates: Requirements 8.1, 8.2, 8.7**
  it('Property 9: authenticates only the exact token, and passes every other token to verify once', async () => {
    await fc.assert(
      fc.asyncProperty(tokenPair, fc.string({ minLength: 1 }), verifyOutcome, async ({ d, t }, userId, outcome) => {
        const verify = vi.fn<VerifySessionToken>(async () => {
          if ('error' in outcome) throw outcome.error
          return outcome.session
        })
        const result = await withDevToken(verify, { token: d, userId })(t).then(
          (session) => ({ session }),
          (error: unknown) => ({ error }),
        )

        if (t === d) {
          expect(verify).not.toHaveBeenCalled()
          expect(result).toEqual({ session: { sub: userId, sid: DEV_SESSION_ID } })
        } else {
          expect(verify).toHaveBeenCalledTimes(1)
          expect(verify).toHaveBeenCalledWith(t)
          // Returned or rethrown unchanged: the same object, not a copy.
          if ('error' in outcome) expect(result).toHaveProperty('error', outcome.error)
          else expect(result).toHaveProperty('session', outcome.session)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('maps the dev token to DEV_USER_ID with the dev session id, without calling verify', async () => {
    const verify = vi.fn<VerifySessionToken>(async () => CLERK_SESSION)
    const session = await withDevToken(verify, { token: DEV_TOKEN, userId: DEV_USER_ID })(DEV_TOKEN)
    expect(session).toEqual({ sub: DEV_USER_ID, sid: 'dev' })
    expect(verify).not.toHaveBeenCalled()
  })

  it('uses a session id that no Clerk session can have', () => {
    expect(DEV_SESSION_ID.startsWith('sess_')).toBe(false)
  })

  it('still verifies a Clerk session token in dev mode', async () => {
    const verify = vi.fn<VerifySessionToken>(async () => CLERK_SESSION)
    const wrapped = withDevToken(verify, { token: DEV_TOKEN, userId: DEV_USER_ID })
    await expect(wrapped('a-clerk-jwt')).resolves.toEqual(CLERK_SESSION)
    expect(verify).toHaveBeenCalledExactlyOnceWith('a-clerk-jwt')
  })

  it('rethrows the wrapped verifier error for a wrong token, including the unavailable kind', async () => {
    const unavailable = new SessionTokenError('unavailable', 'jwk-failed')
    const wrapped = withDevToken(
      async () => {
        throw unavailable
      },
      { token: DEV_TOKEN, userId: DEV_USER_ID },
    )
    await expect(wrapped('wrong')).rejects.toBe(unavailable)
  })
})

// Requirement 8.7: the dev user is an ordinary principal, so tenant = user = DEV_USER_ID
// and every route and RLS treat it like a Clerk session.
describe('dev token through the app', () => {
  const env = loadEnv({
    DATABASE_URL: 'postgresql://unused',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_PUBLISHABLE_KEY: 'pk',
    CLERK_SECRET_KEY: 'sk_test_x',
    APP_ORIGINS: 'https://app.example.com',
    PROVIDERS: 'mock',
    MOCK_RECORDINGS_DIR: '/tmp/unused',
  })

  const clerkVerify: VerifySessionToken = async (token) => {
    if (token === 'good') return CLERK_SESSION
    throw new SessionTokenError('invalid', 'token-invalid')
  }

  function devApp() {
    return createApp({
      env,
      db: {} as Db,
      verifyToken: withDevToken(clerkVerify, { token: DEV_TOKEN, userId: DEV_USER_ID }),
      health: { checkDatabase: async () => true },
      logger: pino({ level: 'silent' }),
      developerRole: async () => false,
      collection: createInMemoryCollection(),
      storageFor: createInMemoryStorage().storageFor,
    })
  }

  it('acts as DEV_USER_ID, with the same ID as user and tenant', async () => {
    const res = await devApp().request('/v1/me', {
      headers: { Authorization: `Bearer ${DEV_TOKEN}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      userId: DEV_USER_ID,
      tenantId: DEV_USER_ID,
      isDeveloper: false,
    })
  })

  it('still accepts a Clerk session token', async () => {
    const res = await devApp().request('/v1/me', { headers: { Authorization: 'Bearer good' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ userId: 'user_clerk', tenantId: 'user_clerk' })
  })

  it('returns the 401 envelope for any other token', async () => {
    const res = await devApp().request('/v1/me', {
      headers: { Authorization: `Bearer ${DEV_TOKEN}x` },
    })
    expect(res.status).toBe(401)
    expect(ErrorResponseSchema.parse(await res.json()).error).toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })
})
