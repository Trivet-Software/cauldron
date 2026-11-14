// Unit tests for the mock and recording providers and createProviders
// (01.5-backend-foundation task 5.4, Requirements 7.1, 7.3 and 7.4).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  parseEnv,
  providerEnvSchema,
} from '../env'
import {
  DEFAULT_MOCK_MODELS,
  MissingRecordingError,
  OpenRouterUnavailableError,
  createProviders,
  fileRecordingStore,
  memoryRecordingStore,
  mockProviders,
  recordingProviders,
  requestKey,
  type Recording,
} from './mock'
import {
  type CompletionRequest,
  type CompletionResult,
  type EmbeddingResult,
  type Providers,
} from './types'

const usage = { inputTokens: 12, outputTokens: 34, costUsd: 0.0005 }

const completion: CompletionResult = {
  output: { title: 'Pancakes' },
  model: 'mock/compile',
  usage,
}

const embedding: EmbeddingResult = {
  vectors: [[0.1, 0.2]],
  model: DEFAULT_EMBEDDING_MODEL,
  dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  usage,
}

function completionRequest(text = 'Extract the recipe'): CompletionRequest {
  return {
    model: 'mock/compile',
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'You are a parser.' }] },
      { role: 'user', content: [{ type: 'text', text }] },
    ],
    output: { name: 'recipe', jsonSchema: { type: 'object' } },
  }
}

function embedKey(inputs: string[]): Promise<string> {
  return requestKey('embed', {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    inputs,
  })
}

function fakeReal(): Providers {
  return {
    llm: { complete: vi.fn(async () => completion) },
    embeddings: {
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      embed: vi.fn(async () => embedding),
    },
    models: { compile: 'real/compile', draft: 'real/draft' },
  }
}

describe('mockProviders', () => {
  it('returns the recorded completion with its usage', async () => {
    const req = completionRequest()
    const key = await requestKey('complete', req)
    const store = memoryRecordingStore({
      [key]: { kind: 'complete', request: {}, result: completion },
    })
    const result = await mockProviders(store).llm.complete(req)
    expect(result).toEqual(completion)
    expect(result.usage).toEqual(usage)
  })

  it('matches a recording regardless of the abort signal', async () => {
    const req = completionRequest()
    const key = await requestKey('complete', req)
    const store = memoryRecordingStore({
      [key]: { kind: 'complete', request: {}, result: completion },
    })
    const result = await mockProviders(store).llm.complete({
      ...req,
      signal: new AbortController().signal,
    })
    expect(result).toEqual(completion)
  })

  it('throws MissingRecordingError naming key, model and an excerpt of the last user message', async () => {
    const req = completionRequest('  Extract\n\nthe   recipe  ')
    const key = await requestKey('complete', req)
    const error = await mockProviders(memoryRecordingStore())
      .llm.complete(req)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MissingRecordingError)
    const missing = error as MissingRecordingError
    expect(missing.kind).toBe('complete')
    expect(missing.key).toBe(key)
    expect(missing.model).toBe('mock/compile')
    expect(missing.excerpt).toBe('Extract the recipe')
    expect(missing.message).toContain(key)
    expect(missing.message).toContain('PROVIDERS=record')
  })

  it('truncates the excerpt to 200 characters', async () => {
    const error = (await mockProviders(memoryRecordingStore())
      .llm.complete(completionRequest('x'.repeat(500)))
      .catch((e: unknown) => e)) as MissingRecordingError
    expect(error.excerpt).toHaveLength(200)
  })

  it('rejects a recording of the wrong kind', async () => {
    const req = completionRequest()
    const key = await requestKey('complete', req)
    const store = memoryRecordingStore({
      [key]: { kind: 'embed', request: {}, result: embedding },
    })
    await expect(mockProviders(store).llm.complete(req)).rejects.toThrow(
      /embed recording, expected complete/,
    )
  })

  it('returns recorded embeddings and throws on a miss', async () => {
    const key = await embedKey(['flour'])
    const store = memoryRecordingStore({
      [key]: { kind: 'embed', request: {}, result: embedding },
    })
    const { embeddings } = mockProviders(store)
    expect(embeddings.model).toBe(DEFAULT_EMBEDDING_MODEL)
    expect(embeddings.dimensions).toBe(DEFAULT_EMBEDDING_DIMENSIONS)
    expect(await embeddings.embed(['flour'])).toEqual(embedding)

    const error = (await embeddings
      .embed(['sugar'])
      .catch((e: unknown) => e)) as MissingRecordingError
    expect(error).toBeInstanceOf(MissingRecordingError)
    expect(error.kind).toBe('embed')
    expect(error.key).toBe(await embedKey(['sugar']))
    expect(error.model).toBe(DEFAULT_EMBEDDING_MODEL)
    expect(error.excerpt).toBe('sugar')
  })

  it('reports the default mock models when none are given', () => {
    expect(mockProviders(memoryRecordingStore()).models).toEqual(DEFAULT_MOCK_MODELS)
  })
})

describe('recordingProviders', () => {
  it('records real results so the mock replays them', async () => {
    const store = memoryRecordingStore()
    const recording = recordingProviders(fakeReal(), store, { nodeEnv: 'test' })
    const image = new Uint8Array([9, 8, 7])
    const req: CompletionRequest = {
      ...completionRequest(),
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', mediaType: 'image/png', data: image }],
        },
      ],
    }

    expect(await recording.llm.complete(req)).toEqual(completion)
    expect(await recording.embeddings.embed(['flour'])).toEqual(embedding)
    expect(store.size).toBe(2)

    // The stored request shows the image hash and size, not its bytes.
    const stored = await store.get(await requestKey('complete', req))
    expect(JSON.stringify(stored?.request)).toContain('"byteLength":3')
    expect(JSON.stringify(stored?.request)).not.toContain('"data"')

    const replay = mockProviders(store)
    expect(await replay.llm.complete(req)).toEqual(completion)
    expect(await replay.embeddings.embed(['flour'])).toEqual(embedding)
  })

  it('is refused when NODE_ENV=production', () => {
    expect(() =>
      recordingProviders(fakeReal(), memoryRecordingStore(), {
        nodeEnv: 'production',
      }),
    ).toThrow(/NODE_ENV=production/)
  })
})

