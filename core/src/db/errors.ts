import { PostgresError } from 'postgres'

// SQLSTATE 42501 (insufficient_privilege). Postgres raises it both for a missing table grant
// ("permission denied for table ...") and for a write that fails an RLS check ("new row
// violates row-level security policy ..."). Reads that RLS filters return no rows instead.
const INSUFFICIENT_PRIVILEGE = '42501'

/**
 * The database refused an operation for the current actor (task 3.1). The API maps it to
 * 403 `forbidden`. Repository code should never trigger it, so callers log it as a bug.
 * The Postgres error is kept as `cause` for logs (its message names the table); this message
 * stays generic so it is safe to return to a client.
 */
export class ForbiddenError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The database refused this operation for the current actor.', {
      cause: options?.cause,
    })
    this.name = 'ForbiddenError'
  }
}

/** Returns a ForbiddenError for an RLS or grant violation, otherwise the error unchanged. */
export function mapDbError(error: unknown): unknown {
  if (error instanceof PostgresError && error.code === INSUFFICIENT_PRIVILEGE) {
    return new ForbiddenError({ cause: error })
  }
  return error
}
