// Queue integration tests (01.5-backend-foundation task 6.2, Requirements 6.1 and 6.2).
//
// claim(), reapExpired() and the fenced writes run on the privileged pool in autocommit, so
// the rollback harness can't wrap them. Instead every test uses its own job type, which keeps
// claim() to that test's jobs, and afterAll deletes every row this file created.
import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, it } from 'vitest'

import { type UserActor, ForbiddenError, withActor } from '../db'
import { rawSql } from '../db/internal'
import { testDb } from '../db/testing'

import {
  claim,
  complete,
  enqueue,
  fail,
  heartbeat,
  reapExpired,
  release,
  setStage,
} from './queue'
import { type EnqueueOptions } from './types'

const TYPE_PREFIX = `test-queue-${randomUUID()}-`
const USER_A: UserActor = { kind: 'user', userId: 'user_queue_a', tenantId: 'user_queue_a' }
const USER_B: UserActor = { kind: 'user', userId: 'user_queue_b', tenantId: 'user_queue_b' }

function uniqueType(): string {
  return `${TYPE_PREFIX}${randomUUID()}`
}

async function enqueueAs(user: UserActor, options: EnqueueOptions) {
  return withActor(testDb(), user, (scope) => enqueue(scope, options))
}

async function enqueueOne(user: UserActor, options: EnqueueOptions) {
  const job = await enqueueAs(user, options)
  if (!job) throw new Error('enqueue() returned null unexpectedly.')
  return job
}

/** Moves a running job's lease into the past, as if its worker had died. */
async function expireLease(id: string): Promise<void> {
  const sql = rawSql(testDb())
  await sql`
    update public.jobs set lease_expires_at = now() - interval '1 second' where id = ${id}`
}

async function readJob(id: string) {
  const sql = rawSql(testDb())
  const [row] = await sql<
    {
      status: string
      attempts: number
      failure_reason: string | null
      last_error: string | null
      locked_by: string | null
      lease_expires_at: Date | null
      stage: string | null
    }[]
  >`
    select status, attempts, failure_reason, last_error, locked_by, lease_expires_at, stage
    from public.jobs where id = ${id}`
  return row
}

afterAll(async () => {
  const sql = rawSql(testDb())
  await sql`delete from public.jobs where starts_with(type, ${TYPE_PREFIX})`
})

describe('claim', () => {
  it('never hands the same job to two concurrent claimers', async () => {
    const type = uniqueType()
    await enqueueOne(USER_A, { type })

    const [first, second] = await Promise.all([
      claim(testDb(), 'worker-1', [type]),
      claim(testDb(), 'worker-2', [type]),
    ])

    const claimed = [first, second].filter((job) => job !== null)
    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toMatchObject({ status: 'running', attempts: 1 })
  })

  it('gives concurrent claimers distinct jobs when several are queued', async () => {
    const type = uniqueType()
    const jobs = [await enqueueOne(USER_A, { type }), await enqueueOne(USER_B, { type })]

    const claimed = await Promise.all([
      claim(testDb(), 'worker-1', [type]),
      claim(testDb(), 'worker-2', [type]),
    ])

    const ids = claimed.map((job) => job?.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.sort()).toEqual(jobs.map((job) => job.id).sort())
  })

  it("doesn't claim jobs of a type the worker has no handler for", async () => {
    const queuedType = uniqueType()
    const job = await enqueueOne(USER_A, { type: queuedType })

    expect(await claim(testDb(), 'worker-1', [uniqueType()])).toBeNull()
    expect(await claim(testDb(), 'worker-1', [])).toBeNull()
    expect((await readJob(job.id)).status).toBe('queued')
  })
})

