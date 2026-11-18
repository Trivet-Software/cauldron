/**
 * Protected item detail. Fields render generically from the goal's schema.
 *
 * Requirements: 01.7-walking-skeleton 7.4, 7.7.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { ItemDetail } from 'web-kit/components'
import { useCollectionClient } from 'web-kit/collection'
import { validateEnv } from '../../lib/env'

export const Route = createFileRoute('/_auth/items/$itemId')({
  component: ItemDetailComponent,
})

function ItemDetailComponent() {
  const { itemId } = Route.useParams()
  const env = validateEnv()
  const client = useCollectionClient(env.VITE_API_BASE_URL)

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <Link to="/items" className="text-sm underline">
        Back to items
      </Link>
      <ItemDetail client={client} itemId={itemId} />
    </main>
  )
}
