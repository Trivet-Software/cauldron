import { useCallback } from 'react'
import { useAuth } from '@clerk/react'

// The API runs on its own origin, so callers pass its base URL (Recipe Box
// reads VITE_API_BASE_URL). `new URL(path, baseUrl)` resolves the path
// against it; an absolute path such as `/v1/me` replaces any base path.
// Memoized so effects that depend on the client don't re-run every render
// (01.5-backend-foundation task 11.1, Requirement 9.2).
export function useApiClient(baseUrl: string) {
  const { getToken } = useAuth()
  return useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getToken()
      return fetch(new URL(path, baseUrl), {
        ...init,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      })
    },
    [getToken, baseUrl],
  )
}
