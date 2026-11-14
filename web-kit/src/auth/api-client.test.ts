import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useApiClient } from './api-client'

const getToken = vi.fn()

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken }),
}))

const BASE_URL = 'https://api.example.test'

// Validates Requirement 3.6 (foundation) and Requirement 9.2 (backend-foundation)
describe('useApiClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response('ok'))
    getToken.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function lastUrl(): string {
    return String(fetchMock.mock.calls[0][0])
  }

  function lastHeaders(): Record<string, string> {
    const init = fetchMock.mock.calls[0][1] as RequestInit
    return init.headers as Record<string, string>
  }

  it('sends a Bearer Authorization header when a token exists', async () => {
    getToken.mockResolvedValue('tok_abc')
    const { result } = renderHook(() => useApiClient(BASE_URL))

    await result.current('/v1/me')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastHeaders().Authorization).toBe('Bearer tok_abc')
  })

  it('omits the Authorization header when the token is null', async () => {
    getToken.mockResolvedValue(null)
    const { result } = renderHook(() => useApiClient(BASE_URL))

    await result.current('/v1/me')

    expect(lastHeaders()).not.toHaveProperty('Authorization')
  })

  it('preserves caller-supplied headers and other init fields', async () => {
    getToken.mockResolvedValue('tok_abc')
    const { result } = renderHook(() => useApiClient(BASE_URL))

    await result.current('/v1/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(lastHeaders()).toEqual({
      Authorization: 'Bearer tok_abc',
      'Content-Type': 'application/json',
    })
  })

  it('resolves the path against the base URL', async () => {
    getToken.mockResolvedValue(null)
    const { result } = renderHook(() => useApiClient(BASE_URL))

    await result.current('/v1/me?x=1')

    expect(lastUrl()).toBe('https://api.example.test/v1/me?x=1')
  })

  it('returns the same function across renders until the base URL changes', () => {
    const { result, rerender } = renderHook(
      ({ baseUrl }) => useApiClient(baseUrl),
      { initialProps: { baseUrl: BASE_URL } },
    )
    const first = result.current

    rerender({ baseUrl: BASE_URL })
    expect(result.current).toBe(first)

    rerender({ baseUrl: 'https://other.example.test' })
    expect(result.current).not.toBe(first)
  })
})
