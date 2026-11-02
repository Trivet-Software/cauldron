# Implementation Plan: 01.5-backend-foundation

## Overview

Build the backend skeleton described in `design.md`: two new services (`services/api`, `services/worker`), Node-only subpaths in `@cauldron/core` (`env`, `db`, `queue`, `storage`, `providers`), and a Supabase project defined by SQL migrations with RLS and a private Storage bucket. Recipe Box then calls `GET /v1/me` to prove the stack in production. The same change moves everything to Node 24, replaces `nixpacks.toml` with Dockerfiles, and adds the first GitHub Actions workflow, which applies migrations.

Order: workspace and tooling first, then the database, so every later layer can be tested against real policies. Next come the `core` modules (data access, storage, providers, queue), then the worker and the API, which consume them. Recipe Box wiring, deployment and documentation come last. Each layer has its own test sub-tasks and ends at a checkpoint.

Testing follows the design: Vitest with `--run`, unit tests in `pnpm test` (no Docker), and database integration tests in `pnpm test:db` against the local Supabase stack. No property-based tests apply.

### Delivery phases

`01.7-walking-skeleton` builds on part of this plan, so the work lands in two phases. The dependency graph orders every phase 1 task before phase 2.

- **Phase 1, before the walking skeleton:** 1.1–1.5, 2.1–2.5, 3.1, 3.3–3.6, 5.1, 5.3, 5.4, 6.1, 6.2, 7.1–7.3, 7.5–7.7, 9.1–9.5, 9.7–9.10, 11.1 and 11.2.
- **Phase 2, after or alongside the walking skeleton:** 2.6, 3.2, 3.7, 5.2, 5.5, 7.4, 7.8, 9.6, 9.11, 11.3, 12, 13 and 14.

## Tasks

- [ ] 1. Workspace, runtime and tooling
  - [ ] 1.1 Move to Node 24 and register the services workspace
    - Add `.nvmrc` (`24`) and `"engines": { "node": ">=24" }` to the root `package.json`
    - Bump `@types/node` to `^24` in every package that uses it (`apps/recipe-box`, plus new packages)
    - Add `'services/*'` to `pnpm-workspace.yaml`
    - Add root scripts `dev:stack`, `db:start`, `db:reset`, `db:push` and `test:db`; leave `dev` unchanged (Recipe Box only)
    - Add the `supabase` CLI as a pinned root devDependency
    - _Requirements: 8.1_
  - [ ] 1.2 Set up `@cauldron/core` for server modules
    - Exports map: `.`, `./env`, `./providers`, `./providers/mock`, `./db`, `./db/system`, `./queue`, `./storage`
    - Add pinned dependencies: `zod`, `postgres`, `@supabase/supabase-js`
    - `tsconfig.json`: `types: ["node"]`
    - Add `vitest.config.ts` (node environment, excludes `*.db.test.ts`), plus `test` and `test:db` scripts
    - _Requirements: 1.1_
  - [ ] 1.3 Add lint guards for privileged database access
    - `no-restricted-imports` in `eslint.config.js`: block `postgres` outside `core/src/db/**` and `core/src/queue/**`, and block `@cauldron/core/db/system` everywhere except the (future) API registration module
    - _Requirements: 4.3_
  - [ ] 1.4 Implement `parseEnv` in `core/src/env`
    - `parseEnv(schema, source)` and `EnvError`: empty strings count as missing, and every missing or invalid name is listed; values are never printed
    - Shared Zod fragments for the provider settings, so `OPENROUTER_API_KEY` and the model names are required only when `PROVIDERS` is `openrouter` or `record`
    - _Requirements: 8.3_
  - [ ] 1.5 Write unit tests for `parseEnv`
    - Present value parses; one missing name is reported; an empty string counts as missing; several missing names are all listed; provider keys are conditional on `PROVIDERS`
    - _Requirements: 8.3_

