// `@cauldron/core/db/system`: the RLS-bypassing system actor (task 3.1, auth-abuse
// Requirement 2.5). Only the API's app-goal registration module may import this subpath;
// ESLint enforces that (task 1.3). Everything else uses withActor() from `@cauldron/core/db`.
import { type SystemActor, SYSTEM_OWNER } from './actor'
import { mapDbError } from './errors'
import { type Db, rawSql } from './internal'
import { type Scoped } from './scoped'

export { SYSTEM_OWNER }

const SYSTEM: SystemActor = { kind: 'system' }

/**
 * Runs `fn` in a transaction as the system owner. The transaction stays on the connection
 * role (the table owner), and RLS is enabled but not forced, so policies don't apply. Queries
 * must filter on `tenant_id = scope.tenantId` ('system') themselves.
 */
export async function withSystem<T>(db: Db, fn: (scope: Scoped) => Promise<T>): Promise<T> {
  const sql = rawSql(db)
  try {
    return (await sql.begin((tx) =>
      fn({ sql: tx, actor: SYSTEM, tenantId: SYSTEM_OWNER }),
    )) as T
  } catch (error) {
    throw mapDbError(error)
  }
}
