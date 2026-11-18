import { type ReactNode, useEffect, useRef, useState } from 'react'
import { type CollectionClient, type CompileState, type ItemEntry, useItems } from '../../collection'
import { cn } from '../../lib/utils'

// 01.7-walking-skeleton Requirements 7.2, 7.3, 7.5: items with title and
// compile state, polled while pending, searched through GET /v1/items?q=.
export const SEARCH_DEBOUNCE_MS = 250

const STATE_LABELS: Record<CompileState, string> = {
  queued: 'Queued',
  extracting: 'Extracting',
  ready: 'Ready',
  failed: 'Failed',
}

const STATE_STYLES: Record<CompileState, string> = {
  queued: 'bg-muted text-muted-foreground',
  extracting: 'bg-muted text-muted-foreground',
  ready: 'bg-secondary text-secondary-foreground',
  failed: 'bg-destructive text-destructive-foreground',
}

export interface ItemListProps {
  client: CollectionClient
  goal: string
  /** Wraps a ready row's title so the app can supply its router link. */
  renderLink: (entry: ItemEntry, children: ReactNode) => ReactNode
  /** Bump this (e.g. after a capture) to reload the list and resume polling. */
  refreshKey?: number
  className?: string
}

function StateBadge({ state }: { state: CompileState }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATE_STYLES[state])}>
      {STATE_LABELS[state]}
    </span>
  )
}

export function ItemList({ client, goal, renderLink, refreshKey = 0, className }: ItemListProps) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const { data, error, loading, refresh } = useItems(client, goal, q)

  // The first load is useItems' own; only later bumps trigger a refresh.
  const lastRefreshKey = useRef(refreshKey)
  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return
    lastRefreshKey.current = refreshKey
    refresh()
  }, [refreshKey, refresh])

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by title"
        aria-label="Search items"
        className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {data === null ? (
        loading && <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q === '' ? 'Nothing saved yet.' : 'No items match your search.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {data.map((entry) => (
            <li key={entry.sourceId} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {entry.state === 'ready' ? renderLink(entry, entry.title) : entry.title}
                </span>
                <StateBadge state={entry.state} />
              </div>
              {entry.state === 'failed' && entry.failureReason !== null && (
                <p className="text-sm text-destructive">{entry.failureReason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
