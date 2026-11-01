import { useAuth } from '@clerk/react'

export function useApiClient() {
  const { getToken } = useAuth()
  return async (path: string, init: RequestInit = {}) => {
    const token = await getToken()
    return fetch(path, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  }
}
