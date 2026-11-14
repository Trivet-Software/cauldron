// Unit tests for parseEnv and the provider fragments
// (01.5-backend-foundation task 1.5, Requirement 8.3).
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  EnvError,
  parseEnv,
  providerEnvSchema,
} from './index'

const schema = z.object({
  DATABASE_URL: z.string(),
  CLERK_SECRET_KEY: z.string(),
  PORT: z.coerce.number().int().positive(),
})

function captureEnvError(fn: () => unknown): EnvError {
  try {
    fn()
  } catch (error) {
    if (error instanceof EnvError) return error
    throw error
  }
  throw new Error('expected parseEnv to throw EnvError')
}

describe('parseEnv', () => {
  it('returns the parsed values when every variable is present', () => {
    const env = parseEnv(schema, {
      DATABASE_URL: 'postgres://localhost/db',
      CLERK_SECRET_KEY: 'sk_test_abc',
      PORT: '8080',
    })
    expect(env).toEqual({
      DATABASE_URL: 'postgres://localhost/db',
      CLERK_SECRET_KEY: 'sk_test_abc',
      PORT: 8080,
    })
  })

  it('names a single missing variable', () => {
    const error = captureEnvError(() =>
      parseEnv(schema, { DATABASE_URL: 'postgres://x', PORT: '1' }),
    )
    expect(error.names).toEqual(['CLERK_SECRET_KEY'])
    expect(error.message).toContain('CLERK_SECRET_KEY')
  })

  it('treats an empty string as missing', () => {
    const error = captureEnvError(() =>
      parseEnv(schema, {
        DATABASE_URL: '',
        CLERK_SECRET_KEY: 'sk_test_abc',
        PORT: '1',
      }),
    )
    expect(error.names).toEqual(['DATABASE_URL'])
  })

  it('lists every missing or invalid name, sorted', () => {
    const error = captureEnvError(() => parseEnv(schema, { PORT: 'not-a-number' }))
    expect(error.names).toEqual(['CLERK_SECRET_KEY', 'DATABASE_URL', 'PORT'])
    expect(error.message).toContain('CLERK_SECRET_KEY, DATABASE_URL, PORT')
  })

  it('never includes variable values in the error message', () => {
    const secret = 'sk_live_super_secret_value'
    const error = captureEnvError(() =>
      parseEnv(schema, { CLERK_SECRET_KEY: secret, PORT: 'bad-port-value' }),
    )
    expect(error.message).not.toContain(secret)
    expect(error.message).not.toContain('bad-port-value')
  })
})

describe('providerEnvSchema', () => {
  const openrouterKeys = {
    OPENROUTER_API_KEY: 'or-key-123',
    LLM_COMPILE_MODEL: 'compile-model',
    LLM_DRAFT_MODEL: 'draft-model',
  }

  it('accepts mock mode with only MOCK_RECORDINGS_DIR and applies embedding defaults', () => {
    const env = parseEnv(providerEnvSchema, {
      PROVIDERS: 'mock',
      MOCK_RECORDINGS_DIR: './recordings',
    })
    expect(env.PROVIDERS).toBe('mock')
    expect(env.OPENROUTER_API_KEY).toBeUndefined()
    expect(env.EMBEDDING_MODEL).toBe(DEFAULT_EMBEDDING_MODEL)
    expect(env.EMBEDDING_DIMENSIONS).toBe(DEFAULT_EMBEDDING_DIMENSIONS)
  })

  it('requires MOCK_RECORDINGS_DIR in mock mode', () => {
    const error = captureEnvError(() =>
      parseEnv(providerEnvSchema, { PROVIDERS: 'mock' }),
    )
    expect(error.names).toEqual(['MOCK_RECORDINGS_DIR'])
  })

  it('accepts openrouter mode with its keys and no recordings dir', () => {
    const env = parseEnv(providerEnvSchema, {
      PROVIDERS: 'openrouter',
      ...openrouterKeys,
    })
    expect(env.PROVIDERS).toBe('openrouter')
    expect(env.MOCK_RECORDINGS_DIR).toBeUndefined()
  })

  it('requires the OpenRouter key and models in openrouter mode', () => {
    const error = captureEnvError(() =>
      parseEnv(providerEnvSchema, { PROVIDERS: 'openrouter' }),
    )
    expect(error.names).toEqual([
      'LLM_COMPILE_MODEL',
      'LLM_DRAFT_MODEL',
      'OPENROUTER_API_KEY',
    ])
  })

  it('requires all four provider variables in record mode', () => {
    const error = captureEnvError(() =>
      parseEnv(providerEnvSchema, { PROVIDERS: 'record' }),
    )
    expect(error.names).toEqual([
      'LLM_COMPILE_MODEL',
      'LLM_DRAFT_MODEL',
      'MOCK_RECORDINGS_DIR',
      'OPENROUTER_API_KEY',
    ])

    const env = parseEnv(providerEnvSchema, {
      PROVIDERS: 'record',
      MOCK_RECORDINGS_DIR: './recordings',
      ...openrouterKeys,
    })
    expect(env.PROVIDERS).toBe('record')
  })

  it('reports conditional names alongside other invalid fields', () => {
    const error = captureEnvError(() =>
      parseEnv(providerEnvSchema, {
        PROVIDERS: 'mock',
        EMBEDDING_DIMENSIONS: 'zero',
      }),
    )
    expect(error.names).toEqual(['EMBEDDING_DIMENSIONS', 'MOCK_RECORDINGS_DIR'])
  })

  it('reports an unknown PROVIDERS value without leaking it', () => {
    const error = captureEnvError(() =>
      parseEnv(providerEnvSchema, { PROVIDERS: 'secret-mode-xyz' }),
    )
    expect(error.names).toEqual(['PROVIDERS'])
    expect(error.message).not.toContain('secret-mode-xyz')
  })

  it('does not leak the OpenRouter key when other provider vars are missing', () => {
    const error = captureEnvError(() =>
      parseEnv(providerEnvSchema, {
        PROVIDERS: 'openrouter',
        OPENROUTER_API_KEY: 'or-very-secret-key',
      }),
    )
    expect(error.names).toEqual(['LLM_COMPILE_MODEL', 'LLM_DRAFT_MODEL'])
    expect(error.message).not.toContain('or-very-secret-key')
  })
})
