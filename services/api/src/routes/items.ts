// `GET /v1/items` and `GET /v1/items/{id}` (01.7-walking-skeleton task 6.8,
// Requirements 6.1 to 6.5). Every read goes through the collection store with
// the caller's own actor, so RLS limits it to their tenant. A missing item and
// another tenant's are the same 404. The detail response never carries a raw
// storage path: the image field holds a short-lived signed URL.
import { type OpenAPIHono, z } from '@hono/zod-openapi'
import { type CollectionStore } from '@cauldron/core/collection'
import { type Logger } from 'pino'
import { type AppBindings } from '../http/bindings'
import { defineRoute } from '../http/define-route'
import { ApiError } from '../http/errors'
import { errorResponses } from '../http/openapi'
import { type StorageFor, requestStorage } from '../storage'
import { userActorOf } from './actor'
import { CompileStateSchema } from './sources'

export const DEFAULT_ITEM_LIMIT = 50
export const MAX_ITEM_LIMIT = 100
/** Lifetime of the signed image URL (Requirement 6.3 allows up to 10 minutes). */
export const IMAGE_URL_SECONDS = 300

export const ItemEntrySchema = z
  .object({
    id: z.uuid().nullable().openapi({ description: 'Null until the capture has compiled.' }),
    sourceId: z.uuid(),
    title: z.string().openapi({ description: 'The item title, or the capture label while pending or failed.' }),
    state: CompileStateSchema,
    failureReason: z.string().nullable(),
    capturedAt: z.iso.datetime(),
  })
  .openapi('ItemEntry')

export const ItemDetailSchema = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    goal: z.object({
      slug: z.string(),
      name: z.string(),
      version: z.number().int(),
    }),
    title: z.string(),
    state: z.literal('ready'),
    data: z
      .record(z.string(), z.unknown())
      .openapi({ description: "The item's fields. The image field's value is a signed URL that expires in 5 minutes." }),
    capturedAt: z.iso.datetime(),
  })
  .openapi('ItemDetail')

export type ItemDetail = z.infer<typeof ItemDetailSchema>

export const listItemsRoute = defineRoute({
  method: 'get',
  path: '/items',
  summary: "List the caller's items for a goal, or search them by title",
  request: {
    query: z.object({
      goal: z.string().min(1).max(100).openapi({ example: 'recipe-box', description: 'Goal slug.' }),
      q: z
        .string()
        .max(200)
        .optional()
        .openapi({ description: 'Case-insensitive title match, best match first. Omit to list newest first.' }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_ITEM_LIMIT)
        .default(DEFAULT_ITEM_LIMIT)
        .openapi({ type: 'integer', minimum: 1, maximum: MAX_ITEM_LIMIT, default: DEFAULT_ITEM_LIMIT }),
    }),
  },
  responses: {
    200: {
      description: 'One entry per capture, including pending and failed ones.',
      content: { 'application/json': { schema: z.object({ items: z.array(ItemEntrySchema) }) } },
    },
    ...errorResponses(400, 401, 503),
  },
})

export const getItemRoute = defineRoute({
  method: 'get',
  path: '/items/{id}',
  summary: 'One item, with a signed URL for its image',
  request: {
    params: z.object({
      id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }),
    }),
  },
  responses: {
    200: {
      description: 'The item and its fields.',
      content: { 'application/json': { schema: ItemDetailSchema } },
    },
    ...errorResponses(400, 401, 404, 503),
  },
})

export interface ItemsDeps {
  collection: CollectionStore
  storageFor: StorageFor
  logger: Logger
}

export function registerItems(v1: OpenAPIHono<AppBindings>, deps: ItemsDeps): void {
  v1.openapi(listItemsRoute, async (c) => {
    const { goal, q, limit } = c.req.valid('query')
    const actor = userActorOf(c)

    const goals = await deps.collection.listGoals(actor)
    if (!goals.some((candidate) => candidate.slug === goal)) {
      const slugs = goals.map((candidate) => candidate.slug)
      throw new ApiError(
        400,
        'bad_request',
        `Unknown goal. Available goals: ${slugs.join(', ')}.`,
        slugs,
      )
    }

    const items = await deps.collection.listItems(actor, {
      goalSlug: goal,
      ...(q !== undefined && q.trim() !== '' ? { q } : {}),
      limit,
    })
    return c.json({ items }, 200)
  })

  v1.openapi(getItemRoute, async (c) => {
    const { id } = c.req.valid('param')
    const actor = userActorOf(c)

    const item = await deps.collection.getItem(actor, id)
    if (!item) throw new ApiError(404, 'not_found', 'No such item.')
    const goal = await deps.collection.getGoal(actor, item.goalSlug)

    // The repository read the image field with the spec of the version the item
    // was saved under and reports its stored value as `imagePath`. Swap that
    // value, wherever it sits in `data`, for a signed URL.
    const data: Record<string, unknown> = { ...item.data }
    if (item.imagePath !== null) {
      const url = await requestStorage(c, deps.storageFor).signedReadUrl(
        item.imagePath,
        IMAGE_URL_SECONDS,
      )
      for (const [key, value] of Object.entries(data)) {
        if (value === item.imagePath) data[key] = url
      }
    }

    const detail: ItemDetail = {
      id: item.id,
      sourceId: item.sourceId,
      goal: {
        slug: item.goalSlug,
        // The slug is all the item row carries. The name is display only, so a
        // goal that has since gone unreadable falls back to the slug.
        name: goal?.name ?? item.goalSlug,
        version: item.goalVersion,
      },
      title: item.title,
      state: 'ready',
      data,
      capturedAt: item.capturedAt,
    }
    return c.json(detail, 200)
  })
}
