// Compile handler against the local database (01.7-walking-skeleton task 7.3, Requirements
// 3.1, 3.4, 3.5, 3.6, 3.7, 5.1, 5.3 and 5.5). Same approach as reembed.db.test.ts: everything
// runs as the source's own user through createHandlerContext, so RLS applies, and the rows stay
// behind (authenticated can't delete jobs or usage). Each run uses its own user, so leftovers
// never collide, and `pnpm db:reset` wipes them.
//
// Storage is the one stand-in: happy paths read from an in-memory bucket behind the real
// `tenantStorage()` (its tenant-prefix check still runs, and a spy shows no read happens for a
// path outside the tenant). The cross-tenant test also goes through the real `serviceStorage`
// wiring with a fetch that fails the test if it is ever called.
import { randomUUID } from 'node:crypto'

import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { buildExtractionRequest } from '@cauldron/core/compile'
import { type UserActor, createDb, withActor } from '@cauldron/core/db'
import { type GoalFile } from '@cauldron/core/goals'
import {
  type CompletionResult,
  type Providers,
} from '@cauldron/core/providers'
import {
  type Recording,
  memoryRecordingStore,
  mockProviders,
  requestKey,
} from '@cauldron/core/providers/mock'
import { NonRetryableError, enqueue } from '@cauldron/core/queue'
import {
  type SourcesBucket,
  StoragePathError,
  sourceObjectPath,
  tenantStorage,
} from '@cauldron/core/storage'

import { type CompileMode, createCompileHandler } from './compile'
import { createHandlerContext } from './index'

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
const STORAGE_URL = 'http://127.0.0.1:54321'

const userId = `user_compile_${randomUUID().replaceAll('-', '')}`
const USER: UserActor = { kind: 'user', userId, tenantId: userId }
const OTHER_TENANT = `user_other_${randomUUID().replaceAll('-', '')}`

const GOAL: GoalFile = {
  name: 'Compile test goal',
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
}

// Magic bytes are all `sniffImageType` looks at; the mapper never decodes the image.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

const db = createDb(DATABASE_URL, { max: 2 })
const objects = new Map<string, Uint8Array>()
const downloads: string[] = []

// Only the `tenantStorage()` seam is faked; the path checks around it are the real ones.
const bucket: SourcesBucket = {
  async upload() {
    throw new Error('The compile handler never uploads.')
  },
  async download(path) {
    downloads.push(path)
    const bytes = objects.get(path)
    if (!bytes) return { data: null, error: { message: 'Object not found', status: 404 } }
    return { data: new Blob([bytes]), error: null }
  },
  async createSignedUrl() {
    throw new Error('The compile handler never signs URLs.')
  },
  async remove() {
    throw new Error('The compile handler never removes objects.')
  },
}

let goalId: string

beforeAll(async () => {
  goalId = await withActor(db, USER, async ({ sql }) => {
    const owner = { tenant_id: userId, user_id: userId }
    const [goal] = await sql<{ id: string }[]>`
      insert into public.goals
        ${sql({ ...owner, kind: 'draft', slug: `goal-${randomUUID()}`, name: GOAL.name, latest_version: 1 })}
      returning id`
    await sql`
      insert into public.goal_versions ${sql({
        ...owner,
        goal_id: goal!.id,
        version: 1,
        schema_version: 1,
        spec: sql.json(GOAL as never),
        content_hash: 'hash',
        author: userId,
      })}`
    return goal!.id
  })
})

afterAll(async () => {
  await db.close({ timeoutSeconds: 5 })
})

interface SeedOptions {
  kind: 'text' | 'photo'
  filename: string
  bytes: Uint8Array
  /** Where the source row says the raw file is. Defaults to the user's own prefix. */
  storageTenant?: string
}

interface Seeded {
  sourceId: string
  storagePath: string
  jobId: string
  run(options?: { mode?: CompileMode; providers?: Providers; useRealStorage?: boolean }): Promise<{
    outcome?: string
  } | void>
}

