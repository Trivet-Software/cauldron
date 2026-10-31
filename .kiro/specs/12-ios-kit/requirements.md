# Spec: ios-kit

# Requirements: iOS Kit (renderer, capture, search UI): STRETCH (nice-to-have)

> **Stretch, not on the critical path.** The primary renderer is `/web-kit`. Build this only if on track after the core is done; otherwise it goes on the roadmap slide. App Store guideline 2.5.2 applies here if shipped.

Lives in `/ios-kit` (Swift package). Uses only the `/v1` API.

## Requirements

### Requirement 1: Declarative view specs from a fixed native catalog
**User Story:** As a user, I want generated screens that are native and safe, so that the app feels polished and passes App Review.
#### Acceptance Criteria
1. WHEN the app renders a goal screen, THE SYSTEM SHALL build it only from the JSON view spec using the fixed v1 native component catalog.
2. WHEN the app receives a goal or view spec, THE SYSTEM SHALL treat it as data and SHALL NOT download or execute generated code.
3. IF a view spec references a component not in the app's catalog, THE SYSTEM SHALL refuse to render that view and show a fallback.

### Requirement 2: Default and custom views
**User Story:** As a user, I want every goal to have list, detail, and page screens automatically, so that a new goal is usable immediately.
#### Acceptance Criteria
1. WHEN a goal is created, THE SYSTEM SHALL provide default list, detail, and page views generated from its schema.
2. WHEN a goal declares custom views (e.g. Cooking Mode), THE SYSTEM SHALL render them in addition to the defaults.
3. WHEN any view is rendered, THE SYSTEM SHALL apply the shared theme.

### Requirement 3: Capture on device
**User Story:** As a user, I want to share into the app from anywhere, so that capture is effortless.
#### Acceptance Criteria
1. WHEN the user shares a URL, text, one or more photos, or a PDF to the app, THE SYSTEM SHALL submit it as a source via the API.
2. WHEN a shared capture has no goal, THE SYSTEM SHALL show the suggested goal by name and let the user confirm or pick another.

### Requirement 4: Search UI and App Intents
**User Story:** As a user, I want to say "Search Research Library for …", so that I can find things hands-free.
#### Acceptance Criteria
1. WHEN the user searches in the app search bar, THE SYSTEM SHALL show results with title, goal name, snippet, and source link.
2. WHEN the user invokes the App Intent "Search <goal name> for …", THE SYSTEM SHALL resolve the goal by name and show its results.
3. IF the goal name is ambiguous, THE SYSTEM SHALL ask the user to pick between the closest matches.

### Requirement 5: Goal creation flow
**User Story:** As a user, I want to create a goal on my phone, so that I can start a new app in a minute.
#### Acceptance Criteria
1. WHEN the user enters a name and description, THE SYSTEM SHALL request a draft and show a rendered preview.
2. WHEN the user approves the preview, THE SYSTEM SHALL publish the goal.
