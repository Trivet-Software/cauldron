import { OpenAPIHono, z } from '@hono/zod-openapi'
import { pino } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { resolvePrincipal } from '../auth/principal'
import { SessionTokenError, type VerifySessionToken } from '../auth/verify-token'
import { type AppBindings } from './bindings'
import { defineRoute } from './define-route'
import { type ErrorResponse, errorHandler, notFoundHandler, validationErrorHook } from './errors'
import { BEARER_AUTH, errorResponses, registerOpenApi } from './openapi'
import { requestId } from './request-id'

const GOOD_TOKEN = 'good.token.value'

const fakeVerify: VerifySessionToken = async (token) => {
  if (token === GOOD_TOKEN) return { sub: 'user_abc', sid: 'sess_123' }
  throw new SessionTokenError('invalid', 'token-invalid-signature')
}

const PrincipalSchema = z.object({ kind: z.string(), userId: z.string().optional() })

// No `access`: exercises the closed default.
const privateRoute = defineRoute({
  method: 'get',
  path: '/private',
  responses: {
    200: {
      description: 'The caller',
      content: { 'application/json': { schema: PrincipalSchema } },
    },
    ...errorResponses(401, 500),
  },
})

const publicRoute = defineRoute({
  access: 'anonymous',
  method: 'get',
  path: '/public',
  responses: {
    200: {
      description: 'The caller',
      content: { 'application/json': { schema: PrincipalSchema } },
    },
  },
})

function buildApp() {
  const logger = pino({ level: 'silent' })
  const privateRan = vi.fn()
  const afterAuth = vi.fn()

  const app = new OpenAPIHono<AppBindings>({ defaultHook: validationErrorHook })
  app.use('*', requestId())
  const v1 = new OpenAPIHono<AppBindings>({ defaultHook: validationErrorHook })
  v1.use('*', resolvePrincipal(fakeVerify, { logger }))
  v1.openapi(
    defineRoute({
      method: 'get',
      path: '/with-middleware',
      middleware: async (_c, next) => {
        afterAuth()
        await next()
      },
      responses: { 204: { description: 'ok' } },
    }),
    (c) => c.body(null, 204),
  )
  v1.openapi(privateRoute, (c) => {
    privateRan()
    const principal = c.get('principal')
    return c.json(
      { kind: principal?.kind ?? 'none', userId: principal?.kind === 'user' ? principal.userId : undefined },
      200,
    )
  })
  v1.openapi(publicRoute, (c) => c.json({ kind: c.get('principal')?.kind ?? 'none' }, 200))
  registerOpenApi(v1, { version: '1.2.3' })
  app.route('/v1', v1)
  app.notFound(notFoundHandler)
  app.onError(errorHandler(logger))
  return { app, privateRan, afterAuth }
}

interface OpenApiDoc {
  info: { title: string; version: string }
  components: { securitySchemes: Record<string, unknown> }
  paths: Record<string, Record<string, { security?: unknown; responses: Record<string, unknown> }>>
}

async function fetchDoc(app: OpenAPIHono<AppBindings>): Promise<OpenApiDoc> {
  const res = await app.request('/v1/openapi.json')
  expect(res.status).toBe(200)
  return (await res.json()) as OpenApiDoc
}

describe('defineRoute', () => {
  it('returns the 401 envelope for a user route without a token, before the handler runs', async () => {
    const { app, privateRan } = buildApp()
    const res = await app.request('/v1/private')
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
    const body = (await res.json()) as ErrorResponse
    expect(body.error).toMatchObject({ code: 'unauthorized', status: 401 })
    expect(privateRan).not.toHaveBeenCalled()
  })

  it('runs a user route for a verified token', async () => {
    const { app, privateRan } = buildApp()
    const res = await app.request('/v1/private', {
      headers: { Authorization: `Bearer ${GOOD_TOKEN}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: 'user', userId: 'user_abc' })
    expect(privateRan).toHaveBeenCalledOnce()
  })

  it('serves an anonymous route without a token', async () => {
    const { app } = buildApp()
    const res = await app.request('/v1/public')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: 'anonymous' })
  })

  it('runs caller middleware only after the access check', async () => {
    const { app, afterAuth } = buildApp()
    expect((await app.request('/v1/with-middleware')).status).toBe(401)
    expect(afterAuth).not.toHaveBeenCalled()
    const res = await app.request('/v1/with-middleware', {
      headers: { Authorization: `Bearer ${GOOD_TOKEN}` },
    })
    expect(res.status).toBe(204)
    expect(afterAuth).toHaveBeenCalledOnce()
  })
})

describe('OpenAPI document', () => {
  it('is served without a token and registers the bearerAuth scheme', async () => {
    const { app } = buildApp()
    const doc = await fetchDoc(app)
    expect(doc.info).toEqual({ title: 'Cauldron API', version: '1.2.3' })
    expect(doc.components.securitySchemes[BEARER_AUTH]).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    })
  })

  it('marks user routes with bearerAuth and anonymous routes with an empty security list', async () => {
    const { app } = buildApp()
    const doc = await fetchDoc(app)
    expect(doc.paths['/private'].get.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/public'].get.security).toEqual([])
  })

  it('gives every operation an explicit security field', async () => {
    const { app } = buildApp()
    const doc = await fetchDoc(app)
    const operations = Object.values(doc.paths).flatMap((ops) => Object.entries(ops))
    expect(operations.length).toBeGreaterThan(0)
    for (const [, op] of operations) {
      expect(op).toHaveProperty('security')
    }
  })

  it('documents error responses with the shared Error component', async () => {
    const { app } = buildApp()
    const doc = await fetchDoc(app)
    expect(doc.paths['/private'].get.responses['401']).toEqual({
      description: 'A valid session token is required.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    })
  })
})
