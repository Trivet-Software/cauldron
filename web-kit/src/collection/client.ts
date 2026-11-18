// Plain-fetch client for the /v1 collection routes (01.7-walking-skeleton task
// 10.1, Requirements 7.2, 7.5). TanStack Query arrives with public-api-sdk.
import { useMemo } from 'react'
import { useApiClient } from '../auth'
import {
  type CaptureInput,
  type CaptureResult,
  type GoalDetail,
  type ItemDetail,
  type ItemEntry,
} from './types'

/** An API failure. `message` is the error envelope's message, safe to show to the user. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

/** The shape of `useApiClient(baseUrl)`'s result. */
export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

export interface CollectionClient {
  getGoal(slug: string): Promise<GoalDetail>
  capture(input: CaptureInput): Promise<CaptureResult>
  listItems(query: { goal: string; q?: string }): Promise<ItemEntry[]>
  getItem(id: string): Promise<ItemDetail>
}

async function toRequestError(res: Response): Promise<ApiRequestError> {
  const fallback = `Request failed (${res.status}).`
  try {
    const body: unknown = await res.json()
    const error = (body as { error?: { message?: unknown; code?: unknown } } | null)?.error
    if (error && typeof error.message === 'string' && error.message !== '') {
      return new ApiRequestError(
        error.message,
        typeof error.code === 'string' ? error.code : null,
        res.status,
      )
    }
  } catch {
    // Not JSON, so not an envelope.
  }
  return new ApiRequestError(fallback, null, res.status)
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw await toRequestError(res)
  return (await res.json()) as T
}

export function createCollectionClient(apiFetch: ApiFetch): CollectionClient {
  return {
    async getGoal(slug: string) {
      return readJson<GoalDetail>(await apiFetch(`/v1/goals/${encodeURIComponent(slug)}`))
    },

    async capture(input: CaptureInput) {
      // The browser sets the multipart Content-Type and boundary itself.
      const body = new FormData()
      body.set('goal', input.goal)
      body.set('client', 'web')
      if (input.text !== undefined) body.set('text', input.text)
      if (input.image !== undefined) body.set('image', input.image)
      return readJson<CaptureResult>(await apiFetch('/v1/captures', { method: 'POST', body }))
    },

    async listItems(query: { goal: string; q?: string }) {
      const params = new URLSearchParams({ goal: query.goal })
      if (query.q) params.set('q', query.q)
      const result = await readJson<{ items: ItemEntry[] }>(
        await apiFetch(`/v1/items?${params.toString()}`),
      )
      return result.items
    },

    async getItem(id: string) {
      return readJson<ItemDetail>(await apiFetch(`/v1/items/${encodeURIComponent(id)}`))
    },
  }
}

// Memoized so hooks that depend on the client don't refetch every render.
export function useCollectionClient(baseUrl: string): CollectionClient {
  const apiFetch = useApiClient(baseUrl)
  return useMemo(() => createCollectionClient(apiFetch), [apiFetch])
}
