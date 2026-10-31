# Spec: search

# Requirements: Search and Find

Lives in `/core`. Search UI is in `web-kit`. Goal name resolution is in `goal-engine`.

## Requirements

### Requirement 1: Search within a goal or across all goals
**User Story:** As a user, I want to search one goal by name or everything at once, so that I find things fast.
#### Acceptance Criteria
1. WHEN the user searches with a goal name, THE SYSTEM SHALL resolve the goal (goal-engine Requirement 3) and search only that goal's items and pages.
2. WHEN the user searches without a goal, THE SYSTEM SHALL search across all of the user's goals.
3. WHEN a search runs, THE SYSTEM SHALL combine full-text (BM25) and vector similarity over items and pages, with date and type filters.

### Requirement 2: Result contents
**User Story:** As a user, I want results that tell me what and where, so that I can pick the right one.
#### Acceptance Criteria
1. WHEN results are returned, THE SYSTEM SHALL include for each result the item title, the goal name, a snippet with the matching text, and a link to the original source.

### Requirement 3: Vague-description ranking (Research Library)
**User Story:** As a Research Library user, I want to find "that piece about Apple's on-device model from last month", so that vague memories are enough.
#### Acceptance Criteria
1. WHEN the user describes an article vaguely, THE SYSTEM SHALL rank candidates using title, summary, topics, authors, and date range.
2. WHEN the description contains a relative time ("last month"), THE SYSTEM SHALL apply it as a date-range filter or ranking signal.


---

