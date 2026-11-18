// The collection repository against the real schema, policies and queue
// (01.7-walking-skeleton task 5.5, Requirements 2.4, 2.5, 3.6, 3.7, 6.1, 6.2, 6.4, 6.5).
// Every test runs in a rolled-back transaction (withRollback), and the repository functions
// are called with the Scoped that asUser() hands out, so they see what a request would.
// App goals are registered per test under unique slugs, so they never reach the local stack.
import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { registerGoal } from '../db/register-goal'
import { uniqueTenant } from '../db/test-fixtures'
import { type RollbackTx, withRollback } from '../db/testing'
import { type GoalFile } from '../goals'

import { createCapture, getItem, getSource, listItems, saveItem } from './repository'
import { type NewCapture } from './types'

function goalFile(name: string): GoalFile {
  return {
    name,
    description: 'A goal used by the collection repository tests.',
    schema: {
      type: 'object',
      titleField: 'title',
      required: ['title'],
      properties: {
        title: { type: 'string', title: 'Title' },
        notes: { type: 'string', format: 'long-text' },
      },
    },
  }
}

interface AppGoal {
  id: string
  slug: string
}

async function seedAppGoal(tx: RollbackTx): Promise<AppGoal> {
  const slug = `test-app-${randomUUID().slice(0, 8)}`
  return tx.asSystem(async (scope) => {
    await registerGoal(scope, { slug, spec: goalFile(`Test ${slug}`) })
    const [row] = await scope.sql<{ id: string }[]>`
      select id from public.goals where tenant_id = 'system' and slug = ${slug}`
    return { id: row!.id, slug }
  })
}

type JobSeed = { status: 'queued' | 'running' | 'done' | 'failed'; failureReason?: string }

// Seeds a source the way createCapture would, but with an explicit capture time (every row of
// one transaction would otherwise share now()) and, optionally, its compile job in any state.
async function seedSource(
  tx: RollbackTx,
  tenant: string,
  goalId: string,
  opts: { label: string; capturedAt: string; job?: JobSeed },
): Promise<string> {
  const sourceId = randomUUID()
  await tx.asSystem(async ({ sql }) => {
    await sql`
      insert into public.sources
        (id, tenant_id, user_id, goal_id, kind, client, captured_at, metadata)
      values (${sourceId}, ${tenant}, ${tenant}, ${goalId}, 'text', 'web', ${opts.capturedAt},
              ${sql.json({ label: opts.label })})`
    if (opts.job) {
      await sql`
        insert into public.jobs
          (tenant_id, user_id, type, payload, status, failure_reason, created_at)
        values (${tenant}, ${tenant}, 'compile', ${sql.json({ sourceId })}, ${opts.job.status},
                ${opts.job.failureReason ?? null}, ${opts.capturedAt})`
    }
  })
  return sourceId
}

// A compiled source: the source row, then the item through saveItem (as the worker does).
async function seedReady(
  tx: RollbackTx,
  tenant: string,
  goal: AppGoal,
  title: string,
  capturedAt: string,
): Promise<{ sourceId: string; itemId: string }> {
  const sourceId = await seedSource(tx, tenant, goal.id, {
    label: `label of ${title}`,
    capturedAt,
    job: { status: 'done' },
  })
  const { itemId } = await tx.asUser(tenant, (scope) =>
    saveItem(scope, {
      sourceId,
      goalId: goal.id,
      goalVersion: 1,
      title,
      data: { title },
      provenance: { mode: 'mapper', sourceKind: 'text' },
    }),
  )
  return { sourceId, itemId }
}

function newCapture(goalId: string, sourceId = randomUUID()): NewCapture {
  return {
    sourceId,
    goalId,
    kind: 'text',
    client: 'mcp',
    storagePath: `tenant/${sourceId}/0/capture.txt`,
    metadata: { label: 'Pancakes', filename: 'capture.txt', contentType: 'text/plain', bytes: 42 },
  }
}

