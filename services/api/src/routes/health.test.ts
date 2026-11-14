import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Logger } from 'pino'
import { type Db, withActor } from '@cauldron/core/db'
import { createHealthProbe, type HealthProbe, healthRoutes } from './health'

// The probe's only database call goes through withActor; mock it at the module
// boundary so these tests need no Postgres. The real query runs in pnpm test:db.
vi.mock('@cauldron/core/db', () => ({ withActor: vi.fn() }))
const withActorMock = vi.mocked(withActor)

const env = {
  RAILWAY_GIT_COMMIT_SHA: 'abc123',
  EMBEDDING_MODEL: 'openai/text-embedding-3-small',
  EMBEDDING_DIMENSIONS: 1536,
}

function probe(ok: boolean): HealthProbe {
  return { checkDatabase: async () => ok }
}

function fakeLogger() {
  return { warn: vi.fn(), info: vi.fn() }
}

const db = {} as Db

describe('GET /health', () => {
  it('returns 200 with version and embedding settings, without a token', async () => {
    const res = await healthRoutes({ env, health: probe(true) }).request('/health', {
      headers: { Origin: 'https://app.example.com' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(await res.json()).toEqual({
      status: 'ok',
      service: 'api',
      version: 'abc123',
      checks: { database: 'ok' },
      embeddings: { model: 'openai/text-embedding-3-small', dimensions: 1536 },
    })
  })

  it('returns 503 with the same shape when the database check fails', async () => {
    const res = await healthRoutes({ env, health: probe(false) }).request('/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      status: 'error',
      service: 'api',
      version: 'abc123',
      checks: { database: 'error' },
      embeddings: { model: env.EMBEDDING_MODEL, dimensions: 1536 },
    })
  })
})

describe('createHealthProbe', () => {
  beforeEach(() => {
    withActorMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs select 1 as the anonymous actor and reports success', async () => {
    const sql = vi.fn(async () => [{ '?column?': 1 }])
    withActorMock.mockImplementation(async (_db, _actor, fn) =>
      fn({ sql, actor: { kind: 'anonymous' }, tenantId: null } as never),
    )
    const log = fakeLogger()
    const result = await createHealthProbe(db, { logger: log as unknown as Logger }).checkDatabase()
    expect(result).toBe(true)
    expect(withActorMock).toHaveBeenCalledWith(db, { kind: 'anonymous' }, expect.any(Function))
    expect(sql).toHaveBeenCalledOnce()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('reports failure when the query rejects, logging once per outage', async () => {
    withActorMock.mockRejectedValue(new Error('connection refused'))
    const log = fakeLogger()
    const health = createHealthProbe(db, { logger: log as unknown as Logger })
    expect(await health.checkDatabase()).toBe(false)
    expect(await health.checkDatabase()).toBe(false)
    expect(log.warn).toHaveBeenCalledOnce()

    withActorMock.mockResolvedValue(undefined)
    expect(await health.checkDatabase()).toBe(true)
    expect(log.info).toHaveBeenCalledOnce()
  })

  it('reports failure when the database does not answer within the timeout', async () => {
    vi.useFakeTimers()
    withActorMock.mockReturnValue(new Promise(() => {}))
    const log = fakeLogger()
    const pending = createHealthProbe(db, {
      timeoutMs: 2000,
      logger: log as unknown as Logger,
    }).checkDatabase()
    await vi.advanceTimersByTimeAsync(1999)
    let settled = false
    void pending.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe(false)
    expect(log.warn).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timer after a fast answer', async () => {
    vi.useFakeTimers()
    withActorMock.mockResolvedValue(undefined)
    const health = createHealthProbe(db, { logger: fakeLogger() as unknown as Logger })
    expect(await health.checkDatabase()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
