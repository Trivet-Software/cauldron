// `POST /v1/captures` (01.7-walking-skeleton task 6.10, Requirements 2.1 to
// 2.3). Real createApp() over the in-memory collection and storage. Every
// rejection must leave both untouched.
import { describe, expect, it } from 'vitest'
import { ErrorResponseSchema } from '../http/errors'
import { AUTH_HEADER, createTestApp } from '../testing'

const MB = 1024 * 1024
const TEN_MB = 10 * MB

/** A valid PNG signature followed by zero padding up to `size` bytes. */
function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}

/** A valid JPEG signature followed by a varying pattern, so a corrupted copy would differ. */
function jpegBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) bytes[i] = i % 251
  bytes.set([0xff, 0xd8, 0xff, 0xe0])
  return bytes
}

function form(fields: { goal?: string; client?: string; text?: string; image?: File }): FormData {
  const data = new FormData()
  if (fields.goal !== undefined) data.set('goal', fields.goal)
  if (fields.client !== undefined) data.set('client', fields.client)
  if (fields.text !== undefined) data.set('text', fields.text)
  if (fields.image !== undefined) data.set('image', fields.image)
  return data
}

function post(app: ReturnType<typeof createTestApp>['app'], body: FormData, headers = AUTH_HEADER) {
  return app.request('/v1/captures', { method: 'POST', headers, body })
}

async function errorOf(res: Response) {
  return ErrorResponseSchema.parse(await res.json()).error
}

function expectUntouched({ collection, storage }: ReturnType<typeof createTestApp>) {
  expect(collection.captures).toEqual([])
  expect(storage.objects.size).toBe(0)
}

describe('POST /v1/captures: accepted captures', () => {
  it('stores the text unchanged under the tenant prefix and queues it (Requirement 2.1)', async () => {
    const ctx = createTestApp()
    // One line: multipart encoding turns a bare \n in a form field into \r\n
    // before the route sees it, so a multi-line string would not round-trip.
    const text = 'Crème brûlée, 🍮 – whisk and bake.'
    const res = await post(ctx.app, form({ goal: 'recipe-box', text }))

    expect(res.status).toBe(202)
    const body = (await res.json()) as { sourceId: string; state: string }
    expect(body.state).toBe('queued')

    expect(ctx.collection.captures).toHaveLength(1)
    const capture = ctx.collection.captures[0]!
    expect(capture).toMatchObject({
      sourceId: body.sourceId,
      goalId: '00000000-0000-4000-8000-000000000001',
      kind: 'text',
      client: 'web',
      metadata: { label: text, contentType: 'text/plain; charset=utf-8' },
    })
    expect(capture.storagePath.startsWith('user_1/')).toBe(true)
    const stored = ctx.storage.objects.get(capture.storagePath)
    expect(new TextDecoder().decode(stored?.body)).toBe(text)
  })

  it('stores the image bytes unchanged and records the mcp client (Requirement 2.1)', async () => {
    const ctx = createTestApp()
    const sent = jpegBytes(4096)
    const res = await post(
      ctx.app,
      form({
        goal: 'recipe-box',
        client: 'mcp',
        image: new File([sent], 'soup.jpg', { type: 'image/jpeg' }),
      }),
    )

    expect(res.status).toBe(202)
    const capture = ctx.collection.captures[0]!
    expect(capture).toMatchObject({
      kind: 'photo',
      client: 'mcp',
      metadata: { filename: 'soup.jpg', contentType: 'image/jpeg', bytes: 4096 },
    })
    expect(capture.storagePath.startsWith('user_1/')).toBe(true)
    expect(Buffer.from(ctx.storage.objects.get(capture.storagePath)!.body).equals(Buffer.from(sent))).toBe(true)
  })

  it("uses the caller's own tenant", async () => {
    const ctx = createTestApp()
    await post(ctx.app, form({ goal: 'recipe-box', text: 'Soup' }), { Authorization: 'Bearer other' })
    expect(ctx.collection.captures[0]!.storagePath.startsWith('user_2/')).toBe(true)
  })

  it('ignores an empty text field sent next to an image, as a browser form does', async () => {
    const ctx = createTestApp()
    const res = await post(
      ctx.app,
      form({
        goal: 'recipe-box',
        text: '',
        image: new File([pngBytes(64)], 'a.png', { type: 'image/png' }),
      }),
    )
    expect(res.status).toBe(202)
  })
})

describe('POST /v1/captures: goal (Requirement 2.2)', () => {
  it.each([
    ['an unknown goal', { goal: 'nope', text: 'Soup' }],
    ['no goal', { text: 'Soup' }],
  ])('rejects %s with 400 listing the available slugs', async (_name, fields) => {
    const ctx = createTestApp()
    const res = await post(ctx.app, form(fields))
    expect(res.status).toBe(400)
    const error = await errorOf(res)
    expect(error.code).toBe('bad_request')
    expect(error.message).toBe('Unknown goal. Available goals: recipe-box, research-library.')
    expect(error.details).toEqual(['recipe-box', 'research-library'])
    expectUntouched(ctx)
  })
})