describe('createCapture', () => {
  it('creates one source and one compile job together, in the caller’s tenant', async () => {
    const tenant = uniqueTenant('capture')
    await withRollback(async (tx) => {
      const goal = await seedAppGoal(tx)
      const input = newCapture(goal.id)

      const result = await tx.asUser(tenant, (scope) => createCapture(scope, input))
      expect(result).toEqual({ sourceId: input.sourceId, state: 'queued' })

      const { sources, jobs } = await tx.asSystem(async ({ sql }) => ({
        sources: await sql<
          {
            tenant_id: string
            user_id: string
            kind: string
            client: string
            storage_paths: string[]
            metadata: unknown
          }[]
        >`
          select tenant_id, user_id, kind, client, storage_paths, metadata
          from public.sources where id = ${input.sourceId}`,
        jobs: await sql<
          { tenant_id: string; user_id: string; payload: unknown; dedupe_key: string }[]
        >`
          select tenant_id, user_id, payload, dedupe_key from public.jobs
          where type = 'compile' and payload->>'sourceId' = ${input.sourceId}`,
      }))
      expect(sources).toEqual([
        {
          tenant_id: tenant,
          user_id: tenant,
          kind: 'text',
          client: 'mcp',
          storage_paths: [input.storagePath],
          metadata: input.metadata,
        },
      ])
      expect(jobs).toEqual([
        {
          tenant_id: tenant,
          user_id: tenant,
          payload: { sourceId: input.sourceId },
          dedupe_key: `compile:${input.sourceId}`,
        },
      ])

      // The new source reads back as queued through the status query.
      const status = await tx.asUser(tenant, (scope) => getSource(scope, input.sourceId))
      expect(status).toMatchObject({
        id: input.sourceId,
        goal: goal.slug,
        kind: 'text',
        client: 'mcp',
        state: 'queued',
        failureReason: null,
        itemId: null,
      })
    })
  })

  // The only enqueue failure createCapture can meet: a queued or running compile job already
  // holds `compile:<sourceId>` for this tenant, so enqueue() returns null after the source
  // insert has succeeded. (Its job type is fixed, and a bad goal ID fails at the source
  // insert, before enqueue runs, so neither tests the rollback of a half-done capture.)
  it('leaves no source behind when the enqueue fails', async () => {
    const tenant = uniqueTenant('capture')
    await withRollback(async (tx) => {
      const goal = await seedAppGoal(tx)
      const input = newCapture(goal.id)
      await tx.asSystem(
        ({ sql }) => sql`
          insert into public.jobs (tenant_id, user_id, type, payload, dedupe_key)
          values (${tenant}, ${tenant}, 'compile', ${sql.json({ sourceId: input.sourceId })},
                  ${`compile:${input.sourceId}`})`,
      )

      await expect(tx.asUser(tenant, (scope) => createCapture(scope, input))).rejects.toThrow(
        /already exists/,
      )

      const counts = await tx.asSystem(async ({ sql }) => {
        const [sources] = await sql<{ n: number }[]>`
          select count(*)::int as n from public.sources where id = ${input.sourceId}`
        const [jobs] = await sql<{ n: number }[]>`
          select count(*)::int as n from public.jobs
          where tenant_id = ${tenant} and payload->>'sourceId' = ${input.sourceId}`
        return { sources: sources!.n, jobs: jobs!.n }
      })
      // Only the job that was already there remains.
      expect(counts).toEqual({ sources: 0, jobs: 1 })
    })
  })
})

