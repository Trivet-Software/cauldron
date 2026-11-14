// Module-internal access to the privileged connection (task 3.1, Requirement 4.3).
//
// The connection string is privileged: it connects as the table owner, which bypasses RLS.
// A Db carries no reference to its postgres.js pool, so code holding a Db can't reach it.
// The pool lives in this WeakMap and only two kinds of code read it:
//   - withActor() and withSystem() in this directory, which wrap it in a transaction;
//   - core/src/queue, whose claim and reap queries cross tenants (design, "Job Queue").
//     It imports rawSql() from '../db/internal' by relative path.
//
// This file is not re-exported from ./index.ts and has no entry in core's exports map, so
// packages outside core can't import it. The ESLint `postgres` restriction (task 1.3) stops
// other core modules from opening their own privileged connection.
import { type Sql } from 'postgres'

/**
 * A database handle. Opaque on purpose: pass it to withActor() (or, for app-goal
 * registration, withSystem()); there is no way to run SQL on it directly.
 */
export interface Db {
  /** Maximum connections in the pool. */
  readonly poolSize: number
  /** Waits for running queries, then closes every connection. */
  close(options?: { timeoutSeconds?: number }): Promise<void>
}

const pools = new WeakMap<Db, Sql>()

export function registerPool(db: Db, sql: Sql): void {
  pools.set(db, sql)
}

/** The privileged postgres.js pool behind a Db. Bypasses RLS: core/src/db and core/src/queue only. */
export function rawSql(db: Db): Sql {
  const sql = pools.get(db)
  if (!sql) throw new TypeError('Not a Db created by createDb().')
  return sql
}
