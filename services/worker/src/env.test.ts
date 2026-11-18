import { describe, expect, it } from 'vitest'
import { EnvError } from '@cauldron/core/env'
import { loadEnv } from './env'

const base = {
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  PROVIDERS: 'mock',
  MOCK_RECORDINGS_DIR: './recordings',
}

function errorOf(fn: () => unknown): EnvError {
  try {
    fn()
  } catch (error) {
    if (error instanceof EnvError) return error
    throw error
  }
  throw new Error('expected EnvError')
}

describe('loadEnv', () => {
  it('applies the worker and embedding defaults', () => {
    const env = loadEnv(base)
    expect(env.WORKER_CONCURRENCY).toBe(4)
    expect(env.POLL_INTERVAL_MS).toBe(1000)
    expect(env.SHUTDOWN_GRACE_MS).toBe(25_000)
    expect(env.EMBEDDING_MODEL).toBe('openai/text-embedding-3-small')
    expect(env.EMBEDDING_DIMENSIONS).toBe(1536)
  })

  it('coerces numeric settings from strings', () => {
    const env = loadEnv({ ...base, WORKER_CONCURRENCY: '8', POLL_INTERVAL_MS: '250' })
    expect(env.WORKER_CONCURRENCY).toBe(8)
    expect(env.POLL_INTERVAL_MS).toBe(250)
  })

  it('names a missing variable, counting an empty string as missing', () => {
    const error = errorOf(() => loadEnv({ ...base, SUPABASE_SECRET_KEY: '' }))
    expect(error.names).toEqual(['SUPABASE_SECRET_KEY'])
    expect(error.message).not.toContain('postgres://')
  })

  it('rejects a non-positive concurrency', () => {
    const error = errorOf(() => loadEnv({ ...base, WORKER_CONCURRENCY: '0' }))
    expect(error.names).toEqual(['WORKER_CONCURRENCY'])
  })

  describe('COMPILE_MODE', () => {
    it('defaults to mapper when unset', () => {
      expect(loadEnv(base).COMPILE_MODE).toBe('mapper')
    })

    it('counts an empty string as unset', () => {
      expect(loadEnv({ ...base, COMPILE_MODE: '' }).COMPILE_MODE).toBe('mapper')
    })

    it.each(['mapper', 'llm'] as const)('accepts %s', (mode) => {
      expect(loadEnv({ ...base, COMPILE_MODE: mode }).COMPILE_MODE).toBe(mode)
    })

    it('rejects another value, naming the variable and no secrets', () => {
      const error = errorOf(() => loadEnv({ ...base, COMPILE_MODE: 'LLM' }))
      expect(error.names).toEqual(['COMPILE_MODE'])
      expect(error.message).toContain('COMPILE_MODE')
      expect(error.message).not.toContain('sb_secret_test')
      expect(error.message).not.toContain('postgres://')
    })
  })

  it('requires OpenRouter settings when PROVIDERS=openrouter', () => {
    const error = errorOf(() => loadEnv({ ...base, PROVIDERS: 'openrouter' }))
    expect(error.names).toEqual([
      'LLM_COMPILE_MODEL',
      'LLM_DRAFT_MODEL',
      'OPENROUTER_API_KEY',
    ])
  })
})
