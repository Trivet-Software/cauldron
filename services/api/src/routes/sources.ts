// `GET /v1/sources/{id}` (01.7-walking-skeleton task 6.8, Requirements 4.1 and
// 4.2): the compile state of one capture. A missing source and another
// tenant's are the same 404 to the caller; RLS makes them identical.
import { type OpenAPIHono, z } from '@hono/zod-openapi'
import { type CollectionStore } from '@cauldron/core/collection'
import { type AppBindings } from '../http/bindings'
import { defineRoute } from '../http/define-route'
import { ApiError } from '../http/errors'
import { errorResponses } from '../http/openapi'
import { userActorOf } from './actor'

export const CompileStateSchema = z
  .enum(['queued', 'extracting', 'ready', 'failed'])
  .openapi('CompileState')

export const SourceStatusSchema = z
  .object({
    id: z.uuid(),
    goal: z.string().openapi({ example: 'recipe-box', description: 'Goal slug.' }),
    kind: z.enum(['text', 'photo']),
    client: z.enum(['web', 'mcp', 'api']),
    capturedAt: z.iso.datetime(),
    state: CompileStateSchema,
    failureReason: z.string().nullable(),
    itemId: z.uuid().nullable(),
  })
  .openapi('SourceStatus')

export const getSourceRoute = defineRoute({
  method: 'get',
  path: '/sources/{id}',
  summary: 'The compile state of one capture',
  request: {
    params: z.object({
      id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }),
    }),
  },
  responses: {
    200: {
      description: 'The source and its compile state.',
      content: { 'application/json': { schema: SourceStatusSchema } },
    },
    ...errorResponses(400, 401, 404, 503),
  },
})

export interface SourcesDeps {
  collection: CollectionStore
}

export function registerSources(v1: OpenAPIHono<AppBindings>, deps: SourcesDeps): void {
  v1.openapi(getSourceRoute, async (c) => {
    const { id } = c.req.valid('param')
    const source = await deps.collection.getSource(userActorOf(c), id)
    if (!source) throw new ApiError(404, 'not_found', 'No such capture.')
    return c.json(source, 200)
  })
}