describe('leases', () => {
  it('reaps an expired lease back to queued while attempts remain', async () => {
    const type = uniqueType()
    const job = await enqueueOne(USER_A, { type, maxAttempts: 2 })
    await claim(testDb(), 'worker-1', [type])
    await expireLease(job.id)

    const reaped = await reapExpired(testDb())

    expect(reaped).toContainEqual({ id: job.id, status: 'queued' })
    expect(await readJob(job.id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      last_error: 'lease expired',
      locked_by: null,
      lease_expires_at: null,
    })
  })

  it('reaps an expired lease to failed with "timed out" at max attempts', async () => {
    const type = uniqueType()
    const job = await enqueueOne(USER_A, { type, maxAttempts: 1 })
    await claim(testDb(), 'worker-1', [type])
    await expireLease(job.id)

    const reaped = await reapExpired(testDb())

    expect(reaped).toContainEqual({ id: job.id, status: 'failed' })
    expect(await readJob(job.id)).toMatchObject({
      status: 'failed',
      failure_reason: 'timed out',
    })
  })

  it("doesn't reap a job whose lease is still live", async () => {
    const type = uniqueType()
    const job = await enqueueOne(USER_A, { type })
    const claimed = await claim(testDb(), 'worker-1', [type])

    const reaped = await reapExpired(testDb())

    expect(reaped.map((r) => r.id)).not.toContain(job.id)
    expect(claimed && (await heartbeat(testDb(), claimed))).toBe(true)
  })

  it('makes a stale worker\'s fenced writes affect zero rows after a re-claim', async () => {
    const type = uniqueType()
    const job = await enqueueOne(USER_A, { type })
    const stale = await claim(testDb(), 'worker-1', [type])
    if (!stale) throw new Error('expected a claim')
    await expireLease(job.id)
    await reapExpired(testDb())
    const fresh = await claim(testDb(), 'worker-2', [type])
    expect(fresh).toMatchObject({ id: job.id, attempts: 2, lockedBy: 'worker-2' })

    expect(await heartbeat(testDb(), stale)).toBe(false)
    expect(await setStage(testDb(), stale, 'fetching')).toBe(false)
    expect(await complete(testDb(), stale, 'stale')).toBe(false)
    expect(await fail(testDb(), stale, new Error('stale'))).toBeNull()
    expect(await release(testDb(), stale)).toBe(false)

    expect(await readJob(job.id)).toMatchObject({
      status: 'running',
      attempts: 2,
      locked_by: 'worker-2',
      stage: null,
    })
  })
})

describe('release', () => {
  it('returns the job to queued and gives back the attempt', async () => {
    const type = uniqueType()
    const job = await enqueueOne(USER_A, { type })
    const claimed = await claim(testDb(), 'worker-1', [type])
    if (!claimed) throw new Error('expected a claim')
    expect(claimed.attempts).toBe(1)

    expect(await release(testDb(), claimed)).toBe(true)

    expect(await readJob(job.id)).toMatchObject({
      status: 'queued',
      attempts: 0,
      locked_by: null,
      lease_expires_at: null,
    })
  })
})

describe('enqueue', () => {
  it('returns null for a second job with the same dedupeKey while the first is queued', async () => {
    const type = uniqueType()
    const dedupeKey = randomUUID()
    const first = await enqueueAs(USER_A, { type, dedupeKey })

    expect(first).not.toBeNull()
    expect(await enqueueAs(USER_A, { type, dedupeKey })).toBeNull()

    const sql = rawSql(testDb())
    const rows = await sql`select id from public.jobs where type = ${type}`
    expect(rows).toHaveLength(1)
  })

  it("scopes dedupeKey per tenant, so one user's key doesn't block another's", async () => {
    const type = uniqueType()
    const dedupeKey = randomUUID()
    await enqueueOne(USER_A, { type, dedupeKey })

    expect(await enqueueAs(USER_B, { type, dedupeKey })).not.toBeNull()
  })

  it("stamps the job with the scope's user as tenant and owner", async () => {
    const job = await enqueueOne(USER_A, { type: uniqueType() })

    expect(job).toMatchObject({ tenantId: USER_A.userId, userId: USER_A.userId })
  })

  it("can't create a job in another user's tenant, even with a raw insert", async () => {
    const type = uniqueType()
    const attempt = withActor(testDb(), USER_A, async ({ sql }) => {
      await sql`
        insert into public.jobs (tenant_id, user_id, type)
        values (${USER_B.userId}, ${USER_B.userId}, ${type})`
    })

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError)
    const sql = rawSql(testDb())
    expect(await sql`select id from public.jobs where type = ${type}`).toHaveLength(0)
  })
})
