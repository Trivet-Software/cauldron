# Spec: public-api-sdk

# Requirements: Public API and SDKs

Lives in `/core` (API). The web apps' `/v1` client is in `web-kit` (TypeScript, using TanStack Query); the Swift SDK applies only to the iOS stretch.

## Requirements

### Requirement 1: Versioned public REST API
**User Story:** As a third-party developer, I want every capability in a versioned REST API, so that I can embed the engine in my app.
#### Acceptance Criteria
1. WHEN any capability (goals, capture, compile, items, pages, search, view specs) is offered, THE SYSTEM SHALL expose it under `/v1` and describe it in a published OpenAPI spec.
2. WHEN the web apps, the MCP server or the optional iOS app need data, THE SYSTEM SHALL serve it only through the `/v1` API.

### Requirement 2: App and user authentication, tenant-bound
**User Story:** As a third-party developer, I want server-to-server keys or user OAuth, so that I can integrate either way.
#### Acceptance Criteria
1. WHEN a third-party app calls the API server-to-server, THE SYSTEM SHALL authenticate it with a per-app API key.
2. WHEN a third-party app acts on behalf of a user, THE SYSTEM SHALL authenticate it with an OAuth token scoped to that user within a tenant.
3. WHEN any key is used, THE SYSTEM SHALL limit it to exactly one tenant.

### Requirement 3: Signed webhooks
**User Story:** As a hosted-library customer, I want event callbacks, so that my app updates when compiles finish.
#### Acceptance Criteria
1. WHEN a compile finishes, THE SYSTEM SHALL send a signed `item.compiled` or `item.needs_review` webhook to the app's registered URL.
2. WHEN a page is updated, THE SYSTEM SHALL send a signed `page.updated` webhook.
3. WHEN a goal is published, THE SYSTEM SHALL send a signed `goal.published` webhook.
4. IF delivery fails, THE SYSTEM SHALL retry with backoff.

### Requirement 4: Headless or rendered integration
**User Story:** As a developer, I want typed JSON or ready-made screens, so that I choose how much UI to build.
#### Acceptance Criteria
1. WHEN an app calls `POST /v1/compile` with a goal and a source, THE SYSTEM SHALL return typed items and store nothing.
2. WHEN an app requests an item, THE SYSTEM SHALL return typed fields, provenance, and the view spec.
3. WHEN an app uses the `web-kit` client (or the Swift SDK, iOS stretch only), THE SYSTEM SHALL let it render returned view specs with the shared catalog.

### Requirement 5: Metering, rate limits, budgets
**User Story:** As the operator, I want usage metered per tenant, so that I can bill and protect the service.
#### Acceptance Criteria
1. WHEN a capture, compile, goal generation, or storage change occurs, THE SYSTEM SHALL record usage against the tenant.
2. IF a tenant exceeds its rate limit or budget, THE SYSTEM SHALL reject the request with an error that states the reset time.


---

