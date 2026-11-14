// OpenRouter implementation of the provider interfaces (01.5-backend-foundation
// task 5.2, Requirements 7.2 and 7.4). Plain `fetch`, no SDK. Isomorphic code
// (no Node-only imports), though it only runs server-side because it holds the key.
import type { ProviderEnv } from '../env'
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type ContentPart,
  type EmbeddingProvider,
  type EmbeddingResult,
  type LlmProvider,
  type Providers,
  type Usage,
} from './types'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const COMPLETION_TIMEOUT_MS = 60_000
export const EMBEDDING_TIMEOUT_MS = 15_000
export const EMBEDDING_BATCH_SIZE = 100
export const PRICING_TTL_MS = 60 * 60 * 1000
export const MAX_RETRIES = 2

export interface OpenRouterOptions {
  apiKey: string
  baseUrl?: string
  fetch?: typeof fetch
  now?: () => number
  // Resolves after `ms`; injectable so tests don't wait on backoff.
  sleep?: (ms: number) => Promise<void>
  // Returns [0, 1); injectable for deterministic jitter.
  random?: () => number
  completionTimeoutMs?: number
  embeddingTimeoutMs?: number
}

interface ModelPricing {
  prompt: number
  completion: number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function toApiPart(part: ContentPart) {
  if (part.type === 'text') return { type: 'text', text: part.text }
  return {
    type: 'image_url',
    image_url: { url: `data:${part.mediaType};base64,${toBase64(part.data)}` },
  }
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** Shared HTTP layer: auth, timeouts, retries, error scrubbing, pricing cache. */
class OpenRouterClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private pricing: { fetchedAt: number; byModel: Map<string, ModelPricing> } | undefined

  constructor(options: OpenRouterOptions) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, '')
    this.fetchFn = options.fetch ?? ((...args) => fetch(...args))
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.random = options.random ?? Math.random
  }

  /** Removes the API key from any text that could reach an error or a log. */
  private scrub(text: string): string {
    return this.apiKey ? text.split(this.apiKey).join('[redacted]') : text
  }

  private async send(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted()
      const timeout = AbortSignal.timeout(timeoutMs)
      const combined = signal ? AbortSignal.any([timeout, signal]) : timeout
      let res: Response
      try {
        res = await this.fetchFn(url, {
          method: init.method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: combined,
        })
      } catch (err) {
        // The caller's own abort propagates unchanged.
        if (signal?.aborted) throw signal.reason ?? err
        if (timeout.aborted) {
          throw new ProviderError(`OpenRouter request to ${path} timed out after ${timeoutMs} ms`)
        }
        // Deliberately no `cause`: keep request details out of error chains.
        throw new ProviderError(
          `OpenRouter request to ${path} failed: ${err instanceof Error ? this.scrub(err.name) : 'unknown error'}`,
        )
      }

      if (res.ok) {
        try {
          return await res.json()
        } catch {
          throw new ProviderError(`OpenRouter returned invalid JSON for ${path}`, {
            status: res.status,
          })
        }
      }

      const retryable = res.status === 429 || res.status >= 500
      if (retryable && attempt < MAX_RETRIES) {
        await res.body?.cancel().catch(() => undefined)
        const backoff = 500 * 2 ** attempt
        await this.sleep(backoff / 2 + this.random() * (backoff / 2))
        continue
      }
      const body = this.scrub(await res.text().catch(() => ''))
      throw new ProviderError(`OpenRouter request to ${path} failed with status ${res.status}`, {
        status: res.status,
        body,
      })
    }
  }

  post(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal) {
    return this.send(path, { method: 'POST', body }, timeoutMs, signal)
  }

  /** Price per token from `/models`, cached for an hour. Undefined if unknown. */
  async priceFor(model: string, signal?: AbortSignal): Promise<ModelPricing | undefined> {
    const cached = this.pricing
    if (!cached || this.now() - cached.fetchedAt >= PRICING_TTL_MS) {
      try {
        const json = (await this.send('/models', { method: 'GET' }, EMBEDDING_TIMEOUT_MS, signal)) as {
          data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>
        }
        const byModel = new Map<string, ModelPricing>()
        for (const m of json.data ?? []) {
          if (!m.id || !m.pricing) continue
          const prompt = Number(m.pricing.prompt)
          const completion = Number(m.pricing.completion)
          if (Number.isFinite(prompt) && Number.isFinite(completion)) {
            byModel.set(m.id, { prompt, completion })
          }
        }
        this.pricing = { fetchedAt: this.now(), byModel }
      } catch (err) {
        if (signal?.aborted) throw err
        // Pricing is a fallback; a failure must not fail an already-paid call.
        return undefined
      }
    }
    return this.pricing?.byModel.get(model)
  }

  /** Cost from the response's usage; else computed from tokens and `/models` pricing. */
  async usageFrom(
    raw: unknown,
    model: string,
    signal?: AbortSignal,
  ): Promise<Usage> {
    const u = (raw ?? {}) as Record<string, unknown>
    const inputTokens = num(u.prompt_tokens) ?? 0
    const outputTokens = num(u.completion_tokens) ?? 0
    let costUsd = num(u.cost)
    if (costUsd === undefined) {
      const price = await this.priceFor(model, signal)
      costUsd = price ? inputTokens * price.prompt + outputTokens * price.completion : 0
    }
    return { inputTokens, outputTokens, costUsd }
  }
}

