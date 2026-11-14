// Mock and recording providers (01.5-backend-foundation Requirements 7.3 and 7.4,
// capture-compile Requirement 16.2). Tests and demo mode replay recorded results
// keyed by a hash of the request, and fail loudly on a request with no recording.
// Node-only (the file store uses node:fs): import from `@cauldron/core/providers/mock`.
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  type ProviderEnv,
} from '../env'
import {
  fileRecordingStore,
  type Recording,
  type RecordingStore,
} from './recordings'
import { requestKey, sha256Hex, type RequestKind } from './request-key'
import {
  type CompletionRequest,
  type CompletionResult,
  type EmbeddingProvider,
  type EmbeddingResult,
  type LlmProvider,
  type Providers,
} from './types'

export {
  fileRecordingStore,
  memoryRecordingStore,
  type Recording,
  type RecordingStore,
} from './recordings'
export { canonicalize, requestKey, type RequestKind } from './request-key'

export const EXCERPT_LENGTH = 200

// Model slugs the mock reports when config names none. Recordings match on the
// request's model, so set LLM_COMPILE_MODEL / LLM_DRAFT_MODEL to the slugs the
// recordings were made with.
export const DEFAULT_MOCK_MODELS = {
  compile: 'mock/compile',
  draft: 'mock/draft',
} as const

/** Thrown by the mock when a request has no recording. Names enough to re-record it. */
export class MissingRecordingError extends Error {
  readonly key: string
  readonly kind: RequestKind
  readonly model: string
  readonly excerpt: string

  constructor(kind: RequestKind, key: string, model: string, excerpt: string) {
    super(
      `No recording for ${kind} request ${key} (model ${model}): ` +
        `${JSON.stringify(excerpt)}. Re-record with PROVIDERS=record.`,
    )
    this.name = 'MissingRecordingError'
    this.key = key
    this.kind = kind
    this.model = model
    this.excerpt = excerpt
  }
}

function excerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LENGTH)
}

// The prompt that varies per call is the last user message; system prompts
// repeat across requests and make poor excerpts.
function completionExcerpt(req: CompletionRequest): string {
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
  const source = lastUser ? [lastUser] : req.messages
  return excerpt(
    source
      .flatMap((m) => m.content)
      .map((part) => (part.type === 'text' ? part.text : `[${part.mediaType}]`))
      .join(' '),
  )
}

// What the recording file shows a reviewer: the request with image bytes
// replaced by their hash and size.
async function summarizeCompletion(req: CompletionRequest): Promise<unknown> {
  return {
    model: req.model,
    output: req.output,
    maxOutputTokens: req.maxOutputTokens,
    temperature: req.temperature,
    messages: await Promise.all(
      req.messages.map(async (m) => ({
        role: m.role,
        content: await Promise.all(
          m.content.map(async (part) =>
            part.type === 'text'
              ? part
              : {
                  type: 'image',
                  mediaType: part.mediaType,
                  sha256: await sha256Hex(part.data),
                  byteLength: part.data.byteLength,
                },
          ),
        ),
      })),
    ),
  }
}

interface EmbedRequest {
  model: string
  dimensions: number
  inputs: string[]
}

async function lookup<K extends Recording['kind']>(
  store: RecordingStore,
  kind: K,
  key: string,
): Promise<Extract<Recording, { kind: K }> | undefined> {
  const recording = await store.get(key)
  if (recording === undefined) return undefined
  if (recording.kind !== kind) {
    throw new Error(
      `Recording ${key} is a ${recording.kind} recording, expected ${kind}`,
    )
  }
  return recording as Extract<Recording, { kind: K }>
}

export interface MockProvidersOptions {
  models?: { compile: string; draft: string }
  embeddingModel?: string
  dimensions?: number
}

/**
 * Replays recordings from `store`. Recorded `usage` is returned unchanged, so
 * usage-recording code runs in tests too (Requirement 7.4).
 */
export function mockProviders(
  store: RecordingStore,
  options: MockProvidersOptions = {},
): Providers {
  const embeddingModel = options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
  const dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS

  const llm: LlmProvider = {
    async complete(req): Promise<CompletionResult> {
      const key = await requestKey('complete', req)
      const recording = await lookup(store, 'complete', key)
      if (!recording) {
        throw new MissingRecordingError(
          'complete',
          key,
          req.model,
          completionExcerpt(req),
        )
      }
      return recording.result
    },
  }

  const embeddings: EmbeddingProvider = {
    model: embeddingModel,
    dimensions,
    async embed(inputs): Promise<EmbeddingResult> {
      const request: EmbedRequest = { model: embeddingModel, dimensions, inputs }
      const key = await requestKey('embed', request)
      const recording = await lookup(store, 'embed', key)
      if (!recording) {
        throw new MissingRecordingError(
          'embed',
          key,
          embeddingModel,
          excerpt(inputs.join(' ')),
        )
      }
      return recording.result
    },
  }

  return {
    llm,
    embeddings,
    models: options.models ?? { ...DEFAULT_MOCK_MODELS },
  }
}

