# Requirements Document

Lives across `/services/api`, `/services/worker`, `/services/mcp`, `/core`, `/supabase/migrations` and `/apps/recipe-box`. Implement after the parts of `01.5-backend-foundation` listed below and before `02-goal-engine`.

## Introduction

The walking skeleton is one thin path through every layer of Cauldron, running end to end on a developer's machine: a goal file defines an app, a user captures text or a photo, the worker compiles it into a structured item, and the user finds it again from the web app or from Kiro over MCP. Each layer does the least that proves the path works. The feature specs (goal-engine, capture-compile, search, web-kit, mcp-server) then thicken their layer instead of building it from nothing.

The skeleton uses the real interfaces from `01.5-backend-foundation` (`withActor`, the job queue, `TenantStorage`, the provider layer), so most of its code is kept. The parts expected to be replaced are the generic item screens (replaced by the web-kit view renderer), the title search (replaced by search), the dev-only auth mode (replaced by Clerk OAuth in mcp-server) and the minimal goal loader (replaced by goal-engine registration).

### Relationship to 01.5-backend-foundation

The skeleton needs these `01.5-backend-foundation` tasks done first: 1.1, 1.2, 1.4, 2.1–2.5, 3.1, 3.3, 3.6, 5.1, 5.3, 6.1, 6.2, 7.1–7.3, 7.5, 9.1–9.5, 9.7 (`/health` only), 9.8, 11.1 and 11.2.

These `01.5-backend-foundation` tasks can wait until after the skeleton: 2.6, 3.2, 3.7, 5.2 (unless the optional LLM path in Requirement 5 is used), 7.4, the re-embed part of 7.7, 9.6, 11.3, 12, 13 and 14.

### Out of scope

- Goal drafting, validation beyond a schema parse, versioning, schema lock, export and import (goal-engine).
- URL and PDF capture, SSRF-safe fetching, repair attempts, needs-review drafts, provenance, multiple items per source (capture-compile).
- Embeddings, full-text ranking and vague-description search (search).
- Pages and page summaries (capture-compile Requirement 13).
- The view-spec renderer, custom views, the Developer section and the public demo (web-kit).
- MCP over HTTP, Clerk OAuth, MCP API keys, scopes and goal-authoring tools (mcp-server).
- Rate limits, spend caps and the developer role (auth-abuse).
- A Research Library web UI, and deployment to Railway.

## Glossary

- **Slice**: the end-to-end path this spec delivers: goal file → capture → compile job → item → list, detail and search.
- **Dev auth mode**: a local-only API mode in which a static token stands in for a Clerk session, so a local MCP server can act as one configured user.
- **Mapper**: deterministic code that turns a source into item fields without an LLM (capture-compile Requirement 7).

## Requirements

### Requirement 1: Minimal app goal files
**User Story:** As a developer, I want an app defined by one goal file from the start, so that the "one file per app" model is real before goal-engine exists.
#### Acceptance Criteria
1. WHEN the repo is set up, THE SYSTEM SHALL contain `apps/recipe-box/goal.json` with a name, slug, description and an item schema of at most a few fields (for example `title`, `ingredients`, `notes`, `image`), one of which is marked as the title field.
2. WHEN the repo is set up, THE SYSTEM SHALL contain `apps/research-library/goal.json` with a different item schema (for example `title`, `authors`, `summary`), so that two apps run on one skeleton.
3. WHEN a goal file is written, THE SYSTEM SHALL use a format that is a subset of the goal-engine goal file, so that goal-engine extends these files instead of replacing them.
4. WHEN the API service starts, THE SYSTEM SHALL read every `apps/*/goal.json`, parse it against a Zod schema, and store each valid one as an app goal owned by the system owner, with the app folder name as its slug (goal-engine Requirement 8.1, 8.3).
5. WHEN a goal file's content matches the stored app goal, THE SYSTEM SHALL change nothing, so that restarting the API does not duplicate goals (goal-engine Requirement 8.2).
6. IF a goal file fails to parse, THEN THE SYSTEM SHALL log the file path and the errors, skip that goal, and keep starting.
7. WHEN `GET /v1/goals` is called, THE SYSTEM SHALL return the app goals by name, slug and schema fields.

### Requirement 2: Capture text and one photo
**User Story:** As a user, I want to paste text or upload a photo into an app, so that I can save something in the simplest way.
#### Acceptance Criteria
1. WHEN a signed-in user sends `POST /v1/captures` with a goal slug and either text or one image, THE SYSTEM SHALL accept it as a source for that goal and return the source ID and its compile status.
2. IF the capture names no goal or an unknown goal, THEN THE SYSTEM SHALL reject it with 400 and an error listing the available goal slugs.
3. IF the text exceeds 100,000 characters, the image exceeds 10 MB, or the image is not JPEG, PNG or WebP, THEN THE SYSTEM SHALL reject the capture with an error naming the limit, and store and queue nothing (capture-compile Requirement 1.3).
4. WHEN a capture is accepted, THE SYSTEM SHALL store the raw text or image unchanged in the private `sources` bucket under the user's tenant prefix, record a `sources` row with the capture client (`web` or `mcp`) and capture time, and then enqueue one `compile` job (capture-compile Requirements 2.1, 2.2, 4.1).
5. WHEN a source and its job are created, THE SYSTEM SHALL store them in the capturing user's tenant through `withActor`, so that RLS applies (goal-engine Requirement 8.7).