async function seed(options: SeedOptions): Promise<Seeded> {
  const sourceId = randomUUID()
  const storagePath = sourceObjectPath(
    options.storageTenant ?? userId,
    sourceId,
    0,
    options.filename,
  )
  objects.set(storagePath, options.bytes)

  await withActor(db, USER, ({ sql }) =>
    sql`
      insert into public.sources
        (id, tenant_id, user_id, goal_id, kind, storage_paths, client, metadata)
      values (${sourceId}, ${userId}, ${userId}, ${goalId}, ${options.kind},
              ${[storagePath]}::text[], 'web',
              ${sql.json({
                label: options.filename,
                filename: options.filename,
                contentType: options.kind === 'photo' ? 'image/png' : 'text/plain',
                bytes: options.bytes.byteLength,
              })})`,
  )
  const job = await withActor(db, USER, (scope) =>
    enqueue(scope, { type: 'compile', payload: { sourceId }, dedupeKey: `compile:${sourceId}` }),
  )
  if (!job) throw new Error('enqueue() returned null unexpectedly.')

  return {
    sourceId,
    storagePath,
    jobId: job.id,
    run: async (runOptions = {}) => {
      const ctx = createHandlerContext({
        db,
        job,
        storageConfig: {
          url: STORAGE_URL,
          secretKey: 'test-secret-key',
          fetch: () => {
            throw new Error('Storage must not be contacted in this test.')
          },
        },
        providers: runOptions.providers ?? mockProviders(memoryRecordingStore()),
        signal: new AbortController().signal,
        setStage: async () => {},
        log: pino({ level: 'silent' }),
      })
      const handler = createCompileHandler({ mode: runOptions.mode ?? 'mapper' })
      return handler(
        runOptions.useRealStorage ? ctx : { ...ctx, storage: tenantStorage(userId, () => bucket) },
      )
    },
  }
}

interface ItemRow {
  title: string
  search_text: string
  data: Record<string, unknown>
  provenance: Record<string, unknown>
  goal_version: number
}

function itemsOf(sourceId: string): Promise<ItemRow[]> {
  return withActor(db, USER, ({ sql }) =>
    sql<ItemRow[]>`
      select title, search_text, data, provenance, goal_version
      from public.items where tenant_id = ${userId} and source_id = ${sourceId}`,
  )
}

interface UsageRow {
  operation: string
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  idempotency_key: string
}

function usageOf(sourceId: string): Promise<UsageRow[]> {
  return withActor(db, USER, ({ sql }) =>
    sql<UsageRow[]>`
      select operation, provider, model, input_tokens, output_tokens, idempotency_key
      from public.usage
      where tenant_id = ${userId} and idempotency_key = ${`compile:${sourceId}`}`,
  )
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected the promise to reject.')
}

describe('compile handler, mapper mode', () => {
  it('compiles a text source into one ready item with search_text (Requirements 3.4, 3.7)', async () => {
    const text = 'Pancakes\n- 2 cups flour\n- 1 cup milk\nMix and fry.'
    const source = await seed({
      kind: 'text',
      filename: 'capture.txt',
      bytes: new TextEncoder().encode(text),
    })

    const result = await source.run()

    expect(result).toEqual({ outcome: 'ready' })
    expect(await itemsOf(source.sourceId)).toEqual([
      {
        title: 'Pancakes',
        search_text: 'Pancakes',
        data: { title: 'Pancakes', ingredients: ['2 cups flour', '1 cup milk'], notes: 'Mix and fry.' },
        provenance: { mode: 'mapper', sourceKind: 'text' },
        goal_version: 1,
      },
    ])
    expect(await usageOf(source.sourceId)).toEqual([])
  })

  it('compiles a photo source into one ready item linked to the stored image', async () => {
    const source = await seed({ kind: 'photo', filename: 'apple-pie.png', bytes: PNG_BYTES })

    const result = await source.run()

    expect(result).toEqual({ outcome: 'ready' })
    expect(await itemsOf(source.sourceId)).toEqual([
      {
        title: 'apple-pie',
        search_text: 'apple-pie',
        data: { title: 'apple-pie', image: source.storagePath },
        provenance: { mode: 'mapper', sourceKind: 'photo' },
        goal_version: 1,
      },
    ])
  })

  it('leaves exactly one item when the job runs twice (Requirement 3.6)', async () => {
    const source = await seed({
      kind: 'text',
      filename: 'capture.txt',
      bytes: new TextEncoder().encode('Soup\n- water'),
    })

    await source.run()
    await source.run()

    const items = await itemsOf(source.sourceId)
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('Soup')
  })

  it('throws a NonRetryableError naming title when no line has text, and saves nothing (Requirement 3.5)', async () => {
    const source = await seed({
      kind: 'text',
      filename: 'capture.txt',
      bytes: new TextEncoder().encode('  \n\t\n   \n'),
    })

    const error = await rejection(source.run())

    expect(error).toBeInstanceOf(NonRetryableError)
    expect((error as NonRetryableError).reason).toMatch(/\btitle\b/)
    expect(await itemsOf(source.sourceId)).toEqual([])
  })

  it('throws before any storage read when the source path is in another tenant (Requirement 3.1)', async () => {
    const source = await seed({
      kind: 'text',
      filename: 'capture.txt',
      bytes: new TextEncoder().encode('Not yours'),
      storageTenant: OTHER_TENANT,
    })

    // Through the injected bucket: the path check rejects before download() is reached.
    const before = downloads.length
    const error = await rejection(source.run())
    expect(error).toBeInstanceOf(StoragePathError)
    expect(downloads.length).toBe(before)

    // Through the real serviceStorage wiring: its fetch fails the test if Storage is contacted,
    // so the StoragePathError proves the check ran first.
    const error2 = await rejection(source.run({ useRealStorage: true }))
    expect(error2).toBeInstanceOf(StoragePathError)

    expect(await itemsOf(source.sourceId)).toEqual([])
  })
})

