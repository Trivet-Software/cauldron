// Hono environment shared by every API app, middleware and route
// (01.5-backend-foundation tasks 9.2-9.8). Later tasks extend Variables here
// rather than declaring their own Env, so every handler sees one shape.
import { type Logger } from 'pino'

/**
 * Who is calling (design: "Clerk Token Verification"). Task 9.5's
 * `resolvePrincipal` sets it; import this type from here rather than
 * redeclaring it.
 */
export type Principal =
  | { kind: 'user'; userId: string; tenantId: string; sessionId: string }
  | { kind: 'anonymous' }

export interface AppVariables {
  /** Set by `requestId()` before anything else runs. */
  requestId: string
  /** Optional request-scoped logger; `errorHandler` falls back to its own. */
  logger?: Logger
  /** Set by `resolvePrincipal` (task 9.5) on `/v1` routes. */
  principal?: Principal
}

export interface AppBindings {
  Variables: AppVariables
}
