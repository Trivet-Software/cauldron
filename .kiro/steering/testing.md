# Testing

## Runner

**Vitest** (`^5`) everywhere, run once with `vitest --run`, never in watch mode in automated runs. Packages with tests: `core`, `services/api`, `services/worker`, `services/mcp`, `web-kit` and `apps/recipe-box`. React packages add React Testing Library and jsdom. Each has a `test` script; the root `pnpm test` runs them all.

Verification after code changes: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` for the apps. Run `pnpm test:db` when you touch migrations, RLS, the queue or `core/src/db`.

## Test Layers

- **Unit tests** (`*.test.ts` / `*.test.tsx`): no network, no database. `pnpm test`.
- **Database integration tests** (`*.db.test.ts`): run only by `pnpm test:db`, which uses each package's `vitest.db.config.ts` (`core`, `services/worker`). They cover the schema, RLS tenant isolation (one user reading and writing another's rows gets nothing), storage policies, the queue, the `withActor()` helper, `registerGoal`, the collection repository and the `compile` handler.
- **API tests**: call `createApp(deps)` and use Hono's `app.request()` in-process, with a fake token verifier and fake Clerk lookups injected through `deps`. No open ports. Route tests also inject an in-memory `CollectionStore` and in-memory `TenantStorage` (`ApiDeps.collection`, `ApiDeps.storageFor`).
- **MCP tests** (`services/mcp`): connect an SDK `Client` and the server through `InMemoryTransport.createLinkedPair()` (from `@modelcontextprotocol/client`) and inject a fake `fetch`. No child process, port or running API. `createServer` is in `src/server.ts` so tests import it without starting stdio.
- **Smoke checks**: config files (Caddyfile, Dockerfiles, workspace layout) and production are checked by `scripts/smoke-production.sh`, not unit tests.
- **Property-based tests** use `fast-check` (`^4`, a devDependency of `core`, `services/api` and `services/mcp`) and only exist for properties a spec's design defines. Each runs 100 times (`{ numRuns: 100 }`) and carries a comment `// Feature: 01.7-walking-skeleton, Property N: <title>`. The goal-file generator `core/src/goals/goal-file.arb.ts` is shared by the property tests that need a valid goal.

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
- SPA: `useApiClient` header behavior, `Header` signed in/out, router and `AuthBridge` context, protected-route redirects (including `/items` and `/items/$itemId`), snapshots for the home page, header and `ItemDetail`.
- Walking skeleton, pure modules (`core/src/{goals,compile}`, co-located `*.test.ts`): goal-file parsing (both real `apps/*/goal.json` files), canonical JSON, `validateItem` (reports field keys, never values), `sniffImageType`, the text and image mappers, `deriveCompileState`, the extraction request (snapshots plus a property that the source is isolated from the instructions). `core/src/collection/like.test.ts` covers LIKE escaping.
- Walking skeleton, database (`pnpm test:db`): `core/src/db/walking-skeleton.db.test.ts` (item ordinal constraint, indexes), `core/src/db/register-goal.db.test.ts` (created, unchanged, updated, reordered keys), `core/src/collection/collection.db.test.ts` (capture is one transaction, newest first, `q` search, cross-tenant reads return nothing, `saveItem` twice leaves one row), `services/worker/src/handlers/compile.db.test.ts` (one item per source, rerun idempotency, `NonRetryableError` on invalid output, a path in another tenant throws before any read, `llm` mode against recordings).
- Walking skeleton, services: `services/api` dev auth (`src/auth/dev-token.test.ts`: only the exact token authenticates, every other token goes to the wrapped verifier once; `src/env.test.ts` and `src/main.test.ts`: the token-length and production guards, warning logged without the token), `src/goals/register-app-goals.test.ts` (bad files are logged by path and skipped), `src/routes/*.test.ts` (security declared per operation, capture limits and rejections store nothing, 404 for missing or other-tenant rows); `services/worker` `compile.test.ts` and `handlers/index.test.ts` (registry, `COMPILE_MODE`, default mode never calls the provider); `services/mcp` `resolve-goal.test.ts` (goal slug or name) and `tools.test.ts` (tools against a fake API, errors never contain the token).
- `web-kit`: `src/collection/{client,hooks}.test.*` (envelope message, `FormData` shape, polling every 2 s only while a row is pending, no timer after unmount) and component tests for `CaptureForm`, `ItemList` and `ItemDetail`.

## Conventions

- Co-locate tests next to the code.
- Test behavior and output, not implementation details.
- Tests must be deterministic and independent of each other.
