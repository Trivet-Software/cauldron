import { defineConfig } from 'vitest/config'

// Database integration tests (01.5-backend-foundation task 3.5). Needs the local Supabase
// stack (`pnpm db:start`) and TEST_DATABASE_URL set to its direct database URL.
// Checked here rather than only in globalSetup: vitest prints a config error as-is, while a
// globalSetup error currently trips its source-map printer and the message gets lost.
// src/db/testing.ts repeats the check for suites run some other way.
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
    globalSetup: ['src/db/test-global-setup.ts'],
    setupFiles: ['src/db/test-setup.ts'],
    // Every test rolls back, so files could run in parallel; one at a time keeps the local
    // stack's connection count low and failures easy to read.
    fileParallelism: false,
    testTimeout: 15_000,
  },
})