### Requirement 3: Deterministic compile
**User Story:** As a developer, I want captures compiled without an LLM, so that the slice works with no API key and gives the same result every time.
#### Acceptance Criteria
1. WHEN the worker claims a `compile` job, THE SYSTEM SHALL load the raw source through the job's tenant-scoped storage and database scope, never through a privileged handle.
2. WHEN the source is text, THE SYSTEM SHALL map it to the goal's fields with a generic mapper: the first non-empty line becomes the title field; lines starting with `-` or `*` fill the goal's first array-of-strings field, if any; the remaining text fills the goal's first long-text field, if any.
3. WHEN the source is an image, THE SYSTEM SHALL set the title field from the image's filename (or "Untitled photo" when there is none) and link the stored image to the item, without OCR.
4. WHEN the mapped result validates against the goal's item schema, THE SYSTEM SHALL save one item in the user's tenant and finish the job with outcome `ready`.
5. IF the mapped result does not validate, THEN THE SYSTEM SHALL finish the job as `failed` with a user-readable reason naming the missing or invalid fields (capture-compile Requirement 4.5).
6. WHEN a `compile` job runs more than once for the same source, THE SYSTEM SHALL leave exactly one item for that source (capture-compile Requirement 4.4).
7. WHEN an item is saved, THE SYSTEM SHALL fill its `search_text` from the title field so that Requirement 6 can find it.

### Requirement 4: Compile status
**User Story:** As a user, I want to see when my capture is ready or why it failed, so that I know what happened.
#### Acceptance Criteria
1. WHEN a client requests a source or item, THE SYSTEM SHALL report its compile state as `queued`, `extracting`, `ready` or `failed`, derived from the job's status, stage and outcome as in the `01.5-backend-foundation` design.
2. WHEN the state is `failed`, THE SYSTEM SHALL include the failure reason.
3. WHEN a compile succeeds, THE SYSTEM SHALL reach `ready` within 5 s of capture on a local stack with the worker running.

### Requirement 5: Optional LLM extraction
**User Story:** As a developer, I want to try a real model on the same slice, so that I can see LLM extraction work without building the full pipeline.
#### Acceptance Criteria
1. WHERE `COMPILE_MODE=llm` is set, THE SYSTEM SHALL make one structured-output call through the `01.5-backend-foundation` LLM provider interface, built from the goal's item schema and the source (text, or the image as an image part), instead of running the mapper in Requirement 3.2 and 3.3.
2. WHEN `COMPILE_MODE` is unset or `mapper`, THE SYSTEM SHALL make no LLM call.
3. WHEN the LLM path runs with `PROVIDERS=mock`, THE SYSTEM SHALL use recorded responses, so that tests stay deterministic (capture-compile Requirement 16.2).
4. WHEN the LLM path places source content in the request, THE SYSTEM SHALL mark it as untrusted data separate from the instructions and give the model no tools (capture-compile Requirement 8.2).
5. WHEN the LLM returns output, THE SYSTEM SHALL validate it against the goal's item schema before saving, and apply Requirement 3.4 and 3.5 to the result.

### Requirement 6: List, view and search items
**User Story:** As a user, I want to see my saved items and find one by name, so that I can get back to what I saved.
#### Acceptance Criteria
1. WHEN a signed-in user calls `GET /v1/items?goal=<slug>`, THE SYSTEM SHALL return that user's items for the goal, newest first, with each item's title, compile state and capture time.
2. WHEN the request includes `q`, THE SYSTEM SHALL return only items whose `search_text` matches `q` case-insensitively, ranked by trigram similarity.
3. WHEN a signed-in user calls `GET /v1/items/:id`, THE SYSTEM SHALL return the item's fields and, for an image source, a signed URL for the image that expires within 10 minutes (`01.5-backend-foundation` Requirement 5.3).
4. IF the item belongs to another tenant or does not exist, THEN THE SYSTEM SHALL return 404 with the error envelope.
5. WHEN any of these endpoints runs, THE SYSTEM SHALL query through `withActor`, so that RLS limits results to the caller's tenant.

### Requirement 7: Recipe Box screens
**User Story:** As a user, I want to capture and browse recipes in Recipe Box, so that I can see the whole slice work in the browser.
#### Acceptance Criteria
1. WHEN a signed-in user opens Recipe Box, THE SYSTEM SHALL show a capture form with a text area and a single image picker, and submit it to `POST /v1/captures` with the `recipe-box` goal slug.
2. WHEN a signed-in user opens the items list, THE SYSTEM SHALL show their items with title and compile state, and refresh items that are not yet `ready` or `failed` every 2 s until they are.
3. WHEN the user types in the search box, THE SYSTEM SHALL call `GET /v1/items` with `q` and show the results.
4. WHEN the user opens an item, THE SYSTEM SHALL render every field in the goal's schema generically (label and value, lists as lists, the image as an image), with no recipe-specific code.
5. WHEN a request fails, THE SYSTEM SHALL show the error envelope's `message`.
6. WHEN these screens are built, THE SYSTEM SHALL place the generic list, detail and capture components in `web-kit`, so that Research Library can mount them later.
7. WHEN a signed-out user opens these screens, THE SYSTEM SHALL redirect to `/sign-in`, as other protected routes do.

