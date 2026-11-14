import { defineConfig } from 'vitest/config'

// Worker integration tests against the local database (01.5-backend-foundation task 7.7).
// Needs the local Supabase stack (`pnpm db:start`) and TEST_DATABASE_URL set to its direct
// database URL. Checked here, as in core/vitest.db.config.ts, so the message prints as-is.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Start the local stack with `pnpm db:start`, then set ' +
      'TEST_DATABASE_URL to its direct database URL (`supabase status` prints it, e.g. ' +
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres).',
  )
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.db.test.ts'],
    // Each file starts its own worker against the shared database; one at a time keeps
    // them from claiming each other's jobs and keeps the connection count low.
    fileParallelism: false,
    testTimeout: 15_000,
  },
})
