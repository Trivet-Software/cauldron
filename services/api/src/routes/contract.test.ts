// Spec-level checks over the real route set (01.7-walking-skeleton task 6.10,
// Requirements 1.7, 2.3, 10.3): the generated OpenAPI document, the stable
// error codes, and CORS for a multipart request.
import { describe, expect, it } from 'vitest'
import { ErrorResponseSchema } from '../http/errors'
import { AUTH_HEADER, TEST_ORIGIN, createTestApp } from '../testing'

type Operation = {
  security?: unknown
  responses?: Record<string, unknown>
  requestBody?: { content: Record<string, unknown> }
}
type Doc = { paths: Record<string, Record<string, Operation>> }

async function openApiDoc(): Promise<Doc> {
  const res = await createTestApp().app.request('/v1/openapi.json')
  expect(res.status).toBe(200)
  return (await res.json()) as Doc
}

describe('OpenAPI document: security of the walking-skeleton operations', () => {
  it('lists the goals operations as public and every other new operation as bearerAuth', async () => {
    const { paths } = await openApiDoc()
    expect(paths['/goals']!.get!.security).toEqual([])
    expect(paths['/goals/{slug}']!.get!.security).toEqual([])
    const bearer = [{ bearerAuth: [] }]
    expect(paths['/captures']!.post!.security).toEqual(bearer)
    expect(paths['/sources/{id}']!.get!.security).toEqual(bearer)
    expect(paths['/items']!.get!.security).toEqual(bearer)
    expect(paths['/items/{id}']!.get!.security).toEqual(bearer)
  })

  it('declares security explicitly on every operation in the document', async () => {
    const { paths } = await openApiDoc()
    const operations = Object.entries(paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ name: `${method} ${path}`, op })),
    )
    expect(operations.length).toBeGreaterThanOrEqual(7)
    for (const { name, op } of operations) {
      expect(op.security, name).toBeDefined()
    }
  })

  it('describes the capture request as multipart/form-data with the two new error statuses', async () => {
    const { paths } = await openApiDoc()
    const capture = paths['/captures']!.post!
    expect(Object.keys(capture.requestBody!.content)).toEqual(['multipart/form-data'])
    expect(Object.keys(capture.responses!)).toEqual(
      expect.arrayContaining(['202', '400', '401', '413', '415']),
    )
  })
})

describe('stable error codes (Requirement 10.3)', () => {
  const { app } = createTestApp()

  async function codeOf(res: Response): Promise<string> {
    return ErrorResponseSchema.parse(await res.json()).error.code
  }

  it('uses the established codes and the two new ones, with matching statuses', async () => {
    const tooLong = new FormData()
    tooLong.set('goal', 'recipe-box')
    tooLong.set('text', 'a'.repeat(100_001))
    const notAnImage = new FormData()
    notAnImage.set('goal', 'recipe-box')
    notAnImage.set('image', new File(['text'], 'a.png', { type: 'image/png' }))
    const noInput = new FormData()
    noInput.set('goal', 'recipe-box')
    const unknownGoal = new FormData()
    unknownGoal.set('goal', 'nope')
    unknownGoal.set('text', 'Soup')

    const post = (body: FormData) =>
      app.request('/v1/captures', { method: 'POST', headers: AUTH_HEADER, body })

    const cases: Array<[Response, number, string]> = [
      [await app.request('/v1/items?goal=recipe-box'), 401, 'unauthorized'],
      [await post(unknownGoal), 400, 'bad_request'],
      [await post(noInput), 400, 'validation_failed'],
      [await post(tooLong), 413, 'payload_too_large'],
      [await post(notAnImage), 415, 'unsupported_media_type'],
      [
        await app.request('/v1/items/00000000-0000-4000-8000-0000000000ff', { headers: AUTH_HEADER }),
        404,
        'not_found',
      ],
    ]
    for (const [res, status, code] of cases) {
      expect(res.status).toBe(status)
      expect(await codeOf(res)).toBe(code)
    }
  })
})

describe('CORS for a multipart capture', () => {
  const { app } = createTestApp()

  function preflight(origin: string) {
    return app.request('/v1/captures', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
  }

  it('allows the configured origin to POST with a multipart content type and a token', async () => {
    const res = await preflight(TEST_ORIGIN)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(TEST_ORIGIN)
    const methods = (res.headers.get('Access-Control-Allow-Methods') ?? '').split(/\s*,\s*/)
    expect(methods).toContain('POST')
    const headers = (res.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase().split(/\s*,\s*/)
    expect(headers).toEqual(expect.arrayContaining(['authorization', 'content-type']))
  })

  it('gives any other origin no allow-origin header', async () => {
    const res = await preflight('https://evil.example')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('lets the allowed origin read the 202 and the other origin gets no CORS header', async () => {
    const body = (): FormData => {
      const data = new FormData()
      data.set('goal', 'recipe-box')
      data.set('text', 'Soup')
      return data
    }
    const allowed = await app.request('/v1/captures', {
      method: 'POST',
      headers: { ...AUTH_HEADER, Origin: TEST_ORIGIN },
      body: body(),
    })
    expect(allowed.status).toBe(202)
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(TEST_ORIGIN)

    const other = await app.request('/v1/captures', {
      method: 'POST',
      headers: { ...AUTH_HEADER, Origin: 'https://evil.example' },
      body: body(),
    })
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
