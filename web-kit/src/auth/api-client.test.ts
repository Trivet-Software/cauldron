import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useApiClient } from './api-client'

const getToken = vi.fn()

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken }),
}))

// Validates Requirement 3.6
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

  function lastHeaders(): Record<string, string> {
    const init = fetchMock.mock.calls[0][1] as RequestInit
    return init.headers as Record<string, string>
  }

  it('sends a Bearer Authorization header when a token exists', async () => {
    getToken.mockResolvedValue('tok_abc')
    const { result } = renderHook(() => useApiClient())

    await result.current('/api/things')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/things')
    expect(lastHeaders().Authorization).toBe('Bearer tok_abc')
  })

  it('omits the Authorization header when the token is null', async () => {
    getToken.mockResolvedValue(null)
    const { result } = renderHook(() => useApiClient())

    await result.current('/api/things')

    expect(lastHeaders()).not.toHaveProperty('Authorization')
  })

  it('preserves caller-supplied headers and other init fields', async () => {
    getToken.mockResolvedValue('tok_abc')
    const { result } = renderHook(() => useApiClient())

    await result.current('/api/things', {
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
})
