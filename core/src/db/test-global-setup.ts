// globalSetup for `pnpm test:db` (task 3.5). Fails the run once, before any suite starts,
// when TEST_DATABASE_URL is unset or the local stack isn't answering.
import postgres from 'postgres'

import { testDatabaseUrl } from './testing'

export default async function setup(): Promise<void> {
  const url = testDatabaseUrl()
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 5, onnotice: false })
  try {
    await sql`select 1`
  } catch (error) {
    const message =
      "Can't reach the database at TEST_DATABASE_URL. Is the local stack running (`pnpm db:start`)?"
    // Written to stderr too: vitest can fail to print a globalSetup error's stack.
    console.error(`${message}\n${error instanceof Error ? error.message : String(error)}`)
    throw new Error(message, { cause: error })
  } finally {
    await sql.end({ timeout: 0 })
  }
}