describe('listItems', () => {
  it('returns pending, failed and ready entries newest first', async () => {
    const tenant = uniqueTenant('list')
    await withRollback(async (tx) => {
      const goal = await seedAppGoal(tx)
      const other = await seedAppGoal(tx)
      const ready = await seedReady(tx, tenant, goal, 'Ready Soup', '2026-01-01T10:00:00Z')
      const failed = await seedSource(tx, tenant, goal.id, {
        label: 'Failed capture',
        capturedAt: '2026-01-02T10:00:00Z',
        job: { status: 'failed', failureReason: 'Missing or invalid: title.' },
      })
      const running = await seedSource(tx, tenant, goal.id, {
        label: 'Running capture',
        capturedAt: '2026-01-03T10:00:00Z',
        job: { status: 'running' },
      })
      const queued = await seedSource(tx, tenant, goal.id, {
        label: 'Queued capture',
        capturedAt: '2026-01-04T10:00:00Z',
        job: { status: 'queued' },
      })
      // Another goal's capture must not appear in this goal's list.
      await seedSource(tx, tenant, other.id, {
        label: 'Other goal',
        capturedAt: '2026-01-05T10:00:00Z',
        job: { status: 'queued' },
      })

      const entries = await tx.asUser(tenant, (scope) =>
        listItems(scope, { goalSlug: goal.slug, limit: 50 }),
      )
      expect(entries).toEqual([
        {
          id: null,
          sourceId: queued,
          title: 'Queued capture',
          state: 'queued',
          failureReason: null,
          capturedAt: '2026-01-04T10:00:00.000Z',
        },
        {
          id: null,
          sourceId: running,
          title: 'Running capture',
          state: 'extracting',
          failureReason: null,
          capturedAt: '2026-01-03T10:00:00.000Z',
        },
        {
          id: null,
          sourceId: failed,
          title: 'Failed capture',
          state: 'failed',
          failureReason: 'Missing or invalid: title.',
          capturedAt: '2026-01-02T10:00:00.000Z',
        },
        {
          id: ready.itemId,
          sourceId: ready.sourceId,
          title: 'Ready Soup',
          state: 'ready',
          failureReason: null,
          capturedAt: '2026-01-01T10:00:00.000Z',
        },
      ])

      const limited = await tx.asUser(tenant, (scope) =>
        listItems(scope, { goalSlug: goal.slug, limit: 2 }),
      )
      expect(limited.map((e) => e.sourceId)).toEqual([queued, running])
    })
  })

  it('matches q case-insensitively and returns compiled items only', async () => {
    const tenant = uniqueTenant('list')
    await withRollback(async (tx) => {
      const goal = await seedAppGoal(tx)
      const chocolate = await seedReady(tx, tenant, goal, 'Chocolate CAKE', '2026-01-01T10:00:00Z')
      const carrot = await seedReady(tx, tenant, goal, 'carrot cake', '2026-01-02T10:00:00Z')
      await seedReady(tx, tenant, goal, 'Tomato Soup', '2026-01-03T10:00:00Z')
      // Its label matches, but it has no item yet, so a search can't return it.
      await seedSource(tx, tenant, goal.id, {
        label: 'cake in progress',
        capturedAt: '2026-01-04T10:00:00Z',
        job: { status: 'queued' },
      })

      for (const q of ['cake', 'CAKE', ' Cake ']) {
        const entries = await tx.asUser(tenant, (scope) =>
          listItems(scope, { goalSlug: goal.slug, q, limit: 50 }),
        )
        expect(entries.map((e) => e.id).sort()).toEqual([chocolate.itemId, carrot.itemId].sort())
      }
    })
  })

  it('orders search results by similarity, then newest first', async () => {
    const tenant = uniqueTenant('list')
    await withRollback(async (tx) => {
      const goal = await seedAppGoal(tx)
      // The closest match is the oldest, so capture order would put it last.
      const exact = await seedReady(tx, tenant, goal, 'Cake', '2026-01-01T10:00:00Z')
      const close = await seedReady(tx, tenant, goal, 'Cake mix', '2026-01-02T10:00:00Z')
      const far = await seedReady(
        tx,
        tenant,
        goal,
        'Chocolate cake with buttercream frosting',
        '2026-01-03T10:00:00Z',
      )

      const entries = await tx.asUser(tenant, (scope) =>
        listItems(scope, { goalSlug: goal.slug, q: 'cake', limit: 50 }),
      )
      expect(entries.map((e) => e.id)).toEqual([exact.itemId, close.itemId, far.itemId])
    })
  })

  it('treats %, _ and \\ in q literally', async () => {
    const tenant = uniqueTenant('list')
    await withRollback(async (tx) => {
      const goal = await seedAppGoal(tx)
      const percent = await seedReady(tx, tenant, goal, '100% Whole Wheat', '2026-01-01T10:00:00Z')
      await seedReady(tx, tenant, goal, '100 Percent Juice', '2026-01-02T10:00:00Z')
      const underscore = await seedReady(tx, tenant, goal, 'a_b stew', '2026-01-03T10:00:00Z')
      await seedReady(tx, tenant, goal, 'axb stew', '2026-01-04T10:00:00Z')
      const backslash = await seedReady(tx, tenant, goal, 'C:\\temp notes', '2026-01-05T10:00:00Z')
      await seedReady(tx, tenant, goal, 'Plain notes', '2026-01-06T10:00:00Z')

      const search = async (q: string) =>
        (
          await tx.asUser(tenant, (scope) =>
            listItems(scope, { goalSlug: goal.slug, q, limit: 50 }),
          )
        ).map((e) => e.id)

      expect(await search('100%')).toEqual([percent.itemId])
      expect(await search('a_b')).toEqual([underscore.itemId])
      expect(await search('\\')).toEqual([backslash.itemId])
      // A bare wildcard matches only titles that contain it, not everything.
      expect(await search('%')).toEqual([percent.itemId])
    })
  })
})

