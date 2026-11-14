import { defineConfig } from 'vitest/config'

// Unit tests only. Database integration tests (`*.db.test.ts`) need the local
// Supabase stack and run through `pnpm test:db` with vitest.db.config.ts
// (01.5-backend-foundation tasks 1.2 and 3.5).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.db.test.ts', '**/node_modules/**'],
    // core has no unit tests until later tasks add them.
    passWithNoTests: true,
  },
})
