# Spec: goal-engine

# Requirements: Goal Engine (core)

Lives in `/core`.

## Introduction
The goal engine owns goals: creating them from a name and description, validating goal specs (the "one file"), naming and resolving them, versioning, and export/import. Every other feature consumes goal specs through this engine.

## Requirements

### Requirement 1: Create a goal from a description and a name
**User Story:** As a user, I want to describe a goal in plain language and name it, so that the engine drafts a working app for it.
#### Acceptance Criteria
1. WHEN the user submits a description and a name, THE SYSTEM SHALL generate a draft goal spec containing a schema, a parser, pages, and views.
2. WHEN a draft goal spec is generated, THE SYSTEM SHALL show a preview before saving.
3. WHEN the user approves a draft, THE SYSTEM SHALL save it as version 1 of the goal.
4. IF the user does not approve the draft, THE SYSTEM SHALL NOT save a goal version.

### Requirement 2: Unique, editable names with stable slug and id
**User Story:** As a user, I want to rename a goal without breaking links, so that I can change my mind about names.
#### Acceptance Criteria
1. WHEN a goal is created or renamed, THE SYSTEM SHALL reject a name that matches another of the user's goal names case-insensitively.
2. WHEN a goal is created, THE SYSTEM SHALL assign an immutable `id` and a stable, unique-per-user `slug` (e.g. `recipe-box`).
3. WHEN a goal is renamed, THE SYSTEM SHALL keep its `id` and `slug` unchanged so existing links keep working.

### Requirement 3: The name is the main handle; resolve names to goals
**User Story:** As a user, I want to refer to a goal by its name everywhere, so that "find X in Research Library" just works.
#### Acceptance Criteria
1. WHEN the user refers to a goal by text, THE SYSTEM SHALL resolve it by exact case-insensitive name, then slug, then fuzzy (trigram) match over name and description.
2. WHEN a goal is resolved for a search request, THE SYSTEM SHALL search only that goal's items.
3. IF the top two fuzzy matches are within the configured margin, THE SYSTEM SHALL ask the user to pick between the closest matches.
4. WHEN goals are listed on the home screen, capture screen (or share sheet in the iOS stretch), search scope, or MCP tools, THE SYSTEM SHALL present them by name.

### Requirement 4: Icon, accent color, and description
**User Story:** As a user, I want each goal to look distinct without extra work, so that my home screen is easy to scan.
#### Acceptance Criteria
1. WHEN a draft goal is generated, THE SYSTEM SHALL generate a default icon, accent color, and short description.
2. WHEN the user edits the icon, color, or description, THE SYSTEM SHALL save the edit without changing the goal's schema version.

### Requirement 5: Reject invalid view specs at validation time
**User Story:** As a developer, I want invalid specs rejected before they are saved, so that the app never renders broken screens.
#### Acceptance Criteria
1. WHEN a goal spec is validated, THE SYSTEM SHALL check the JSON Schema, field references in views, component names, and parser mapper names.
2. IF a view spec references an unknown component or field, THE SYSTEM SHALL reject the spec and return the exact errors.
3. IF a component is bound to a field whose type it does not accept, THE SYSTEM SHALL reject the spec.

### Requirement 6: Versioning, migration, and recompile
**User Story:** As a user, I want to change a goal's schema safely, so that my existing items keep working.
#### Acceptance Criteria
1. WHEN a goal spec is published, THE SYSTEM SHALL store it as a new numbered version with its author (`app` or `mcp:<client>`).
2. WHEN a goal's schema changes, THE SYSTEM SHALL ask the user to confirm before touching existing items.
3. WHEN the user confirms, THE SYSTEM SHALL either run a generated migration on existing items or recompile them from their stored sources.
4. IF the user does not confirm, THE SYSTEM SHALL leave existing items on their current version.

### Requirement 7: Export and import as one file
**User Story:** As a user or tenant, I want to export a goal as a single JSON file, so that "a new app is one file" and goals can be shared.
#### Acceptance Criteria
1. WHEN the user exports a goal, THE SYSTEM SHALL produce a single JSON file containing the full goal spec.
2. WHEN the user imports a goal file, THE SYSTEM SHALL validate it (Requirement 5) before creating the goal.
3. IF an imported goal's name collides with an existing goal name, THE SYSTEM SHALL ask the user to rename it before saving.


---

