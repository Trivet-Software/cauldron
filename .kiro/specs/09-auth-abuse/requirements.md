# Spec: auth-abuse

# Requirements: Auth and Abuse Protection

Applies across `/core`, `/services/*`, `/web-kit` (and `/ios-kit` if the stretch ships), the worker and the MCP server.

Clerk token verification, the shared schema, RLS policies and service-role scoping (Requirements 1.5–1.7 and 2 below) are built in `01.5-backend-foundation`. This spec defines the rules; that spec implements the base, and this spec adds the rest.

## Introduction

Identity is Clerk. Every account is its own tenant. Users with the developer role can draft goals (Requirement 11); drafts belong to their developer. App goals belong to a built-in system owner and are shared read-only with every user, while each user's captures stay private. Two special accounts exist for the hackathon: a **public demo account** that anonymous visitors browse read-only, and a **judge account** that judges sign in to.

## Requirements

### Requirement 1: Managed identity via Clerk (web sign-in; Sign in with Apple on iOS stretch)
**User Story:** As a user, I want to sign in easily in my browser, so that I don't manage another password with Cauldron itself.
#### Acceptance Criteria
1. WHEN a user signs in, THE SYSTEM SHALL authenticate them through Clerk (Supabase Auth is not used).
2. WHEN a user signs in on the web, THE SYSTEM SHALL offer Clerk's web sign-in, including username + password so the judge account login works.
3. WHEN a user signs in on iOS (stretch only), THE SYSTEM SHALL offer Sign in with Apple through Clerk.
4. WHEN a user account is created or signs in, THE SYSTEM SHALL NOT store or verify passwords itself.
5. WHEN the backend or Supabase receives a request with a Clerk session token, THE SYSTEM SHALL verify it (Clerk configured as a Supabase third-party auth provider) and apply row-level security using its `sub` claim as both user ID and tenant ID.
6. WHEN server code or the worker uses the Supabase service-role key (which bypasses RLS), THE SYSTEM SHALL scope every read and write to the requesting job's user.
7. WHEN any client-side code is built, THE SYSTEM SHALL include only the Clerk publishable key; the Clerk secret key and Supabase service-role key SHALL exist only in backend services.

### Requirement 2: One tenant per user, enforced by RLS
**User Story:** As a user, I want my data invisible to everyone else, so that I can trust the service.
#### Acceptance Criteria
1. WHEN an account is created, THE SYSTEM SHALL treat it as its own tenant; `tenant_id` equals the Clerk user ID.
2. WHEN any row is written, THE SYSTEM SHALL store its `tenant_id` and `user_id`.
3. WHEN any query runs, THE SYSTEM SHALL enforce Postgres row-level security so that it returns only the caller's own rows, plus app goal specs (readable by everyone, goal-engine Requirement 8) and the public demo account's items and pages (readable by everyone, Requirement 10).
4. WHEN tests attempt cross-tenant reads or writes, THE SYSTEM SHALL return no foreign rows and change nothing.
5. WHEN app goals are written, THE SYSTEM SHALL do so only from the API service's startup registration (goal-engine Requirement 8), under the system owner; no user, including developers, can write rows owned by the system owner.

### Requirement 3: Spend caps on LLM and embedding calls
**User Story:** As the operator, I want daily spend caps, so that abuse can't run up an unbounded bill.
#### Acceptance Criteria
1. WHEN an LLM or embedding call (goal draft, compile, repair, page summary, item or query embedding) is made, THE SYSTEM SHALL attribute it to a user and, if used, an API key.
2. WHEN such a call is about to run, THE SYSTEM SHALL check daily caps per user, per API key, and a **global** daily cap across all users, and record the actual cost afterwards.
3. IF a cap is reached, THEN THE SYSTEM SHALL reject new captures and goal drafts with 429 and an error that includes the reset time, store nothing and queue nothing; background page summaries SHALL wait until the reset (capture-compile Requirement 13.3).
4. WHEN caps are configured, THE SYSTEM SHALL read their values from configuration; the free per-user values and the global value are set before launch.

### Requirement 4: API keys
**User Story:** As a developer, I want safe, revocable keys, so that a leak can be contained.
#### Acceptance Criteria
1. WHEN an API key is created, THE SYSTEM SHALL show it once and store only its hash and a lookup prefix.
2. WHEN a key is created, THE SYSTEM SHALL let the owner assign scopes (`goals:read`, `goals:write`, `items:read`, `items:write`).
3. WHEN a key is revoked, THE SYSTEM SHALL reject further requests with it.
4. IF requests exceed the per-key, per-user or per-IP rate limit, THE SYSTEM SHALL reject them with 429.

### Requirement 5: MCP OAuth and write confirmation
**User Story:** As a user, I want MCP writes gated, so that a connected AI can't publish on its own.
#### Acceptance Criteria
1. WHEN an MCP client authenticates, THE SYSTEM SHALL use OAuth from Clerk, the same identity provider as the app; IF the client can't complete OAuth, THE SYSTEM SHALL accept hashed per-user API keys instead (mcp-server Requirement 5).
2. WHEN an MCP write tool is called, THE SYSTEM SHALL require `goals:write` or `items:write`.
3. WHEN an MCP client publishes or updates a goal, THE SYSTEM SHALL require the user to confirm in the web app (web-kit Requirement 9.2). A confirmation sent by the MCP client itself SHALL NOT count, because the AI could send it.

