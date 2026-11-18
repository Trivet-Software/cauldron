import { type CollectionClient, type GoalField, type ItemDetail as ItemDetailData, useGoal, useItem } from '../../collection'
import { cn } from '../../lib/utils'

// 01.7-walking-skeleton Requirement 7.4: every field of the goal's schema is
// rendered by its kind, with no app-specific code. Requirement 7.5: a failed
// request shows the error envelope's message.
export interface ItemDetailProps {
  client: CollectionClient
  itemId: string
  className?: string
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

function FieldValue({ field, value, title }: { field: GoalField; value: unknown; title: string }) {
  if (isBlank(value)) return <p className="text-sm text-muted-foreground">—</p>

  switch (field.kind) {
    case 'list':
      return (
        <ul className="list-disc pl-5 text-sm text-foreground">
          {(Array.isArray(value) ? value : [value]).map((entry, index) => (
            <li key={index}>{String(entry)}</li>
          ))}
        </ul>
      )
    case 'image':
      // The API replaces the stored path with a short-lived signed URL.
      return (
        <img
          src={String(value)}
          alt={`${field.label} for ${title}`}
          className="max-h-96 rounded-md border object-contain"
        />
      )
    case 'long-text':
      return <p className="whitespace-pre-wrap text-sm text-foreground">{String(value)}</p>
    case 'text':
      return <p className="text-sm text-foreground">{String(value)}</p>
  }
}

function ItemFields({ client, item, className }: { client: CollectionClient; item: ItemDetailData; className?: string }) {
  const goal = useGoal(client, item.goal.slug)

  return (
    <article className={cn('flex flex-col gap-4', className)}>
      <h1 className="text-2xl font-semibold text-foreground">{item.title}</h1>
      {goal.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {goal.error.message}
        </p>
      )}
      {goal.data === null ? (
        goal.loading && <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <dl className="flex flex-col gap-4">
          {goal.data.fields
            .filter((field) => !field.isTitle)
            .map((field) => (
              <div key={field.key} className="flex flex-col gap-1">
                <dt className="text-sm font-medium text-muted-foreground">{field.label}</dt>
                <dd>
                  <FieldValue field={field} value={item.data[field.key]} title={item.title} />
                </dd>
              </div>
            ))}
        </dl>
      )}
    </article>
  )
}

export function ItemDetail({ client, itemId, className }: ItemDetailProps) {
  const item = useItem(client, itemId)

  if (item.error !== null) {
    return (
      <p role="alert" className={cn('text-sm text-destructive', className)}>
        {item.error.message}
      </p>
    )
  }
  if (item.data === null) {
    return <p className={cn('text-sm text-muted-foreground', className)}>Loading…</p>
  }
  // The goal slug comes from the item, so the fields load once it has.
  return <ItemFields client={client} item={item.data} className={className} />
}
