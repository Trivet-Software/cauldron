// The generated OpenAPI document (01.5-backend-foundation task 9.3,
// Requirements 1.3 and 2.4). Routes declared with defineRoute() appear in it
// with their `security` entry; the document itself is served anonymously.
import { type OpenAPIHono } from '@hono/zod-openapi'
import pkg from '../../package.json' with { type: 'json' }
import { type AppBindings } from './bindings'
import { ErrorResponseSchema, registerErrorSchema } from './errors'

/** Name of the security scheme that `access: 'user'` routes reference. */
export const BEARER_AUTH = 'bearerAuth'

/** Path of the document, relative to the `/v1` sub-app. */
export const OPENAPI_PATH = '/openapi.json'

export interface OpenApiOptions {
  /** Defaults to the api package version, or `0.0.0`. */
  version?: string
}

/**
 * Registers the `bearerAuth` scheme and the `Error` schema on the `/v1`
 * sub-app and serves the document at `/openapi.json`. The document route is
 * not a defineRoute() route and needs no token, though resolvePrincipal still
 * runs first, so a broken token gets a 401 like every other `/v1` request.
 */
export function registerOpenApi(v1: OpenAPIHono<AppBindings>, options: OpenApiOptions = {}): void {
  v1.openAPIRegistry.registerComponent('securitySchemes', BEARER_AUTH, {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'A Clerk session token: `Authorization: Bearer <token>`.',
  })
  registerErrorSchema(v1)
  v1.doc31(OPENAPI_PATH, {
    openapi: '3.1.0',
    info: {
      title: 'Cauldron API',
      version: options.version ?? pkg.version ?? '0.0.0',
    },
  })
}

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503

const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: 'The request is invalid.',
  401: 'A valid session token is required.',
  403: 'The caller may not perform this operation.',
  404: 'Not found.',
  409: 'Conflicts with existing data.',
  429: 'Too many requests.',
  500: 'Unexpected server error.',
  503: 'A dependency is unavailable.',
}

interface ErrorResponseConfig {
  description: string
  content: { 'application/json': { schema: typeof ErrorResponseSchema } }
}

/**
 * Response entries for the given statuses, each referencing the `Error`
 * component. Spread into a route's `responses`:
 * `responses: { 200: {...}, ...errorResponses(401, 500) }`.
 */
export function errorResponses<const S extends readonly ErrorStatus[]>(
  ...statuses: S
): { [K in S[number]]: ErrorResponseConfig } {
  const entries = statuses.map((status) => [
    status,
    {
      description: ERROR_DESCRIPTIONS[status],
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  ])
  return Object.fromEntries(entries) as { [K in S[number]]: ErrorResponseConfig }
}
