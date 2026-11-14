// Unit tests for the Clerk token verifier wrapper (01.5-backend-foundation
// task 9.10, Requirements 2.1, 2.3). @clerk/backend is mocked at the module
// boundary; @clerk/backend/errors stays real so the wrapper classifies the
// same TokenVerificationError instances the SDK throws.
import { verifyToken } from '@clerk/backend'
import { TokenVerificationError, TokenVerificationErrorReason } from '@clerk/backend/errors'
import { Hono } from 'hono'
import { pino } from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppBindings } from '../http/bindings'
import { type ErrorResponse, errorHandler } from '../http/errors'
import { requestId } from '../http/request-id'
import { resolvePrincipal } from './principal'
import { SessionTokenError, createSessionTokenVerifier } from './verify-token'

vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn() }))

type ClerkPayload = Awaited<ReturnType<typeof verifyToken>>

const mockVerifyToken = vi.mocked(verifyToken)

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.secret-token-body.sig'
const SECRET_KEY = 'sk_test_abc'
const JWT_KEY = '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----'
const AUTHORIZED_PARTIES = ['https://recipes.example.com', 'http://localhost:5173']

function clerkError(reason: string): TokenVerificationError {
  return new TokenVerificationError({ reason, message: `clerk says ${reason}` })
}

function resolvesTo(payload: Record<string, unknown>) {
  mockVerifyToken.mockResolvedValueOnce(payload as unknown as ClerkPayload)
}

async function captureError(promise: Promise<unknown>): Promise<SessionTokenError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(SessionTokenError)
  return err as SessionTokenError
}

beforeEach(() => {
  mockVerifyToken.mockReset()
})

describe('createSessionTokenVerifier', () => {
  it('passes jwtKey and authorizedParties, and not secretKey, when jwtKey is set', async () => {
    resolvesTo({ sub: 'user_abc', sid: 'sess_123' })
    const verify = createSessionTokenVerifier({
      secretKey: SECRET_KEY,
      jwtKey: JWT_KEY,
      authorizedParties: AUTHORIZED_PARTIES,
    })
    await verify(TOKEN)
    expect(mockVerifyToken).toHaveBeenCalledOnce()
    const [token, options] = mockVerifyToken.mock.calls[0]
    expect(token).toBe(TOKEN)
    expect(options).toEqual({ jwtKey: JWT_KEY, authorizedParties: AUTHORIZED_PARTIES })
    expect(options).not.toHaveProperty('secretKey')
  })

  it('passes secretKey and authorizedParties when jwtKey is not set', async () => {
    resolvesTo({ sub: 'user_abc', sid: 'sess_123' })
    const verify = createSessionTokenVerifier({
      secretKey: SECRET_KEY,
      authorizedParties: AUTHORIZED_PARTIES,
    })
    await verify(TOKEN)
    expect(mockVerifyToken).toHaveBeenCalledWith(TOKEN, {
      secretKey: SECRET_KEY,
      authorizedParties: AUTHORIZED_PARTIES,
    })
  })

  it('returns only sub and sid from a valid payload', async () => {
    resolvesTo({ sub: 'user_abc', sid: 'sess_123', azp: AUTHORIZED_PARTIES[0], exp: 9999999999 })
    const verify = createSessionTokenVerifier({ secretKey: SECRET_KEY, authorizedParties: [] })
    await expect(verify(TOKEN)).resolves.toEqual({ sub: 'user_abc', sid: 'sess_123' })
  })

  it.each([
    { sid: 'sess_123' },
    { sub: 'user_abc' },
    { sub: '', sid: 'sess_123' },
    { sub: 'user_abc', sid: 42 },
  ])('rejects a verified payload without usable sub and sid: %j', async (payload) => {
    resolvesTo(payload)
    const verify = createSessionTokenVerifier({ secretKey: SECRET_KEY, authorizedParties: [] })
    const err = await captureError(verify(TOKEN))
    expect(err.kind).toBe('invalid')
    expect(err.reason).toBe('missing-claims')
  })

  it.each([
    TokenVerificationErrorReason.TokenExpired,
    TokenVerificationErrorReason.TokenInvalidSignature,
    TokenVerificationErrorReason.TokenInvalidAuthorizedParties,
    TokenVerificationErrorReason.TokenNotActiveYet,
  ])('classifies Clerk reason %s as invalid', async (reason) => {
    const cause = clerkError(reason)
    mockVerifyToken.mockRejectedValueOnce(cause)
    const verify = createSessionTokenVerifier({ secretKey: SECRET_KEY, authorizedParties: [] })
    const err = await captureError(verify(TOKEN))
    expect(err.kind).toBe('invalid')
    expect(err.reason).toBe(reason)
    expect(err.cause).toBe(cause)
  })

  it.each([
    TokenVerificationErrorReason.RemoteJWKFailedToLoad,
    TokenVerificationErrorReason.InvalidSecretKey,
    TokenVerificationErrorReason.LocalJWKMissing,
    TokenVerificationErrorReason.JWKFailedToResolve,
  ])('classifies Clerk reason %s as unavailable', async (reason) => {
    mockVerifyToken.mockRejectedValueOnce(clerkError(reason))
    const verify = createSessionTokenVerifier({ secretKey: SECRET_KEY, authorizedParties: [] })
    const err = await captureError(verify(TOKEN))
    expect(err.kind).toBe('unavailable')
    expect(err.reason).toBe(reason)
  })

  it('classifies a non-Clerk error as unavailable', async () => {
    const cause = new TypeError('fetch failed')
    mockVerifyToken.mockRejectedValueOnce(cause)
    const verify = createSessionTokenVerifier({ secretKey: SECRET_KEY, authorizedParties: [] })
    const err = await captureError(verify(TOKEN))
    expect(err.kind).toBe('unavailable')
    expect(err.reason).toBe('verification-error')
    expect(err.cause).toBe(cause)
  })

  it('never puts the token in the error message', async () => {
    const verify = createSessionTokenVerifier({ secretKey: SECRET_KEY, authorizedParties: [] })
    mockVerifyToken.mockRejectedValueOnce(clerkError(TokenVerificationErrorReason.TokenExpired))
    const invalid = await captureError(verify(TOKEN))
    resolvesTo({})
    const missing = await captureError(verify(TOKEN))
    mockVerifyToken.mockRejectedValueOnce(new Error('boom'))
    const unavailable = await captureError(verify(TOKEN))
    for (const err of [invalid, missing, unavailable]) {
      expect(err.message).not.toContain(TOKEN)
      expect(err.message).not.toContain('secret-token-body')
    }
  })
})

