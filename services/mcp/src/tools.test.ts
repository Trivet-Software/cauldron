import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { CAPTURE_LIMITS } from '@cauldron/core/compile'
import { EnvError } from '@cauldron/core/env'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseMcpEnv } from './env'
import { createServer, EXAMPLE_GOAL_URI } from './server'

// Tool tests for 01.7-walking-skeleton task 9.4 (Requirements 9.2, 9.3, 9.5 to 9.8, 10.3).
// The server runs in-process against a fake `fetch` that answers with the response shapes
// from the design ("API routes").

const TOKEN = 'dev-token-0123456789abcdef0123456789abcdef'
const BASE_URL = 'http://api.test'

const SOURCE_ID = '3f0c1a52-6d1e-4c0a-9a53-0b6f3c9d7e11'
const ITEM_ID = '8a1f5c7e-2b34-4d56-8e78-9a0b1c2d3e4f'

const recipeBoxSpec = {
  name: 'Recipe Box',
  description: 'Save recipes from text or a photo and find them later.',
  icon: 'chef-hat',
  accentColor: '#c2410c',
  schema: {
    type: 'object',
    titleField: 'title',
    required: ['title'],
    properties: {
      title: { type: 'string', title: 'Title' },
      ingredients: { type: 'array', items: { type: 'string' }, title: 'Ingredients' },
    },
  },
}

const goals = [
  {
    slug: 'recipe-box',
    name: 'Recipe Box',
    description: 'Save recipes from text or a photo and find them later.',
    icon: 'chef-hat',
    accentColor: '#c2410c',
    version: 1,
    fields: [
      { key: 'title', label: 'Title', kind: 'text', required: true, isTitle: true },
      { key: 'ingredients', label: 'Ingredients', kind: 'list', required: false, isTitle: false },
    ],
  },
  {
    slug: 'research-library',
    name: 'Research Library',
    description: null,
    icon: null,
    accentColor: null,
    version: 1,
    fields: [{ key: 'title', label: 'Title', kind: 'text', required: true, isTitle: true }],
  },
]

const entry = {
  id: ITEM_ID,
  sourceId: SOURCE_ID,
  title: 'Pancakes',
  state: 'ready',
  failureReason: null,
  capturedAt: '2026-11-14T10:00:00.000Z',
}

const itemDetail = {
  id: ITEM_ID,
  sourceId: SOURCE_ID,
  goal: { slug: 'recipe-box', name: 'Recipe Box', version: 1 },
  title: 'Pancakes',
  state: 'ready',
  data: { title: 'Pancakes', ingredients: ['flour', 'milk', 'eggs'] },
  capturedAt: '2026-11-14T10:00:00.000Z',
}

interface RecordedCall {
  url: URL
  method: string
  headers: Headers
  body: RequestInit['body']
}

type Responder = (call: RecordedCall) => Response | Promise<Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Default routes cover the happy path; a test passes `override` to change one of them.
function fakeApi(override?: Responder) {
  const calls: RecordedCall[] = []
  const fakeFetch: typeof fetch = async (input, init) => {
    const call: RecordedCall = {
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    }
    calls.push(call)
    if (override) return override(call)
    return defaultRoutes(call)
  }
  return { fetch: fakeFetch, calls }
}

function defaultRoutes(call: RecordedCall): Response {
  const { pathname } = call.url
  if (call.method === 'GET' && pathname === '/v1/goals') return json({ goals })
  if (call.method === 'GET' && pathname === '/v1/goals/recipe-box') {
    return json({ ...goals[0], spec: recipeBoxSpec })
  }
  if (call.method === 'POST' && pathname === '/v1/captures') {
    return json({ sourceId: SOURCE_ID, state: 'queued' }, 202)
  }
  if (call.method === 'GET' && pathname === '/v1/items') return json({ items: [entry] })
  if (call.method === 'GET' && pathname === `/v1/items/${ITEM_ID}`) return json(itemDetail)
  return json({ error: { code: 'not_found', message: 'No such route.' } }, 404)
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? []).map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('\n')
}

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])