### Requirement 6: Webhook signing and replay protection *(stretch, with public-api-sdk Requirement 3)*
**User Story:** As a webhook receiver, I want to verify events, so that forged or replayed calls are rejected.
#### Acceptance Criteria
1. WHEN a webhook is sent, THE SYSTEM SHALL include `X-Signature: t=<ts>,v1=<hmac>` using HMAC-SHA256 over the timestamp and body.
2. IF a webhook timestamp is outside the 5-minute tolerance, THE SYSTEM SHALL treat it as a replay (documented for receivers and the SDK verifier).

### Requirement 7: SSRF-safe URL fetching
**User Story:** As the operator, I want the fetcher locked down, so that captures can't reach internal services.
#### Acceptance Criteria
1. WHEN a URL is fetched, THE SYSTEM SHALL allow only http and https.
2. WHEN a hostname resolves, THE SYSTEM SHALL block private, loopback, and link-local IP ranges after DNS resolution, and connect to the checked address.
3. WHEN a redirect occurs, THE SYSTEM SHALL re-check the new target, following at most 5 redirects.
4. IF a response exceeds 10 MB or 10 s, THE SYSTEM SHALL abort the fetch.
5. WHEN any component needs a URL fetched, THE SYSTEM SHALL use only this fetcher.

### Requirement 8: Captured content is untrusted
**User Story:** As a user, I want malicious web pages to be harmless, so that a capture can't hijack my goals.
#### Acceptance Criteria
1. WHEN the compile step runs, THE SYSTEM SHALL give it no tools and no write access beyond saving items or drafts for its own job's goal and user.
2. WHEN extraction output is returned, THE SYSTEM SHALL save it as an item only if it validates against the goal schema; output that does not validate SHALL be kept only as a `needs_review` draft (capture-compile Requirement 9).
3. IF source text contains instructions, THE SYSTEM SHALL NOT let it change goal specs, settings, or other items.

### Requirement 9: Judge account
**User Story:** As a judge, I want a ready login, so that I can try capture without setup or cost risk.
#### Acceptance Criteria
1. WHEN a judge signs in with the judge account (credentials in the Devpost submission form), THE SYSTEM SHALL let them capture into both apps using the real LLM provider, under that account's own daily spend cap of $1.
2. WHEN the nightly reset runs, THE SYSTEM SHALL delete the judge account's captures and restore its seeded items.
3. WHEN several judges use the judge account at the same time, THE SYSTEM SHALL keep working within the account's caps and rate limits.
4. WHEN the judge account is used, THE SYSTEM SHALL apply the same rules as any signed-in user apart from its cap value; no other special entitlement exists.

### Requirement 10: Anonymous read-only, signed-in capture
**User Story:** As the operator, I want anyone to look but only signed-in users to capture, so that judges and visitors see a working app without anonymous traffic running up LLM cost.
#### Acceptance Criteria
1. WHEN an anonymous visitor opens an app URL, THE SYSTEM SHALL let them browse the public demo account's items, pages and search for that app's goal, read-only.
2. IF an anonymous request tries to capture, compile, draft or edit a goal, or write anything, THEN THE SYSTEM SHALL reject it with 401, run no LLM call and store nothing; the web app SHALL show a sign-in prompt instead.
3. WHEN a signed-in user captures, THE SYSTEM SHALL allow it for any signed-in user, with no paid tier or entitlement check.
4. WHEN a signed-in user captures, THE SYSTEM SHALL apply the per-user and global spend caps (Requirement 3) and rate limits (Requirement 4).
5. WHEN anonymous searches would spend on query embeddings, THE SYSTEM SHALL count that against a separate public cap and per-IP rate limits, and at the cap SHALL fall back to full-text-only search (search Requirement 4.2) rather than fail.
6. WHEN the public demo account's data changes, THE SYSTEM SHALL only allow it through the seeding process; no user, including the judge account, can write to it.

### Requirement 11: Developer role
**User Story:** As the operator, I want only developers to draft goals, so that ordinary sign-ups can't spend goal-drafting LLM money or create goals.
#### Acceptance Criteria
1. WHEN a user's email is listed in the `DEVELOPER_EMAILS` configuration, or their Clerk public metadata has `role: "developer"`, THE SYSTEM SHALL treat them as a developer.
2. IF a user without the developer role calls a goal-authoring operation (`create_goal`, `validate_goal`, `preview_goal`, `publish_goal`, `update_goal`, `export_goal`, or their `/v1` equivalents), THEN THE SYSTEM SHALL reject it with 403 and make no LLM call.
3. WHEN a user without the developer role is signed in, THE SYSTEM SHALL still allow capture and search, over the web, the API and MCP.
4. WHEN the role check runs, THE SYSTEM SHALL read the role on the server from the verified token or configuration, never from a value the client sends.
5. WHEN `DEVELOPER_EMAILS` matches a user, THE SYSTEM SHALL only trust it for an email address Clerk has verified.

---
