import { Hono } from 'hono'
import { pino } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { type AppBindings } from '../http/bindings'
import { type ErrorResponse, errorHandler } from '../http/errors'
import { requestId } from '../http/request-id'
import { actorFor, parseBearer, requireUser, resolvePrincipal } from './principal'
import { SessionTokenError, type VerifySessionToken } from './verify-token'

const GOOD_TOKEN = 'good.token.value'

// Accepts GOOD_TOKEN only; everything else is rejected the way the Clerk wrapper would.
const fakeVerify: VerifySessionToken = async (token) => {
  if (token === GOOD_TOKEN) return { sub: 'user_abc', sid: 'sess_123' }
  throw new SessionTokenError('invalid', 'token-invalid-signature')
}

function buildApp(verify: VerifySessionToken = fakeVerify) {
  const logger = pino({ level: 'silent' })
  const handlerRan = vi.fn()
  const app = new Hono<AppBindings>()
  app.use('*', requestId())
  app.use('*', resolvePrincipal(verify, { logger }))
  app.get('/whoami', (c) => c.json({ principal: c.get('principal') }))
  app.get('/private', requireUser(), (c) => {
    handlerRan()
    return c.json({ ok: true })
  })
  app.onError(errorHandler(logger))
  return { app, handlerRan }
}

describe('parseBearer', () => {
  it('accepts a case-insensitive Bearer scheme with one token', () => {
    expect(parseBearer('Bearer abc')).toBe('abc')
    expect(parseBearer('bearer abc')).toBe('abc')
  })

  it.each(['', '   ', 'Bearer', 'Bearer ', 'Bearer  abc', 'Bearer a b', 'Basic abc', 'abc'])(
    'rejects %j',
    (header) => {
      expect(parseBearer(header)).toBeNull()
    },
  )
})

describe('resolvePrincipal', () => {
  it('treats a request without an Authorization header as anonymous', async () => {
    const { app } = buildApp()
    const res = await app.request('/whoami')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ principal: { kind: 'anonymous' } })
  })

  it('ignores the __session cookie and a token in the query string', async () => {
    const verify = vi.fn(fakeVerify)
    const { app } = buildApp(verify)
    const res = await app.request(`/whoami?token=${GOOD_TOKEN}&__session=${GOOD_TOKEN}`, {
      headers: { Cookie: `__session=${GOOD_TOKEN}` },
    })
    expect(await res.json()).toEqual({ principal: { kind: 'anonymous' } })
    expect(verify).not.toHaveBeenCalled()
  })

  it.each(['', 'Basic dXNlcjpwYXNz', 'Bearer', 'Bearer a b'])(
    'returns the 401 envelope for malformed header %j',
    async (header) => {
      const { app } = buildApp()
      const res = await app.request('/whoami', { headers: { Authorization: header } })
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
      const body = (await res.json()) as ErrorResponse
      expect(body.error).toMatchObject({ code: 'unauthorized', status: 401 })
    },
  )

  it('returns 401 for a token the verifier rejects, even on an anonymous route', async () => {
    const { app } = buildApp()
    const res = await app.request('/whoami', { headers: { Authorization: 'Bearer forged' } })
    expect(res.status).toBe(401)
    const body = (await res.json()) as ErrorResponse
    expect(body.error.code).toBe('unauthorized')
    expect(body.error.message).not.toContain('signature')
  })

  it('returns 503 when the verifier cannot check tokens at all', async () => {
    const { app } = buildApp(async () => {
      throw new SessionTokenError('unavailable', 'jwk-remote-failed-to-load')
    })
    const res = await app.request('/whoami', { headers: { Authorization: `Bearer ${GOOD_TOKEN}` } })
    expect(res.status).toBe(503)
    expect(((await res.json()) as ErrorResponse).error.code).toBe('internal')
  })

  it('sets the user principal with userId = tenantId = sub', async () => {
    const { app } = buildApp()
    const res = await app.request('/whoami', { headers: { Authorization: `Bearer ${GOOD_TOKEN}` } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      principal: { kind: 'user', userId: 'user_abc', tenantId: 'user_abc', sessionId: 'sess_123' },
    })
  })
})

describe('requireUser', () => {
  it('returns 401 for an anonymous caller without running the handler', async () => {
    const { app, handlerRan } = buildApp()
    const res = await app.request('/private')
    expect(res.status).toBe(401)
    expect(((await res.json()) as ErrorResponse).error.code).toBe('unauthorized')
    expect(handlerRan).not.toHaveBeenCalled()
  })

  it('runs the handler for a signed-in user', async () => {
    const { app, handlerRan } = buildApp()
    const res = await app.request('/private', { headers: { Authorization: `Bearer ${GOOD_TOKEN}` } })
    expect(res.status).toBe(200)
    expect(handlerRan).toHaveBeenCalledOnce()
  })
})

describe('actorFor', () => {
  it('maps a user principal to a user actor without the session ID', () => {
    expect(
      actorFor({ kind: 'user', userId: 'user_abc', tenantId: 'user_abc', sessionId: 'sess_123' }),
    ).toEqual({ kind: 'user', userId: 'user_abc', tenantId: 'user_abc' })
  })

  it('maps an anonymous principal to the anonymous actor', () => {
    expect(actorFor({ kind: 'anonymous' })).toEqual({ kind: 'anonymous' })
  })
})
