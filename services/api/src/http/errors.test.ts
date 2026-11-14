import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { ForbiddenError } from '@cauldron/core/db'
import { type AppBindings } from './bindings'
import {
  ApiError,
  ErrorResponseSchema,
  errorHandler,
  notFoundHandler,
  registerErrorSchema,
  validationErrorHook,
} from './errors'
import { REQUEST_ID_HEADER, requestId } from './request-id'

function buildApp() {
  const app = new OpenAPIHono<AppBindings>({ defaultHook: validationErrorHook })
  app.use('*', requestId())
  registerErrorSchema(app)

  app.get('/conflict', () => {
    throw new ApiError(409, 'conflict', 'Already exists.', [{ field: 'slug' }])
  })
  app.get('/unauthorized', () => {
    throw new ApiError(401, 'unauthorized', 'A valid session token is required.')
  })
  app.get('/boom', () => {
    throw new Error('connection string postgres://secret@db leaked')
  })
  app.get('/forbidden', () => {
    throw new ForbiddenError({ cause: new Error('new row violates row-level security') })
  })
  app.openapi(
    createRoute({
      method: 'get',
      path: '/items',
      request: { query: z.object({ limit: z.coerce.number().int().max(50) }) },
      responses: { 200: { description: 'ok' } },
    }),
    (c) => c.json({ ok: true }, 200),
  )

  app.notFound(notFoundHandler)
  app.onError(errorHandler(pino({ enabled: false })))
  return app
}

async function envelope(res: Response) {
  return ErrorResponseSchema.parse(await res.json()).error
}

describe('error envelope', () => {
  const app = buildApp()

  it('renders ApiError with its code, status, message and details', async () => {
    const res = await app.request('/conflict')
    expect(res.status).toBe(409)
    expect(await envelope(res)).toMatchObject({
      code: 'conflict',
      status: 409,
      message: 'Already exists.',
      details: [{ field: 'slug' }],
    })
  })

  it('sets WWW-Authenticate: Bearer on 401', async () => {
    const res = await app.request('/unauthorized')
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect((await envelope(res)).code).toBe('unauthorized')
  })

  it('maps unknown errors to 500 internal without leaking the message', async () => {
    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    const text = await res.clone().text()
    expect(text).not.toContain('postgres://')
    expect(text).not.toContain('at ')
    expect(await envelope(res)).toMatchObject({ code: 'internal', status: 500 })
  })

  it('maps ForbiddenError to 403 forbidden', async () => {
    const res = await app.request('/forbidden')
    expect(res.status).toBe(403)
    const body = await envelope(res)
    expect(body.code).toBe('forbidden')
    expect(body.message).not.toContain('row-level security')
  })

  it('returns a 404 envelope for unknown routes', async () => {
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
    expect(await envelope(res)).toMatchObject({ code: 'not_found', status: 404 })
  })

  it('maps Zod failures to 400 validation_failed with details', async () => {
    const res = await app.request('/items?limit=500')
    expect(res.status).toBe(400)
    const body = await envelope(res)
    expect(body.code).toBe('validation_failed')
    expect(body.details).toEqual([
      { path: 'query.limit', message: expect.any(String) },
    ])
    expect((await app.request('/items?limit=5')).status).toBe(200)
  })

  it('puts the request ID in the header and the body', async () => {
    const res = await app.request('/nope')
    const header = res.headers.get(REQUEST_ID_HEADER)
    expect(header).toMatch(/^req_[0-9a-f]{32}$/)
    expect((await envelope(res)).requestId).toBe(header)
  })

  it('keeps a well-formed incoming request ID and replaces a malformed one', async () => {
    const kept = await app.request('/nope', { headers: { [REQUEST_ID_HEADER]: 'edge-abc_123' } })
    expect(kept.headers.get(REQUEST_ID_HEADER)).toBe('edge-abc_123')

    const replaced = await app.request('/nope', {
      headers: { [REQUEST_ID_HEADER]: 'bad id; with spaces' },
    })
    expect(replaced.headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/)
    const tooLong = await app.request('/nope', { headers: { [REQUEST_ID_HEADER]: 'a'.repeat(65) } })
    expect(tooLong.headers.get(REQUEST_ID_HEADER)).toMatch(/^req_/)
  })

  it('registers the Error schema as an OpenAPI component', () => {
    const doc = app.getOpenAPI31Document({
      openapi: '3.1.0',
      info: { title: 'test', version: '0' },
    })
    expect(doc.components?.schemas).toHaveProperty('Error')
  })
})
