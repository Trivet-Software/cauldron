/**
 * Protected items screen: capture form above the item list. A successful
 * capture bumps the list's `refreshKey` so the new entry appears and polling
 * resumes until it is `ready` or `failed`.
 *
 * Requirements: 01.7-walking-skeleton 7.1, 7.2, 7.3, 7.7.
 */
import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CaptureForm, ItemList } from 'web-kit/components'
import { useCollectionClient } from 'web-kit/collection'
import { GOAL_SLUG } from '../../lib/goal'
import { validateEnv } from '../../lib/env'

export const Route = createFileRoute('/_auth/items/')({
  component: ItemsComponent,
})

function ItemsComponent() {
  const env = validateEnv()
  const client = useCollectionClient(env.VITE_API_BASE_URL)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Items</h1>
      <CaptureForm
        client={client}
        goal={GOAL_SLUG}
        onCaptured={() => setRefreshKey((key) => key + 1)}
      />
      <ItemList
        client={client}
        goal={GOAL_SLUG}
        refreshKey={refreshKey}
        renderLink={(entry, children) =>
          // Only ready rows are linked, and those always have an item id.
          entry.id ? (
            <Link to="/items/$itemId" params={{ itemId: entry.id }} className="underline">
              {children}
            </Link>
          ) : (
            children
          )
        }
      />
    </main>
  )
}
