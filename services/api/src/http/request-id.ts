// Request-ID middleware (01.5-backend-foundation task 9.2, Requirement 1.4).
// Every response carries `X-Request-Id`, and the error envelope repeats it,
// so a user's report can be matched to the server log line.
import { randomBytes } from 'node:crypto'
import { type MiddlewareHandler } from 'hono'
import { requestId as honoRequestId } from 'hono/request-id'
import { type AppBindings } from './bindings'

export const REQUEST_ID_HEADER = 'X-Request-Id'

// An incoming id (e.g. from a proxy) is kept only when it is short and uses
// [A-Za-z0-9_-=]; Hono rejects any other character. Anything else is replaced,
// so a client can't inject log-breaking or oversized values.
const MAX_INCOMING_LENGTH = 64

/** `req_` + 48-bit millisecond timestamp + 80 random bits, all hex: sortable by time. */
export function generateRequestId(): string {
  const time = Date.now().toString(16).padStart(12, '0')
  return `req_${time}${randomBytes(10).toString('hex')}`
}

/** Sets `c.var.requestId` and the `X-Request-Id` response header. */
export function requestId(): MiddlewareHandler<AppBindings> {
  return honoRequestId({
    headerName: REQUEST_ID_HEADER,
    limitLength: MAX_INCOMING_LENGTH,
    generator: generateRequestId,
  })
}
