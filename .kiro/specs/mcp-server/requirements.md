# Spec: mcp-server

# Requirements: MCP Server

Lives in `/core` (TypeScript), as a thin client of `/v1`. MCP OAuth hardening is in `auth-abuse`.

## Requirements

### Requirement 1: Remote MCP server for goal authoring and runtime
**User Story:** As a user of any MCP client (Kiro, Claude, ChatGPT, Cursor), I want to create and configure goals by name, so that any AI can build apps for me.
#### Acceptance Criteria
1. WHEN an MCP client connects, THE SYSTEM SHALL expose the resources `catalog://components`, `catalog://schema-rules`, `examples://goals/recipe-box`, `examples://goals/research-library`.
2. WHEN an MCP client connects, THE SYSTEM SHALL expose the tools `list_goals`, `create_goal`, `validate_goal`, `preview_goal`, `publish_goal`, `update_goal`, `capture`, `search`, `get_item`, `get_page`, and the prompt `design_goal`.
3. WHEN a tool takes a goal argument, THE SYSTEM SHALL accept a goal `name`, `slug`, or `id`.

### Requirement 2: Same validation as the app
**User Story:** As a user, I want MCP-authored goals held to the same rules, so that an AI can't save a broken app.
#### Acceptance Criteria
1. WHEN a client submits a spec, THE SYSTEM SHALL validate it with the goal-engine validator.
2. IF a schema fails validation or a view uses unknown components, THE SYSTEM SHALL refuse to save it and return the exact errors.

### Requirement 3: User confirmation for publish and update
**User Story:** As a user, I want to approve any goal an AI publishes, so that nothing changes without me.
#### Acceptance Criteria
1. WHEN a client calls `publish_goal` or `update_goal`, THE SYSTEM SHALL require user confirmation in the app or the client before saving a new version.
2. IF the user declines or does not confirm, THE SYSTEM SHALL NOT save the version.

### Requirement 4: Per-user OAuth with scopes
**User Story:** As a user, I want to grant an MCP client only the access it needs, so that my data stays safe.
#### Acceptance Criteria
1. WHEN an MCP client connects, THE SYSTEM SHALL require a per-user OAuth access token.
2. WHEN a tool is called, THE SYSTEM SHALL enforce the scope listed for it (`goals:read`, `goals:write`, `items:read`, `items:write`).
3. IF the token lacks the tool's scope, THE SYSTEM SHALL reject the call.

### Requirement 5: Clerk OAuth and API-key fallback
**User Story:** As a user connecting Kiro, I want to sign in with my existing account, or paste a key if sign-in can't complete, so that MCP access is always tied to me.
#### Acceptance Criteria
1. WHEN an MCP client connects without credentials, THE SYSTEM SHALL respond 401 with a `WWW-Authenticate` header pointing to its OAuth protected-resource metadata, which names Clerk as the authorization server.
2. WHEN an MCP client presents a bearer token, THE SYSTEM SHALL verify it as a Clerk-issued OAuth access token (signature, expiry, audience) before running any tool, and map it to exactly one user and tenant.
3. WHEN the Clerk OAuth flow runs, THE SYSTEM SHALL require PKCE and user consent, and SHALL prefer Client ID Metadata Documents over dynamic client registration.
4. IF dynamic client registration is enabled, THE SYSTEM SHALL apply the existing rate limits and per-user spend caps (auth-abuse R36, R37) to every client registered that way, and SHALL grant no access without the user's consent.
5. WHEN a signed-in user creates an MCP API key (fallback), THE SYSTEM SHALL show it once, store only its hash with a lookup prefix, and bind it to that user, their tenant and the chosen scopes.
6. WHEN an MCP request carries an API key, THE SYSTEM SHALL look it up by prefix, compare hashes, reject revoked or unknown keys, and enforce the same scopes, rate limits and spend caps as for OAuth tokens.
7. WHEN a user revokes a key or a Clerk grant, THE SYSTEM SHALL reject further requests made with it.


---

