import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateEnv } from './env'

describe('validateEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the publishable key when present', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_abc')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')

    expect(validateEnv()).toEqual({
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_abc',
      VITE_API_BASE_URL: 'https://api.example.com',
    })
  })

  it('throws an Error naming the variable when it is missing', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', undefined)
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', undefined)

    expect(() => validateEnv()).toThrow(Error)
    expect(() => validateEnv()).toThrow(/VITE_CLERK_PUBLISHABLE_KEY/)
  })

  it('treats an empty string as missing', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '')
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', '')

    expect(() => validateEnv()).toThrow(/VITE_CLERK_PUBLISHABLE_KEY/)
  })

  it('falls back to CLERK_PUBLISHABLE_KEY, as written by `clerk env pull`', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', undefined)
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', 'pk_test_from_cli')

    expect(validateEnv().VITE_CLERK_PUBLISHABLE_KEY).toBe('pk_test_from_cli')
  })

  it('defaults VITE_API_BASE_URL to an empty string when unset', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_abc')
    vi.stubEnv('VITE_API_BASE_URL', undefined)

    expect(validateEnv().VITE_API_BASE_URL).toBe('')
  })
})
