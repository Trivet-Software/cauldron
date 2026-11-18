// `GET /v1/sources/{id}`, `GET /v1/items` and `GET /v1/items/{id}`
// (01.7-walking-skeleton task 6.10, Requirements 4.1, 4.2, 6.1, 6.3, 6.4).
import { describe, expect, it } from 'vitest'
import { type ItemEntry, type ItemRecord, type SourceStatus } from '@cauldron/core/collection'
import { ErrorResponseSchema } from '../http/errors'
import { AUTH_HEADER, createTestApp } from '../testing'

const SOURCE_ID = '00000000-0000-4000-8000-0000000000a1'
const ITEM_ID = '00000000-0000-4000-8000-0000000000b1'
const MISSING_ID = '00000000-0000-4000-8000-0000000000ff'

function source(overrides: Partial<SourceStatus> = {}): SourceStatus {
  return {
    id: SOURCE_ID,
    goal: 'recipe-box',
    kind: 'text',
    client: 'web',
    capturedAt: '2026-11-14T10:00:00.000Z',
    state: 'queued',
    failureReason: null,
    itemId: null,
    ...overrides,
  }
}

function item(overrides: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: ITEM_ID,
    sourceId: SOURCE_ID,
    goalSlug: 'recipe-box',
    goalVersion: 1,
    title: 'Pancakes',
    data: { title: 'Pancakes', ingredients: ['flour', 'milk'] },
    imagePath: null,
    capturedAt: '2026-11-14T10:00:00.000Z',
    ...overrides,
  }
}

async function errorOf(res: Response) {
  return ErrorResponseSchema.parse(await res.json()).error
}

describe('GET /v1/sources/{id}', () => {
  it.each([
    ['queued', null],
    ['extracting', null],
    ['ready', null],
    ['failed', "The capture doesn't fit this app. Missing or invalid: title."],
  ] as const)('reports the %s state (Requirements 4.1, 4.2)', async (state, failureReason) => {
    const { app, collection } = createTestApp()
    collection.sources.set(SOURCE_ID, source({ state, failureReason }))
    const res = await app.request(`/v1/sources/${SOURCE_ID}`, { headers: AUTH_HEADER })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: SOURCE_ID, state, failureReason })
  })

  it('returns the 404 envelope when the repository returns null', async () => {
    const { app } = createTestApp()
    const res = await app.request(`/v1/sources/${MISSING_ID}`, { headers: AUTH_HEADER })
    expect(res.status).toBe(404)
    expect(await errorOf(res)).toMatchObject({ code: 'not_found', status: 404 })
  })

  it('returns 400 for an id that is not a UUID', async () => {
    const { app } = createTestApp()
    const res = await app.request('/v1/sources/not-a-uuid', { headers: AUTH_HEADER })
    expect(res.status).toBe(400)
    expect((await errorOf(res)).code).toBe('validation_failed')
  })
})

describe('GET /v1/items', () => {
  const entries: ItemEntry[] = [
    {
      id: ITEM_ID,
      sourceId: SOURCE_ID,
      title: 'Pancakes',
      state: 'ready',
      failureReason: null,
      capturedAt: '2026-11-14T10:00:00.000Z',
    },
    {
      id: null,
      sourceId: '00000000-0000-4000-8000-0000000000a2',
      title: 'Waffles',
      state: 'failed',
      failureReason: 'The capture could not be compiled.',
      capturedAt: '2026-11-14T09:00:00.000Z',
    },
  ]

  it('returns the entries, including pending and failed ones (Requirement 6.1)', async () => {
    const { app, collection } = createTestApp()
    collection.entries.push(...entries)
    const res = await app.request('/v1/items?goal=recipe-box', { headers: AUTH_HEADER })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: entries })
  })

  it('returns 400 listing the slugs for an unknown goal', async () => {
    const { app } = createTestApp()
    const res = await app.request('/v1/items?goal=nope', { headers: AUTH_HEADER })
    expect(res.status).toBe(400)
    const error = await errorOf(res)
    expect(error.code).toBe('bad_request')
    expect(error.details).toEqual(['recipe-box', 'research-library'])
  })

  it.each(['', '?goal=', '?goal=recipe-box&limit=0', '?goal=recipe-box&limit=101'])(
    'returns 400 validation_failed for the query "%s"',
    async (query) => {
      const { app } = createTestApp()
      const res = await app.request(`/v1/items${query}`, { headers: AUTH_HEADER })
      expect(res.status).toBe(400)
      expect((await errorOf(res)).code).toBe('validation_failed')
    },
  )
})

describe('GET /v1/items/{id}', () => {
  it('returns the item with its goal and fields (Requirement 6.3)', async () => {
    const { app, collection } = createTestApp()
    collection.items.set(ITEM_ID, item())
    const res = await app.request(`/v1/items/${ITEM_ID}`, { headers: AUTH_HEADER })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: ITEM_ID,
      sourceId: SOURCE_ID,
      goal: { slug: 'recipe-box', name: 'Recipe Box', version: 1 },
      title: 'Pancakes',
      state: 'ready',
      data: { title: 'Pancakes', ingredients: ['flour', 'milk'] },
      capturedAt: '2026-11-14T10:00:00.000Z',
    })
  })

  it('replaces the stored image path with a signed URL that lives at most 600 s', async () => {
    const { app, collection, storage } = createTestApp()
    const imagePath = `user_1/${SOURCE_ID}/0-soup.png`
    collection.items.set(
      ITEM_ID,
      item({ data: { title: 'Soup', image: imagePath }, imagePath, title: 'Soup' }),
    )
    const res = await app.request(`/v1/items/${ITEM_ID}`, { headers: AUTH_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { image: string } }
    expect(body.data.image).toMatch(/^https:\/\/storage\.test\/sign\//)
    expect(body.data.image).not.toBe(imagePath)
    expect(storage.signedExpiries).toHaveLength(1)
    expect(storage.signedExpiries[0]).toBeGreaterThan(0)
    expect(storage.signedExpiries[0]).toBeLessThanOrEqual(600)
  })

  it('signs nothing when the item has no image', async () => {
    const { app, collection, storage } = createTestApp()
    collection.items.set(ITEM_ID, item())
    await app.request(`/v1/items/${ITEM_ID}`, { headers: AUTH_HEADER })
    expect(storage.signedExpiries).toEqual([])
  })

  it('returns the 404 envelope when the repository returns null (missing or another tenant)', async () => {
    const { app } = createTestApp()
    const res = await app.request(`/v1/items/${MISSING_ID}`, { headers: AUTH_HEADER })
    expect(res.status).toBe(404)
    expect(await errorOf(res)).toMatchObject({ code: 'not_found', status: 404 })
  })

  it('returns 400 for an id that is not a UUID', async () => {
    const { app } = createTestApp()
    const res = await app.request('/v1/items/x', { headers: AUTH_HEADER })
    expect(res.status).toBe(400)
    expect((await errorOf(res)).code).toBe('validation_failed')
  })
})
