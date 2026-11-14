import postgres from 'postgres'

import { type Db, registerPool } from './internal'

export interface CreateDbOptions {
  /** Maximum pool connections. Design: API 10, worker WORKER_CONCURRENCY + 2. */
  max: number
}

/**
 * Opens a pool on DATABASE_URL (task 3.1). Connections open lazily on the first query.
 *
 * `prepare: false` because DATABASE_URL is Supabase's transaction-mode pooler, which doesn't
 * keep prepared statements between transactions. withActor() uses only `set local` and
 * `set_config(..., true)`, which are transaction-scoped and so safe on a pooled connection.
 */
export function createDb(url: string, options: CreateDbOptions): Db {
  if (!Number.isInteger(options.max) || options.max < 1) {
    throw new RangeError(`Pool size must be a positive integer, got ${options.max}.`)
  }
  const sql = postgres(url, {
    prepare: false,
    max: options.max,
    // Notices are informational; don't print them to the services' JSON log stream.
    onnotice: false,
  })
  const db: Db = {
    poolSize: options.max,
    close: (closeOptions) => sql.end({ timeout: closeOptions?.timeoutSeconds }),
  }
  registerPool(db, sql)
  return db
}
