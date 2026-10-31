# Requirements Document

## Introduction

The goal engine (goal-engine spec, lives in `/core`) owns goals: creating them from a name and description, validating goal specs (the "one file"), naming and resolving them, versioning, and export/import. Every other feature consumes goal specs through this engine.

## Requirements

### Requirement 1: Create a goal from a description and a name
**User Story:** As a user, I want to describe a goal in plain language and name it, so that the engine drafts a working app for it.
#### Acceptance Criteria
1. WHEN the user submits a description of at most 2000 characters and a name of at least 1 and at most 100 characters, THE SYSTEM SHALL generate a draft goal spec containing a schema, a parser, pages, and views.
2. WHEN a draft goal spec is generated, THE SYSTEM SHALL show a preview of the schema, parser, pages, and views before saving.
3. WHEN the user confirms approval of the draft preview, THE SYSTEM SHALL save it as version 1 of the goal.
4. IF the user does not approve the draft, THE SYSTEM SHALL NOT save a goal version.
5. IF the user submits a description longer than 2000 characters, a name longer than 100 characters, or an empty name, THEN THE SYSTEM SHALL reject the submission with an error message indicating the invalid input.

### Requirement 2: Unique, editable names with stable slug and id
**User Story:** As a user, I want to rename a goal without breaking links, so that I can change my mind about names.
#### Acceptance Criteria
1. IF a goal is created or renamed with a name that, after removing leading and trailing whitespace, is empty or case-insensitively matches another of the user's goal names, THEN THE SYSTEM SHALL not save the submitted name and shall indicate to the user that the name was rejected.
2. WHEN a goal is created, THE SYSTEM SHALL assign an immutable `id` that is unique across the user's goals and a stable, unique-per-user `slug` (e.g. `recipe-box`).
3. WHEN a goal is renamed, THE SYSTEM SHALL keep its `id` and `slug` unchanged so existing links keep working.

### Requirement 3: The name is the main handle; resolve names to goals
**User Story:** As a user, I want to refer to a goal by its name everywhere, so that "find X in Research Library" just works.
#### Acceptance Criteria
1. WHEN the user refers to a goal by text, THE SYSTEM SHALL resolve it by exact case-insensitive name, then slug, then fuzzy (trigram) match over name and description.
2. WHEN a goal is resolved for a search request, THE SYSTEM SHALL search only that goal's items.
3. IF the top two fuzzy matches are within a margin of 0.1 in trigram similarity score, THE SYSTEM SHALL ask the user to pick between the closest matches.
4. WHEN goals are listed on the home screen, capture screen (or share sheet in the iOS stretch), search scope, or MCP tools, THE SYSTEM SHALL present them by name.
5. IF the user refers to a goal by text that matches no goal by exact name, slug, or fuzzy match, THEN THE SYSTEM SHALL return an error indicating no matching goal was found.

### Requirement 4: Icon, accent color, and description
**User Story:** As a user, I want each goal to look distinct without extra work, so that my home screen is easy to scan.
#### Acceptance Criteria
1. WHEN a draft goal is generated, THE SYSTEM SHALL generate a non-empty default icon, accent color, and a description of at most 200 characters.
2. WHEN the user edits the icon, color, or description, THE SYSTEM SHALL save the edit without changing the goal's schema version.
3. IF the user submits a description longer than 200 characters, THEN THE SYSTEM SHALL reject the submission and indicate the error to the user.
4. IF a save of an icon, color, or description edit fails, THEN THE SYSTEM SHALL retain the pre-edit values and indicate the failure to the user.

### Requirement 5: Reject invalid view specs at validation time
**User Story:** As a developer, I want invalid specs rejected before they are saved, so that the app never renders broken screens.
#### Acceptance Criteria
1. WHEN a goal spec is submitted for validation, THE SYSTEM SHALL validate its JSON Schema conformance, verify that field references in views correspond to fields defined in the goal's schema, verify that component names exist in the component catalog, and verify that parser mapper names are valid.
2. IF a view spec references a component that is not in the component catalog or a field that is not defined in the goal's schema, THEN THE SYSTEM SHALL reject the spec, not save it, and return every distinct validation error found.
3. IF a component is bound to a field whose type it does not accept, THEN THE SYSTEM SHALL reject the spec, not save it, and return every distinct validation error found.
4. IF a goal spec does not conform to the JSON Schema, THEN THE SYSTEM SHALL reject the spec, not save it, and return every distinct validation error found.
5. IF a goal spec references an unknown parser mapper name, THEN THE SYSTEM SHALL reject the spec, not save it, and return every distinct validation error found.

### Requirement 6: Versioning and schema lock
**User Story:** As a user, I want goal schemas locked once items are captured, so that my existing items stay consistent without migration complexity.
#### Acceptance Criteria
1. WHEN a goal spec is published, THE SYSTEM SHALL store it as a sequential integer version number that starts at 1 and increments on each publish, with its author (`app` or `mcp:<client>`).
2. IF a goal has one or more captured items, THE SYSTEM SHALL reject any attempted change to the goal's schema (the data model or fields), leave the existing schema unchanged, and return an error indicating that the schema is locked.
3. WHEN a schema change is rejected because the goal has captured items, THE SYSTEM SHALL inform the user that a new goal must be created to apply the new schema.
4. WHEN the user edits a view, page, icon, accent color, or description, THE SYSTEM SHALL save the change without bumping the schema version.

### Requirement 7: Export and import as one file
**User Story:** As a user or tenant, I want to export a goal as a single JSON file, so that "a new app is one file" and goals can be shared.
#### Acceptance Criteria
1. WHEN the user exports a goal, THE SYSTEM SHALL produce a single JSON file containing the latest published goal spec (schema, parser, pages, views, icon, accent color, description) and excluding captured items.
2. WHEN the user imports a goal file, THE SYSTEM SHALL validate it (Requirement 5) before creating the goal.
3. IF the imported goal file fails validation, THEN THE SYSTEM SHALL reject the file and show an error indicating which validation rules failed, without creating a goal.
4. IF an imported goal's name collides with an existing goal name, THE SYSTEM SHALL ask the user to rename it before saving.
5. IF the user cancels the rename prompted by a name collision during import, THEN THE SYSTEM SHALL abort the import without creating a goal.

---

