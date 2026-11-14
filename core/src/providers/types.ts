// LLM and embedding provider contracts (01.5-backend-foundation, Requirements 7.1
// and 7.4). Every model call goes through these interfaces so tests and demo mode
// can swap in the mock. Isomorphic: no Node-only imports, so the root export can
// carry these types into a browser bundle.

export type ContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
      data: Uint8Array
    }

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: ContentPart[]
}

// Every call reports its cost so usage can be recorded per tenant (Requirement 7.4).
export interface Usage {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface CompletionRequest {
  model: string
  messages: Message[]
  // Structured output: the provider asks the model for JSON matching this schema.
  output: { name: string; jsonSchema: Record<string, unknown> }
  maxOutputTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface CompletionResult {
  // Parsed JSON, not validated. Callers validate it against their own schema
  // (capture-compile owns validation and repair).
  output: unknown
  // The model that actually served the request.
  model: string
  usage: Usage
}

export interface LlmProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>
}

export interface EmbeddingResult {
  vectors: number[][]
  model: string
  dimensions: number
  usage: Usage
}

export interface EmbeddingProvider {
  readonly model: string
  readonly dimensions: number
  embed(inputs: string[], signal?: AbortSignal): Promise<EmbeddingResult>
}

export interface Providers {
  llm: LlmProvider
  embeddings: EmbeddingProvider
  // Model slugs from config (Requirement 7.2).
  models: { compile: string; draft: string }
}

export interface ProviderErrorOptions {
  // HTTP status from the upstream provider, when there was a response.
  status?: number
  // Upstream response body; truncated so error logs stay small.
  body?: string
  cause?: unknown
}

export const PROVIDER_ERROR_BODY_LIMIT = 500

// Thrown for upstream failures that survive the provider's own retries.
// Implementations must never put credentials in `message` or `body`.
export class ProviderError extends Error {
  readonly status: number | undefined
  readonly body: string | undefined

  constructor(message: string, options: ProviderErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'ProviderError'
    this.status = options.status
    this.body =
      options.body === undefined
        ? undefined
        : options.body.slice(0, PROVIDER_ERROR_BODY_LIMIT)
  }
}