### Requirement 8: Dev auth mode
**User Story:** As a developer, I want a local MCP server to act as me without OAuth, so that I can try MCP before the mcp-server spec.
#### Acceptance Criteria
1. WHERE `AUTH_MODE=dev` is set with `DEV_API_TOKEN` and `DEV_USER_ID`, THE SYSTEM SHALL treat a request carrying `Authorization: Bearer <DEV_API_TOKEN>` as the user `DEV_USER_ID`, with that ID as user and tenant ID.
2. WHEN dev auth mode compares tokens, THE SYSTEM SHALL use a constant-time comparison, and SHALL still verify any other bearer token as a Clerk session token.
3. IF `AUTH_MODE=dev` is set while `NODE_ENV=production` or `RAILWAY_ENVIRONMENT` is set, THEN THE SYSTEM SHALL refuse to start and name the conflicting variables.
4. IF `AUTH_MODE=dev` is set without `DEV_API_TOKEN` or `DEV_USER_ID`, or with a `DEV_API_TOKEN` shorter than 32 characters, THEN THE SYSTEM SHALL refuse to start and name the problem.
5. WHEN `AUTH_MODE` is unset, THE SYSTEM SHALL accept only Clerk session tokens.
6. WHEN dev auth mode is active, THE SYSTEM SHALL log a warning at startup and never log the token.
7. WHEN `DEV_USER_ID` is set to the developer's own Clerk user ID, THE SYSTEM SHALL show items captured over MCP in Recipe Box when that developer signs in, because both resolve to the same tenant.

### Requirement 9: Local MCP server
**User Story:** As a developer using Kiro, I want to save and find items from chat, so that the slice works from an AI client as well as the browser.
#### Acceptance Criteria
1. WHEN the repo is set up, THE SYSTEM SHALL contain a TypeScript MCP server in `/services/mcp` that is a pnpm workspace package, runs over stdio, and calls only the `/v1` API (mcp-server introduction).
2. WHEN the MCP server starts, THE SYSTEM SHALL read `API_BASE_URL` and `DEV_API_TOKEN` from its environment and fail fast, naming any that are missing.
3. WHEN an MCP client connects, THE SYSTEM SHALL expose the tools `list_goals`, `capture`, `search` and `get_item`, and the resource `examples://goals/recipe-box` returning the Recipe Box goal file.
4. WHEN a tool takes a goal argument, THE SYSTEM SHALL accept a goal slug or an exact name (case-insensitive); IF it matches no goal, THEN THE SYSTEM SHALL return an error listing the available goals.
5. WHEN `capture` is called, THE SYSTEM SHALL accept either text or a local image file path, send it to `POST /v1/captures` with capture client `mcp`, and return the source ID and compile state.
6. IF the image path is not a readable JPEG, PNG or WebP file within the size limit in Requirement 2.3, THEN THE SYSTEM SHALL return an error and send nothing.
7. WHEN `search` or `get_item` is called, THE SYSTEM SHALL return the results of `GET /v1/items` or `GET /v1/items/:id` as structured content plus a short text summary.
8. WHEN an API call fails, THE SYSTEM SHALL return the error envelope's `code` and `message` as a tool error, never the token.
9. WHEN the repo is set up, THE SYSTEM SHALL include a workspace `.kiro/settings/mcp.json` entry that starts the server from the repo, with the token read from the developer's environment, not committed.

### Requirement 10: Local run and verification
**User Story:** As a developer, I want one documented way to run and check the slice, so that I can show it working.
#### Acceptance Criteria
1. WHEN a developer runs `pnpm dev:stack` against the local Supabase stack, THE SYSTEM SHALL start the API, the worker and Recipe Box; the MCP server is started by Kiro.
2. WHEN a new developer sets up the slice, THE SYSTEM SHALL document `AUTH_MODE`, `DEV_API_TOKEN`, `DEV_USER_ID`, `COMPILE_MODE` and the MCP server's variables in `.env.example`, marking the token as a local-only secret.
3. WHEN the test suite runs, THE SYSTEM SHALL include tests for the text mapper, goal-file parsing and registration, capture limits, compile idempotency, cross-tenant item reads returning 404, the dev auth mode guards, and the MCP tools against a fake API.
4. WHEN the slice is complete, THE SYSTEM SHALL pass a documented manual check: capture text in Recipe Box and see it `ready`; capture a photo and see it on the detail page; search by title; capture text from Kiro over MCP and see it in Recipe Box; find it with the MCP `search` tool.

---