describe('tenant isolation', () => {
  it('shows user B nothing of user A’s sources, items and list', async () => {
    const userA = uniqueTenant('iso_a')
    const userB = uniqueTenant('iso_b')
    await withRollback(async (tx) => {
      const goal = await seedAppGoal(tx)
      const ready = await seedReady(tx, userA, goal, 'A Secret Soup', '2026-01-01T10:00:00Z')
      const pending = await seedSource(tx, userA, goal.id, {
        label: 'A pending capture',
        capturedAt: '2026-01-02T10:00:00Z',
        job: { status: 'queued' },
      })

      // The data is there for A.
      const own = await tx.asUser(userA, async (scope) => ({
        item: await getItem(scope, ready.itemId),
        source: await getSource(scope, pending),
        entries: await listItems(scope, { goalSlug: goal.slug, limit: 50 }),
      }))
      expect(own.item).toMatchObject({ id: ready.itemId, title: 'A Secret Soup' })
      expect(own.source).toMatchObject({ id: pending, state: 'queued' })
      expect(own.entries).toHaveLength(2)

      // B asks for A's IDs, and lists the same goal, with and without a search.
      const theirs = await tx.asUser(userB, async (scope) => ({
        item: await getItem(scope, ready.itemId),
        readySource: await getSource(scope, ready.sourceId),
        pendingSource: await getSource(scope, pending),
        entries: await listItems(scope, { goalSlug: goal.slug, limit: 50 }),
        found: await listItems(scope, { goalSlug: goal.slug, q: 'Secret', limit: 50 }),
      }))
      expect(theirs).toEqual({
        item: null,
        readySource: null,
        pendingSource: null,
        entries: [],
        found: [],
      })
    })
  })
})

describe('saveItem', () => {
  it('leaves one row when saved twice, and search_text equals the title', async () => {
    const tenant = uniqueTenant('save')
    await withRollback(async (tx) => {
      const goal = await seedAppGoal(tx)
      const sourceId = await seedSource(tx, tenant, goal.id, {
        label: 'Pancakes',
        capturedAt: '2026-01-01T10:00:00Z',
        job: { status: 'running' },
      })
      const save = (title: string, notes: string) =>
        tx.asUser(tenant, (scope) =>
          saveItem(scope, {
            sourceId,
            goalId: goal.id,
            goalVersion: 1,
            title,
            data: { title, notes },
            provenance: { mode: 'mapper', sourceKind: 'text' },
          }),
        )
      const rowsOf = () =>
        tx.asSystem(
          ({ sql }) => sql<
            {
              id: string
              ordinal: number
              title: string
              search_text: string | null
              data: unknown
            }[]
          >`
            select id, ordinal, title, search_text, data from public.items
            where tenant_id = ${tenant} and source_id = ${sourceId}`,
        )

      const first = await save('Pancakes', 'first run')
      expect(await rowsOf()).toEqual([
        {
          id: first.itemId,
          ordinal: 0,
          title: 'Pancakes',
          search_text: 'Pancakes',
          data: { title: 'Pancakes', notes: 'first run' },
        },
      ])

      // A retried or re-run job replaces the item in place.
      const second = await save('Fluffy Pancakes', 'second run')
      expect(second.itemId).toBe(first.itemId)
      expect(await rowsOf()).toEqual([
        {
          id: first.itemId,
          ordinal: 0,
          title: 'Fluffy Pancakes',
          search_text: 'Fluffy Pancakes',
          data: { title: 'Fluffy Pancakes', notes: 'second run' },
        },
      ])
    })
  })
})
