// `GET /v1/goals` and `GET /v1/goals/{slug}` (01.7-walking-skeleton task 6.10,
// Requirement 1.7). Real createApp() over the in-memory collection.
import { describe, expect, it } from 'vitest'
import { ErrorResponseSchema } from '../http/errors'
import { AUTH_HEADER, createTestApp } from '../testing'

const BROKEN = { Authorization: 'Bearer forged' }

describe('GET /v1/goals', () => {
  const { app } = createTestApp()

  it('lists the app goals without a token, with their schema fields and no goal file', async () => {
    const res = await app.request('/v1/goals')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { goals: Array<Record<string, unknown>> }
    expect(body.goals.map((goal) => goal.slug)).toEqual(['recipe-box', 'research-library'])
    expect(body.goals[0]).toMatchObject({
      name: 'Recipe Box',
      version: 1,
      fields: [
        { key: 'title', label: 'Title', kind: 'text', required: true, isTitle: true },
        { key: 'ingredients', kind: 'list', required: false, isTitle: false },
        { key: 'notes', kind: 'long-text' },
        { key: 'image', kind: 'image' },
      ],
    })
    expect(body.goals[0]).not.toHaveProperty('spec')
  })

  it('also answers a valid token', async () => {
    const res = await app.request('/v1/goals', { headers: AUTH_HEADER })
    expect(res.status).toBe(200)
  })

  it('returns the 401 envelope for a broken token', async () => {
    const res = await app.request('/v1/goals', { headers: BROKEN })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(ErrorResponseSchema.parse(await res.json()).error).toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })
})

describe('GET /v1/goals/{slug}', () => {
  const { app } = createTestApp()

  it('returns the summary plus the goal file without a token', async () => {
    const res = await app.request('/v1/goals/recipe-box')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      slug: 'recipe-box',
      name: 'Recipe Box',
      spec: { name: 'Recipe Box', schema: { titleField: 'title' } },
    })
  })

  it('returns the 404 envelope for an unknown slug', async () => {
    const res = await app.request('/v1/goals/nope')
    expect(res.status).toBe(404)
    expect(ErrorResponseSchema.parse(await res.json()).error).toMatchObject({
      code: 'not_found',
      status: 404,
    })
  })

  it('returns the 401 envelope for a broken token', async () => {
    const res = await app.request('/v1/goals/recipe-box', { headers: BROKEN })
    expect(res.status).toBe(401)
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe('unauthorized')
  })
})

describe('the protected routes need a token', () => {
  const { app } = createTestApp()
  const id = '00000000-0000-4000-8000-0000000000aa'

  it.each([
    ['POST', '/v1/captures'],
    ['GET', `/v1/sources/${id}`],
    ['GET', '/v1/items?goal=recipe-box'],
    ['GET', `/v1/items/${id}`],
  ])('%s %s returns 401 without a token and with a broken one', async (method, path) => {
    for (const headers of [undefined, BROKEN]) {
      const res = await app.request(path, { method, ...(headers ? { headers } : {}) })
      expect(res.status).toBe(401)
      expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe('unauthorized')
    }
  })
})
