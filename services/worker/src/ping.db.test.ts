// End-to-end ping run against the local database (01.5-backend-foundation task 7.7,
// Requirement 6.3): a `ping` job is enqueued, an in-process worker claims it, and the job
// ends `done`.
//
// Cleanup: the test leaves its finished job row behind. Deleting it needs a privileged path,
// and `authenticated` has no delete grant on jobs; the raw driver and the system actor are
// reserved for core and app-goal registration, and the package exports neither on purpose.
// Instead each run uses its own user (`user_ping_<uuid>`), so leftover rows never collide
// with a later run, and the test asserts only on its own job id. `pnpm db:reset` wipes them.
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { pino } from 'pino'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { type UserActor, createDb, withActor } from '@cauldron/core/db'
import { memoryRecordingStore, mockProviders } from '@cauldron/core/providers/mock'
import { enqueue } from '@cauldron/core/queue'

import { loadEnv } from './env'
import { type RunningWorker, startWorker } from './main'

// vitest.db.config.ts fails the run before this file loads when the variable is unset.
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''

const userId = `user_ping_${randomUUID()}`
const USER: UserActor = { kind: 'user', userId, tenantId: userId }

// The test's own pool for enqueueing and reading; the worker opens its own.
const db = createDb(DATABASE_URL, { max: 2 })

let running: RunningWorker | undefined

afterEach(async () => {
  await running?.stop()
  running = undefined
})

afterAll(async () => {
  await db.close({ timeoutSeconds: 5 })
})

async function readStatus(id: string): Promise<string | undefined> {
  // Read as the job's owner: RLS lets `authenticated` select its own tenant's jobs.
  const rows = await withActor(db, USER, ({ sql }) =>
    sql<{ status: string }[]>`select status from public.jobs where id = ${id}`,
  )
  return rows[0]?.status
}

describe('ping job', () => {
  it('is claimed by a running worker and ends done', async () => {
    const job = await withActor(db, USER, (scope) => enqueue(scope, { type: 'ping' }))
    if (!job) throw new Error('enqueue() returned null unexpectedly.')
    expect(job.status).toBe('queued')

    running = startWorker(
      loadEnv({
        DATABASE_URL,
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SECRET_KEY: 'test-secret-key',
        PROVIDERS: 'mock',
        MOCK_RECORDINGS_DIR: tmpdir(),
        POLL_INTERVAL_MS: '50',
        WORKER_CONCURRENCY: '1',
      }),
      {
        providers: mockProviders(memoryRecordingStore()),
        log: pino({ level: 'silent' }),
        workerId: `test-ping-${randomUUID()}`,
      },
    )

    await vi.waitFor(async () => expect(await readStatus(job.id)).toBe('done'), {
      timeout: 10_000,
      interval: 100,
    })
  })
})