- [ ] 2. Supabase project and migrations
  - [ ] 2.1 Initialize the local Supabase configuration
    - Run `supabase init` and edit `supabase/config.toml`: `[auth.third_party.clerk] enabled = true`, `domain = "env(CLERK_DOMAIN)"`; Data API (PostgREST) disabled; Storage enabled
    - Add an empty `supabase/seed.sql` with a comment explaining what later specs seed
    - _Requirements: 3.4, 4.1_
  - [ ] 2.2 Write the extensions and private-helpers migrations
    - `create extension if not exists vector with schema extensions`, same for `pg_trgm`
    - `private` schema with `private.tenant_id()`, `private.user_id()`, `private.is_public_tenant(text)` (security definer, `search_path = ''`), and the `updated_at` trigger function
    - _Requirements: 3.2, 4.2_
  - [ ] 2.3 Write the tables migration
    - `goals`, `goal_versions`, `sources`, `jobs`, `items`, `drafts`, `pages`, `page_items`, `usage`, `api_keys`, and `public_tenants`, with the columns, check constraints and unique indexes in the design's Data Models section
    - `tenant_id`/`user_id` `not null` on every user-data table; the `kind = 'app'` ⇔ `tenant_id = 'system'` check on `goals`; composite `(tenant_id, …)` foreign keys between same-tenant rows
    - Indexes: `items_fts_gin` (GIN on `fts`), `items_embedding_hnsw` (HNSW `vector_cosine_ops` on `vector(1536)`), trigram index on goal name and description, the queue's partial indexes, and `usage (user_id, created_at)`
    - _Requirements: 3.1, 3.2, 3.3, 7.5_
  - [ ] 2.4 Write the grants and RLS migration
    - Revoke all from `anon` and `authenticated` (including default privileges), then grant per the design's grants table
    - Enable RLS on every user-data table, with the `_own` policy template using `(select private.tenant_id())`
    - Shared reads: `system` goals and goal versions for `anon` and `authenticated`; items, pages and page items of public tenants
    - _Requirements: 4.2_
  - [ ] 2.5 Write the storage migration
    - Private `sources` bucket (`public = false`, 20 MB object limit)
    - `storage.objects` policies for `authenticated`: `select`, `insert` and `delete` only where the first path segment equals the token's `sub`; no `update` policy; nothing for `anon`
    - _Requirements: 5.1, 5.2_
  - [ ] 2.6 Write the production setup runbook
    - `docs/production-setup.md`, the checklist an operator follows once per environment. Its first section registers Clerk as a Supabase third-party auth provider: activate the Supabase integration in the Clerk dashboard (adds `role: "authenticated"` to session tokens), add Clerk with the instance domain under Supabase → Authentication → Third-Party Auth, and disable the Data API on the hosted project
    - Later sections:
      - The GitHub `production` environment and its secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`)
      - The Railway services: `RAILWAY_DOCKERFILE_PATH`, `SERVICE`/`APP`, reference variables for `APP_ORIGINS` and `VITE_API_BASE_URL`, backend secrets, `/health` checks, restart policy, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` on `worker`, watch paths, and "Wait for CI" on `api` and `worker`
      - Adding `migrate` as a required status check in `protect-main` after its first run
      - The production checks the smoke script (13.5) can't automate: signing in to Recipe Box and seeing `/v1/me` data on Account, inserting a `ping` job, redeploying `worker` mid-job, and whether "Wait for CI" holds commits that don't trigger `migrate`
    - _Requirements: 4.1, 9.1, 9.2_

