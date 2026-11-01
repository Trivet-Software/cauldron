# Spec: mcp-server

# Requirements: MCP Server

Runs as its own service in `/services/mcp` (TypeScript), as a thin client of `/v1`. MCP OAuth hardening is in `auth-abuse`.

## Introduction

The MCP server is the main developer tool for creating goals: from Kiro or another MCP client, a developer drafts, validates, previews and approves a goal, then exports it as a goal file for a new app. The developer signs in as their own user account on their own Cauldron deployment, and needs the developer role (auth-abuse Requirement 11) for goal-authoring tools. Any signed-in user can capture and search their collections from an MCP client.

## Requirements

### Requirement 1: Remote MCP server for goal authoring and runtime
**User Story:** As a developer using any MCP client (Kiro, Claude, ChatGPT, Cursor), I want to create and configure goals by name, so that an AI can build collection apps with me.
#### Acceptance Criteria
1. WHEN an MCP client connects, THE SYSTEM SHALL expose the resources `catalog://components`, `catalog://schema-rules`, `examples://goals/recipe-box`, `examples://goals/research-library`.
2. WHEN an MCP client connects, THE SYSTEM SHALL expose the tools `list_goals`, `create_goal`, `validate_goal`, `preview_goal`, `publish_goal`, `update_goal`, `export_goal`, `capture`, `search`, `get_item`, `get_page`, and the prompt `design_goal`.
3. WHEN a tool takes a goal argument, THE SYSTEM SHALL accept a goal `name`, `slug`, or `id` and resolve it with goal-engine Requirement 3; IF the name is ambiguous, THEN THE SYSTEM SHALL return the candidates instead of picking one.
4. WHEN `preview_goal` is called, THE SYSTEM SHALL return the goal's preview URL (web-kit Requirement 5).
5. WHEN `export_goal` is called, THE SYSTEM SHALL return the goal file (goal-engine Requirement 7.1) so the client can pass it to the scaffold command (web-kit Requirement 7.4).
6. WHEN `list_goals` is called, THE SYSTEM SHALL return the app goals and, for developers, their own drafts, each marked as `app` or `draft`.

### Requirement 2: Same validation as the app
**User Story:** As a developer, I want MCP-authored goals held to the same rules, so that an AI can't save a broken app.
#### Acceptance Criteria
1. WHEN a client submits a spec, THE SYSTEM SHALL validate it with the goal-engine validator (goal-engine Requirement 5).
2. IF validation fails, THEN THE SYSTEM SHALL refuse to save it and return the exact errors with their paths.

### Requirement 3: User confirmation for publish and update
**User Story:** As a developer, I want to approve any goal an AI publishes, so that nothing changes without me.
#### Acceptance Criteria
1. WHEN a client calls `publish_goal` or `update_goal` on a draft, THE SYSTEM SHALL create a pending request and return a confirmation link to the Developer section of the web app (web-kit Requirement 9), without saving a new version.
2. WHEN the owner approves the request in the web app, THE SYSTEM SHALL save the new version.
3. IF the owner declines or does not confirm within 24 hours, THEN THE SYSTEM SHALL NOT save the version and SHALL discard the request.
4. IF a client calls `update_goal` on an app goal, THEN THE SYSTEM SHALL reject it and explain that app goals change only through `apps/<name>/goal.json` (goal-engine Requirement 8.6).

### Requirement 4: Per-user access with scopes
**User Story:** As a user, I want to grant an MCP client only the access it needs, so that my data stays safe.
#### Acceptance Criteria
1. WHEN an MCP client connects, THE SYSTEM SHALL require a per-user Clerk OAuth access token or an MCP API key (Requirement 5).
2. WHEN a tool is called, THE SYSTEM SHALL enforce the scope listed for it (`goals:read`, `goals:write`, `items:read`, `items:write`).
3. IF the token or key lacks the tool's scope, THE SYSTEM SHALL reject the call.
4. WHEN a client connects without requesting scopes (some clients, such as ChatGPT and Claude, omit them), THE SYSTEM SHALL rely on Clerk's default scopes for dynamic clients, configured as `goals:read` and `items:read` only.
5. WHEN a goal-authoring tool is called, THE SYSTEM SHALL require the developer role (auth-abuse Requirement 11) in addition to the tool's scope.

### Requirement 5: Clerk OAuth and API-key fallback
**User Story:** As a user connecting Kiro, I want to sign in with my existing account, or paste a key if sign-in can't complete, so that MCP access is always tied to me.
#### Acceptance Criteria
1. WHEN an MCP client connects without credentials, THE SYSTEM SHALL respond 401 with a `WWW-Authenticate` header pointing to its OAuth protected-resource metadata, which names Clerk as the authorization server.
2. WHEN an MCP client presents a bearer token, THE SYSTEM SHALL verify it as a Clerk-issued OAuth access token (signature, expiry, audience) before running any tool, and map it to exactly one user.
3. WHEN the Clerk OAuth flow runs, THE SYSTEM SHALL require PKCE and user consent, and SHALL use Client ID Metadata Documents (CIMD) rather than dynamic client registration.
4. IF dynamic client registration is enabled for a client that doesn't support CIMD, THE SYSTEM SHALL apply the existing rate limits and spend caps (auth-abuse Requirements 3 and 4) to every client registered that way, and SHALL grant no access without the user's consent.
5. WHEN a signed-in user creates an MCP API key (fallback), THE SYSTEM SHALL show it once, store only its hash with a lookup prefix, and bind it to that user and the chosen scopes.
6. WHEN an MCP request carries an API key, THE SYSTEM SHALL look it up by prefix, compare hashes, reject revoked or unknown keys, and enforce the same scopes, rate limits and spend caps as for OAuth tokens.
7. WHEN a user revokes a key or a Clerk grant, THE SYSTEM SHALL reject further requests made with it.

---
