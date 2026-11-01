# Spec: public-api-sdk

# Requirements: Public API and SDKs

The `/v1` API runs as its own service in `/services/api`, using domain logic from `/core`. The web apps' `/v1` client is in `web-kit` (TypeScript, using TanStack Query); the Swift SDK applies only to the iOS stretch.

Every account is its own tenant (auth-abuse Requirement 2). An API key or token always acts as exactly one user.

The service skeleton, `/v1` routing, OpenAPI generation and Clerk session-token verification are built in `01.5-backend-foundation` (its Requirements 1 and 2). This spec covers the full endpoint set and the remaining auth methods.

## Requirements

### Requirement 1: Versioned public REST API
**User Story:** As a third-party developer, I want every capability in a versioned REST API, so that I can embed the engine in my app.
#### Acceptance Criteria
1. WHEN any capability (goals, capture, compile status, items, drafts, pages, search, view specs, API keys) is offered, THE SYSTEM SHALL expose it under `/v1` and describe it in a published OpenAPI spec.
2. WHEN the web apps, the MCP server or the optional iOS app need data, THE SYSTEM SHALL serve it only through the `/v1` API.

### Requirement 2: Authentication
**User Story:** As a developer, I want to call the API from my web app, my server or an AI client, so that I can integrate either way.
#### Acceptance Criteria
1. WHEN the first-party web apps call the API, THE SYSTEM SHALL authenticate them with the user's Clerk session token in the `Authorization: Bearer` header.
2. WHEN a developer calls the API server-to-server, THE SYSTEM SHALL authenticate them with one of their API keys (auth-abuse Requirement 4), acting as the key's owner.
3. WHEN an MCP client calls through the MCP server, THE SYSTEM SHALL authenticate it with a Clerk OAuth access token or an MCP API key (mcp-server Requirement 5).
4. IF a request has no valid credential, THEN THE SYSTEM SHALL serve only the anonymous read-only endpoints (auth-abuse Requirement 10) and reject everything else with 401.
5. *(Stretch)* WHEN a third-party app acts on behalf of another user, THE SYSTEM SHALL authenticate it with a Clerk OAuth token scoped to that user.

### Requirement 3: Signed webhooks *(stretch)*
**User Story:** As a developer, I want event callbacks, so that my app updates when compiles finish.
#### Acceptance Criteria
1. WHEN a developer registers a webhook URL through `/v1`, THE SYSTEM SHALL validate it with the SSRF-safe fetcher's address rules (auth-abuse Requirement 7) and generate a signing secret shown once.
2. WHEN a compile finishes, THE SYSTEM SHALL send a signed `item.compiled` or `item.needs_review` webhook to the registered URL.
3. WHEN a page is updated, THE SYSTEM SHALL send a signed `page.updated` webhook.
4. WHEN a goal is published, THE SYSTEM SHALL send a signed `goal.published` webhook.
5. IF delivery fails, THE SYSTEM SHALL retry with exponential backoff, at most 5 times.

### Requirement 4: Headless or rendered integration
**User Story:** As a developer, I want typed JSON or ready-made screens, so that I choose how much UI to build.
#### Acceptance Criteria
1. WHEN an authenticated caller calls `POST /v1/compile` with a goal and a source, THE SYSTEM SHALL return typed items and store no source, item or page; usage and spend SHALL still be recorded and capped (auth-abuse Requirement 3).
2. WHEN an app requests an item, THE SYSTEM SHALL return typed fields, provenance, and the view spec.
3. WHEN an app uses the `web-kit` client (or the Swift SDK, iOS stretch only), THE SYSTEM SHALL let it render returned view specs with the shared catalog.

### Requirement 5: Metering and limits
**User Story:** As the operator, I want usage metered per account, so that I can protect the service.
#### Acceptance Criteria
1. WHEN a capture, compile, goal draft, search embedding, or storage change occurs, THE SYSTEM SHALL record usage against the acting user (and API key, if any).
2. IF a caller exceeds a rate limit or spend cap (auth-abuse Requirements 3 and 4), THEN THE SYSTEM SHALL reject the request with 429 and an error that states the reset time.

---
