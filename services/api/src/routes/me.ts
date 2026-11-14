// `GET /v1/me` (01.5-backend-foundation task 9.6, Requirement 2.5): who the
// caller is, as the API sees it. Recipe Box's Account page renders it.
import { type OpenAPIHono, z } from '@hono/zod-openapi'
import { type DeveloperRoleLookup } from '../auth/developer'
import { type AppBindings } from '../http/bindings'
import { defineRoute } from '../http/define-route'
import { ApiError } from '../http/errors'
import { errorResponses } from '../http/openapi'

export const MeResponseSchema = z
  .object({
    userId: z.string().openapi({ example: 'user_2abc' }),
    tenantId: z.string().openapi({ example: 'user_2abc' }),
    isDeveloper: z.boolean(),
  })
  .openapi('Me')

export type MeResponse = z.infer<typeof MeResponseSchema>

export const meRoute = defineRoute({
  method: 'get',
  path: '/me',
  summary: 'The signed-in user',
  responses: {
    200: {
      description: 'The caller’s user ID, tenant ID and developer role.',
      content: { 'application/json': { schema: MeResponseSchema } },
    },
    ...errorResponses(401, 503),
  },
})

export interface MeDeps {
  developerRole: DeveloperRoleLookup
}

export function registerMe(v1: OpenAPIHono<AppBindings>, deps: MeDeps): void {
  v1.openapi(meRoute, async (c) => {
    const principal = c.get('principal')
    // requireUser (from defineRoute) already guarantees this.
    if (principal?.kind !== 'user') {
      throw new ApiError(401, 'unauthorized', 'A valid session token is required.')
    }
    const isDeveloper = await deps.developerRole(principal.userId)
    const body: MeResponse = {
      userId: principal.userId,
      tenantId: principal.tenantId,
      isDeveloper,
    }
    return c.json(body, 200)
  })
}
