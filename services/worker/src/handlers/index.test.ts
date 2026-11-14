import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'

import { type Db } from '@cauldron/core/db'
import { type Providers } from '@cauldron/core/providers'
import { type Job } from '@cauldron/core/queue'

import { createHandlerContext, handlers, registeredTypes } from './index'

// withActor needs a real pool; replace it at the module boundary and record the actor.
const withActor = vi.hoisted(() =>
  vi.fn(async (_db: unknown, actor: unknown, fn: (s: unknown) => unknown) =>
    fn({ actor }),
  ),
)
vi.mock('@cauldron/core/db', () => ({ withActor }))

const OWNER = 'user_abc'

function job(): Job {
  const now = new Date()
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: OWNER,
    userId: OWNER,
    type: 'ping',
    payload: {},
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

function context() {
  const fetch = vi.fn<typeof globalThis.fetch>()
  const ctx = createHandlerContext({
    db: { poolSize: 1, close: async () => {} } satisfies Db,
    job: job(),
    storageConfig: { url: 'http://127.0.0.1:54321', secretKey: 'test-secret', fetch },
    providers: {} as Providers,
    signal: new AbortController().signal,
    setStage: async () => {},
    log: pino({ enabled: false }),
  })
  return { ctx, fetch }
}

describe('handler registry', () => {
  it('registers ping', () => {
    expect(registeredTypes(handlers)).toContain('ping')
  })

  it('ping resolves without an outcome', async () => {
    await expect(handlers.ping(context().ctx)).resolves.toBeUndefined()
  })
})

describe('createHandlerContext', () => {
  it("binds scope to the job's user", async () => {
    const { ctx } = context()
    const result = await ctx.scope(async (s) => s.actor)
    expect(result).toEqual({ kind: 'user', userId: OWNER, tenantId: OWNER })
    expect(withActor).toHaveBeenCalledOnce()
  })

  it("binds storage to the job's tenant", async () => {
    const { ctx, fetch } = context()
    expect(ctx.storage.tenantId).toBe(OWNER)
    await expect(ctx.storage.get('user_other/src/0-a.txt')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
