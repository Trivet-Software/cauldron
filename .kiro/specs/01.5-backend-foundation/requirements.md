# Requirements Document

Lives across `/services/api`, `/services/worker`, `/core` and `/supabase/migrations`. Implement after `01-foundation` and before `02-goal-engine`: every later spec builds on it.

## Introduction

The backend foundation delivers the smallest backend that proves the server side of the stack works end to end: the `/v1` API service, Clerk token verification, the shared database schema with row-level security, raw-source storage, the job queue with an empty worker, and the LLM and embedding provider interfaces with a mock. No goal-engine, capture, or search behavior yet. Those specs add their logic on top of these pieces.

This spec owns the base of two later specs, which build on it rather than repeat it:
- **public-api-sdk**: the service skeleton, `/v1` routing and the OpenAPI document (its Requirement 1), and Clerk session-token auth (its Requirement 2.1).
- **auth-abuse**: Clerk token verification, RLS and service-role scoping (its Requirements 1.5–1.7 and 2).

## Requirements

### Requirement 1: API service skeleton
**User Story:** As a developer, I want a running `/v1` service from the start, so that every feature spec adds endpoints instead of building a server.
#### Acceptance Criteria
1. WHEN the repo is set up, THE SYSTEM SHALL contain a TypeScript API service in `/services/api` that is a pnpm workspace package and uses domain logic only from `/core`.
2. WHEN the service runs, THE SYSTEM SHALL serve every endpoint under `/v1` and an unauthenticated `/health` endpoint outside it.
3. WHEN an endpoint is defined, THE SYSTEM SHALL describe it in an OpenAPI document generated from the route definitions and served at `/v1/openapi.json`.
4. WHEN a request fails, THE SYSTEM SHALL return a JSON error with a stable `code`, a human-readable `message`, and the HTTP status.
5. WHEN a browser calls the API, THE SYSTEM SHALL allow CORS only from the configured app origins.

### Requirement 2: Clerk session-token verification
**User Story:** As a user, I want the API to know who I am from my sign-in, so that my data is protected without a second login.
#### Acceptance Criteria
1. WHEN a request carries `Authorization: Bearer <Clerk session token>`, THE SYSTEM SHALL verify its signature, expiry and authorized party (the configured app origins) before running the handler.
2. WHEN a token is valid, THE SYSTEM SHALL use its `sub` claim as both the user ID and the tenant ID (auth-abuse Requirement 2.1).
3. IF a token is missing or invalid on an endpoint that requires sign-in, THEN THE SYSTEM SHALL return 401 and run nothing else.
4. WHEN an endpoint is marked anonymous read-only, THE SYSTEM SHALL serve it without a token (auth-abuse Requirement 10).
5. WHEN a signed-in user calls `GET /v1/me`, THE SYSTEM SHALL return their user ID, tenant ID and whether they have the developer role (auth-abuse Requirement 11).

### Requirement 3: Shared database schema and migrations
**User Story:** As a developer, I want one schema that every goal shares, so that a new goal needs no migration.
#### Acceptance Criteria
1. WHEN migrations are applied, THE SYSTEM SHALL create the shared tables: `goals`, `goal_versions`, `sources`, `jobs`, `items`, `drafts`, `pages`, `page_items`, `usage`, `api_keys`.
2. WHEN migrations are applied, THE SYSTEM SHALL enable the `vector` (pgvector) and `pg_trgm` extensions, and create one full-text index and one vector index on `items` that serve every goal.
3. WHEN a row is stored in any table holding user data, THE SYSTEM SHALL require non-null `tenant_id` and `user_id`; rows owned by the system owner (app goals) SHALL use a reserved owner value instead.
4. WHEN a schema change is needed, THE SYSTEM SHALL add it as a new SQL migration in `/supabase/migrations`, applied in order by the Supabase CLI, the same way locally and in production.

### Requirement 4: Row-level security
**User Story:** As a user, I want the database itself to keep my data private, so that a bug in one endpoint can't leak it.
#### Acceptance Criteria
1. WHEN the database is configured, THE SYSTEM SHALL register Clerk as a Supabase third-party auth provider so Supabase accepts Clerk session tokens.
2. WHEN any table holding user data is created, THE SYSTEM SHALL enable RLS on it with policies that limit reads and writes to rows whose `tenant_id` matches the token's `sub`, plus the shared-read exceptions in auth-abuse Requirement 2.3.
3. WHEN server code or the worker uses the service-role key, THE SYSTEM SHALL pass the acting user through a single data-access helper that adds the tenant filter to every query (auth-abuse Requirement 1.6).
4. WHEN the test suite runs, THE SYSTEM SHALL include tests in which one user tries to read and write another user's rows and gets no rows and no changes.