- [ ] 3. Data access and storage in `core`
  - [ ] 3.1 Implement the connection and `withActor` helper
    - `core/src/db`: `createDb(url)` (postgres.js, `prepare: false`, pool size parameter), `Actor`, `SYSTEM_OWNER = 'system'`, `Scoped`
    - `withActor(db, actor, fn)` sets `request.jwt.claims` and `set local role authenticated` / `anon` inside a transaction; `db.raw` is not exported from `./db`
    - `withSystem` exported only from `./db/system`
    - Map RLS violations to a typed `ForbiddenError`
    - _Requirements: 3.3, 4.3_
  - [ ] 3.2 Implement embedding-model helpers
    - `embeddingScope(embeddings)` returning the model filter that search queries must apply
    - `countItemsNeedingReembed(db, model)` and `selectStaleItems(db, model, limit)` (privileged, in `core/src/db`): items with non-null `search_text` whose `embedding_model` is null or differs
    - _Requirements: 7.6_
  - [ ] 3.3 Implement `TenantStorage`
    - Path builder `{tenantId}/{sourceId}/{index}-{safeFilename}` (allows `[A-Za-z0-9._-]`, max 100 characters)
    - `userStorage` (supabase-js with the publishable key plus the caller's Clerk token through `accessToken`) and `serviceStorage` (secret key, rejects paths outside its tenant before calling Storage)
    - `signedReadUrl` clamps the expiry to 1–600 s (default 300); there is no public-URL method
    - _Requirements: 5.2, 5.3_
  - [ ] 3.4 Write unit tests for storage helpers
    - Path building and filename sanitizing; expiry clamping (0, 300, 601, 3600); `serviceStorage` throws on another tenant's path without making a network call
    - _Requirements: 5.2, 5.3_
  - [ ] 3.5 Set up the database integration-test harness
    - `vitest.db.config.ts` in `core` that includes `*.db.test.ts` and reads `TEST_DATABASE_URL` (the local stack's direct URL), failing with a clear message if it's unset
    - Helpers: `asUser(id)`, `asAnon()`, `asSystem()`, each wrapping a test in a transaction that is rolled back; and a fixture that adds a row to `public_tenants`
    - _Requirements: 4.4_
  - [ ] 3.6 Write schema and cross-tenant isolation tests
    - Schema smoke: the ten tables, both extensions, `items_fts_gin` and `items_embedding_hnsw` exist; `tenant_id`/`user_id` are `not null` on every user-data table
    - For every user-data table: as user B, user A's rows can't be selected, updated or deleted, and are unchanged afterwards; inserting with `tenant_id = A` fails; a composite FK to A's row fails
    - Shared reads: `system` goals are readable but not writable by anon and by user B; public-tenant items and pages are readable; anon gets permission denied on `sources`, `drafts`, `jobs`, `usage` and `api_keys`
    - Grants: `authenticated` can't update or delete `usage`, and can't update `jobs`
    - `withActor` itself: the same queries through the helper return only the actor's rows
    - _Requirements: 3.1, 3.2, 3.3, 4.2, 4.3, 4.4_
  - [ ] 3.7 Write storage policy integration tests
    - Against local Storage, using tokens the local stack accepts: user B can't download, list or upload under user A's prefix; a signed URL created for A works and stops working after it expires
    - _Requirements: 5.2, 5.3_

- [ ] 4. Checkpoint: database and data access
  - Ensure `pnpm test`, `pnpm test:db`, `pnpm typecheck` and `pnpm lint` pass; ask the user if questions arise.

- [ ] 5. LLM and embedding providers
  - [ ] 5.1 Define provider interfaces
    - `core/src/providers/types.ts`: `ContentPart` (text, image), `Message`, `Usage`, `CompletionRequest`, `CompletionResult`, `LlmProvider`, `EmbeddingResult`, `EmbeddingProvider`, `Providers`, `ProviderError`
    - _Requirements: 7.1, 7.4_
  - [ ] 5.2 Implement the OpenRouter providers
    - Completions with `response_format: json_schema` (strict), image parts as `data:` URLs, and usage accounting; embeddings via `/api/v1/embeddings` with `dimensions`, batched up to 100
    - Cost from response usage, falling back to `/api/v1/models` pricing cached for an hour; 60 s and 15 s timeouts combined with the caller's signal; two jittered retries on 429/5xx; the API key is never included in errors
    - Throw when a returned vector's length differs from `dimensions`
    - _Requirements: 7.2, 7.4_
  - [ ] 5.3 Implement the mock and recording providers and `createProviders`
    - `requestKey` (SHA-256 over canonical JSON; image bytes replaced by their hash; signal dropped)
    - File-backed and in-memory `RecordingStore`; `MissingRecordingError` naming the key, model and a prompt excerpt
    - `recordingProviders` that refuses `NODE_ENV=production`
    - `createProviders(env)` selecting `openrouter`, `mock` or `record`
    - _Requirements: 7.3, 7.4_
  - [ ] 5.4 Write unit tests for the mock providers
    - Key is stable across object key order and changes when image bytes change; recorded result returned with its usage; a miss throws `MissingRecordingError`; `record` mode is refused in production; `createProviders` picks the implementation from `PROVIDERS`
    - _Requirements: 7.1, 7.3, 7.4_
  - [ ] 5.5 Write unit tests for the OpenRouter providers
    - Request bodies (structured output, image parts, embedding `dimensions`) with mocked `fetch`; usage and cost parsing, plus the pricing fallback
    - Wrong vector length errors; 429 retried then `ProviderError`; the key is absent from error text
    - _Requirements: 7.2, 7.4_

- [ ] 6. Job queue
  - [ ] 6.1 Implement `core/src/queue`
    - `Job` types and statuses
    - `enqueue` (scoped, `dedupeKey` with `on conflict do nothing`); `claim` using the design's `FOR UPDATE SKIP LOCKED` query with a 60 s lease, filtered to registered types
    - Fenced `heartbeat`, `setStage`, `complete`, `fail` (exponential backoff, `failure_reason` on final failure, `NonRetryableError` support) and `release` (restores the attempt); `reapExpired`
    - _Requirements: 6.1, 6.2_
  - [ ] 6.2 Write queue integration tests
    - Two concurrent claimers never get the same job; types without a handler aren't claimed
    - An expired lease is reaped to `queued`, and to `failed` with "timed out" at max attempts; a fenced write after re-claim affects zero rows
    - `release` restores attempts; `dedupeKey` prevents a second queued job; `enqueue` as user A can't create a job for user B
    - _Requirements: 6.1, 6.2_

- [ ] 7. Worker service
  - [ ] 7.1 Scaffold `services/worker`
    - `package.json` (name `worker`; `dev`: `tsx watch --env-file-if-exists=../../.env.local src/index.ts`; `build`: tsup; `typecheck`; `test`), `tsconfig.json` (`lib: ["ES2022"]`, `types: ["node"]`), `tsup.config.ts` (single bundled `dist/index.js`, `@cauldron/core` inlined), `vitest.config.ts`
    - `src/env.ts` using `parseEnv`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, provider settings, `EMBEDDING_*`, `WORKER_CONCURRENCY`, `POLL_INTERVAL_MS`, `SHUTDOWN_GRACE_MS`
    - _Requirements: 6.1, 8.3_
  - [ ] 7.2 Implement the handler registry and the `ping` handler
    - `HandlerContext` (job, `scope` bound to the job's user, `TenantStorage` bound to the job's tenant, providers, `signal`, `setStage`, `log`), `JobHandler`, registry with `ping` (no-op)
    - _Requirements: 4.3, 6.3_
  - [ ] 7.3 Implement the worker loop and shutdown
    - Concurrency slots, polling every `POLL_INTERVAL_MS` when idle, a 20 s heartbeat per job (aborts on lost lease), the reaper every 15 s
    - On `SIGTERM`/`SIGINT`: stop claiming, wait up to `SHUTDOWN_GRACE_MS`, abort and `release` remaining jobs, close the pool
    - _Requirements: 6.1, 6.2, 6.4_
  - [ ] 7.4 Implement re-embedding
    - Scheduler every 5 minutes: up to 1000 stale items, grouped by tenant into batches of 100, enqueued as `reembed` jobs with a `dedupeKey`
    - `reembed` handler: loads the batch through its scope, embeds `search_text`, updates rows whose model still differs (storing model and dimensions), and writes `usage` with `idempotency_key = reembed:<item id>:<model>`
    - _Requirements: 7.4, 7.5, 7.6_
  - [ ] 7.5 Wire the worker entry point
    - `src/index.ts`: validate env (exit 1 on `EnvError`), check that `EMBEDDING_DIMENSIONS` equals the column size, create the db pool (`WORKER_CONCURRENCY + 2`), providers and storage config, start the loop and the timers, install signal handlers; pino logging
    - Start the re-embed scheduler only once 7.4 exists; until then the entry point runs the loop and the reaper
    - _Requirements: 6.4, 8.3_
  - [ ] 7.6 Write unit tests for the worker loop
    - Using an in-memory queue fake: never runs more than `WORKER_CONCURRENCY` jobs; a heartbeat returning `false` aborts the handler and discards its result; `NonRetryableError` → `fail` with `retryable: false`; shutdown stops claiming, waits for running handlers, then releases unfinished ones
    - _Requirements: 6.2, 6.4_
  - [ ] 7.7 Write the `ping` integration test
    - `ping` job enqueued → worker run claims it → status `done`
    - _Requirements: 6.3_
  - [ ] 7.8 Write the re-embed integration test
    - `reembed` with mock embeddings updates a stale item's vector and model, and writes exactly one `usage` row even when the job runs twice
    - _Requirements: 7.5, 7.6_

- [ ] 8. Checkpoint: providers, queue and worker
  - Ensure `pnpm test`, `pnpm test:db`, `pnpm typecheck` and `pnpm lint` pass; ask the user if questions arise.

- [ ] 9. API service
  - [ ] 9.1 Scaffold `services/api`
    - `package.json` (name `api`; same `dev`, `build`, `typecheck`, `test` scripts as the worker), `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
    - Pinned dependencies: `hono`, `@hono/node-server`, `@hono/zod-openapi`, `zod`, `@clerk/backend`, `pino`
    - `src/env.ts`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, optional `CLERK_JWT_KEY`, `APP_ORIGINS` (parsed to a list of exact origins), optional `DEVELOPER_EMAILS`, provider and `EMBEDDING_*` settings, `PORT` (default 8787)
    - _Requirements: 1.1, 8.3_
  - [ ] 9.2 Implement the error envelope
    - `ApiError`, `ErrorCode`; `onError` (unknown errors → 500 `internal`, stack logged with `requestId`); `notFound`; Zod `defaultHook` → 400 `validation_failed` with `details`; `ForbiddenError` → 403; `WWW-Authenticate: Bearer` on 401
    - Register the error schema as an OpenAPI component; add a request-ID middleware
    - _Requirements: 1.4_
  - [ ] 9.3 Implement `defineRoute` and the OpenAPI document
    - `defineRoute({ access })`, defaulting to `'user'`: sets `security` (`[{ bearerAuth: [] }]` or `[]`) and attaches `requireUser()`
    - Register the `bearerAuth` scheme; serve the document at `/v1/openapi.json` with `access: 'anonymous'`
    - _Requirements: 1.3, 2.4_
  - [ ] 9.4 Implement CORS
    - `hono/cors` on `/v1/*` with an origin callback that allows only exact `APP_ORIGINS` matches; allowed headers `Authorization` and `Content-Type`; no credentials; `maxAge: 600`
    - _Requirements: 1.5_
  - [ ] 9.5 Implement token verification and principals
    - `verifySessionToken` wrapping `verifyToken` from `@clerk/backend` with `authorizedParties: APP_ORIGINS` and `jwtKey` (else `secretKey`)
    - `resolvePrincipal`: header only (cookies and query strings ignored); no header → anonymous; malformed or invalid → 401; valid → `{ kind: 'user', userId: sub, tenantId: sub, sessionId: sid }`
    - `requireUser()` → 401 before the handler runs; a helper mapping a principal to an `Actor`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ] 9.6 Implement the developer-role lookup and `GET /v1/me`
    - `isDeveloper(userId)` using the Clerk Backend API (60 s per-user cache): `publicMetadata.role === 'developer'`, or a verified email in `DEVELOPER_EMAILS` (lower-cased); a Clerk failure throws so the route returns 503
    - `GET /v1/me` (`access: 'user'`) returning `{ userId, tenantId, isDeveloper }` with Zod response schemas, registered in `createApp`
    - _Requirements: 2.5_
  - [ ] 9.7 Implement `/health`
    - Outside `/v1`, with no CORS or auth: DB `select 1` with a 2 s timeout (200 or 503), `version` from `RAILWAY_GIT_COMMIT_SHA`, and the configured embedding model and dimensions
    - `embeddings.itemsNeedingReembed` (cached for 60 s) is added with 3.2; leave it out until then
    - _Requirements: 1.2, 7.6_
  - [ ] 9.8 Wire `createApp` and the API entry point
    - `createApp(deps)` assembled as in the design (request ID → `/health` → `/v1` sub-app with CORS, `resolvePrincipal`, routes, OpenAPI document → `notFound`/`onError`)
    - `src/index.ts`: validate env, check embedding dimensions, create the db pool (10), providers and Clerk client, serve on `PORT`, close the server and pool on `SIGTERM`; pino with the `Authorization` header redacted
    - _Requirements: 1.1, 1.2, 8.3_
  - [ ] 9.9 Write unit tests for the API
    - With `app.request()` and injected fakes, plus a test-only route defined without `access` to exercise the closed default:
      - `/health` returns 200 without a token, and 503 when the DB probe fails
      - `/v1/openapi.json` is served anonymously; every operation has an explicit `security` field, and the test route has `bearerAuth`
      - Test route: no token → 401 envelope before the handler runs; rejected token → 401; valid token → principal with `userId = tenantId = sub`
      - Unknown route → 404 envelope; thrown error → 500 with a generic message; invalid input → 400 `validation_failed`
      - CORS: allowed origin echoed, other origins get no header, preflight returns the allowed headers
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.2, 2.3, 2.4_
  - [ ] 9.10 Write unit tests for the token verifier wrapper
    - Mock `@clerk/backend` at the module boundary: `authorizedParties` and `jwtKey` (or `secretKey`) are passed through; a thrown verification error becomes 401; `Bearer` parsing rejects other schemes and empty tokens
    - _Requirements: 2.1, 2.3_
  - [ ] 9.11 Write unit tests for `/v1/me`
    - No token → 401 envelope; valid token → `userId = tenantId = sub`; developer cases: metadata role, verified listed email, unverified listed email (false), Clerk failure → 503; the OpenAPI document lists `/v1/me` with `bearerAuth`
    - _Requirements: 2.3, 2.5_

- [ ] 10. Checkpoint: API
  - Ensure `pnpm test`, `pnpm test:db`, `pnpm typecheck` and `pnpm lint` pass, and that `pnpm dev:stack` starts the API, worker and Recipe Box against the local stack; ask the user if questions arise.

- [ ] 11. Recipe Box end-to-end call
  - [ ] 11.1 Give `useApiClient` a base URL
    - `useApiClient(baseUrl)` joins the base URL and path with `new URL()` and is memoized with `useCallback`; update the existing API-client tests and add a base-URL test
    - _Requirements: 9.2_
  - [ ] 11.2 Make `VITE_API_BASE_URL` required in Recipe Box
    - `validateEnv()` throws, naming `VITE_API_BASE_URL`, when it's missing or empty; update `env.test.ts`
    - _Requirements: 9.2_
  - [ ] 11.3 Show `/v1/me` on the Account page
    - `_auth/account.tsx` calls `GET /v1/me` on mount through `useApiClient(env.VITE_API_BASE_URL)` and renders user ID, tenant ID and developer role, or the error envelope's `message`; update routing tests and snapshots that render the page
    - _Requirements: 9.2_

- [ ] 12. Local development documentation
  - [ ] 12.1 Document backend variables in `.env.example`
    - Every variable in the design's environment table, grouped by service, with secrets marked as server-only and never `VITE_`-prefixed; remove the "staged for a future backend" note on `CLERK_SECRET_KEY`
    - _Requirements: 8.2_
  - [ ] 12.2 Document the local stack
    - A "Local development" section in `README.md`: prerequisites (Node 24, pnpm, Docker), `pnpm db:start`, copying `.env.example`, `pnpm dev:stack`, `pnpm test` and `pnpm test:db`
    - Pointing at a configured dev Supabase project instead of the local stack
    - _Requirements: 8.1_

- [ ] 13. Deployment
  - [ ] 13.1 Create `Dockerfile.service`
    - Multi-stage `node:24-slim` build per the design (`ARG SERVICE`, `pnpm install --frozen-lockfile --filter "${SERVICE}..."`, tsup build), runtime copying only `dist`, running as `node`; add a `.dockerignore` (`node_modules`, `dist`, `.env*`, `.git`)
    - _Requirements: 9.1_
  - [ ] 13.2 Create `Dockerfile.app` and retire `nixpacks.toml`
    - `node:24-slim` build stage with `ARG APP`, `ARG VITE_CLERK_PUBLISHABLE_KEY` and `ARG VITE_API_BASE_URL`; `caddy:2-alpine` runtime with `SITE_ROOT=/srv`
    - Change the `Caddyfile` root to `{$SITE_ROOT:./apps/recipe-box/dist}`; delete `nixpacks.toml`
    - In `.github/CODEOWNERS`, replace the `/nixpacks.toml` entry with `/Dockerfile.*` and add the new sensitive paths `/supabase/migrations/`, `/services/api/src/auth/` and `/core/src/db/`
    - _Requirements: 9.1, 9.2_
  - [ ] 13.3 Add the `migrate` GitHub Actions workflow
    - `.github/workflows/migrate.yml` per the design: push to `main` on `supabase/migrations/**`, plus `workflow_dispatch`; `contents: read`; non-cancelling concurrency group; secrets from the `production` environment; `supabase link` then `supabase db push`; actions pinned to commit SHAs
    - _Requirements: 3.4_
  - [ ] 13.4 Run the local deployment smoke checks
    - `docker build` both Dockerfiles; the API image answers `/health`; the Recipe Box image serves `/`, `/account` (deep link) and `/health`; both images report Node v24
    - `actionlint` passes on the workflow
    - _Requirements: 9.1_
  - [ ] 13.5 Write the production smoke-check script
    - `scripts/smoke-production.sh <api-url> <app-url>` (POSIX shell and `curl`), exiting non-zero on the first failure:
      - API `/health` returns 200 with `"status":"ok"`
      - `/v1/me` without a token returns 401 with the error envelope
      - A foreign `Origin` on `/v1/openapi.json` gets no `Access-Control-Allow-Origin`
      - App `/`, `/account` and `/health` return 200
    - The runbook (2.6) lists it as the first check after each deploy
    - _Requirements: 9.1, 9.3_

- [ ] 14. Steering updates
  - [ ] 14.1 Update `tech.md`, `structure.md` and `testing.md`
    - `tech.md`: backend stack (Hono, postgres.js, Supabase, Clerk backend verification, OpenRouter), Dockerfile deploys instead of `nixpacks.toml`, new commands
    - `structure.md`: `services/`, `supabase/`, the `core` subpath exports, Dockerfiles, `.github/workflows/`, `.nvmrc`; remove `nixpacks.toml`
    - `testing.md`: Vitest in `core` and the services, the `pnpm test:db` integration suite and its local-stack requirement
    - _Requirements: 8.1_

- [ ] 15. Final checkpoint
  - Ensure all tests, typecheck, lint and build pass; ask the user if questions arise. Production setup and verification follow the runbook (2.6) and the smoke script (13.5).

## Notes

- Changes to hosted Clerk, Supabase, GitHub or Railway settings aren't tasks here; they are steps in the runbook (2.6). Confirm with the user before carrying any of them out, and use the Supabase, Clerk and Railway MCP servers where available.
- `01.7-walking-skeleton` refers to these task numbers. Keep them stable: give new tasks new numbers instead of renumbering.
- `pnpm test:db` needs Docker and `pnpm db:start`. It is part of the test suite for Requirement 4.4 but isn't run by `pnpm test`.
- Pin every new dependency to an exact or caret version that exists at implementation time, and add test dependencies deliberately, per the testing steering.
- Commit on a branch and open a PR; `main` is protected.
- Handlers added by later specs must be idempotent; the queue delivers at least once.
- Each task references requirements in `requirements.md`; component shapes and SQL are in `design.md`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "11.1", "11.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.3", "5.1"] },
    { "id": 3, "tasks": ["1.5", "2.4", "2.5", "5.3"] },
    { "id": 4, "tasks": ["3.1", "3.3", "5.4"] },
    { "id": 5, "tasks": ["3.4", "3.5", "6.1"] },
    { "id": 6, "tasks": ["3.6", "6.2", "7.1", "9.1"] },
    { "id": 7, "tasks": ["7.2", "9.2", "9.4", "9.5"] },
    { "id": 8, "tasks": ["7.3", "9.3"] },
    { "id": 9, "tasks": ["7.5", "9.7"] },
    { "id": 10, "tasks": ["7.6", "7.7", "9.8"] },
    { "id": 11, "tasks": ["9.9", "9.10"] },
    { "id": 12, "tasks": ["2.6", "3.2", "3.7", "5.2", "9.6", "12.1", "13.3"] },
    { "id": 13, "tasks": ["5.5", "7.4", "9.11", "11.3", "13.1", "13.2"] },
    { "id": 14, "tasks": ["7.8", "12.2", "13.4", "13.5"] },
    { "id": 15, "tasks": ["14.1"] }
  ]
}
```
