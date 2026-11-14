// Re-embed handler against the local database (01.5-backend-foundation task 7.8,
// Requirements 7.5 and 7.6): a stale item gets the mock vector and model, and running the
// job twice leaves exactly one `usage` row.
//
// Everything runs as the item's own user, so no privileged path is needed. As in
// ping.db.test.ts, the rows stay behind (authenticated can't delete jobs or usage); each run
// uses its own user, so leftovers never collide, and `pnpm db:reset` wipes them.
import { randomUUID } from 'node:crypto'

import { pino } from 'pino'
import { afterAll, describe, expect, it } from 'vitest'

import { type UserActor, createDb, withActor } from '@cauldron/core/db'
import { type EmbeddingResult } from '@cauldron/core/providers'
import {
  type Recording,
  memoryRecordingStore,
  mockProviders,
  requestKey,
} from '@cauldron/core/providers/mock'
import { enqueue } from '@cauldron/core/queue'

import { createHandlerContext } from './index'
import { reembedHandler } from './reembed'

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''

const userId = `user_reembed_${randomUUID().replaceAll('-', '')}`
const USER: UserActor = { kind: 'user', userId, tenantId: userId }
const NEW_MODEL = `test-embed-${randomUUID()}`
const DIMENSIONS = 1536
const SEARCH_TEXT = 'tomato soup'

const db = createDb(DATABASE_URL, { max: 2 })

afterAll(async () => {
  await db.close({ timeoutSeconds: 5 })
})

describe('reembed handler', () => {
  it('updates a stale item and writes one usage row, even when run twice', async () => {
    const itemId = await withActor(db, USER, async ({ sql }) => {
      const owner = { tenant_id: userId, user_id: userId }
      const [goal] = await sql<{ id: string }[]>`
        insert into public.goals ${sql({ ...owner, kind: 'draft', slug: `goal-${randomUUID()}`, name: 'Goal' })}
        returning id`
      await sql`
        insert into public.goal_versions ${sql({
          ...owner,
          goal_id: goal.id,
          version: 1,
          schema_version: 1,
          spec: sql.json({}),
          content_hash: 'hash',
          author: userId,
        })}`
      const [source] = await sql<{ id: string }[]>`
        insert into public.sources ${sql({ ...owner, goal_id: goal.id, kind: 'text', client: 'web' })}
        returning id`
      const [item] = await sql<{ id: string }[]>`
        insert into public.items
          (tenant_id, user_id, goal_id, source_id, goal_version, data, title, search_text,
           embedding, embedding_model, embedding_dimensions)
        values (${userId}, ${userId}, ${goal.id}, ${source.id}, 1, ${sql.json({})}, 'Item',
                ${SEARCH_TEXT}, ${`[${new Array(DIMENSIONS).fill(0).join(',')}]`}::extensions.vector,
                'some-older-model', ${DIMENSIONS})
        returning id`
      return item.id
    })

    // One recorded embedding for exactly this input, with a distinctive first component.
    const vector = new Array<number>(DIMENSIONS).fill(0)
    vector[0] = 0.5
    const result: EmbeddingResult = {
      vectors: [vector],
      model: NEW_MODEL,
      dimensions: DIMENSIONS,
      usage: { inputTokens: 7, outputTokens: 0, costUsd: 0.000014 },
    }
    const key = await requestKey('embed', {
      model: NEW_MODEL,
      dimensions: DIMENSIONS,
      inputs: [SEARCH_TEXT],
    })
    const recording: Recording = { kind: 'embed', request: {}, result }
    const providers = mockProviders(memoryRecordingStore({ [key]: recording }), {
      embeddingModel: NEW_MODEL,
      dimensions: DIMENSIONS,
    })

    const job = await withActor(db, USER, (scope) =>
      enqueue(scope, { type: 'reembed', payload: { itemIds: [itemId] } }),
    )
    if (!job) throw new Error('enqueue() returned null unexpectedly.')

    const run = () =>
      reembedHandler(
        createHandlerContext({
          db,
          job,
          storageConfig: { url: 'http://127.0.0.1:54321', secretKey: 'test-secret-key' },
          providers,
          signal: new AbortController().signal,
          setStage: async () => {},
          log: pino({ level: 'silent' }),
        }),
      )
    await run()
    await run()

    const items = await withActor(db, USER, ({ sql }) =>
      sql<{ model: string; dims: number; first: number }[]>`
        select embedding_model as model, embedding_dimensions as dims,
               (embedding::real[])[1] as first
        from public.items where id = ${itemId}`,
    )
    expect(items).toEqual([{ model: NEW_MODEL, dims: DIMENSIONS, first: 0.5 }])

    const usage = await withActor(db, USER, ({ sql }) =>
      sql<{ operation: string; model: string; idempotency_key: string }[]>`
        select operation, model, idempotency_key from public.usage
        where tenant_id = ${userId}`,
    )
    expect(usage).toEqual([
      { operation: 'reembed', model: NEW_MODEL, idempotency_key: `reembed:${itemId}:${NEW_MODEL}` },
    ])
  })
})
