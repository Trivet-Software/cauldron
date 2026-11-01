# Spec: capture-compile

# Requirements: Capture and Compile

Lives in `/core` (pipeline logic) and the worker service. Capture UI is in `web-kit` (browser paste/upload; the iOS share sheet is the `ios-kit` stretch). Capture requires sign-in (auth-abuse Requirement 10). URL fetching goes through the SSRF-safe fetcher (auth-abuse Requirement 7). Captured content is untrusted (auth-abuse Requirement 8).

## Introduction

Accepts sources, stores them raw, and compiles them into typed items and pages. The pipeline, in order:

1. **Capture**: accept a source into a named goal and store it unchanged (R1–R3).
2. **Queue**: create a compile job that a worker claims (R4).
3. **Prepare**: fetch URLs and turn the source into extraction input: page text and metadata, PDF text, or images (R5, R6).
4. **Extract**: run deterministic mappers, then one LLM call for missing fields, validate, repair or mark for review (R7–R11).
5. **Index and group**: embed the item, assign it to pages, and re-summarize pages (R12, R13).

Each app has exactly one goal (goal-engine Requirement 8), so captures in the web apps always target that goal. API and MCP captures must name a goal.

## Requirements

### Requirement 1: Source kinds and limits
**User Story:** As a user, I want to capture URLs, pasted text, photos and PDFs, so that anything I find can go into my collection.
#### Acceptance Criteria
1. WHEN a capture of kind URL, text, photo (one or more), or PDF arrives for a goal the user can capture into, THE SYSTEM SHALL accept it as a source for that goal.
2. IF a capture arrives through the API or MCP without a goal, THEN THE SYSTEM SHALL reject it with an error asking for a goal name, slug or id (goal-engine Requirement 3).
3. IF a capture exceeds its limits (text over 100,000 characters, more than 10 photos, a photo over 10 MB, a PDF over 20 MB or 50 pages), THEN THE SYSTEM SHALL reject it with an error naming the limit, store nothing and queue nothing. Limit values are configuration.

### Requirement 2: Store raw sources unchanged
**User Story:** As a user, I want my original sources kept, so that a failed or wrong compile can be re-run without capturing again.
#### Acceptance Criteria
1. WHEN a source is captured, THE SYSTEM SHALL store the raw source unchanged in object storage before compiling.
2. WHEN a source is stored, THE SYSTEM SHALL record its origin (URL if any, capture time, capture client: web, MCP, API).
3. IF the same user captures the same normalized URL into the same goal again, THEN THE SYSTEM SHALL return the existing item instead of compiling a duplicate, and SHALL offer to recompile it.

### Requirement 3: Social-network content is captured by the user, not fetched
**User Story:** As a user, I want social-network content to still be capturable, so that blocked fetches don't lose it.
#### Acceptance Criteria
1. IF a captured URL's host is on the configured social-network list (e.g. instagram.com, tiktok.com, x.com, facebook.com), THEN THE SYSTEM SHALL NOT fetch it server-side and SHALL ask the user to paste the post text or upload screenshots instead.

### Requirement 4: Compile jobs and status
**User Story:** As a user, I want to see what happened to each capture, so that I know when it's ready or why it failed.
#### Acceptance Criteria
1. WHEN a source is stored, THE SYSTEM SHALL insert a compile job into a Postgres jobs table; workers SHALL claim jobs with `FOR UPDATE SKIP LOCKED` (no Redis).
2. WHEN a job runs, THE SYSTEM SHALL move it through the states `queued` → `fetching` → `extracting` → one of `ready`, `needs_review`, or `failed`, and expose the current state through the `/v1` API.
3. IF a worker stops while holding a job, THEN THE SYSTEM SHALL return the job to `queued` after a lease timeout (60 s) and retry it at most 3 times before marking it `failed`.
4. WHEN a job is retried, THE SYSTEM SHALL produce the same result as a single run: no duplicate items, pages, or usage records.
5. WHEN a job ends in `failed`, THE SYSTEM SHALL record a user-readable reason (for example "page returned 404", "fetch blocked", "timed out", "unsupported content type").

