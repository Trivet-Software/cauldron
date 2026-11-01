# Requirements Document

## Introduction

The goal engine (goal-engine spec, lives in `/core`) owns goals: drafting them from a name and description, validating goal specs (the "one file"), naming and resolving them, versioning, export/import, and publishing a goal as an app.

A goal is plain data: a schema for its items, parser rules (deterministic mapper names plus LLM extraction instructions), a page grouping rule, and JSON view specs. Every other feature consumes goal specs through this engine.

### Who creates goals

- **Developers** create goals. A developer is a signed-in user with the developer role (auth-abuse Requirement 11) on their own Cauldron deployment. They draft a goal through the MCP server (for example from Kiro) or the `/v1` API, check it with the validator, preview it, and ship it as an app: a goal file in `apps/<name>/` plus a thin entry point and an optional custom view.
- **End users** never create goals. They open an app (Recipe Box, Research Library) and capture into that app's goal.

Goals have one of two owners:
- **Drafts** belong to the developer who created them and are visible only to that developer.
- **App goals** come from `apps/*/goal.json` in the repo. They belong to a built-in **system owner**, not a user, are readable by everyone, and change only through a redeploy (Requirement 8).

Letting end users create their own goals in the browser is on the roadmap, not in scope.

## Requirements

### Requirement 1: Draft a goal from a description and a name
**User Story:** As a developer, I want to describe a goal in plain language and name it, so that the engine drafts a working goal spec for me.
#### Acceptance Criteria
1. WHEN a user with the developer role (auth-abuse Requirement 11) submits a description of at most 2000 characters and a name of at least 1 and at most 100 characters, THE SYSTEM SHALL generate a draft goal spec containing a schema, parser rules, a page grouping rule, and views.
2. WHEN a draft goal spec is generated, THE SYSTEM SHALL use at most one LLM call (with a larger model than compile uses), counted against the developer's spend caps (auth-abuse Requirement 3).
3. WHEN a draft goal spec is generated, THE SYSTEM SHALL validate it (Requirement 5) and make a rendered preview available (web-kit Requirement 5) before saving.
4. WHEN the developer approves the draft, THE SYSTEM SHALL save it as version 1 of the goal.
5. IF the developer does not approve the draft, THE SYSTEM SHALL NOT save a goal version.
6. IF the submission has a description longer than 2000 characters, a name longer than 100 characters, or an empty name, THEN THE SYSTEM SHALL reject it with an error message indicating the invalid input.
7. IF the caller does not have the developer role, THEN THE SYSTEM SHALL reject the request with 403 and make no LLM call.

### Requirement 2: Unique, editable names with stable slug and id
**User Story:** As a developer, I want to rename a goal without breaking links, so that I can change my mind about names.
#### Acceptance Criteria
1. IF a goal is created or renamed with a name that, after removing leading and trailing whitespace, is empty or case-insensitively matches another of the owner's goal names, THEN THE SYSTEM SHALL not save the submitted name and shall indicate that the name was rejected.
2. WHEN a goal is created, THE SYSTEM SHALL assign an immutable `id` that is globally unique and a stable `slug` (e.g. `recipe-box`) that is unique per owner.
3. IF the slug derived from a new goal's name is already used by another of the owner's goals (e.g. "Recipe Box" and "Recipe-Box"), THEN THE SYSTEM SHALL append a numeric suffix (`recipe-box-2`).
4. WHEN a goal is renamed, THE SYSTEM SHALL keep its `id` and `slug` unchanged so existing links keep working.

### Requirement 3: Resolve names to goals
**User Story:** As a user of an MCP client or the API, I want to refer to a goal by its name, so that "find X in Research Library" just works.
#### Acceptance Criteria
1. WHEN a goal is referred to by text, THE SYSTEM SHALL resolve it among the goals the caller can access (their own goals and app goals) by exact case-insensitive name, then slug, then fuzzy (trigram) match over name and description.
2. WHEN a goal is resolved for a search request, THE SYSTEM SHALL search only that goal's items.
3. IF the top two fuzzy matches are within a margin of 0.1 in trigram similarity score, THE SYSTEM SHALL return both candidates and ask the caller to pick one instead of guessing.
4. IF the text matches no goal by exact name, slug, or fuzzy match, THEN THE SYSTEM SHALL return an error indicating no matching goal was found.
5. WHEN goals are listed (MCP tools, API), THE SYSTEM SHALL present them by name.

### Requirement 4: Icon, accent color, and description
**User Story:** As a developer, I want each goal to look distinct without extra work, so that apps are easy to tell apart.
#### Acceptance Criteria
1. WHEN a draft goal is generated, THE SYSTEM SHALL generate a non-empty default icon, accent color, and a description of at most 200 characters.
2. WHEN the owner edits the icon, color, or description, THE SYSTEM SHALL save the edit without changing the goal's schema version (Requirement 6).
3. IF the owner submits a description longer than 200 characters, THEN THE SYSTEM SHALL reject the submission and indicate the error.
4. IF a save of an icon, color, or description edit fails, THEN THE SYSTEM SHALL retain the pre-edit values and indicate the failure.

