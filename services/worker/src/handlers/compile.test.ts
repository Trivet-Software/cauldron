// Mapper mode never calls the LLM (01.7-walking-skeleton Requirement 5.2, task 7.2).
//
// The handler imports its repository functions from `@cauldron/core/collection`, which need
// a real Postgres scope. Those functions are replaced at the module boundary so the handler
// runs without a database; the rest (mapper, validation, provenance) is real. The database
// behavior is covered by compile.db.test.ts.
import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type CompileInput } from '@cauldron/core/collection'
import { type Scoped } from '@cauldron/core/db'
import { goalFileSchema } from '@cauldron/core/goals'
import { type Providers } from '@cauldron/core/providers'
import { type Job } from '@cauldron/core/queue'
import { type TenantStorage } from '@cauldron/core/storage'

import { createCompileHandler } from './compile'
import { type HandlerContext } from './index'

const collection = vi.hoisted(() => ({
  loadCompileInput: vi.fn(),
  saveItem: vi.fn(async () => ({ itemId: 'item-1' })),
  recordCompileUsage: vi.fn(async () => {}),
}))
vi.mock('@cauldron/core/collection', () => collection)

const SOURCE_ID = '00000000-0000-0000-0000-0000000000aa'
const STORAGE_PATH = `user_abc/${SOURCE_ID}/0-source.txt`
// A PNG signature, enough for sniffImageType.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

const spec = goalFileSchema.parse({
  name: 'Recipe Box',
  description: 'Save recipes.',
  schema: {
    type: 'object',
    titleField: 'title',
    required: ['title'],
    properties: {
      title: { type: 'string', title: 'Title' },
      ingredients: { type: 'array', items: { type: 'string' }, title: 'Ingredients' },
      notes: { type: 'string', format: 'long-text', title: 'Notes' },
      image: { type: 'string', format: 'image', title: 'Photo' },
    },
  },
})

function compileInput(kind: 'text' | 'photo'): CompileInput {
  return {
    sourceId: SOURCE_ID,
    kind,
    storagePath: STORAGE_PATH,
    metadata: { label: 'Pancakes', filename: 'pancakes.png', contentType: 'x', bytes: 1 },
    goal: { id: 'goal-1', slug: 'recipe-box', version: 1, spec },
  }
}

function job(): Job {
  const now = new Date()
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: 'user_abc',
    userId: 'user_abc',
    type: 'compile',
    payload: { sourceId: SOURCE_ID },
    status: 'running',
    stage: null,
    outcome: null,
    attempts: 1,
    maxAttempts: 3,
    runAfter: now,
    leaseExpiresAt: now,
    lockedBy: 'worker-1',
    lastError: null,
    failureReason: null,
    dedupeKey: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function context(bytes: Uint8Array) {
  const complete = vi.fn(async () => {
    throw new Error('the LLM provider must not be called in mapper mode')
  })
  const embed = vi.fn(async () => {
    throw new Error('the embedding provider must not be called in mapper mode')
  })
  const ctx: HandlerContext = {
    job: job(),
    scope: (fn) => fn({} as Scoped),
    storage: {
      tenantId: 'user_abc',
      get: async () => bytes,
    } as unknown as TenantStorage,
    providers: {
      llm: { complete },
      embeddings: { model: 'm', dimensions: 1536, embed },
      models: { compile: 'a/compile', draft: 'a/draft' },
    } as unknown as Providers,
    signal: new AbortController().signal,
    setStage: async () => {},
    log: pino({ enabled: false }),
  }
  return { ctx, complete, embed }
}

describe('compile handler in mapper mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps a text source without calling the provider', async () => {
    collection.loadCompileInput.mockResolvedValue(compileInput('text'))
    const { ctx, complete, embed } = context(
      new TextEncoder().encode('Pancakes\n- flour\n- milk\nMix and fry.'),
    )

    await expect(createCompileHandler({ mode: 'mapper' })(ctx)).resolves.toEqual({
      outcome: 'ready',
    })

    expect(complete).not.toHaveBeenCalled()
    expect(embed).not.toHaveBeenCalled()
    expect(collection.saveItem).toHaveBeenCalledOnce()
    expect(collection.saveItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Pancakes',
        provenance: { mode: 'mapper', sourceKind: 'text' },
      }),
    )
    expect(collection.recordCompileUsage).not.toHaveBeenCalled()
  })

  it('maps a photo source without calling the provider', async () => {
    collection.loadCompileInput.mockResolvedValue(compileInput('photo'))
    const { ctx, complete, embed } = context(PNG)

    await expect(createCompileHandler({ mode: 'mapper' })(ctx)).resolves.toEqual({
      outcome: 'ready',
    })

    expect(complete).not.toHaveBeenCalled()
    expect(embed).not.toHaveBeenCalled()
    expect(collection.saveItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provenance: { mode: 'mapper', sourceKind: 'photo' },
      }),
    )
    expect(collection.recordCompileUsage).not.toHaveBeenCalled()
  })
})
