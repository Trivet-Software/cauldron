// One access-log line per request (01.5-backend-foundation design, "Logging").
// Runs right after requestId(), so `c.var.logger` carries the request ID for
// everything downstream (resolvePrincipal, errorHandler, handlers).
import { type MiddlewareHandler } from 'hono'
import { type Logger } from 'pino'
import { type AppBindings } from './bindings'

export function requestLog(logger: Logger): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const started = performance.now()
    const log = logger.child({ requestId: c.get('requestId') })
    c.set('logger', log)
    await next()
    // Path only, never the query string: tokens or emails could ride in it.
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      'request',
    )
  }
}
