// End-to-end API suite against the full createApp() (01.5-backend-foundation
// task 9.9, Requirements 1.2-1.5 and 2.2-2.4). Uses app.request() with fakes
// for the token verifier, database and health probe. `./routes` is mocked to
// register test-only routes, so production code needs no test seam:
// - GET /probe: defineRoute() without `access`, to exercise the closed default
// - GET /boom: anonymous, throws an error carrying an internal message
// - GET /search: anonymous, with a Zod query schema
import { pino } from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Db } from '@cauldron/core/db'
import { createApp } from './app'
import { SessionTokenError, type VerifySessionToken } from './auth/verify-token'
import { loadEnv } from './env'
import { ErrorResponseSchema } from './http/errors'
import { REQUEST_ID_HEADER } from './http/request-id'

const calls = vi.hoisted(() => ({ probe: 0 }))

const SECRET = 'db password is hunter2'

vi.mock('./routes', async () => {
  const { z } = await import('@hono/zod-openapi')
  const { defineRoute } = await import('./http/define-route')
  const { errorResponses } = await import('./http/openapi')
  const routes: typeof import('./routes') = {
    registerRoutes: (v1) => {
      const probe = defineRoute({
        method: 'get',
        path: '/probe',
        responses: {
          200: {
            description: 'The resolved principal.',
            content: {
              'application/json': {
                schema: z.object({ userId: z.string(), tenantId: z.string() }),
              },
            },
          },
          ...errorResponses(401),
        },
      })
      v1.openapi(probe, (c) => {
        calls.probe += 1
        const principal = c.get('principal')
        if (principal?.kind !== 'user') throw new Error('handler ran without a user')
        return c.json({ userId: principal.userId, tenantId: principal.tenantId }, 200)
      })

      const boom = defineRoute({
        method: 'get',
        path: '/boom',
        access: 'anonymous',
        responses: { ...errorResponses(500) },
      })
      v1.openapi(boom, () => {
        throw new Error(SECRET)
      })

      const search = defineRoute({
        method: 'get',
        path: '/search',
        access: 'anonymous',
        request: {
          query: z.object({ limit: z.coerce.number().int().positive() }),
        },
        responses: {
          200: {
            description: 'Echoes the limit.',
            content: { 'application/json': { schema: z.object({ limit: z.number() }) } },
          },
          ...errorResponses(400),
        },
      })
      v1.openapi(search, (c) => c.json({ limit: c.req.valid('query').limit }, 200))
    },
  }
  return routes
})

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

function buildApp(databaseOk = true) {
  return createApp({
    env,
    // No route under test touches the database.
    db: {} as Db,
    verifyToken,
    health: { checkDatabase: async () => databaseOk },
    logger: pino({ level: 'silent' }),
    developerRole: async () => false,
  })
}

async function envelope(res: Response) {
  return ErrorResponseSchema.parse(await res.json()).error
}

beforeEach(() => {
  calls.probe = 0
})

describe('/health (Requirement 1.2)', () => {
  it('returns 200 without a token when the database answers', async () => {
    const res = await buildApp().request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } })
  })

  it('returns 503 when the database probe fails', async () => {
    const res = await buildApp(false).request('/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ status: 'error', checks: { database: 'error' } })
  })
})

describe('OpenAPI document (Requirements 1.3, 2.4)', () => {
  it('is served anonymously, with an explicit security field on every operation', async () => {
    const res = await buildApp().request('/v1/openapi.json')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { security?: unknown }>>
    }

    const operations = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ path, method, op })),
    )
    expect(operations.map((o) => `${o.method} ${o.path}`).sort()).toEqual([
      'get /boom',
      'get /probe',
      'get /search',
    ])
    for (const { op } of operations) expect(op.security).toBeDefined()

    expect(doc.paths['/probe'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/search'].get.security).toEqual([])
  })
})

describe('route defined without access (Requirements 2.2, 2.3)', () => {
  const app = buildApp()

  it('returns the 401 envelope without a token, before the handler runs', async () => {
    const res = await app.request('/v1/probe')
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(await envelope(res)).toMatchObject({ code: 'unauthorized', status: 401 })
    expect(calls.probe).toBe(0)
  })

  it('returns 401 for a rejected token', async () => {
    const res = await app.request('/v1/probe', { headers: { Authorization: 'Bearer forged' } })
    expect(res.status).toBe(401)
    expect((await envelope(res)).code).toBe('unauthorized')
    expect(calls.probe).toBe(0)
  })

  it('gives the handler a principal with userId = tenantId = sub for a valid token', async () => {
    const res = await app.request('/v1/probe', { headers: { Authorization: 'Bearer good' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'user_1', tenantId: 'user_1' })
    expect(calls.probe).toBe(1)
  })
})

describe('error envelope (Requirement 1.4)', () => {
  const app = buildApp()

  it('returns 404 for an unknown route', async () => {
    const res = await app.request('/v1/does-not-exist')
    expect(res.status).toBe(404)
    const error = await envelope(res)
    expect(error).toMatchObject({ code: 'not_found', status: 404 })
    expect(error.requestId).toBe(res.headers.get(REQUEST_ID_HEADER))
  })

  it('returns 500 with a generic message when a handler throws', async () => {
    const res = await app.request('/v1/boom')
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('at ')
    const error = ErrorResponseSchema.parse(JSON.parse(text)).error
    expect(error).toMatchObject({ code: 'internal', status: 500 })
    expect(error.requestId).toBe(res.headers.get(REQUEST_ID_HEADER))
  })

  it('returns 400 validation_failed for invalid input', async () => {
    const res = await app.request('/v1/search?limit=-3')
    expect(res.status).toBe(400)
    const error = await envelope(res)
    expect(error).toMatchObject({ code: 'validation_failed', status: 400 })
    expect(error.details).toEqual([expect.objectContaining({ path: 'query.limit' })])
  })

  it('passes valid input through to the handler', async () => {
    const res = await app.request('/v1/search?limit=5')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ limit: 5 })
  })
})

describe('CORS (Requirement 1.5)', () => {
  const app = buildApp()

  it('echoes an allowed origin', async () => {
    const res = await app.request('/v1/search?limit=1', { headers: { Origin: ORIGIN } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('gives any other origin no CORS header', async () => {
    const res = await app.request('/v1/search?limit=1', {
      headers: { Origin: 'https://evil.example' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers a preflight with the allowed headers, without requiring a token', async () => {
    const res = await app.request('/v1/probe', {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    const allowHeaders = (res.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase()
    expect(allowHeaders.split(/\s*,\s*/)).toEqual(
      expect.arrayContaining(['authorization', 'content-type']),
    )
    expect(calls.probe).toBe(0)
  })
})