export function openRouterLlm(options: OpenRouterOptions): LlmProvider {
  const client = new OpenRouterClient(options)
  const timeoutMs = options.completionTimeoutMs ?? COMPLETION_TIMEOUT_MS
  return {
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content.map(toApiPart) })),
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.output.name, strict: true, schema: req.output.jsonSchema },
        },
        usage: { include: true },
      }
      if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens
      if (req.temperature !== undefined) body.temperature = req.temperature

      const json = (await client.post('/chat/completions', body, timeoutMs, req.signal)) as {
        model?: string
        choices?: Array<{ message?: { content?: unknown } }>
        usage?: unknown
      }
      const content = json.choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        throw new ProviderError('OpenRouter completion had no message content')
      }
      let output: unknown
      try {
        output = JSON.parse(content)
      } catch {
        throw new ProviderError('OpenRouter completion content was not valid JSON')
      }
      const model = json.model ?? req.model
      return { output, model, usage: await client.usageFrom(json.usage, model, req.signal) }
    },
  }
}

export function openRouterEmbeddings(
  options: OpenRouterOptions & { model: string; dimensions: number },
): EmbeddingProvider {
  const client = new OpenRouterClient(options)
  const timeoutMs = options.embeddingTimeoutMs ?? EMBEDDING_TIMEOUT_MS
  const { model, dimensions } = options
  return {
    model,
    dimensions,
    async embed(inputs: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
      const vectors: number[][] = []
      const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
      let servedModel = model
      for (let i = 0; i < inputs.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = inputs.slice(i, i + EMBEDDING_BATCH_SIZE)
        const json = (await client.post(
          '/embeddings',
          { model, input: batch, dimensions, encoding_format: 'float' },
          timeoutMs,
          signal,
        )) as {
          model?: string
          data?: Array<{ index?: number; embedding?: unknown }>
          usage?: Record<string, unknown>
        }
        const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        if (data.length !== batch.length) {
          throw new ProviderError(
            `OpenRouter returned ${data.length} embeddings for ${batch.length} inputs`,
          )
        }
        for (const d of data) {
          const v = d.embedding
          if (!Array.isArray(v) || v.length !== dimensions) {
            throw new ProviderError(
              `Embedding has ${Array.isArray(v) ? v.length : 'no'} dimensions, expected ${dimensions}`,
            )
          }
          vectors.push(v as number[])
        }
        servedModel = json.model ?? servedModel
        // Embedding responses report prompt_tokens/total_tokens; there is no output side.
        const u = await client.usageFrom(
          { prompt_tokens: json.usage?.prompt_tokens ?? json.usage?.total_tokens, cost: json.usage?.cost },
          model,
          signal,
        )
        usage.inputTokens += u.inputTokens
        usage.costUsd += u.costUsd
      }
      return { vectors, model: servedModel, dimensions, usage }
    },
  }
}

/** Builds the real providers from validated env. */
export function openRouterProviders(
  env: ProviderEnv,
  overrides: Partial<OpenRouterOptions> = {},
): Providers {
  const apiKey = env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for this PROVIDERS mode')
  if (!env.LLM_COMPILE_MODEL || !env.LLM_DRAFT_MODEL) {
    throw new Error('LLM_COMPILE_MODEL and LLM_DRAFT_MODEL are required for this PROVIDERS mode')
  }
  const base = { ...overrides, apiKey }
  return {
    llm: openRouterLlm(base),
    embeddings: openRouterEmbeddings({
      ...base,
      model: env.EMBEDDING_MODEL,
      dimensions: env.EMBEDDING_DIMENSIONS,
    }),
    models: { compile: env.LLM_COMPILE_MODEL, draft: env.LLM_DRAFT_MODEL },
  }
}