describe('createProviders', () => {
  const mockEnv = () =>
    parseEnv(providerEnvSchema, {
      PROVIDERS: 'mock',
      MOCK_RECORDINGS_DIR: './recordings',
    })
  const realEnv = (mode: 'openrouter' | 'record') =>
    parseEnv(providerEnvSchema, {
      PROVIDERS: mode,
      OPENROUTER_API_KEY: 'sk-test',
      LLM_COMPILE_MODEL: 'real/compile',
      LLM_DRAFT_MODEL: 'real/draft',
      MOCK_RECORDINGS_DIR: './recordings',
    })

  it('builds the mock for PROVIDERS=mock, with models from config', async () => {
    const env = { ...mockEnv(), LLM_COMPILE_MODEL: 'cfg/compile' }
    const openrouter = vi.fn(fakeReal)
    const providers = createProviders(env, {
      store: memoryRecordingStore(),
      openrouter,
    })
    expect(openrouter).not.toHaveBeenCalled()
    expect(providers.models).toEqual({
      compile: 'cfg/compile',
      draft: DEFAULT_MOCK_MODELS.draft,
    })
    await expect(providers.llm.complete(completionRequest())).rejects.toBeInstanceOf(
      MissingRecordingError,
    )
  })

  it('uses the injected factory for PROVIDERS=openrouter', () => {
    const real = fakeReal()
    const openrouter = vi.fn(() => real)
    const env = realEnv('openrouter')
    expect(createProviders(env, { openrouter })).toBe(real)
    expect(openrouter).toHaveBeenCalledWith(env)
  })

  it('throws OpenRouterUnavailableError for openrouter and record without a factory', () => {
    expect(() => createProviders(realEnv('openrouter'))).toThrow(
      OpenRouterUnavailableError,
    )
    expect(() =>
      createProviders(realEnv('record'), {
        store: memoryRecordingStore(),
        nodeEnv: 'test',
      }),
    ).toThrow(OpenRouterUnavailableError)
  })

  it('wraps the real providers with a recorder for PROVIDERS=record', async () => {
    const real = fakeReal()
    const store = memoryRecordingStore()
    const providers = createProviders(realEnv('record'), {
      openrouter: () => real,
      store,
      nodeEnv: 'test',
    })
    expect(providers).not.toBe(real)
    expect(providers.models).toEqual(real.models)
    await providers.llm.complete(completionRequest())
    expect(real.llm.complete).toHaveBeenCalledTimes(1)
    expect(store.size).toBe(1)
  })

  it('refuses PROVIDERS=record in production before building the real providers', () => {
    const openrouter = vi.fn(fakeReal)
    expect(() =>
      createProviders(realEnv('record'), {
        openrouter,
        store: memoryRecordingStore(),
        nodeEnv: 'production',
      }),
    ).toThrow(/PROVIDERS=record is not allowed/)
    expect(openrouter).not.toHaveBeenCalled()
  })

  it('requires MOCK_RECORDINGS_DIR when no store is injected', () => {
    const env = { ...mockEnv(), MOCK_RECORDINGS_DIR: undefined }
    expect(() => createProviders(env)).toThrow(/MOCK_RECORDINGS_DIR is required/)
  })
})

describe('memoryRecordingStore', () => {
  it('clones values in and out', async () => {
    const store = memoryRecordingStore()
    const key = 'a'.repeat(64)
    const recording: Recording = { kind: 'complete', request: {}, result: completion }
    await store.put(key, recording)
    recording.result.model = 'mutated'
    const read = await store.get(key)
    expect(read?.result.model).toBe('mock/compile')
    if (read) read.result.model = 'mutated again'
    expect((await store.get(key))?.result.model).toBe('mock/compile')
    expect(store.keys()).toEqual([key])
  })
})

describe('fileRecordingStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cauldron-recordings-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips a recording through <dir>/<key>.json', async () => {
    const nested = path.join(dir, 'nested')
    const store = fileRecordingStore(nested)
    const key = await requestKey('complete', completionRequest())
    const recording: Recording = { kind: 'complete', request: { a: 1 }, result: completion }

    expect(await store.get(key)).toBeUndefined()
    await store.put(key, recording)
    expect(await store.get(key)).toEqual(recording)

    const text = await readFile(path.join(nested, `${key}.json`), 'utf8')
    expect(JSON.parse(text)).toEqual(recording)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('rejects keys that are not SHA-256 hex', async () => {
    const store = fileRecordingStore(dir)
    await expect(store.get('../escape')).rejects.toThrow(/Invalid recording key/)
    await expect(
      store.put('A'.repeat(64), { kind: 'embed', request: {}, result: embedding }),
    ).rejects.toThrow(/Invalid recording key/)
  })

  it('rejects a malformed recording file', async () => {
    const key = 'b'.repeat(64)
    await writeFile(path.join(dir, `${key}.json`), '{"kind":"other"}', 'utf8')
    await expect(fileRecordingStore(dir).get(key)).rejects.toThrow(
      /Malformed recording file/,
    )
  })
})