describe('POST /v1/captures: exactly one input (Requirement 2.1)', () => {
  it('rejects text and an image together', async () => {
    const ctx = createTestApp()
    const res = await post(
      ctx.app,
      form({
        goal: 'recipe-box',
        text: 'Soup',
        image: new File([pngBytes(64)], 'a.png', { type: 'image/png' }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await errorOf(res)).code).toBe('validation_failed')
    expectUntouched(ctx)
  })

  it.each([
    ['neither', {}],
    ['whitespace-only text', { text: '  \n ' }],
  ])('rejects %s', async (_name, extra) => {
    const ctx = createTestApp()
    const res = await post(ctx.app, form({ goal: 'recipe-box', ...extra }))
    expect(res.status).toBe(400)
    expect((await errorOf(res)).code).toBe('validation_failed')
    expectUntouched(ctx)
  })

  it('rejects an unknown client label', async () => {
    const ctx = createTestApp()
    const res = await post(ctx.app, form({ goal: 'recipe-box', client: 'cli', text: 'Soup' }))
    expect(res.status).toBe(400)
    expect((await errorOf(res)).code).toBe('validation_failed')
    expectUntouched(ctx)
  })
})

describe('POST /v1/captures: text limit (Requirement 2.3)', () => {
  it('accepts 100,000 characters', async () => {
    const ctx = createTestApp()
    const res = await post(ctx.app, form({ goal: 'recipe-box', text: 'a'.repeat(100_000) }))
    expect(res.status).toBe(202)
    expect(ctx.collection.captures).toHaveLength(1)
    expect(ctx.storage.objects.size).toBe(1)
  })

  it('rejects 100,001 characters with 413 naming the limit', async () => {
    const ctx = createTestApp()
    const res = await post(ctx.app, form({ goal: 'recipe-box', text: 'a'.repeat(100_001) }))
    expect(res.status).toBe(413)
    const error = await errorOf(res)
    expect(error.code).toBe('payload_too_large')
    expect(error.message).toContain('100,000')
    expectUntouched(ctx)
  })
})

describe('POST /v1/captures: image limits (Requirement 2.3)', () => {
  it('accepts exactly 10 MB', async () => {
    const ctx = createTestApp()
    const res = await post(
      ctx.app,
      form({ goal: 'recipe-box', image: new File([pngBytes(TEN_MB)], 'big.png', { type: 'image/png' }) }),
    )
    expect(res.status).toBe(202)
    const capture = ctx.collection.captures[0]!
    expect(ctx.storage.objects.get(capture.storagePath)!.body.byteLength).toBe(TEN_MB)
  })

  it('rejects 10 MB + 1 byte with 413 naming the limit', async () => {
    const ctx = createTestApp()
    const res = await post(
      ctx.app,
      form({
        goal: 'recipe-box',
        image: new File([pngBytes(TEN_MB + 1)], 'big.png', { type: 'image/png' }),
      }),
    )
    expect(res.status).toBe(413)
    const error = await errorOf(res)
    expect(error.code).toBe('payload_too_large')
    expect(error.message).toContain('10 MB')
    expectUntouched(ctx)
  })

  it('rejects a body over the 12 MB request limit with 413 before reading it', async () => {
    const ctx = createTestApp()
    const res = await post(
      ctx.app,
      form({
        goal: 'recipe-box',
        image: new File([pngBytes(13 * MB)], 'huge.png', { type: 'image/png' }),
      }),
    )
    expect(res.status).toBe(413)
    expect((await errorOf(res)).code).toBe('payload_too_large')
    expectUntouched(ctx)
  })

  it('rejects a text file named .png with 415, whatever type it declares', async () => {
    const ctx = createTestApp()
    const res = await post(
      ctx.app,
      form({
        goal: 'recipe-box',
        image: new File(['just some text, not a picture'], 'photo.png', { type: 'image/png' }),
      }),
    )
    expect(res.status).toBe(415)
    const error = await errorOf(res)
    expect(error.code).toBe('unsupported_media_type')
    expect(error.message).toContain('JPEG, PNG or WebP')
    expectUntouched(ctx)
  })

  it('rejects an image part sent as a plain string field', async () => {
    const ctx = createTestApp()
    const data = form({ goal: 'recipe-box' })
    data.set('image', 'not a file')
    const res = await post(ctx.app, data)
    expect(res.status).toBe(400)
    expect((await errorOf(res)).code).toBe('validation_failed')
    expectUntouched(ctx)
  })
})