### Requirement 5: Fetch and prepare the source
**User Story:** As the operator, I want each source turned into clean, bounded input, so that extraction is accurate and LLM cost stays predictable.
#### Acceptance Criteria
1. WHEN a URL source is compiled, THE SYSTEM SHALL fetch it only through the SSRF-safe fetcher (auth-abuse Requirement 7), without running the page's JavaScript.
2. WHEN the response is HTML, THE SYSTEM SHALL keep its structured metadata (JSON-LD, Open Graph, `<meta>` tags) for the mappers and extract the main readable content as plain text, dropping navigation, ads, scripts and styles.
3. WHEN the response is a PDF or an image, THE SYSTEM SHALL compile it as a PDF or photo source (Requirement 6); IF it is any other content type, THEN THE SYSTEM SHALL mark the job `failed` with reason "unsupported content type" and make no LLM call.
4. IF a fetch fails (HTTP error status, timeout, size limit, or blocked address), THEN THE SYSTEM SHALL mark the job `failed` with the reason and make no LLM call.
5. WHEN prepared text exceeds the extraction input budget (configurable, default 12,000 tokens), THE SYSTEM SHALL truncate it, keeping the title and metadata, and record that truncation happened.

### Requirement 6: Photo and PDF text
**User Story:** As a home cook, I want a photo of a cookbook page to become a recipe, so that printed recipes count too.
#### Acceptance Criteria
1. WHEN a PDF has a text layer, THE SYSTEM SHALL extract that text with page numbers for provenance.
2. WHEN the source is one or more photos, or PDF pages without a text layer, THE SYSTEM SHALL send the images to an image-capable extraction model as part of the single extraction call (Requirement 8), so OCR and extraction happen together. *(Default choice; a separate OCR step remains an option if the bake-off shows it is cheaper or more accurate.)*

### Requirement 7: Deterministic mappers before the LLM
**User Story:** As the operator, I want structured metadata used first, so that compiles are cheaper and more accurate.
#### Acceptance Criteria
1. WHEN a source matches a parser rule in the goal (e.g. JSON-LD `Recipe`, arXiv metadata, Open Graph), THE SYSTEM SHALL run that deterministic mapper before any LLM call.
2. WHEN the mappers fill every required field and the result validates, THE SYSTEM SHALL NOT call the LLM for extraction.
3. WHEN the mappers leave gaps, THE SYSTEM SHALL ask the LLM to fill only the missing fields.

### Requirement 8: LLM extraction
**User Story:** As a developer, I want extraction driven entirely by my goal file, so that a new goal needs no pipeline code.
#### Acceptance Criteria
1. WHEN the LLM is called for extraction, THE SYSTEM SHALL build the request from the goal's schema (as JSON Schema), the goal's LLM extraction instructions, the list of fields still missing, the mapper output, and the prepared source content.
2. WHEN source content is placed in the request, THE SYSTEM SHALL mark it as untrusted data, separate from the instructions, and SHALL give the model no tools (auth-abuse Requirement 8).
3. WHEN the provider supports structured output, THE SYSTEM SHALL request output constrained to the goal schema; in every case THE SYSTEM SHALL validate the returned output against the schema before saving.
4. WHEN extraction runs, THE SYSTEM SHALL use the compile model named in configuration, separate from the goal-drafting model.

### Requirement 9: Validation repair and needs-review
**User Story:** As a user, I want failed extractions kept for review, so that nothing I capture is silently lost.
#### Acceptance Criteria
1. IF extraction output fails schema validation, THEN THE SYSTEM SHALL send the validation errors back for a repair attempt, at most 2 times.
2. IF output still fails after 2 repair attempts, THEN THE SYSTEM SHALL save it as a **draft** with status `needs_review` and the errors attached. Drafts are kept apart from validated items: they do not appear in pages or search results.
3. WHEN the user edits a draft so that it validates, THE SYSTEM SHALL save it as an item and index and group it (Requirements 12, 13).
4. WHEN the user asks to retry a `needs_review` or `failed` capture, THE SYSTEM SHALL recompile it from the stored raw source.

