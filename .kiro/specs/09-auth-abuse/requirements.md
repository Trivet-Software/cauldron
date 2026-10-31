# Spec: auth-abuse

# Requirements: Auth and Abuse Protection

Applies across `/core`, `/web-kit` (and `/ios-kit` if the stretch ships), and the MCP server.

## Requirements

### Requirement 1: Managed identity via Clerk (web sign-in; Sign in with Apple on iOS stretch)
**User Story:** As a user, I want to sign in easily in my browser, so that I don't manage another password with Cauldron itself.
#### Acceptance Criteria
1. WHEN a user signs in, THE SYSTEM SHALL authenticate them through Clerk (Supabase Auth is not used).
2. WHEN a user signs in on the web, THE SYSTEM SHALL offer the provider's web sign-in, and it SHALL support a shared judge demo login entered as a username and password.
3. WHEN a user signs in on iOS (stretch only), THE SYSTEM SHALL offer Sign in with Apple through Clerk.
4. WHEN a user account is created or signs in, THE SYSTEM SHALL NOT store or verify passwords itself.
5. WHEN the backend or Supabase receives a request with a Clerk session token, THE SYSTEM SHALL verify it (Clerk configured as a Supabase third-party auth provider) and apply row-level security from its claims (`sub` as user ID, plus the tenant claim).
6. WHEN server code or the worker uses the Supabase service-role key (which bypasses RLS), THE SYSTEM SHALL scope every read and write to the requesting job's tenant and user.

### Requirement 2: Tenant and user isolation via RLS
**User Story:** As a user, I want my data invisible to everyone else, so that I can trust the service.
#### Acceptance Criteria
1. WHEN any row is written, THE SYSTEM SHALL store its `tenant_id` and `user_id`.
2. WHEN any query runs, THE SYSTEM SHALL enforce Postgres row-level security so no query returns another tenant's or user's data.
3. WHEN tests attempt cross-tenant reads, THE SYSTEM SHALL return no foreign rows.

### Requirement 3: Spend caps on LLM calls
**User Story:** As the operator, I want daily spend caps, so that abuse can't run up an unbounded LLM bill.
#### Acceptance Criteria
1. WHEN an LLM-spending call (goal generation, compile, page summary) is made, THE SYSTEM SHALL attribute it to a user or an API key.
2. WHEN an LLM call is about to run, THE SYSTEM SHALL check daily caps per user, per key, and per tenant, and record the cost afterwards.
3. IF a cap is reached, THE SYSTEM SHALL reject new compiles with a clear error that includes the reset time and SHALL queue nothing.

### Requirement 4: API keys
**User Story:** As a developer, I want safe, revocable keys, so that a leak can be contained.
#### Acceptance Criteria
1. WHEN an API key is created, THE SYSTEM SHALL show it once and store only its hash and a lookup prefix.
2. WHEN a key is created, THE SYSTEM SHALL let the owner assign scopes.
3. WHEN a key is revoked, THE SYSTEM SHALL reject further requests with it.
4. IF requests exceed the per-key or per-IP rate limit, THE SYSTEM SHALL reject them with 429.

### Requirement 5: MCP OAuth and write confirmation
**User Story:** As a user, I want MCP writes gated, so that a connected AI can't publish on its own.
#### Acceptance Criteria
1. WHEN an MCP client authenticates, THE SYSTEM SHALL use OAuth from Clerk, the same identity provider as the app; IF Kiro's MCP client can't complete OAuth, THE SYSTEM SHALL accept hashed per-user API keys instead (mcp-server Requirement 5).
2. WHEN an MCP write tool is called, THE SYSTEM SHALL require `goals:write` or `items:write`.
3. WHEN an MCP client publishes, THE SYSTEM SHALL require user confirmation first.

### Requirement 6: Webhook signing and replay protection
**User Story:** As a webhook receiver, I want to verify events, so that forged or replayed calls are rejected.
#### Acceptance Criteria
1. WHEN a webhook is sent, THE SYSTEM SHALL include `X-Signature: t=<ts>,v1=<hmac>` using HMAC-SHA256 over the timestamp and body.
2. IF a webhook timestamp is outside the 5-minute tolerance, THE SYSTEM SHALL treat it as a replay (documented for receivers and the SDK verifier).

### Requirement 7: SSRF-safe URL fetching
**User Story:** As the operator, I want the fetcher locked down, so that captures can't reach internal services.
#### Acceptance Criteria
1. WHEN a URL is fetched, THE SYSTEM SHALL allow only http and https.
2. WHEN a hostname resolves, THE SYSTEM SHALL block private, loopback, and link-local IP ranges after DNS resolution.
3. WHEN a redirect occurs, THE SYSTEM SHALL re-check the new target.
4. IF a response exceeds 10 MB or 10 s, THE SYSTEM SHALL abort the fetch.
5. WHEN any component needs a URL fetched, THE SYSTEM SHALL use only this fetcher.

### Requirement 8: Captured content is untrusted
**User Story:** As a user, I want malicious web pages to be harmless, so that a capture can't hijack my goals.
#### Acceptance Criteria
1. WHEN the compile step runs, THE SYSTEM SHALL give it no tools and no write access beyond inserting items for its own goal.
2. WHEN extraction output is returned, THE SYSTEM SHALL accept it only if it validates against the goal schema.
3. IF source text contains instructions, THE SYSTEM SHALL NOT let it change goal specs, settings, or other items.

### Requirement 9: Judge demo account
**User Story:** As a judge, I want a ready demo login, so that I can try the app without setup or cost risk.
#### Acceptance Criteria
1. WHEN a judge signs in with the demo login (given in the Devpost credentials field), THE SYSTEM SHALL run in demo mode with the mock LLM or a small capped budget (decision pending; budget is $1/day).
2. WHEN the nightly reset runs, THE SYSTEM SHALL restore the demo tenant's seeded data.
3. WHEN several judges use the demo login at the same time, THE SYSTEM SHALL keep working within the demo caps (shared-login limits to be determined).

### Requirement 10: Anonymous read-only, signed-in import
**User Story:** As the operator, I want anyone to look but only signed-in users to import, so that judges and visitors see a working app without anonymous traffic running up LLM cost.
#### Acceptance Criteria
1. WHEN an anonymous visitor opens an app URL, THE SYSTEM SHALL let them browse the public demo tenant's goals, items, pages and search read-only.
2. IF an anonymous request tries to capture, compile, create or edit a goal, or write anything, THE SYSTEM SHALL reject it with 401, run no LLM call and store nothing; the web app SHALL show a sign-in prompt instead.
3. WHEN a signed-in user imports (captures and compiles), THE SYSTEM SHALL allow it for any signed-in user, with no paid tier or entitlement check.
4. WHEN a signed-in user imports, THE SYSTEM SHALL apply the per-user spend caps (Requirement 3) and rate limits (Requirement 4); the free limit values are to be determined.
5. WHEN anonymous search or page views would spend on the LLM or embeddings, THE SYSTEM SHALL count that against a separate public-tenant cap and per-IP rate limits, and at the cap SHALL fall back to a no-spend path (for example keyword-only search) rather than fail.
6. WHEN a judge signs in, THE SYSTEM SHALL treat them like any signed-in user on the demo login; no special judge entitlement exists.


---

