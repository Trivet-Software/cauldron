// createApp wiring (01.5-backend-foundation task 9.8). Task 9.9 adds the full
// API suite; these cover how the pieces are assembled.
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { type Db } from '@cauldron/core/db'
import { createApp } from './app'
import { SessionTokenError, type VerifySessionToken } from './auth/verify-token'
import { loadEnv } from './env'
import { ErrorResponseSchema } from './http/errors'
import { REQUEST_ID_HEADER } from './http/request-id'

const ORIGIN = 'https://app.example.com'

const env = loadEnv({
  DATABASE_URL: 'postgresql://unused',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  CLERK_SECRET_KEY: 'sk_test_x',
  APP_ORIGINS: ORIGIN,
  PROVIDERS: 'mock',
  MOCK_RECORDINGS_DIR: '/tmp/unused',
})

const verifyToken: VerifySessionToken = async (token) => {
  if (token === 'good') return { sub: 'user_1', sid: 'sess_1' }
  throw new SessionTokenError('invalid', 'token-invalid')
}

function buildApp() {
  return createApp({
    env,
    // No route touches the database yet.
    db: {} as Db,
    verifyToken,
    health: { checkDatabase: async () => true },
    logger: pino({ level: 'silent' }),
    developerRole: async () => false,
  })
}

async function envelope(res: Response) {
  return ErrorResponseSchema.parse(await res.json()).error
}

describe('createApp', () => {
  const app = buildApp()

  it('serves /health without a token and without CORS headers', async () => {
    const res = await app.request('/health', { headers: { Origin: ORIGIN } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^req_[0-9a-f]+$/)
  })

  it('serves the OpenAPI document anonymously, with CORS for an allowed origin', async () => {
    const res = await app.request('/v1/openapi.json', { headers: { Origin: ORIGIN } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    const doc = (await res.json()) as {
      openapi: string
      components: { securitySchemes: Record<string, unknown> }
    }
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ scheme: 'bearer' })
  })

  it('accepts a valid token on an anonymous route', async () => {
    const res = await app.request('/v1/openapi.json', {
      headers: { Authorization: 'Bearer good' },
    })
    expect(res.status).toBe(200)
  })

  it('returns the 404 envelope for an unknown /v1 path, with CORS', async () => {
    const res = await app.request('/v1/nope', { headers: { Origin: ORIGIN } })
    expect(res.status).toBe(404)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    const error = await envelope(res)
    expect(error).toMatchObject({ code: 'not_found', status: 404 })
    expect(error.requestId).toBe(res.headers.get(REQUEST_ID_HEADER))
  })

  it('returns the 404 envelope outside /v1', async () => {
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
    expect((await envelope(res)).code).toBe('not_found')
  })

  it('rejects a broken token with the 401 envelope, readable by an allowed origin', async () => {
    const res = await app.request('/v1/openapi.json', {
      headers: { Origin: ORIGIN, Authorization: 'Bearer forged' },
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/)
    expect(await envelope(res)).toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('gives a disallowed origin no CORS header on the 401', async () => {
    const res = await app.request('/v1/openapi.json', {
      headers: { Origin: 'https://evil.example', Authorization: 'Basic abc' },
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
