# Testing

## Runner

**Vitest** (`^5`) everywhere, run once with `vitest --run`, never in watch mode in automated runs. Packages with tests: `core`, `services/api`, `services/worker`, `web-kit` and `apps/recipe-box`. React packages add React Testing Library and jsdom. Each has a `test` script; the root `pnpm test` runs them all.

Verification after code changes: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` for the apps. Run `pnpm test:db` when you touch migrations, RLS, the queue or `core/src/db`.

## Test Layers

- **Unit tests** (`*.test.ts` / `*.test.tsx`): no network, no database. `pnpm test`.
- **Database integration tests** (`*.db.test.ts`): run only by `pnpm test:db`, which uses each package's `vitest.db.config.ts` (`core`, `services/worker`). They cover the schema, RLS tenant isolation (one user reading and writing another's rows gets nothing), storage policies, the queue and the `withActor()` helper.
- **API tests**: call `createApp(deps)` and use Hono's `app.request()` in-process, with a fake token verifier and fake Clerk lookups injected through `deps`. No open ports.
- **Smoke checks**: config files (Caddyfile, Dockerfiles, workspace layout) and production are checked by `scripts/smoke-production.sh`, not unit tests.
- No property-based tests unless a spec's design defines correctness properties.

## `pnpm test:db` Requirements

- The local Supabase stack must be running: `pnpm db:start` (needs Docker). `pnpm db:reset` re-applies migrations and `seed.sql`.
- `TEST_DATABASE_URL` must be set to the stack's **direct** database URL (not the pooler), e.g. `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. `supabase status` prints it. The config loads the repo-root `.env.local`; variables already in the shell win.
- Without it the run fails at once with a message saying so. If the database doesn't answer, global setup fails once before any suite starts.
- Each test runs in a transaction that is always rolled back, with `asUser` / `asAnon` / `asSystem` helpers from `core/src/db/testing.ts`. Suites leave the stack as `db:reset` left it. Files run one at a time.
- `testing.ts` hands out the privileged pool and is not exported from `core`'s exports map. Use it only from `*.db.test.ts`.
- CI does not run `test:db` yet; run it locally before merging database changes.

## Mocks and Fixtures

- LLM and embedding calls go through the provider interfaces. Tests use `@cauldron/core/providers/mock`, which replays recordings and fails on an unrecorded request. Never call OpenRouter from tests.
- Clerk is an external service. In the SPA, mock `@clerk/react` at the module boundary and flip `isSignedIn` per test. In the API, inject a fake `verifyToken`. Don't test Clerk's own behavior.
- Don't mock the database in `*.db.test.ts`; those tests exist to exercise real Postgres and RLS.

## What to Cover

- `parseEnv()` / `validateEnv()`: valid input passes, a missing variable throws an error naming it, empty string counts as missing, values are never printed.
- API: every operation in the generated OpenAPI document declares `security` explicitly; protected routes return 401 without a valid token (including a broken token on an anonymous route); the error envelope has a stable `code`; CORS allows only `APP_ORIGINS`.
- Queue and worker: claim with `SKIP LOCKED`, lease expiry and reaping, fenced writes after a lost lease, retry with backoff, `NonRetryableError`, shutdown release.
- Providers: mock replay, unrecorded-request failure, usage and cost returned.
- SPA: `useApiClient` header behavior, `Header` signed in/out, router and `AuthBridge` context, protected-route redirects, snapshots for the home page and header.

## Conventions

- Co-locate tests next to the code.
- Test behavior and output, not implementation details.
- Tests must be deterministic and independent of each other.
