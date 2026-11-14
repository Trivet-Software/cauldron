import { describe, expect, it } from 'vitest'
import { EnvError } from '@cauldron/core/env'
import { loadEnv } from './env'

const base = {
  DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  CLERK_SECRET_KEY: 'sk_test_example',
  APP_ORIGINS: 'http://localhost:5173',
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
  it('applies defaults', () => {
    const env = loadEnv(base)
    expect(env.PORT).toBe(8787)
    expect(env.DEVELOPER_EMAILS).toEqual([])
    expect(env.CLERK_JWT_KEY).toBeUndefined()
    expect(env.EMBEDDING_MODEL).toBe('openai/text-embedding-3-small')
    expect(env.EMBEDDING_DIMENSIONS).toBe(1536)
    expect(env.RAILWAY_GIT_COMMIT_SHA).toBe('dev')
  })

  it('coerces PORT and rejects out-of-range values', () => {
    expect(loadEnv({ ...base, PORT: '3000' }).PORT).toBe(3000)
    expect(errorOf(() => loadEnv({ ...base, PORT: '70000' })).names).toEqual([
      'PORT',
    ])
  })

  it('parses APP_ORIGINS into a trimmed list of exact origins', () => {
    const env = loadEnv({
      ...base,
      APP_ORIGINS: ' https://recipes.example.com , http://localhost:5173,',
    })
    expect(env.APP_ORIGINS).toEqual([
      'https://recipes.example.com',
      'http://localhost:5173',
    ])
  })

  it.each([
    ['a trailing slash', 'https://recipes.example.com/'],
    ['a path', 'https://recipes.example.com/app'],
    ['a query', 'https://recipes.example.com?x=1'],
    ['no scheme', 'recipes.example.com'],
    ['only separators', ' , '],
  ])('rejects APP_ORIGINS with %s without echoing the value', (_label, value) => {
    const error = errorOf(() => loadEnv({ ...base, APP_ORIGINS: value }))
    expect(error.names).toEqual(['APP_ORIGINS'])
    expect(error.message).not.toContain('recipes.example.com')
  })

  it('lower-cases and trims DEVELOPER_EMAILS, dropping empty entries', () => {
    const env = loadEnv({
      ...base,
      DEVELOPER_EMAILS: ' Brian@Example.com,, dev@EXAMPLE.org ',
    })
    expect(env.DEVELOPER_EMAILS).toEqual(['brian@example.com', 'dev@example.org'])
  })

  it('names a missing variable, counting an empty string as missing', () => {
    const error = errorOf(() => loadEnv({ ...base, CLERK_SECRET_KEY: '' }))
    expect(error.names).toEqual(['CLERK_SECRET_KEY'])
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
