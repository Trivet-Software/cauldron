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

// 01.7-walking-skeleton Requirements 8.4 and 8.5.
describe('loadEnv, dev auth mode', () => {
  const token32 = 'x'.repeat(32)
  const dev = {
    ...base,
    AUTH_MODE: 'dev',
    DEV_API_TOKEN: token32,
    DEV_USER_ID: 'user_dev',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
  }

  it('leaves every dev variable optional when AUTH_MODE is unset or clerk', () => {
    expect(loadEnv(base).AUTH_MODE).toBeUndefined()
    expect(loadEnv({ ...base, AUTH_MODE: 'clerk' }).AUTH_MODE).toBe('clerk')
  })

  it('accepts a complete dev configuration', () => {
    const env = loadEnv(dev)
    expect(env.AUTH_MODE).toBe('dev')
    expect(env.DEV_API_TOKEN).toBe(token32)
    expect(env.DEV_USER_ID).toBe('user_dev')
    expect(env.SUPABASE_SECRET_KEY).toBe('sb_secret_test')
  })

  it('rejects an AUTH_MODE other than clerk or dev', () => {
    expect(errorOf(() => loadEnv({ ...base, AUTH_MODE: 'none' })).names).toEqual(['AUTH_MODE'])
  })

  it.each(['DEV_API_TOKEN', 'DEV_USER_ID', 'SUPABASE_SECRET_KEY'])(
    'names %s when AUTH_MODE=dev and it is missing',
    (name) => {
      const source: Record<string, string> = { ...dev }
      delete source[name]
      expect(errorOf(() => loadEnv(source)).names).toEqual([name])
    },
  )

  it('counts an empty string as missing', () => {
    expect(errorOf(() => loadEnv({ ...dev, DEV_USER_ID: '' })).names).toEqual(['DEV_USER_ID'])
  })

  it('names every missing dev variable at once', () => {
    const error = errorOf(() => loadEnv({ ...base, AUTH_MODE: 'dev' }))
    expect(error.names).toEqual(['DEV_API_TOKEN', 'DEV_USER_ID', 'SUPABASE_SECRET_KEY'])
  })

  it('rejects a 31-character DEV_API_TOKEN and accepts 32', () => {
    expect(loadEnv({ ...dev, DEV_API_TOKEN: 'x'.repeat(32) }).DEV_API_TOKEN).toHaveLength(32)
    const error = errorOf(() => loadEnv({ ...dev, DEV_API_TOKEN: 'x'.repeat(31) }))
    expect(error.names).toEqual(['DEV_API_TOKEN'])
  })

  it('never echoes the token in the error', () => {
    const short = 'short-secret-token'
    const error = errorOf(() => loadEnv({ ...dev, DEV_API_TOKEN: short }))
    expect(error.message).not.toContain(short)
  })

  it('does not require the dev variables, or a minimum length, outside dev mode', () => {
    expect(loadEnv({ ...base, DEV_API_TOKEN: 'short' }).DEV_API_TOKEN).toBe('short')
  })

  it('passes NODE_ENV and RAILWAY_ENVIRONMENT through, absent by default', () => {
    expect(loadEnv(base).NODE_ENV).toBeUndefined()
    expect(loadEnv(base).RAILWAY_ENVIRONMENT).toBeUndefined()
    const env = loadEnv({ ...base, NODE_ENV: 'production', RAILWAY_ENVIRONMENT: 'production' })
    expect(env.NODE_ENV).toBe('production')
    expect(env.RAILWAY_ENVIRONMENT).toBe('production')
  })
})
