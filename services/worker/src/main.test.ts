// Startup checks and lifecycle of the worker entry point (task 7.5, Requirements 6.4, 8.3).
// The end-to-end ping run against the local database is task 7.7.
import { pino } from 'pino'
import { describe, expect, it, vi } from 'vitest'

import { EMBEDDING_COLUMN_DIMENSIONS } from '@cauldron/core/db'
import { memoryRecordingStore, mockProviders } from '@cauldron/core/providers/mock'

import { loadEnv } from './env'
import { StartupError, checkEmbeddingDimensions, main, startWorker } from './main'

const baseEnv = {
  // Port 1 refuses connections, so claims fail fast without a database.
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'secret-value',
  PROVIDERS: 'mock',
  MOCK_RECORDINGS_DIR: '/tmp/cauldron-recordings',
  POLL_INTERVAL_MS: '10',
}

describe('checkEmbeddingDimensions', () => {
  it('accepts the column size', () => {
    expect(() => checkEmbeddingDimensions(EMBEDDING_COLUMN_DIMENSIONS)).not.toThrow()
  })

  it('names both numbers on a mismatch', () => {
    expect(() => checkEmbeddingDimensions(768)).toThrow(StartupError)
    expect(() => checkEmbeddingDimensions(768)).toThrow(/768.*1536/)
  })
})

describe('main', () => {
  it('exits 1 naming the missing variables, without printing values', () => {
    const exit = vi.fn()
    const writeStderr = vi.fn()
    const result = main({ SUPABASE_SECRET_KEY: 'secret-value' }, { exit, writeStderr })

    expect(result).toBeUndefined()
    expect(exit).toHaveBeenCalledWith(1)
    const text = writeStderr.mock.calls.map(([t]) => t).join('')
    expect(text).toContain('DATABASE_URL')
    expect(text).toContain('PROVIDERS')
    expect(text).not.toContain('secret-value')
  })

  it('exits 1 when EMBEDDING_DIMENSIONS differs from the column', () => {
    const exit = vi.fn()
    const result = main(
      { ...baseEnv, EMBEDDING_DIMENSIONS: '768', LOG_LEVEL: 'silent' },
      { exit, writeStderr: vi.fn() },
    )
    expect(result).toBeUndefined()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits 1 when the providers cannot be built', () => {
    const exit = vi.fn()
    const result = main(
      {
        ...baseEnv,
        PROVIDERS: 'openrouter',
        OPENROUTER_API_KEY: 'key',
        LLM_COMPILE_MODEL: 'a/b',
        LLM_DRAFT_MODEL: 'a/c',
        LOG_LEVEL: 'silent',
      },
      { exit, writeStderr: vi.fn() },
    )
    expect(result).toBeUndefined()
    expect(exit).toHaveBeenCalledWith(1)
  })
})

describe('startWorker', () => {
  it('starts and stops cleanly even when the database is unreachable', async () => {
    const running = startWorker(loadEnv(baseEnv), {
      log: pino({ level: 'silent' }),
      providers: mockProviders(memoryRecordingStore()),
      workerId: 'test-worker',
    })
    expect(running.workerId).toBe('test-worker')
    await new Promise((resolve) => setTimeout(resolve, 30))
    await running.stop()
    // Idempotent: a second stop resolves to the same shutdown.
    await running.stop()
    expect(running.running).toBe(0)
  })
})
