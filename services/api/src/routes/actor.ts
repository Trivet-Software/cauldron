// The database actor for the caller of an `access: 'user'` route
// (01.7-walking-skeleton task 6.8).
import { type Context } from 'hono'
import { type UserActor } from '@cauldron/core/db'
import { type AppBindings } from '../http/bindings'
import { ApiError } from '../http/errors'

export function userActorOf(c: Context<AppBindings>): UserActor {
  const principal = c.get('principal')
  // requireUser (from defineRoute) already guarantees this.
  if (principal?.kind !== 'user') {
    throw new ApiError(401, 'unauthorized', 'A valid session token is required.')
  }
  return { kind: 'user', userId: principal.userId, tenantId: principal.tenantId }
}
