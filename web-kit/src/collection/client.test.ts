import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, createCollectionClient } from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('collection client errors (Requirement 7.5)', () => {
  it('uses the error envelope message and code', async () => {
    const apiFetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'bad_request', message: 'Unknown goal.' } }, 400),
    )
    const client = createCollectionClient(apiFetch)

    const error = await client.getGoal('nope').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ message: 'Unknown goal.', code: 'bad_request', status: 400 })
  })

  it('falls back to a status message when the body is not JSON', async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))
    const client = createCollectionClient(apiFetch)

    const error = await client.listItems({ goal: 'recipe-box' }).catch((e: unknown) => e)

    expect(error).toMatchObject({ message: 'Request failed (502).', code: null, status: 502 })
  })

  it('falls back when the JSON body has no envelope message', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'x' } }, 500))
    const client = createCollectionClient(apiFetch)

    const error = await client.getItem('abc').catch((e: unknown) => e)

    expect(error).toMatchObject({ message: 'Request failed (500).', code: null, status: 500 })
  })
})

describe('collection client requests', () => {
  it('sends capture as multipart FormData with goal, client, text and image', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ sourceId: 's1', state: 'queued' }, 202))
    const client = createCollectionClient(apiFetch)
    const image = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'pie.jpg', { type: 'image/jpeg' })

    const result = await client.capture({ goal: 'recipe-box', image })

    expect(result).toEqual({ sourceId: 's1', state: 'queued' })
    const [path, init] = apiFetch.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/v1/captures')
    expect(init.method).toBe('POST')
    // No explicit Content-Type: the browser adds the multipart boundary.
    expect(init.headers).toBeUndefined()
    const body = init.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('goal')).toBe('recipe-box')
    expect(body.get('client')).toBe('web')
    expect((body.get('image') as File).name).toBe('pie.jpg')
    expect(body.has('text')).toBe(false)
  })

  it('sends text captures without an image part', async () => {
    const apiFetch = vi.fn().mockResolvedValue(jsonResponse({ sourceId: 's2', state: 'queued' }, 202))
    const client = createCollectionClient(apiFetch)

    await client.capture({ goal: 'recipe-box', text: 'Soup\n- water' })

    const body = (apiFetch.mock.calls[0] as [string, RequestInit])[1].body as FormData
    expect(body.get('text')).toBe('Soup\n- water')
    expect(body.has('image')).toBe(false)
  })

  it('lists items with goal and optional q, returning the items array', async () => {
    const entries = [
      { id: null, sourceId: 's1', title: 'Soup', state: 'queued', failureReason: null, capturedAt: 'now' },
    ]
    const apiFetch = vi.fn().mockImplementation(async () => jsonResponse({ items: entries }))
    const client = createCollectionClient(apiFetch)

    expect(await client.listItems({ goal: 'recipe-box', q: 'so up' })).toEqual(entries)
    expect(apiFetch).toHaveBeenCalledWith('/v1/items?goal=recipe-box&q=so+up')

    await client.listItems({ goal: 'recipe-box', q: '' })
    expect(apiFetch).toHaveBeenLastCalledWith('/v1/items?goal=recipe-box')
  })
})
