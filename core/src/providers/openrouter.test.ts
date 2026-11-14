// Unit tests for the OpenRouter providers with a mocked fetch
// (01.5-backend-foundation task 5.5, Requirements 7.2 and 7.4).
import { describe, expect, it } from 'vitest'
import { MAX_RETRIES, openRouterEmbeddings, openRouterLlm } from './openrouter'
import { ProviderError, type CompletionRequest } from './types'

const KEY = 'sk-or-secret-key-123'

interface Call {
  url: string
  init: RequestInit
  // Tests read arbitrary request-body fields; the shape is the provider's wire format.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

function mockFetch(handler: (url: string, call: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {}, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return handler(url, calls.length - 1)
  }) as typeof fetch
  return { fn, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const common = (fn: typeof fetch) => ({
  apiKey: KEY,
  fetch: fn,
  sleep: async () => undefined,
  random: () => 0,
})

const request = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  model: 'test/model',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
      ],
    },
  ],
  output: { name: 'thing', jsonSchema: { type: 'object' } },
  ...over,
})

const completion = (usage: unknown, model = 'test/model') =>
  json({ model, choices: [{ message: { content: '{"a":1}' } }], usage })

describe('openRouterLlm', () => {
  it('sends structured output and image parts with auth', async () => {
    const { fn, calls } = mockFetch(() => completion({ prompt_tokens: 3, completion_tokens: 2, cost: 0.01 }))
    const res = await openRouterLlm(common(fn)).complete(request({ maxOutputTokens: 50, temperature: 0.2 }))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    const b = calls[0]!.body
    expect(b.model).toBe('test/model')
    expect(b.max_tokens).toBe(50)
    expect(b.temperature).toBe(0.2)
    expect(b.usage).toEqual({ include: true })
    expect(b.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'thing', strict: true, schema: { type: 'object' } },
    })
    expect(b.messages[0].content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ])
    expect(res).toEqual({
      output: { a: 1 },
      model: 'test/model',
      usage: { inputTokens: 3, outputTokens: 2, costUsd: 0.01 },
    })
  })

  it('computes cost from /models pricing when usage has no cost', async () => {
    const { fn, calls } = mockFetch((url) =>
      url.endsWith('/models')
        ? json({ data: [{ id: 'test/model', pricing: { prompt: '0.001', completion: '0.002' } }] })
        : completion({ prompt_tokens: 10, completion_tokens: 5 }),
    )
    const res = await openRouterLlm(common(fn)).complete(request())
    expect(res.usage.costUsd).toBeCloseTo(10 * 0.001 + 5 * 0.002)
    expect(calls.map((c) => c.url.split('/api/v1')[1])).toEqual(['/chat/completions', '/models'])
  })

  it('reports zero cost when pricing is unavailable', async () => {
    const { fn } = mockFetch((url) =>
      url.endsWith('/models') ? json({}, 404) : completion({ prompt_tokens: 10, completion_tokens: 5 }),
    )
    const res = await openRouterLlm(common(fn)).complete(request())
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: 0 })
  })

  it('retries 429 then succeeds', async () => {
    const { fn, calls } = mockFetch((_u, n) => (n === 0 ? json({}, 429) : completion({ cost: 0 })))
    const res = await openRouterLlm(common(fn)).complete(request())
    expect(calls).toHaveLength(2)
    expect(res.output).toEqual({ a: 1 })
  })

  it('throws ProviderError after retries on 429 without leaking the key', async () => {
    const { fn, calls } = mockFetch(() => new Response(`rate limited for ${KEY}`, { status: 429 }))
    const err = await openRouterLlm(common(fn))
      .complete(request())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    const pe = err as ProviderError
    expect(pe.status).toBe(429)
    expect(calls).toHaveLength(MAX_RETRIES + 1)
    expect(pe.message).not.toContain(KEY)
    expect(pe.body).toContain('[redacted]')
    expect(pe.body).not.toContain(KEY)
  })

  it('does not include the key in network-failure errors', async () => {
    const { fn } = mockFetch(() => {
      throw new Error(`boom ${KEY}`)
    })
    const err = (await openRouterLlm(common(fn))
      .complete(request())
      .catch((e: unknown) => e)) as ProviderError
    expect(err).toBeInstanceOf(ProviderError)
    expect(`${err.message} ${err.body ?? ''} ${String(err.cause ?? '')}`).not.toContain(KEY)
  })
})

describe('openRouterEmbeddings', () => {
  const opts = (fn: typeof fetch) => ({ ...common(fn), model: 'emb/model', dimensions: 3 })

  it('sends dimensions and parses vectors and usage', async () => {
    const { fn, calls } = mockFetch(() =>
      json({
        model: 'emb/model',
        data: [
          { index: 1, embedding: [4, 5, 6] },
          { index: 0, embedding: [1, 2, 3] },
        ],
        usage: { prompt_tokens: 7, cost: 0.0004 },
      }),
    )
    const res = await openRouterEmbeddings(opts(fn)).embed(['a', 'b'])
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(calls[0]!.body).toEqual({
      model: 'emb/model',
      input: ['a', 'b'],
      dimensions: 3,
      encoding_format: 'float',
    })
    expect(res.vectors).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
    expect(res.dimensions).toBe(3)
    expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 0, costUsd: 0.0004 })
  })

  it('rejects vectors of the wrong length', async () => {
    const { fn } = mockFetch(() =>
      json({ data: [{ index: 0, embedding: [1, 2] }], usage: { prompt_tokens: 1, cost: 0 } }),
    )
    await expect(openRouterEmbeddings(opts(fn)).embed(['a'])).rejects.toThrow(ProviderError)
    await expect(openRouterEmbeddings(opts(fn)).embed(['a'])).rejects.toThrow(/2 dimensions, expected 3/)
  })

  it('rejects a response with the wrong number of embeddings', async () => {
    const { fn } = mockFetch(() => json({ data: [{ index: 0, embedding: [1, 2, 3] }] }))
    await expect(openRouterEmbeddings(opts(fn)).embed(['a', 'b'])).rejects.toThrow(ProviderError)
  })
})