### Requirement 5: Raw-source storage
**User Story:** As a user, I want my uploads stored privately, so that only I can read my captured sources.
#### Acceptance Criteria
1. WHEN migrations are applied, THE SYSTEM SHALL create a private Supabase Storage bucket for raw sources.
2. WHEN a file is stored, THE SYSTEM SHALL place it under a path that starts with the owner's tenant ID, with storage policies that allow access only to that tenant.
3. WHEN a client needs to read a stored source, THE SYSTEM SHALL return a short-lived signed URL (at most 10 minutes), never a public one.

### Requirement 6: Job queue and worker skeleton
**User Story:** As a developer, I want a working queue and worker before compile logic exists, so that capture-compile only adds job handlers.
#### Acceptance Criteria
1. WHEN the repo is set up, THE SYSTEM SHALL contain a worker service in `/services/worker` that claims jobs from the `jobs` table with `FOR UPDATE SKIP LOCKED`.
2. WHEN a worker claims a job, THE SYSTEM SHALL set a lease (60 s) and return the job to `queued` if the lease expires (capture-compile Requirement 4.3).
3. WHEN a job type has a registered handler, THE SYSTEM SHALL run it; this spec registers only a no-op `ping` handler that marks its job done.
4. WHEN the worker receives a shutdown signal, THE SYSTEM SHALL stop claiming jobs and finish or release the ones it holds.

### Requirement 7: LLM and embedding provider interfaces
**User Story:** As a developer, I want the provider interfaces and mock in place first, so that every spec that calls an LLM tests against the same mock.
#### Acceptance Criteria
1. WHEN `/core` is built, THE SYSTEM SHALL expose an LLM provider interface (structured-output completion, with image input) and an embedding provider interface.
2. WHEN real providers are configured, THE SYSTEM SHALL use OpenRouter for both LLM calls and embeddings (`openai/text-embedding-3-small`, 1536 dimensions through OpenRouter's embeddings endpoint), with one OpenRouter API key and the model names read from configuration.
3. WHEN tests or demo mode run, THE SYSTEM SHALL use the mock providers (capture-compile Requirement 16.2).
4. WHEN any provider call completes, THE SYSTEM SHALL return its token counts and cost so callers can record usage (auth-abuse Requirement 3).
5. WHEN an embedding is stored, THE SYSTEM SHALL store the embedding model name and dimension count with it.
6. IF the configured embedding model differs from the model stored with existing embeddings, THEN THE SYSTEM SHALL compare only embeddings from the configured model, report how many items need re-embedding on `/health`, and re-embed them in the background.

### Requirement 8: Local development
**User Story:** As a developer, I want to run the whole stack on my machine, so that I can build features without deploying.
#### Acceptance Criteria
1. WHEN a developer runs the documented dev command, THE SYSTEM SHALL start the API, the worker and an app against a local Supabase instance (`supabase start`) or a configured dev project.
2. WHEN a new developer sets up the project, THE SYSTEM SHALL document every backend variable in `.env.example`, marking server-only secrets (Clerk secret key, Supabase service-role key, provider keys) as never `VITE_`-prefixed.
3. WHEN the API or worker starts, THE SYSTEM SHALL validate its required environment variables and fail fast with a message naming any that are missing.

### Requirement 9: Deployment and end-to-end check
**User Story:** As an operator, I want the backend deployed next to the app, so that the stack is proven in production before features land.
#### Acceptance Criteria
1. WHEN the backend is deployed, THE SYSTEM SHALL run `api` and `worker` as Railway services in the same production environment as the apps, with `/health` as the API's health check.
2. WHEN a signed-in user opens Recipe Box in production, THE SYSTEM SHALL call `GET /v1/me` through `web-kit`'s API client and show the result, confirming that Clerk sign-in, token verification and the API work end to end.
3. WHEN an anonymous visitor calls a protected endpoint in production, THE SYSTEM SHALL return 401.

---