describe('compile handler, llm mode', () => {
  const MODEL = 'mock/compile'

  // Providers that replay one recorded completion for exactly the request the handler builds
  // for this text, and count calls to the provider.
  async function llmProviders(text: string, result: Partial<CompletionResult> & { output: unknown }) {
    const request = buildExtractionRequest(GOAL, { kind: 'text', text }, MODEL)
    const recording: Recording = {
      kind: 'complete',
      request: {},
      result: {
        model: 'recorded/compile-model',
        usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.0021 },
        ...result,
      },
    }
    const store = memoryRecordingStore({ [await requestKey('complete', request)]: recording })
    const providers = mockProviders(store, { models: { compile: MODEL, draft: 'mock/draft' } })
    const complete = vi.spyOn(providers.llm, 'complete')
    return { providers, complete }
  }

  it('makes one provider call, saves the item and writes one usage row after two runs (Requirements 3.6, 5.1, 5.3)', async () => {
    const text = 'Pancakes\n- flour\n- milk'
    const source = await seed({
      kind: 'text',
      filename: 'capture.txt',
      bytes: new TextEncoder().encode(text),
    })
    const { providers, complete } = await llmProviders(text, {
      output: { title: 'Fluffy Pancakes', ingredients: ['flour', 'milk'] },
    })

    const result = await source.run({ mode: 'llm', providers })

    expect(result).toEqual({ outcome: 'ready' })
    expect(complete).toHaveBeenCalledTimes(1)

    await source.run({ mode: 'llm', providers })

    expect(await itemsOf(source.sourceId)).toEqual([
      {
        title: 'Fluffy Pancakes',
        search_text: 'Fluffy Pancakes',
        data: { title: 'Fluffy Pancakes', ingredients: ['flour', 'milk'] },
        provenance: { mode: 'llm', sourceKind: 'text', model: 'recorded/compile-model' },
        goal_version: 1,
      },
    ])
    expect(await usageOf(source.sourceId)).toEqual([
      {
        operation: 'compile',
        provider: 'openrouter',
        model: 'recorded/compile-model',
        input_tokens: 120,
        output_tokens: 30,
        idempotency_key: `compile:${source.sourceId}`,
      },
    ])
  })

  it('fails with field keys only on invalid recorded output, and still records the spend once (Requirements 5.5, 3.5)', async () => {
    const text = 'Mystery dish'
    const leaked = `LEAKED-${randomUUID()}`
    const source = await seed({
      kind: 'text',
      filename: 'capture.txt',
      bytes: new TextEncoder().encode(text),
    })
    // No title, and a value that must never reach the failure reason.
    const { providers, complete } = await llmProviders(text, {
      output: { notes: leaked, ingredients: 'not a list' },
    })

    const error = await rejection(source.run({ mode: 'llm', providers }))

    expect(error).toBeInstanceOf(NonRetryableError)
    const reason = (error as NonRetryableError).reason
    expect(reason).toMatch(/\btitle\b/)
    expect(reason).not.toContain(leaked)
    expect(reason).not.toContain('not a list')
    expect(complete).toHaveBeenCalledTimes(1)
    expect(await itemsOf(source.sourceId)).toEqual([])
    // The call cost money even though its output was unusable; a second run adds no row.
    expect(await usageOf(source.sourceId)).toHaveLength(1)
    await rejection(source.run({ mode: 'llm', providers }))
    expect(await usageOf(source.sourceId)).toHaveLength(1)
  })
})
