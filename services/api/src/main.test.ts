// Startup failure paths (01.5-backend-foundation task 9.8, Requirement 8.3).
// Both fail before any port or connection opens, so no server is started here.
import { describe, expect, it, vi } from 'vitest'
import { EMBEDDING_COLUMN_DIMENSIONS } from '@cauldron/core/db'
import { StartupError, checkEmbeddingDimensions, main } from './main'

describe('main', () => {
  it('names missing variables on stderr, without values, and exits 1', () => {
    const exit = vi.fn()
    const writeStderr = vi.fn()
    const running = main({ CLERK_SECRET_KEY: 'sk_test_secret' }, { exit, writeStderr })

    expect(running).toBeUndefined()
    expect(exit).toHaveBeenCalledWith(1)
    const message = writeStderr.mock.calls.map(([text]) => text).join('')
    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('APP_ORIGINS')
    expect(message).not.toContain('sk_test_secret')
  })
})

describe('checkEmbeddingDimensions', () => {
  it('accepts the column size', () => {
    expect(() => checkEmbeddingDimensions(EMBEDDING_COLUMN_DIMENSIONS)).not.toThrow()
  })

  it('rejects any other size, naming both numbers', () => {
    expect(() => checkEmbeddingDimensions(768)).toThrow(StartupError)
    expect(() => checkEmbeddingDimensions(768)).toThrow(
      new RegExp(`768.*${EMBEDDING_COLUMN_DIMENSIONS}`),
    )
  })
})