describe('mcp tools against a fake API', () => {
  const closers: Array<() => Promise<void>> = []
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'mcp-tools-'))
  })

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()))
    await rm(tempDir, { recursive: true, force: true })
  })

  async function connect(api: ReturnType<typeof fakeApi>) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createServer({ baseUrl: BASE_URL, token: TOKEN, fetch: api.fetch })
    const client = new Client({ name: 'test', version: '0.0.0' })
    closers.push(
      () => client.close(),
      () => server.close(),
    )
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    return client
  }

  describe('listing', () => {
    it('lists the four tools and the example goal resource, and reads the goal file', async () => {
      const client = await connect(fakeApi())

      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual(['capture', 'get_item', 'list_goals', 'search'])

      const { resources } = await client.listResources()
      expect(resources.map((resource) => resource.uri)).toEqual([EXAMPLE_GOAL_URI])

      const { contents } = await client.readResource({ uri: EXAMPLE_GOAL_URI })
      const first = contents[0]
      expect(first && 'text' in first ? JSON.parse(first.text) : undefined).toEqual(recipeBoxSpec)
    })

    it('list_goals returns the goals as structured content and text', async () => {
      const api = fakeApi()
      const client = await connect(api)

      const result = await client.callTool({ name: 'list_goals', arguments: {} })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ goals })
      expect(textOf(result as never)).toContain('recipe-box: Recipe Box.')
      expect(api.calls[0]?.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    })
  })

  describe('capture', () => {
    it('sends text with client=mcp and the resolved slug, and returns the ID and state', async () => {
      const api = fakeApi()
      const client = await connect(api)

      const result = await client.callTool({
        name: 'capture',
        arguments: { goal: 'Recipe Box', text: 'Pancakes\n- flour\n- milk' },
      })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ sourceId: SOURCE_ID, state: 'queued' })
      expect(textOf(result as never)).toContain(SOURCE_ID)
      expect(textOf(result as never)).toContain('queued')

      const post = api.calls.find((call) => call.method === 'POST')
      expect(post?.url.pathname).toBe('/v1/captures')
      expect(post?.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
      const form = post?.body as FormData
      expect(form.get('client')).toBe('mcp')
      expect(form.get('goal')).toBe('recipe-box')
      expect(form.get('text')).toBe('Pancakes\n- flour\n- milk')
      expect(form.get('image')).toBeNull()
    })

    it('sends an image file with client=mcp and returns the ID and state', async () => {
      const api = fakeApi()
      const client = await connect(api)
      const file = path.join(tempDir, 'soup.png')
      await writeFile(file, PNG_BYTES)

      const result = await client.callTool({
        name: 'capture',
        arguments: { goal: 'recipe-box', imagePath: file },
      })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ sourceId: SOURCE_ID, state: 'queued' })

      const form = api.calls.find((call) => call.method === 'POST')?.body as FormData
      expect(form.get('client')).toBe('mcp')
      expect(form.get('goal')).toBe('recipe-box')
      expect(form.get('text')).toBeNull()
      const image = form.get('image') as File
      expect(image.name).toBe('soup.png')
      expect(image.type).toBe('image/png')
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG_BYTES)
    })

    it('returns an error and sends nothing for a missing file', async () => {
      const api = fakeApi()
      const client = await connect(api)

      const result = await client.callTool({
        name: 'capture',
        arguments: { goal: 'recipe-box', imagePath: path.join(tempDir, 'missing.png') },
      })

      expect(result.isError).toBe(true)
      expect(textOf(result as never)).toContain('invalid_image')
      expect(api.calls).toHaveLength(0)
    })

    it('returns an error and sends nothing for a directory or a file that is not an image', async () => {
      const api = fakeApi()
      const client = await connect(api)
      const notImage = path.join(tempDir, 'notes.png')
      await writeFile(notImage, 'this is plain text, whatever the extension says')

      for (const imagePath of [tempDir, notImage]) {
        const result = await client.callTool({ name: 'capture', arguments: { goal: 'recipe-box', imagePath } })
        expect(result.isError).toBe(true)
        expect(textOf(result as never)).toContain('invalid_image')
      }
      expect(api.calls).toHaveLength(0)
    })

    it('returns an error and sends nothing for an image over the size limit', async () => {
      const api = fakeApi()
      const client = await connect(api)
      // A sparse file: one byte past the limit without writing 10 MB to disk.
      const big = path.join(tempDir, 'big.jpg')
      await writeFile(big, JPEG_BYTES)
      await truncate(big, CAPTURE_LIMITS.maxImageBytes + 1)

      const result = await client.callTool({ name: 'capture', arguments: { goal: 'recipe-box', imagePath: big } })

      expect(result.isError).toBe(true)
      expect(textOf(result as never)).toContain('10 MB')
      expect(api.calls).toHaveLength(0)
    })
  })

  describe('search and get_item', () => {
    it('search returns structured content and a text summary', async () => {
      const api = fakeApi()
      const client = await connect(api)

      const result = await client.callTool({
        name: 'search',
        arguments: { goal: 'recipe-box', query: 'pancake' },
      })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual({ items: [entry] })
      expect(textOf(result as never)).toContain('Found 1 item in Recipe Box.')
      expect(textOf(result as never)).toContain(`Pancakes [ready] (id: ${ITEM_ID})`)

      const get = api.calls.find((call) => call.url.pathname === '/v1/items')
      expect(get?.url.searchParams.get('goal')).toBe('recipe-box')
      expect(get?.url.searchParams.get('q')).toBe('pancake')
    })

    it('get_item returns structured content and a text summary', async () => {
      const client = await connect(fakeApi())

      const result = await client.callTool({ name: 'get_item', arguments: { id: ITEM_ID } })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toEqual(itemDetail)
      expect(textOf(result as never)).toContain('Pancakes (Recipe Box')
      expect(textOf(result as never)).toContain('ingredients: flour, milk, eggs')
    })
  })

  describe('API failures', () => {
    it('turns a 404 envelope into a tool error with its code and message, without the token', async () => {
      const api = fakeApi((call) =>
        call.url.pathname.startsWith('/v1/items/')
          ? json({ error: { code: 'not_found', message: 'Item not found.' } }, 404)
          : defaultRoutes(call),
      )
      const client = await connect(api)

      const result = await client.callTool({ name: 'get_item', arguments: { id: ITEM_ID } })

      expect(result.isError).toBe(true)
      const text = textOf(result as never)
      expect(text).toContain('not_found')
      expect(text).toContain('Item not found.')
      expect(text).not.toContain(TOKEN)
    })

    it('turns a network error into a tool error without the token', async () => {
      // The thrown error carries the token, as a careless fetch error could.
      const api = fakeApi(() => {
        throw new TypeError(`fetch failed: Authorization: Bearer ${TOKEN}`)
      })
      const client = await connect(api)

      const result = await client.callTool({ name: 'list_goals', arguments: {} })

      expect(result.isError).toBe(true)
      const text = textOf(result as never)
      expect(text).toContain('unreachable')
      expect(text).not.toContain(TOKEN)
    })

    it('lists the available goals when the goal does not match', async () => {
      const client = await connect(fakeApi())

      const result = await client.callTool({ name: 'search', arguments: { goal: 'nope', query: '' } })

      expect(result.isError).toBe(true)
      expect(textOf(result as never)).toContain('recipe-box')
      expect(textOf(result as never)).toContain('research-library')
    })
  })

  describe('environment', () => {
    it('names both variables when they are missing', () => {
      let error: unknown
      try {
        parseMcpEnv({})
      } catch (err) {
        error = err
      }
      expect(error).toBeInstanceOf(EnvError)
      expect((error as EnvError).message).toContain('API_BASE_URL')
      expect((error as EnvError).message).toContain('DEV_API_TOKEN')
    })

    it('accepts both variables when set', () => {
      expect(parseMcpEnv({ API_BASE_URL: BASE_URL, DEV_API_TOKEN: TOKEN })).toEqual({
        API_BASE_URL: BASE_URL,
        DEV_API_TOKEN: TOKEN,
      })
    })
  })
})
