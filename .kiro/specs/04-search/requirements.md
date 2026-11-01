# Spec: search

# Requirements: Search and Find

Lives in `/core`. Search UI is in `web-kit`. Goal name resolution is in `goal-engine`. Embeddings and full-text indexing happen at compile time (capture-compile Requirement 12).

## Introduction

Finds items and pages from a query, including vague descriptions. In the web apps, search is always scoped to the app's one goal. Through the API and MCP, a caller can name a goal or search all goals they have items in.

## Requirements

### Requirement 1: Search scope
**User Story:** As a user, I want to search my collection in an app, or everything at once from an AI client, so that I find things fast.
#### Acceptance Criteria
1. WHEN a user searches inside an app, THE SYSTEM SHALL search only that app's goal and only the user's own items and pages (or the public demo account's, for anonymous visitors).
2. WHEN an API or MCP search names a goal, THE SYSTEM SHALL resolve it (goal-engine Requirement 3) and search only that goal's items and pages.
3. WHEN an API or MCP search names no goal, THE SYSTEM SHALL search across every goal the caller has items in.
4. WHEN a search runs, THE SYSTEM SHALL combine Postgres full-text ranking and pgvector similarity over the goal's searchable fields (goal-engine Requirement 9), with date and type filters.
5. WHEN a search returns no results, THE SYSTEM SHALL say so rather than showing unrelated items.

### Requirement 2: Result contents
**User Story:** As a user, I want results that tell me what and where, so that I can pick the right one.
#### Acceptance Criteria
1. WHEN results are returned, THE SYSTEM SHALL include for each result its title, its kind (item or page), the goal name, a snippet with the matching text, and a link to the original source.
2. WHEN a result has no source URL (pasted text, photos, PDF uploads), THE SYSTEM SHALL link to the stored raw source instead.

### Requirement 3: Vague-description ranking
**User Story:** As a Research Library user, I want to find "that piece about Apple's on-device model from last month", so that a vague memory is enough.
#### Acceptance Criteria
1. WHEN the user describes an item vaguely, THE SYSTEM SHALL rank candidates using the goal's searchable fields and weights (for Research Library: title, summary, topics, authors) and the item's date.
2. WHEN the query contains a relative time ("last month", "last week", "yesterday"), THE SYSTEM SHALL parse it without an LLM call and apply it as a date-range filter on the item's date (goal-engine Requirement 9.2), widening to a ranking signal if the filter leaves no results.

### Requirement 4: Search cost
**User Story:** As the operator, I want search to stay cheap, so that anonymous browsing can't run up a bill.
#### Acceptance Criteria
1. WHEN a search runs, THE SYSTEM SHALL make at most one embedding call for the query and no LLM call.
2. IF the caller's embedding budget is spent (auth-abuse Requirement 10.5), THEN THE SYSTEM SHALL fall back to full-text-only search.

---
