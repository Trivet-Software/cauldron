// The JSON error envelope (01.5-backend-foundation task 9.2, Requirement 1.4).
// Every failure, including 404s, validation failures and unexpected
// exceptions, returns `{ error: { code, message, status, requestId, details? } }`.
// `code` values are a public contract: later specs may add codes, never rename one.
import { type Context, type ErrorHandler, type NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type ContentfulStatusCode } from 'hono/utils/http-status'
import { type Hook, type OpenAPIHono, z } from '@hono/zod-openapi'
import { type Logger } from 'pino'
import { ForbiddenError } from '@cauldron/core/db'
import { type AppBindings } from './bindings'

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal'

/**
 * An error whose code, status and message are safe to return to the client.
 * Throw it from handlers and middleware; `errorHandler` renders it.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown[],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const ErrorBodySchema = z
  .object({
    code: z.string().openapi({ example: 'unauthorized' }),
    message: z.string().openapi({ example: 'A valid session token is required.' }),
    status: z.number().int().openapi({ example: 401 }),
    requestId: z.string().openapi({ example: 'req_0190a1b2c3d4e5f6a7b8c9d0e1f2' }),
    details: z.array(z.unknown()).optional(),
  })
  .openapi('ErrorBody')

export const ErrorResponseSchema = z
  .object({ error: ErrorBodySchema })
  .openapi('Error')

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

/** Registers `Error` (and `ErrorBody`) under `components.schemas` of the app's document. */
export function registerErrorSchema(app: OpenAPIHono<AppBindings>): void {
  app.openAPIRegistry.register('ErrorBody', ErrorBodySchema)
  app.openAPIRegistry.register('Error', ErrorResponseSchema)
}

const INTERNAL_MESSAGE = 'Something went wrong. Quote the request ID if you report this.'

/** Renders the envelope. 401 responses also get `WWW-Authenticate: Bearer`. */
export function errorResponse(
  c: Context<AppBindings>,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  details?: unknown[],
): Response {
  if (status === 401) c.header('WWW-Authenticate', 'Bearer')
  const body: ErrorResponse = {
    error: {
      code,
      message,
      status,
      // Falls back only if an error fires before the requestId middleware.
      requestId: c.get('requestId') ?? 'unknown',
      ...(details && details.length > 0 ? { details } : {}),
    },
  }
  return c.json(body, status)
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'bad_request'
    case 401:
      return 'unauthorized'
    case 403:
      return 'forbidden'
    case 404:
      return 'not_found'
    case 409:
      return 'conflict'
    case 422:
      return 'validation_failed'
    case 429:
      return 'rate_limited'
    default:
      return status < 500 ? 'bad_request' : 'internal'
  }
}

/** `app.onError(errorHandler(logger))`. Never puts a stack or internal message in a response. */
export function errorHandler(logger: Logger): ErrorHandler<AppBindings> {
  return (err, c) => {
    // The request logger (requestLog) already carries requestId.
    const log = c.get('logger') ?? logger.child({ requestId: c.get('requestId') })

    if (err instanceof ApiError) {
      if (err.status >= 500) log.error({ err }, 'request failed')
      return errorResponse(c, err.status, err.code, err.message, err.details)
    }

    if (err instanceof ForbiddenError) {
      // Repository code should never attempt a write RLS rejects, so this is a bug.
      log.error({ err }, 'database refused the operation for this actor')
      return errorResponse(c, 403, 'forbidden', err.message)
    }

    // Hono's own exceptions (e.g. malformed JSON in a validated body).
    // 4xx messages are framework-authored and safe; 5xx are not.
    if (err instanceof HTTPException && err.status < 500) {
      const status = err.status as ContentfulStatusCode
      return errorResponse(c, status, codeForStatus(status), err.message || 'Bad request.')
    }

    log.error({ err }, 'unhandled error')
    return errorResponse(c, 500, 'internal', INTERNAL_MESSAGE)
  }
}

/** `app.notFound(notFoundHandler)`. */
export const notFoundHandler: NotFoundHandler<AppBindings> = (c) =>
  errorResponse(c, 404, 'not_found', `No route for ${c.req.method} ${c.req.path}.`)

/**
 * `new OpenAPIHono({ defaultHook: validationErrorHook })`: a request that fails
 * its Zod schema becomes 400 `validation_failed` with one `{ path, message }`
 * per issue. `path` starts with the request part (`query`, `json`, `param`, ...).
 */
export const validationErrorHook: Hook<unknown, AppBindings, string, Response | undefined> = (
  result,
  c,
) => {
  if (result.success) return undefined
  const details = result.error.issues.map((issue) => ({
    path: [result.target, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }))
  return errorResponse(c, 400, 'validation_failed', 'The request is invalid.', details)
}
