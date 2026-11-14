// Who a query runs as (01.5-backend-foundation task 3.1, Requirements 3.3 and 4.3).

/**
 * Reserved tenant_id and user_id for rows owned by the system: app goals registered at API
 * startup (goal-engine Requirement 8). Clerk user IDs start with `user_`, so no real user's
 * `sub` can equal it, which is why no RLS policy lets a user write `system` rows.
 */
export const SYSTEM_OWNER = 'system'

/** A signed-in user. One tenant per account, so tenantId is always the Clerk `sub`. */
export interface UserActor {
  kind: 'user'
  userId: string
  tenantId: string
}

/** No token: reads app goals and public demo tenants only. */
export interface AnonymousActor {
  kind: 'anonymous'
}

/** App-goal registration only. Bypasses RLS; reachable only through `@cauldron/core/db/system`. */
export interface SystemActor {
  kind: 'system'
}

export type Actor = UserActor | AnonymousActor | SystemActor

/** The actors withActor() accepts: everything a request or a job can run as. */
export type RequestActor = UserActor | AnonymousActor

export function tenantOf(actor: Actor): string | null {
  switch (actor.kind) {
    case 'user':
      return actor.tenantId
    case 'system':
      return SYSTEM_OWNER
    case 'anonymous':
      return null
  }
}
