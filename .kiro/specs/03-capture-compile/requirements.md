# Spec: capture-compile

# Requirements: Capture and Compile

Lives in `/core` (server side). Capture UI is in `web-kit` (browser paste/upload; the iOS share sheet is the `ios-kit` stretch). Capture requires sign-in (auth-abuse Requirement 10).

## Introduction
Accepts sources, stores them raw, and compiles them into typed items and compiled pages: deterministic mappers first, then the LLM fills gaps, with validation, retry, and provenance.

## Requirements

### Requirement 1: Source kinds
**User Story:** As a user, I want to capture URLs, shared text, photos, PDFs, and RSS feeds, so that anything I find can go into a goal.
#### Acceptance Criteria
1. WHEN a capture of kind URL, text, photo (one or more), or PDF arrives, THE SYSTEM SHALL accept it as a source for the target goal.
2. WHEN the user subscribes a goal to an RSS feed, THE SYSTEM SHALL create a source for each new feed item.

### Requirement 2: Goal suggestion for unassigned captures
**User Story:** As a user, I want the app to guess which goal a capture belongs to, so that sharing is one tap.
#### Acceptance Criteria
1. WHEN a capture arrives without a goal, THE SYSTEM SHALL suggest the best-matching goal by name and description.
2. WHEN a goal is suggested, THE SYSTEM SHALL let the user confirm it or pick another before compiling.

### Requirement 3: Store raw sources unchanged
**User Story:** As a user, I want my original sources kept, so that items can be recompiled when a goal changes.
#### Acceptance Criteria
1. WHEN a source is captured, THE SYSTEM SHALL store the raw source unchanged in object storage before compiling.
2. WHEN a source is stored, THE SYSTEM SHALL record its origin (URL, time, device).

### Requirement 4: Blocked server-side fetching is out of scope
**User Story:** As a user, I want social-network content to still be capturable, so that blocked fetches don't lose it.
#### Acceptance Criteria
1. WHEN a source comes from a social network, THE SYSTEM SHALL capture it on the device as shared text or screenshots rather than fetching it server-side.

### Requirement 5: Extract typed items
**User Story:** As a user, I want each capture turned into structured items, so that I can browse and search them.
#### Acceptance Criteria
1. WHEN a source is added to a goal, THE SYSTEM SHALL extract one or more typed items that validate against the goal's schema.

### Requirement 6: Validation retry and needs-review
**User Story:** As a user, I want failed extractions kept for review, so that nothing I capture is silently lost.
#### Acceptance Criteria
1. IF extraction fails validation, THE SYSTEM SHALL retry with the validation errors, at most 2 times.
2. IF extraction still fails after 2 retries, THE SYSTEM SHALL save the item with status `needs_review` and the errors attached.

### Requirement 7: Field provenance
**User Story:** As a user, I want to see where each field came from, so that I can trust the extracted data.
#### Acceptance Criteria
1. WHEN a field is extracted, THE SYSTEM SHALL record its provenance as a quote, a selector, or a page and region of the source.

### Requirement 8: Deterministic mappers before the LLM
**User Story:** As the operator, I want structured metadata used first, so that compiles are cheaper and more accurate.
#### Acceptance Criteria
1. WHEN a source matches a parser rule (e.g. JSON-LD `Recipe`, arXiv metadata, Open Graph), THE SYSTEM SHALL run that deterministic mapper before any LLM call.
2. WHEN the mapper fills every required field, THE SYSTEM SHALL NOT call the LLM for extraction.
3. WHEN the mapper leaves gaps, THE SYSTEM SHALL ask the LLM to fill only the missing fields.

### Requirement 9: Compiled pages with summaries
**User Story:** As a user, I want items grouped into pages (by cuisine, by topic), so that I see the big picture.
#### Acceptance Criteria
1. WHEN an item is saved, THE SYSTEM SHALL assign it to pages per the goal's `pages.groupBy` rule.
2. WHEN a page's items change, THE SYSTEM SHALL re-summarize that page in the background with an LLM-written summary that links back to its items.

### Requirement 10: Latency
**User Story:** As a user, I want captures to show up quickly, so that the app feels instant.
#### Acceptance Criteria
1. WHEN a typical web page is captured, THE SYSTEM SHALL produce its item in under 10 s.
2. WHEN a multi-photo capture is submitted, THE SYSTEM SHALL produce its item in under 20 s.

### Requirement 11: LLM cost budget per operation
**User Story:** As the operator, I want a bounded LLM cost per action, so that the product is affordable to run.
#### Acceptance Criteria
1. WHEN a goal is generated, THE SYSTEM SHALL use one larger LLM call.
2. WHEN a capture is compiled, THE SYSTEM SHALL use at most one normal extraction call, and none when deterministic rules cover it.

### Requirement 12: Pluggable LLM provider
**User Story:** As a developer, I want to swap LLM providers and use a mock, so that tests and demos are deterministic.
#### Acceptance Criteria
1. WHEN the system makes an LLM call, THE SYSTEM SHALL go through a provider interface with OpenRouter as the default implementation.
2. WHEN tests or demo mode run, THE SYSTEM SHALL use the mock LLM implementation.


---

