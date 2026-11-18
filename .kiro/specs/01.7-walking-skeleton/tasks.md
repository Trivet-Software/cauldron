# Implementation Plan: 01.7-walking-skeleton

## Overview

Build the thin end-to-end slice described in `design.md`: two goal files, pure domain modules and a tenant-scoped repository in `@cauldron/core`, six `/v1` routes, a `compile` handler in the worker, a dev auth mode, a stdio MCP server in `services/mcp`, generic capture/list/detail components in `web-kit`, and Recipe Box screens. Everything is TypeScript, matching the design.

Order: the two first-task verifications from the design (Kiro's working directory for the MCP config, and which MCP v2 SDK transport the tests use) come first because they shape `services/mcp`. Next the migration and the pure `core` modules, which have no I/O and carry Properties 1 to 7. Then the repository (Property 8), the API (Property 9), the worker, the MCP server (Property 10), `web-kit`, and Recipe Box. Each layer ends with its tests; checkpoints follow the pure modules and the backend.

### Prerequisites

Every task in `01.5-backend-foundation` is already checked off, including the phase 1 tasks this spec lists (1.1, 1.2, 1.4, 2.1 to 2.5, 3.1, 3.3, 3.6, 5.1, 5.3, 6.1, 6.2, 7.1 to 7.3, 7.5, 9.1 to 9.5, 9.7, 9.8, 11.1, 11.2). Read the shipped code in `core/src/db`, `core/src/queue`, `core/src/storage`, `core/src/providers`, `services/api/src` and `services/worker/src` before changing it, and keep their numbering and conventions.

### Testing approach

Vitest with `--run`. The design defines Correctness Properties 1 to 10, so each gets its own property-based sub-task using `fast-check` (100 runs, tagged `// Feature: 01.7-walking-skeleton, Property N: ...`). Test sub-tasks are optional (`*`) per the workflow; implementation tasks are not. Database tests are `*.db.test.ts` and run only with `pnpm test:db`.

## Tasks

- [x] 1. Verify MCP assumptions and scaffold `services/mcp`
  - [x] 1.1 Scaffold `services/mcp` and pick the test transport
    - Create the pnpm workspace package `mcp` (`private`, `"type": "module"`, scripts `start`: `tsx --env-file-if-exists=../../.env.local src/index.ts`, `typecheck`, `test`), `tsconfig.json`, `vitest.config.ts`; add `@modelcontextprotocol/server` (v2), `@modelcontextprotocol/client` (dev), `@cauldron/core` (`workspace:*`), `zod`, `tsx`, and `fast-check` (dev)
    - Write a minimal server in `src/index.ts` that registers one placeholder tool and calls `serveStdio(createServer)`; nothing may write to stdout except the protocol
    - Write a throwaway test with the v2 client that connects to the server and lists the tool. Try an in-memory transport first and fall back to a stdio child process if v2 has no in-memory pair
    - Record the chosen transport and why in a file-level comment in `services/mcp/src/index.ts`, so the tool tests in 9.4 reuse it
    - _Requirements: 9.1_
  - [x] 1.2 Add the Kiro MCP config and verify the working directory
    - Create `.kiro/settings/mcp.json` with the `cauldron` server: `pnpm --silent --filter mcp start`, `env: { "API_BASE_URL": "http://localhost:8787" }`, and no token value
    - Check Kiro's documentation for the directory workspace MCP configs run in. If it is not the repo root, change the args to `--dir` form so the command works from any directory; confirm by spawning the configured command from the repo root and from another directory in a script or test and completing the MCP `initialize` handshake
    - Note the result in the Notes section of this file
    - _Requirements: 9.9_
  - [x] 1.3 Write a test for the Kiro MCP config
    - Parse `.kiro/settings/mcp.json`; assert the `cauldron` entry exists, runs the `mcp` package and contains no `DEV_API_TOKEN` value or `Bearer` string
    - _Requirements: 9.9_

- [x] 2. Migration
  - [x] 2.1 Write the walking-skeleton migration
    - Add `supabase/migrations/20261114000100_walking_skeleton.sql` exactly as in the design: `items.ordinal`, the `(tenant_id, source_id, ordinal)` unique constraint, the `items_search_text_trgm` GIN index and the `jobs_compile_source` partial index. Additive only; do not edit applied migrations
    - Run `pnpm db:reset` to confirm it applies
    - _Requirements: 3.6, 3.7, 6.2_
  - [x] 2.2 Write a database test for the new constraint
    - In `core/src/db/` as `walking-skeleton.db.test.ts`: a second item at the same `(tenant, source, ordinal)` fails; a different ordinal succeeds; the two indexes exist
    - _Requirements: 3.6_

- [x] 3. Pure domain modules in `@cauldron/core`
  - [x] 3.1 Add exports and dependencies
    - `core/package.json`: subpath exports `./goals` and `./compile` (isomorphic) and `./collection` (Node-only); `fast-check` devDependency
    - `web-kit/package.json`: workspace dependency on `@cauldron/core` for `goals` types only
    - `services/api/package.json`: `fast-check` devDependency
    - Create empty `index.ts` files under `core/src/goals`, `core/src/compile` and `core/src/collection` so typecheck passes
    - _Requirements: 1.3, 10.3_
  - [x] 3.2 Implement the `goals` module
    - `core/src/goals`: `goalFileSchema` (strict Zod, with the design's refinements: `titleField` is a text property, `required` keys exist, at most one image field, key pattern, name and description lengths), `GoalFile`, `GoalField`, `FieldKind`, `goalFields`, `validateItem`, `failureReasonFor`, `llmJsonSchema`, `canonicalJson`
    - `validateItem` reports field keys only, never values
    - _Requirements: 1.3, 3.5, 5.1, 5.5_
  - [x] 3.3 Write property test for canonical JSON
    - **Property 1: Canonical JSON round trip and key-order invariance**
    - **Validates: Requirements 1.5**
  - [x] 3.4 Write property test for the goal file round trip
    - **Property 2: Goal file round trip**
    - Build the `goalFileArb` generator (1 to 6 properties, one title string, optional list, long-text and image fields) in a shared test helper for reuse by Properties 4, 5 and 7
    - **Validates: Requirements 1.3, 1.4**
  - [x] 3.5 Write property test for item validation
    - **Property 5: Item validation accepts exactly the schema and reports only field keys**
    - **Validates: Requirements 3.5**
  - [x] 3.6 Create the two goal files
    - `apps/recipe-box/goal.json` (title, ingredients, notes, image) and `apps/research-library/goal.json` (title, authors, summary, no image field), as in the design; the slug is the folder name
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 3.7 Write unit tests for goal parsing
    - Both real goal files parse with `goalFileSchema`, have different schemas and a title field; refinement failures: missing `titleField`, two image fields, unknown key
    - _Requirements: 1.1, 1.2, 1.6_
  - [x] 3.8 Implement capture limits and the mapper
    - `core/src/compile`: `CAPTURE_LIMITS`, `sniffImageType`, `captureLabel`, `mapText`, `mapImage`, with the exact rules in the design (first non-empty line is the title; `-`/`*` bullets fill the first list field; remainder fills the first long-text field; image title from filename or "Untitled photo")
    - _Requirements: 2.3, 3.2, 3.3, 9.6_
  - [x] 3.9 Write property test for image type detection
    - **Property 3: Image type detection follows the leading bytes**
    - **Validates: Requirements 2.3, 9.6**
  - [x] 3.10 Write property test for the text mapper
    - **Property 4: Text mapper keeps every line and the title rule**
    - **Validates: Requirements 3.2**
  - [x] 3.11 Write unit tests for the image mapper and labels
    - `mapImage` with and without extension, without filename, with and without an image field; `captureLabel` truncation at 80 characters and the "Untitled capture" fallback
    - _Requirements: 3.3_
  - [x] 3.12 Implement compile state and the extraction request
    - `deriveCompileState` per the state table in the design; `buildExtractionRequest` (system message states the task and that `<source>` content is untrusted; source only in the user message; `output` is `llmJsonSchema(goal)`; no tools)
    - _Requirements: 4.1, 4.2, 5.1, 5.4_
  - [x] 3.13 Write property test for compile state derivation
    - **Property 6: Compile state is derived from the item and the job**
    - **Validates: Requirements 4.1, 4.2**
  - [x] 3.14 Write property test and snapshots for the extraction request
    - **Property 7: The extraction request carries the goal schema and isolates the source**
    - Add snapshot unit tests for one text goal and one image goal
    - **Validates: Requirements 5.1, 5.4**

- [x] 4. Checkpoint: pure modules
  - Ensure `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm test:db` pass, ask the user if questions arise.

- [x] 5. Collection repository and goal registration in `core`
  - [x] 5.1 Implement `registerGoal`
    - `core/src/db/register-goal.ts`, re-exported from `@cauldron/core/db/system`: insert-if-absent, `select ... for update`, hash comparison against the latest version's `content_hash`, then new version plus goal update; returns `created`, `updated` or `unchanged`
    - _Requirements: 1.4, 1.5_
  - [x] 5.2 Implement the collection repository
    - `core/src/collection`: `escapeLike`, `listGoals`, `getGoal`, `createCapture` (source insert and `enqueue` in one transaction, `dedupeKey: 'compile:<sourceId>'`), `getSource`, `listItems` (the design's SQL, keyed by source, with `q` filtering and similarity ordering), `getItem`, `createCollectionStore(db)` wrapping each in `withActor`
    - Worker-side: `loadCompileInput`, `saveItem` (upsert on `(tenant_id, source_id, ordinal)`, `search_text` from the title), `recordCompileUsage` (`idempotency_key = 'compile:<sourceId>'`, `on conflict do nothing`)
    - Use `deriveCompileState` for every row; all statements filter on `tenant_id` explicitly
    - _Requirements: 2.4, 2.5, 3.1, 3.4, 3.6, 3.7, 4.1, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 5.3 Write property test for LIKE escaping
    - **Property 8: LIKE escaping round trip**
    - **Validates: Requirements 6.2**
  - [x] 5.4 Write database tests for `registerGoal`
    - `core/src/db/register-goal.db.test.ts`: first call creates version 1; the same file is `unchanged` with one `goal_versions` row; a changed file creates version 2; a file with reordered keys is `unchanged`; anon can read the registered app goal
    - _Requirements: 1.4, 1.5_
  - [x] 5.5 Write database tests for the collection repository
    - `core/src/collection/collection.db.test.ts`: `createCapture` creates one source and one `compile` job together, and a failing enqueue leaves no source; `listItems` returns pending, failed and ready entries newest first, with `q` matching case-insensitively, ordering by similarity and handling `%` and `_`; user B's `getItem`, `getSource` and `listItems` see nothing of user A's; `saveItem` twice leaves one row and `search_text` equals the title
    - _Requirements: 2.4, 2.5, 3.6, 3.7, 6.1, 6.2, 6.4, 6.5_

- [x] 6. API service
  - [x] 6.1 Add the new error codes
    - `services/api/src/http/errors.ts`: add `payload_too_large` (413) and `unsupported_media_type` (415) to `ErrorCode` and to the status switch for non-`ApiError` HTTP exceptions; codes are only added, never renamed
    - _Requirements: 2.3_
  - [x] 6.2 Add dev auth configuration and the guards
    - `services/api/src/env.ts`: optional `AUTH_MODE`, `DEV_API_TOKEN`, `DEV_USER_ID`, `SUPABASE_SECRET_KEY`, `NODE_ENV`, `RAILWAY_ENVIRONMENT`, `APPS_DIR`; `devAuthRules` refinement (three required variables, token at least 32 characters) chained after `providerRules`
    - `checkAuthMode(env)` throwing `StartupError` naming `NODE_ENV` and `RAILWAY_ENVIRONMENT`; add `DEV_API_TOKEN` and `SUPABASE_SECRET_KEY` to the logger's `REDACT_PATHS`
    - `services/api/src/auth/dev-token.ts`: `DEV_SESSION_ID`, `withDevToken` using SHA-256 digests and `timingSafeEqual`, falling through to the wrapped verifier otherwise
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 6.3 Write tests for dev auth
    - **Property 9: The dev token authenticates only the exact token** (fast-check; calls `verify` exactly once for any other token)
    - Unit tests: `loadEnv` per variable, 31 versus 32 character token; `checkAuthMode` with `NODE_ENV=production` and with `RAILWAY_ENVIRONMENT`; startup warning logged and token never logged; with `AUTH_MODE` unset the dev token string gets 401
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7**
  - [x] 6.4 Implement app-goal registration at startup
    - `services/api/src/goals/register-app-goals.ts` (`registerAppGoals`, `RegistrationOutcome`): list `appsDir/*/goal.json`, parse, call `withSystem` plus `registerGoal`; log path and Zod issues for bad files and continue; never rejects
    - `eslint.config.js`: allow `@cauldron/core/db/system` in this one file only
    - _Requirements: 1.4, 1.5, 1.6_
  - [x] 6.5 Write tests for registration
    - Over a temp directory: valid, malformed JSON and schema-invalid files; the valid goal registers, the others log their path and issues, and the function resolves
    - _Requirements: 1.4, 1.6_
  - [x] 6.6 Add dependencies and the goals routes
    - `ApiDeps` gains `collection: CollectionStore` and `storageFor(principal, bearer)`; production `storageFor` uses `userStorage` for Clerk sessions and `serviceStorage` when `sessionId === DEV_SESSION_ID`
    - `routes/goals.ts`: `GET /v1/goals` and `GET /v1/goals/{slug}`, both `access: 'anonymous'`, app goals only, with `GoalSummary` and `GoalDetail` schemas; register in `routes/index.ts`
    - _Requirements: 1.7_
  - [x] 6.7 Implement `POST /v1/captures`
    - `routes/captures.ts` (`access: 'user'`): multipart schema with the file part declared as `z.any().openapi({ type: 'string', format: 'binary' })`; 12 MB body limit; handler order from the design (resolve goal, exactly one of text or image, text limit, image limit and magic-byte sniff, then upload followed by `createCapture`); `client` defaults to `web`; returns 202 `{ sourceId, state: 'queued' }`
    - Nothing is stored or queued when any check fails
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 6.8 Implement the source and item routes
    - `routes/sources.ts` (`GET /v1/sources/{id}`) and `routes/items.ts` (`GET /v1/items` with `goal`, `q`, `limit`; `GET /v1/items/{id}` replacing the image field with a signed URL, 300 s); non-UUID ids rejected by the path schema; missing or other-tenant rows return the 404 envelope; unknown goal on list returns 400 with the slugs
    - _Requirements: 4.1, 4.2, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 6.9 Wire the API entry point
    - `startApi`: `checkAuthMode` first, wrap the Clerk verifier with `withDevToken` only in dev mode and log the warning, build `collection` with `createCollectionStore`, call `registerAppGoals` with `APPS_DIR` (default `../../apps`), and resolve `listening` after both the socket is bound and registration has finished
    - _Requirements: 1.4, 8.1, 8.3, 8.5, 8.6, 10.1_
  - [x] 6.10 Write API route tests
    - With `createApp(deps)`, `app.request()`, a fake verifier, an in-memory `CollectionStore` and in-memory `TenantStorage`: every new operation declares `security` (goals routes `[]`, others `bearerAuth`); 401 without a token and with a broken token on the goals routes; capture happy paths (stored bytes equal sent bytes, path starts with the tenant), unknown goal, both or neither input, 100,000 versus 100,001 characters, 10 MB versus 10 MB + 1, a `.png`-named text file, and untouched store and storage on every rejection; item detail image URL expiry at most 600 s; null repository result returns 404; stable error codes including the two new ones; CORS preflight for a multipart request allows only `APP_ORIGINS`
    - _Requirements: 1.7, 2.1, 2.2, 2.3, 4.1, 4.2, 6.1, 6.3, 6.4, 10.3_

- [x] 7. Worker compile handler
  - [x] 7.1 Implement the `compile` handler and registry changes
    - `services/worker/src/handlers/compile.ts`: `createCompileHandler({ mode })` following the design flowchart (stage `extracting`, `loadCompileInput`, `ctx.storage.get`, mapper or one `providers.llm.complete`, `validateItem`, `signal.throwIfAborted()`, `saveItem`, usage row in `llm` mode, outcome `ready`); `NonRetryableError` for a missing source or goal and for validation failure with field keys only; provenance `{ mode, sourceKind, model? }`; set the image field to the storage path after validating LLM output
    - `handlers/index.ts`: `createHandlers({ compileMode })` while keeping the exported `handlers`; `env.ts`: `COMPILE_MODE` (`mapper` default or `llm`, invalid value names the variable); `startWorker` builds the registry from it
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 7.2 Write unit tests for the worker changes
    - `createHandlers` registers `compile`; `COMPILE_MODE` parsing; in default mode a provider that fails the test if called is never called
    - _Requirements: 5.2_
  - [x] 7.3 Write database tests for the compile handler
    - `services/worker/src/handlers/compile.db.test.ts`, same approach as `reembed.db.test.ts`: text and photo sources give one item, outcome `ready` and `search_text`; running twice leaves one item; text with no non-empty line throws `NonRetryableError` naming `title`; a path in another tenant throws before any read; `llm` mode with a memory recording store makes one provider call, writes one `usage` row after two runs, and fails the job on invalid recorded output
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.7, 5.1, 5.3, 5.5_

- [x] 8. Checkpoint: backend
  - Ensure `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm test:db` pass, ask the user if questions arise.

- [x] 9. MCP server
  - [x] 9.1 Implement the API client and goal resolution
    - `services/mcp/src/api.ts`: `createApiClient` (injectable `fetch`, bearer header set only inside the client), `ApiToolError(code, message)`, envelope errors as `[code] message`, network failure as "Could not reach the API at <API_BASE_URL>."
    - `resolveGoal(goals, text)`: exact slug or name, case-insensitive; no match lists every available slug
    - _Requirements: 9.4, 9.8_
  - [x] 9.2 Write property test for goal resolution
    - **Property 10: Goal resolution by slug or name**
    - **Validates: Requirements 9.4**
  - [x] 9.3 Implement the server, tools, resource and startup
    - Replace the placeholder from 1.1: `parseEnv` over `API_BASE_URL` and `DEV_API_TOKEN` (on `EnvError` write to stderr and exit 1); tools `list_goals`, `capture`, `search`, `get_item` with Zod schemas and structured plus text results; resource `examples://goals/recipe-box`
    - `capture` accepts exactly one of `text` or `imagePath`; for images, `stat`, size check against `CAPTURE_LIMITS.maxImageBytes`, read, and `sniffImageType` before any request; send `client=mcp`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
  - [x] 9.4 Write tool tests against a fake API
    - Using the transport chosen in 1.1 and a fake `fetch`: tool and resource listing; `capture` text and image send `client=mcp` and return ID and state; bad image path, missing file and oversize send nothing; `search` and `get_item` return structured content and text; a 404 envelope and a network error become tool errors that never contain the token; missing env names both variables
    - _Requirements: 9.2, 9.3, 9.5, 9.6, 9.7, 9.8, 10.3_

- [x] 10. `web-kit` collection layer and components
  - [x] 10.1 Implement the collection client and hooks
    - `web-kit/src/collection/`: `ApiRequestError`, `createCollectionClient(apiFetch)` (multipart `FormData` for capture; envelope `message` on failure with a "Request failed (status)." fallback), `useCollectionClient(baseUrl)`, `useGoal`, `useItems` (polls every `pollMs`, default 2000, while any entry is `queued` or `extracting`; clears its timer on unmount; exposes `refresh`), `useItem`
    - Add the `./collection` export in `web-kit/package.json`
    - _Requirements: 7.2, 7.5_
  - [x] 10.2 Implement `CaptureForm`, `ItemList` and `ItemDetail`
    - `web-kit/src/components/{capture-form,item-list,item-detail}/index.tsx`, re-exported from `components/index.ts`, with Tailwind semantic tokens and `cn()`
    - `CaptureForm`: text area and one image picker (`accept="image/jpeg,image/png,image/webp"`), disabled while sending, error in `role="alert"`, clears on success; `ItemList`: 250 ms debounced search, state badges, failure reasons, `renderLink` for ready rows; `ItemDetail`: renders each goal field by kind with no recipe-specific code
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [x] 10.3 Write tests for the client and hooks
    - Envelope message and non-envelope fallback; `FormData` shape on capture; `useItems` with fake timers refetches every 2 s while a row is pending, stops when none is, and leaves no timer after unmount
    - _Requirements: 7.2, 7.5_
  - [x] 10.4 Write component tests
    - React Testing Library with a fake client: `CaptureForm` submit, disabled state and error alert; `ItemList` search debounce and links only for ready rows; `ItemDetail` renders one field of each kind, with a snapshot
    - _Requirements: 7.1, 7.3, 7.4, 7.5_

- [x] 11. Recipe Box screens
  - [x] 11.1 Add the routes and goal constant
    - `apps/recipe-box/src/lib/goal.ts` (`GOAL_SLUG = 'recipe-box'`); `routes/_auth/items.index.tsx` (`CaptureForm` above `ItemList`, `refresh()` after capture) and `routes/_auth/items.$itemId.tsx` (`ItemDetail`); add a link to `/items` on the home page and update its snapshot deliberately; never edit `routeTree.gen.ts` by hand
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.7_
  - [x] 11.2 Write routing tests
    - Signed-out visits to `/items` and `/items/x` redirect to `/sign-in`; signed-in render of `/items` mounts the capture form and list with a mocked client
    - _Requirements: 7.7_

- [x] 12. Documentation and steering
  - [x] 12.1 Document the new variables and local run
    - `.env.example`: `AUTH_MODE`, `DEV_API_TOKEN` (marked a local-only secret, `openssl rand -hex 32`), `DEV_USER_ID`, `SUPABASE_SECRET_KEY` for the API, `APPS_DIR`, `COMPILE_MODE`, `API_BASE_URL`; `README.md` local section covering the slice's run steps and the manual check in the design
    - _Requirements: 10.1, 10.2, 10.4_
  - [x] 12.2 Update steering and the deferred notes
    - `structure.md`: `services/mcp`, `apps/*/goal.json`, `core` `goals`/`compile`/`collection` subpaths; `tech.md`: MCP server and dev auth mode; `testing.md`: `fast-check` and the new test files
    - _Requirements: 10.3_

- [x] 13. Final checkpoint
  - Ensure `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm test:db` pass, ask the user if questions arise.

## Notes

- Tasks marked `*` are optional test sub-tasks and can be skipped for a faster MVP. The design defines Correctness Properties, so each has its own `fast-check` sub-task (Properties 1 to 10 in tasks 3.3, 3.4, 3.9, 3.10, 3.5, 3.13, 3.14, 5.3, 6.3, 9.2).
- The manual check (Requirement 10.4) is a human step and is documented in the README by 12.1, not a task.
- Tasks 1.2 and 1.3 were skipped by the user's decision: no Kiro MCP config file (`.kiro/settings/mcp.json`) is added, and the README documents manual registration instead (so Requirement 9.9 is met by documentation, not by a committed file). Findings from the working-directory check that still apply: Kiro's MCP configuration docs do not state the working directory for stdio servers. The plain form `pnpm --silent --filter mcp start` completed the MCP `initialize` handshake when spawned from the repo root and from `services/api` (inside the repo). From `/tmp` it failed with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` (pnpm found no workspace), and from the home directory it failed walking the workspace. The `--dir` form, `pnpm --silent --dir <absolute repo path> --filter mcp start`, completed the handshake from both `/tmp` and the repo root. `--dir` needs an absolute path, and Kiro's config only expands `${ENV_VAR}` placeholders, so a committed config would have to hold a machine-specific path.
- The MCP v2 test transport is chosen in 1.1; record the outcome here: **in-memory**. `@modelcontextprotocol/client` v2 exports `InMemoryTransport.createLinkedPair()`. Connect `server.connect(serverEnd)` and `client.connect(clientEnd)`, then call `client.listTools()` and `client.callTool()`. No child process is needed, so a fake `fetch` can be injected into the tools. `createServer` lives in `services/mcp/src/server.ts` (not `index.ts`) so tests import it without starting `serveStdio`; the pattern is in `services/mcp/src/server.test.ts` and recorded in the comment at the top of `src/index.ts`. The real stdio entry point (`pnpm --filter mcp start`) was also checked by hand: `initialize` and `tools/list` over stdin returned only protocol JSON on stdout.
- Deferred, per the design: copying `apps/*/goal.json` into the API image for deployment, rejecting a photo for a goal with no image field, and a schema lock once items exist.
- Each task references granular acceptance criteria in `requirements.md`; shapes and SQL are in `design.md`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2", "6.1", "6.2"] },
    { "id": 2, "tasks": ["1.3", "3.3", "3.4", "3.5", "3.6", "3.8"] },
    { "id": 3, "tasks": ["3.7", "3.9", "3.10", "3.11", "3.12", "5.1", "6.3", "9.1"] },
    { "id": 4, "tasks": ["3.13", "3.14", "5.2", "5.4", "6.4", "9.2", "9.3"] },
    { "id": 5, "tasks": ["5.3", "5.5", "6.5", "6.6", "7.1", "9.4", "10.1", "12.1"] },
    { "id": 6, "tasks": ["6.7", "7.2", "7.3", "10.2", "10.3"] },
    { "id": 7, "tasks": ["6.8", "10.4", "11.1"] },
    { "id": 8, "tasks": ["6.9", "11.2"] },
    { "id": 9, "tasks": ["6.10", "12.2"] }
  ]
}
```
