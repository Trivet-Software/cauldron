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
3. IF a view spec references a component or field not in the app's catalog, THE SYSTEM SHALL refuse to render that view and show a fallback.
4. WHEN the user signs in, THE SYSTEM SHALL use Sign in with Apple through Clerk (auth-abuse Requirement 1.3), and SHALL show the public demo account read-only before sign-in (auth-abuse Requirement 10).

### Requirement 2: Default and custom views
**User Story:** As a user, I want every goal to have list, detail, and page screens automatically, so that a new goal is usable immediately.
#### Acceptance Criteria
1. WHEN a goal is rendered, THE SYSTEM SHALL provide default list, detail, and page views generated from its schema.
2. WHEN a goal declares a custom view that the app registers (e.g. Cooking Mode), THE SYSTEM SHALL render it in addition to the defaults.
3. WHEN any view is rendered, THE SYSTEM SHALL apply the shared theme.

### Requirement 3: Capture on device
**User Story:** As a user, I want to share into the app from anywhere, so that capture is effortless.
#### Acceptance Criteria
1. WHEN the user shares a URL, text, one or more photos, or a PDF to the app, THE SYSTEM SHALL submit it as a source via the API.
2. WHEN a capture is shared to an app built on `ios-kit`, THE SYSTEM SHALL submit it to that app's one goal (goal-engine Requirement 8).

### Requirement 4: Search UI and App Intents
**User Story:** As a user, I want to say "Search Research Library for …", so that I can find things hands-free.
#### Acceptance Criteria
1. WHEN the user searches in the app search bar, THE SYSTEM SHALL search the app's goal and show results with title, snippet, and source link.
2. WHEN the user invokes the App Intent "Search <app name> for …", THE SYSTEM SHALL search that app's goal and show its results.

*(Goal creation is a developer task done through MCP or the API, so the iOS app has no goal creation flow.)*