export interface RecordingProvidersOptions {
  // Defaults to process.env.NODE_ENV.
  nodeEnv?: string
}

/**
 * Calls `real` and writes each result to `store`, for refreshing fixtures by
 * hand (PROVIDERS=record). Refused when NODE_ENV=production, because it spends
 * real money and writes files on every call.
 */
export function recordingProviders(
  real: Providers,
  store: RecordingStore,
  options: RecordingProvidersOptions = {},
): Providers {
  const nodeEnv = options.nodeEnv ?? globalThis.process?.env?.NODE_ENV
  if (nodeEnv === 'production') {
    throw new Error('Recording providers are not allowed when NODE_ENV=production')
  }

  const llm: LlmProvider = {
    async complete(req) {
      const key = await requestKey('complete', req)
      const result = await real.llm.complete(req)
      await store.put(key, {
        kind: 'complete',
        request: await summarizeCompletion(req),
        result,
      })
      return result
    },
  }

  const { model, dimensions } = real.embeddings
  const embeddings: EmbeddingProvider = {
    model,
    dimensions,
    async embed(inputs, signal) {
      const request: EmbedRequest = { model, dimensions, inputs }
      const key = await requestKey('embed', request)
      const result = await real.embeddings.embed(inputs, signal)
      await store.put(key, { kind: 'embed', request, result })
      return result
    },
  }

  return { llm, embeddings, models: real.models }
}

// ---------------------------------------------------------------------------
// createProviders: picks the implementation from PROVIDERS.
//
// It lives here rather than in `./providers` because the mock and record modes
// need the Node-only file store, and `./providers` stays isomorphic.
//
// Seam for task 5.2 (OpenRouter): the real providers arrive through
// `options.openrouter`. Until 5.2 lands there is no default, so `openrouter`
// and `record` modes throw OpenRouterUnavailableError unless a factory is
// injected. When 5.2 lands, default `openrouter` to its factory, e.g.
// `const openrouter = options.openrouter ?? openRouterProviders`.

/** Builds the real providers from validated env (task 5.2). */
export type OpenRouterFactory = (env: ProviderEnv) => Providers

export interface CreateProvidersOptions {
  openrouter?: OpenRouterFactory
  // Overrides the file store at MOCK_RECORDINGS_DIR, e.g. an in-memory store in tests.
  store?: RecordingStore
  // Defaults to process.env.NODE_ENV; `record` is refused in production.
  nodeEnv?: string
}

export class OpenRouterUnavailableError extends Error {
  constructor() {
    super(
      'OpenRouter providers are not implemented yet (01.5-backend-foundation ' +
        'task 5.2). Use PROVIDERS=mock, or pass options.openrouter.',
    )
    this.name = 'OpenRouterUnavailableError'
  }
}

function requireSetting(name: string, value: string | undefined): string {
  // parseEnv with providerRules already enforces these; this guards callers
  // that build ProviderEnv by hand.
  if (value === undefined || value === '') {
    throw new Error(`${name} is required for this PROVIDERS mode`)
  }
  return value
}

/** Expects env already validated by `parseEnv` with `providerRules`. */
export function createProviders(
  env: ProviderEnv,
  options: CreateProvidersOptions = {},
): Providers {
  const store = () =>
    options.store ??
    fileRecordingStore(requireSetting('MOCK_RECORDINGS_DIR', env.MOCK_RECORDINGS_DIR))
  const real = () => {
    if (!options.openrouter) throw new OpenRouterUnavailableError()
    return options.openrouter(env)
  }

  switch (env.PROVIDERS) {
    case 'mock':
      return mockProviders(store(), {
        models: {
          compile: env.LLM_COMPILE_MODEL ?? DEFAULT_MOCK_MODELS.compile,
          draft: env.LLM_DRAFT_MODEL ?? DEFAULT_MOCK_MODELS.draft,
        },
        embeddingModel: env.EMBEDDING_MODEL,
        dimensions: env.EMBEDDING_DIMENSIONS,
      })
    case 'record': {
      // Check production before building the real providers, so a misconfigured
      // production deploy fails on the mode, not on a missing factory.
      const nodeEnv = options.nodeEnv ?? globalThis.process?.env?.NODE_ENV
      if (nodeEnv === 'production') {
        throw new Error('PROVIDERS=record is not allowed when NODE_ENV=production')
      }
      return recordingProviders(real(), store(), { nodeEnv })
    }
    case 'openrouter':
      return real()
  }
}
