// `GET /v1/goals` and `GET /v1/goals/{slug}` (01.7-walking-skeleton task 6.6,
// Requirement 1.7). Anonymous: app goals are readable by everyone under RLS
// (`goals_system_read`), and the SPA and MCP server need them before or
// without a session. The repository returns app goals only, so a developer's
// drafts never appear.
import { type OpenAPIHono, z } from '@hono/zod-openapi'
import { type CollectionStore, type GoalRecord } from '@cauldron/core/collection'
import { goalFields } from '@cauldron/core/goals'
import { actorFor } from '../auth/principal'
import { type AppBindings } from '../http/bindings'
import { defineRoute } from '../http/define-route'
import { ApiError } from '../http/errors'
import { errorResponses } from '../http/openapi'

export const GoalFieldSchema = z
  .object({
    key: z.string().openapi({ example: 'title' }),
    label: z.string().openapi({ example: 'Title' }),
    kind: z.enum(['text', 'long-text', 'list', 'image']),
    required: z.boolean(),
    isTitle: z.boolean(),
  })
  .openapi('GoalField')

export const GoalSummarySchema = z
  .object({
    slug: z.string().openapi({ example: 'recipe-box' }),
    name: z.string().openapi({ example: 'Recipe Box' }),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    accentColor: z.string().nullable(),
    version: z.number().int(),
    fields: z.array(GoalFieldSchema),
  })
  .openapi('GoalSummary')

export const GoalDetailSchema = GoalSummarySchema.extend({
  // The goal file as registered. Typed loosely here; `@cauldron/core/goals`
  // owns its shape and goal-engine will extend it.
  spec: z.record(z.string(), z.unknown()),
}).openapi('GoalDetail')

export type GoalSummary = z.infer<typeof GoalSummarySchema>
export type GoalDetail = z.infer<typeof GoalDetailSchema>

export function toGoalSummary(goal: GoalRecord): GoalSummary {
  return {
    slug: goal.slug,
    name: goal.name,
    description: goal.description,
    icon: goal.icon,
    accentColor: goal.accentColor,
    version: goal.version,
    fields: goalFields(goal.spec),
  }
}

export function toGoalDetail(goal: GoalRecord): GoalDetail {
  return { ...toGoalSummary(goal), spec: goal.spec }
}

export const listGoalsRoute = defineRoute({
  method: 'get',
  path: '/goals',
  access: 'anonymous',
  summary: 'List the app goals',
  responses: {
    200: {
      description: 'Every app goal, by name.',
      content: { 'application/json': { schema: z.object({ goals: z.array(GoalSummarySchema) }) } },
    },
    ...errorResponses(401, 503),
  },
})

export const getGoalRoute = defineRoute({
  method: 'get',
  path: '/goals/{slug}',
  access: 'anonymous',
  summary: 'One app goal, with its goal file',
  request: {
    params: z.object({
      slug: z.string().min(1).max(100).openapi({ param: { name: 'slug', in: 'path' }, example: 'recipe-box' }),
    }),
  },
  responses: {
    200: {
      description: 'The goal summary plus its goal file.',
      content: { 'application/json': { schema: GoalDetailSchema } },
    },
    ...errorResponses(401, 404, 503),
  },
})

export interface GoalsDeps {
  collection: CollectionStore
}

export function registerGoals(v1: OpenAPIHono<AppBindings>, deps: GoalsDeps): void {
  v1.openapi(listGoalsRoute, async (c) => {
    const goals = await deps.collection.listGoals(actorFor(c.get('principal') ?? { kind: 'anonymous' }))
    return c.json({ goals: goals.map(toGoalSummary) }, 200)
  })

  v1.openapi(getGoalRoute, async (c) => {
    const { slug } = c.req.valid('param')
    const goal = await deps.collection.getGoal(
      actorFor(c.get('principal') ?? { kind: 'anonymous' }),
      slug,
    )
    if (!goal) throw new ApiError(404, 'not_found', 'No such goal.')
    return c.json(toGoalDetail(goal), 200)
  })
}