### Requirement 5: Reject invalid goal specs at validation time
**User Story:** As a developer, I want invalid specs rejected before they are saved, so that an app never renders broken screens or compiles into a broken schema.
#### Acceptance Criteria
1. WHEN a goal spec is submitted for validation, THE SYSTEM SHALL check: JSON Schema conformance of the goal file; that every field referenced by a view or by `pages.groupBy` is defined in the goal's schema; that every component name exists in the component catalog; that every component accepts the type of the field bound to it; that every parser mapper name is a known mapper; and that LLM extraction instructions are within their size limit (at most 4000 characters).
2. WHEN `pages.groupBy` references an array field (e.g. `topics`), THE SYSTEM SHALL accept it and assign an item to one page per array value.
3. IF any check fails, THEN THE SYSTEM SHALL reject the spec, not save it, and return every distinct validation error found, each naming the failing path in the goal file.

### Requirement 6: Versioning and schema lock
**User Story:** As a developer, I want goal schemas locked once items are captured, so that existing items stay consistent without migration complexity.
#### Acceptance Criteria
1. WHEN a goal spec is published, THE SYSTEM SHALL store it as a new **spec version**: a sequential integer starting at 1 and incrementing on each publish, with its author (`app`, `deploy`, or `mcp:<client>`).
2. WHEN a published change alters the schema (the data model or fields), THE SYSTEM SHALL also increment the goal's **schema version**; a change to views, pages, parser rules, icon, accent color, or description SHALL increment only the spec version.
3. IF a goal has one or more captured items, THEN THE SYSTEM SHALL reject any change to its schema, leave the existing schema unchanged, and return an error stating the schema is locked and that a new goal must be created to use the new schema.
4. WHEN parser rules change on a goal that has items, THE SYSTEM SHALL apply the new rules to new captures only; existing items are not recompiled automatically.

### Requirement 7: Export and import as one file
**User Story:** As a developer, I want to export a goal as a single JSON file, so that "a new app is one file" and goals can be committed to an app folder or shared.
#### Acceptance Criteria
1. WHEN the owner exports a goal, THE SYSTEM SHALL produce a single JSON file containing the latest published goal spec (schema, parser rules, pages, views, icon, accent color, description) and excluding captured items.
2. WHEN a goal file is imported, THE SYSTEM SHALL validate it (Requirement 5) before creating the goal.
3. IF the imported goal file fails validation, THEN THE SYSTEM SHALL reject the file and return the validation errors, without creating a goal.
4. IF an imported goal's name collides with one of the owner's existing goal names, THE SYSTEM SHALL ask the owner to rename it before saving.
5. IF the owner cancels the rename prompted by a name collision, THEN THE SYSTEM SHALL abort the import without creating a goal.

### Requirement 8: App goals registered at startup
**User Story:** As a developer, I want my goal file to become a working app for everyone who signs in, so that I can ship a collection app without building capture and search myself.
#### Acceptance Criteria
1. WHEN the API service starts, THE SYSTEM SHALL read every `apps/*/goal.json` and validate each one (Requirement 5).
2. WHEN a valid goal file's content hash matches the stored latest version, THE SYSTEM SHALL change nothing, so that several API instances starting at once produce one version.
3. WHEN a valid goal file differs from the stored latest version, THE SYSTEM SHALL publish it as a new spec version (Requirement 6) of that app's **app goal**, owned by the system owner, with author `deploy`. The goal's slug is the app folder name.
4. IF a goal file fails validation, or changes the schema of an app goal that has items (Requirement 6.3), THEN THE SYSTEM SHALL log the errors, keep serving the previous version (or no goal, for a new app), and keep starting the other apps' goals.
5. WHEN `/health` is requested, THE SYSTEM SHALL report each app goal's slug, current spec version, and whether its last registration succeeded or failed with which errors.
6. WHEN any request other than startup registration tries to change an app goal, THE SYSTEM SHALL reject it; app goals change only through the repo.
7. WHEN any signed-in user captures into an app goal, THE SYSTEM SHALL store the resulting sources, items and pages in that user's own tenant; the goal spec stays shared and read-only.
8. WHEN an app is opened, THE SYSTEM SHALL show only that app's goal; each app serves exactly one goal, identified by the slug bundled at build time.
9. WHEN a goal is a draft, THE SYSTEM SHALL make it accessible only to the developer who owns it.

### Requirement 9: Searchable fields
**User Story:** As a developer, I want to say which fields matter for search, so that the generic search engine ranks my items well without custom code.
#### Acceptance Criteria
1. WHEN a goal schema marks fields as `searchable` (with an optional weight), THE SYSTEM SHALL use those fields for embeddings and full-text ranking (capture-compile Requirement 12, search Requirement 3).
2. WHEN a goal schema marks one date field as the item's `date`, THE SYSTEM SHALL use it for date filters and relative-time queries; otherwise the capture time is used.
3. IF a goal marks no field as `searchable`, THEN THE SYSTEM SHALL use the item's title field.

### Requirement 10: From draft to app
**User Story:** As a developer, I want to turn an approved draft into an app folder, so that a goal I designed with Kiro becomes a deployable app.
#### Acceptance Criteria
1. WHEN a developer exports an approved draft (Requirement 7.1) and runs the scaffold command (web-kit Requirement 7.4), THE SYSTEM SHALL produce an `apps/<name>/goal.json` that registers at the next startup (Requirement 8).
2. WHEN a draft has been shipped as an app goal, THE SYSTEM SHALL keep the draft unchanged; later edits to the app go through the goal file in the repo.

---
