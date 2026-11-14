import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateEnv } from './env'

describe('validateEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns both values when present', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_abc')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')

    expect(validateEnv()).toEqual({
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_abc',
      VITE_API_BASE_URL: 'https://api.example.com',
    })
  })

  it('throws an Error naming the publishable key when it is missing', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', undefined)
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', undefined)
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')

    expect(() => validateEnv()).toThrow(Error)
    expect(() => validateEnv()).toThrow(/VITE_CLERK_PUBLISHABLE_KEY/)
  })

  it('treats an empty publishable key as missing', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '')
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')

    expect(() => validateEnv()).toThrow(/VITE_CLERK_PUBLISHABLE_KEY/)
  })

  it('falls back to CLERK_PUBLISHABLE_KEY, as written by `clerk env pull`', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', undefined)
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', 'pk_test_from_cli')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')

    expect(validateEnv().VITE_CLERK_PUBLISHABLE_KEY).toBe('pk_test_from_cli')
  })

  it('throws naming VITE_API_BASE_URL when it is missing', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_abc')
    vi.stubEnv('VITE_API_BASE_URL', undefined)

    expect(() => validateEnv()).toThrow(/VITE_API_BASE_URL/)
    expect(() => validateEnv()).not.toThrow(/VITE_CLERK_PUBLISHABLE_KEY/)
  })

  it('treats an empty VITE_API_BASE_URL as missing', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_abc')
    vi.stubEnv('VITE_API_BASE_URL', '')

    expect(() => validateEnv()).toThrow(/VITE_API_BASE_URL/)
  })

  it('names every missing variable in one error', () => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '')
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', '')
    vi.stubEnv('VITE_API_BASE_URL', '')

    expect(() => validateEnv()).toThrow(
      /VITE_CLERK_PUBLISHABLE_KEY.*VITE_API_BASE_URL/,
    )
  })
})
