// Data hooks over the collection client (01.7-walking-skeleton task 10.1,
// Requirements 7.2, 7.5).
import { useCallback, useEffect, useState } from 'react'
import { type CollectionClient } from './client'
import { type GoalDetail, type ItemDetail, type ItemEntry } from './types'

export interface AsyncState<T> {
  data: T | null
  error: Error | null
  loading: boolean
}

export const DEFAULT_POLL_MS = 2000

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Request failed.')
}

function isPending(entry: ItemEntry): boolean {
  return entry.state === 'queued' || entry.state === 'extracting'
}

function useAsync<T>(load: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true })
  useEffect(() => {
    let cancelled = false
    setState({ data: null, error: null, loading: true })
    load().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false })
      },
      (error: unknown) => {
        if (!cancelled) setState({ data: null, error: toError(error), loading: false })
      },
    )
    return () => {
      cancelled = true
    }
  }, [load])
  return state
}

export function useGoal(client: CollectionClient, slug: string): AsyncState<GoalDetail> {
  const load = useCallback(() => client.getGoal(slug), [client, slug])
  return useAsync(load)
}

export function useItem(client: CollectionClient, id: string): AsyncState<ItemDetail> {
  const load = useCallback(() => client.getItem(id), [client, id])
  return useAsync(load)
}

/**
 * Lists a goal's items, newest first. While any entry is `queued` or
 * `extracting` it refetches every `pollMs`; it stops once none are, and on
 * unmount. A failed refetch stops polling and keeps the last data; `refresh()`
 * starts it again (Requirement 7.2).
 */
export function useItems(
  client: CollectionClient,
  goal: string,
  q: string,
  opts: { pollMs?: number } = {},
): AsyncState<ItemEntry[]> & { refresh(): void } {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS
  const [state, setState] = useState<AsyncState<ItemEntry[]>>({
    data: null,
    error: null,
    loading: true,
  })
  const [generation, setGeneration] = useState(0)
  const refresh = useCallback(() => setGeneration((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function load() {
      try {
        const items = await client.listItems({ goal, q })
        if (cancelled) return
        setState({ data: items, error: null, loading: false })
        if (items.some(isPending)) timer = setTimeout(() => void load(), pollMs)
      } catch (error) {
        if (cancelled) return
        setState((prev) => ({ data: prev.data, error: toError(error), loading: false }))
      }
    }

    // Keep the previous rows on screen while a new query loads.
    setState((prev) => ({ data: prev.data, error: null, loading: true }))
    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, goal, q, pollMs, generation])

  return { ...state, refresh }
}