describe('createSessionTokenVerifier through resolvePrincipal', () => {
  function buildApp() {
    const logger = pino({ level: 'silent' })
    const verify = createSessionTokenVerifier({
      secretKey: SECRET_KEY,
      authorizedParties: AUTHORIZED_PARTIES,
    })
    const app = new Hono<AppBindings>()
    app.use('*', requestId())
    app.use('*', resolvePrincipal(verify, { logger }))
    app.get('/whoami', (c) => c.json({ principal: c.get('principal') }))
    app.onError(errorHandler(logger))
    return app
  }

  const authorized = { headers: { Authorization: `Bearer ${TOKEN}` } }

  it('turns a Clerk invalid-token error into the 401 envelope', async () => {
    mockVerifyToken.mockRejectedValueOnce(clerkError(TokenVerificationErrorReason.TokenExpired))
    const res = await buildApp().request('/whoami', authorized)
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
    const body = (await res.json()) as ErrorResponse
    expect(body.error).toMatchObject({ code: 'unauthorized', status: 401 })
    expect(JSON.stringify(body)).not.toContain('expired')
    expect(JSON.stringify(body)).not.toContain(TOKEN)
  })

  it('turns a Clerk key-loading failure into 503', async () => {
    mockVerifyToken.mockRejectedValueOnce(
      clerkError(TokenVerificationErrorReason.RemoteJWKFailedToLoad),
    )
    const res = await buildApp().request('/whoami', authorized)
    expect(res.status).toBe(503)
    expect(((await res.json()) as ErrorResponse).error.code).toBe('internal')
  })

  it('sets the user principal from a verified token', async () => {
    resolvesTo({ sub: 'user_abc', sid: 'sess_123' })
    const res = await buildApp().request('/whoami', authorized)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      principal: { kind: 'user', userId: 'user_abc', tenantId: 'user_abc', sessionId: 'sess_123' },
    })
    expect(mockVerifyToken).toHaveBeenCalledWith(TOKEN, {
      secretKey: SECRET_KEY,
      authorizedParties: AUTHORIZED_PARTIES,
    })
  })
})