### Requirement 10: Extract typed items
**User Story:** As a user, I want each capture turned into structured items, so that I can browse and search them.
#### Acceptance Criteria
1. WHEN a source compiles successfully, THE SYSTEM SHALL save one item that validates against the goal's schema.
2. WHEN the goal's parser rules allow several items per source (for example a page listing several recipes), THE SYSTEM SHALL save one item per entity found, up to 20.

### Requirement 11: Field provenance
**User Story:** As a user, I want to see where each field came from, so that I can trust the extracted data.
#### Acceptance Criteria
1. WHEN a field is filled, THE SYSTEM SHALL record its provenance as the mapper that produced it, a quote from the source text, a selector, or a page and region of a PDF or photo.
2. WHEN the LLM supplies a quote as provenance, THE SYSTEM SHALL check that the quote appears in the prepared source text (ignoring whitespace and case); IF it does not, THEN THE SYSTEM SHALL keep the field and mark its provenance `unverified`.

### Requirement 12: Index items for search
**User Story:** As a user, I want new items searchable right away, so that I can find what I just saved.
#### Acceptance Criteria
1. WHEN an item is saved, THE SYSTEM SHALL compute its embedding (`openai/text-embedding-3-small` through OpenRouter, behind the provider interface, with the model name stored per 01.5-backend-foundation Requirement 7.5) from the fields the goal marks searchable, and update its full-text index.
2. IF embedding fails, THEN THE SYSTEM SHALL keep the item `ready`, leave it searchable by full text, and retry the embedding in the background.

### Requirement 13: Pages with summaries
**User Story:** As a user, I want items grouped into pages (by cuisine, by topic), so that I see the big picture.
#### Acceptance Criteria
1. WHEN an item is saved, THE SYSTEM SHALL assign it to pages per the goal's `pages.groupBy` rule, within the user's own tenant.
2. WHEN a page's items change, THE SYSTEM SHALL re-summarize it in the background with an LLM-written summary that cites its items, at most once per page every 5 minutes.
3. IF a spend cap blocks a re-summary (auth-abuse Requirement 3), THEN THE SYSTEM SHALL keep the previous summary and run the re-summary after the cap resets.

### Requirement 14: Latency
**User Story:** As a user, I want captures to show up quickly, so that the app feels instant.
#### Acceptance Criteria
1. WHEN the golden web-page fixtures are captured against the configured real provider, THE SYSTEM SHALL reach `ready` within 10 s at the 90th percentile.
2. WHEN the golden multi-photo fixtures are captured against the configured real provider, THE SYSTEM SHALL reach `ready` within 20 s at the 90th percentile.

### Requirement 15: LLM cost per operation
**User Story:** As the operator, I want a bounded LLM cost per action, so that the product is affordable to run.
#### Acceptance Criteria
1. WHEN a capture is compiled, THE SYSTEM SHALL make at most one extraction call plus at most two repair calls (Requirement 9), and no extraction call when mappers cover it (Requirement 7.2).
2. WHEN any LLM or embedding call is made, THE SYSTEM SHALL check and record spend against the caps in auth-abuse Requirement 3.

### Requirement 16: Pluggable providers and a deterministic mock
**User Story:** As a developer, I want to swap LLM providers and use a mock, so that tests and demos are deterministic.
#### Acceptance Criteria
1. WHEN the system makes an LLM call, THE SYSTEM SHALL go through a provider interface with OpenRouter as the default implementation; embeddings SHALL go through the same kind of interface.
2. WHEN tests or demo mode run, THE SYSTEM SHALL use the mock implementation, which returns recorded outputs keyed by a hash of the request, and SHALL fail the test if a request has no recording.

### Requirement 17: RSS feeds *(stretch)*
**User Story:** As a reader, I want a goal to follow an RSS feed, so that new articles arrive without capturing each one.
#### Acceptance Criteria
1. WHEN a user subscribes to an RSS feed in an app, THE SYSTEM SHALL poll it through the SSRF-safe fetcher at most once per hour and create a source for each new feed item.
2. WHEN a feed delivers more than 20 new items in one poll, THE SYSTEM SHALL capture only the newest 20.

---
