# Spec: web-kit

# Requirements: Web Kit (web renderer, capture, search UI, public demo)

Lives in `/web-kit`. The renderer target is the web (not native iOS). Uses only the `/v1` API. Web stack: Vite + TanStack Router + TanStack Query + shadcn/ui + Tailwind CSS. Auth via `@clerk/clerk-react`.

## Requirements

### Requirement 1: Declarative view specs from a fixed web component catalog
**User Story:** As a user, I want generated screens that are polished and safe in my browser, so that a new goal looks like a real app and can't run anything harmful.
#### Acceptance Criteria
1. WHEN the web app renders a goal screen, THE SYSTEM SHALL build it only from the JSON view spec using the fixed v1 web component catalog (same component names and field types as the `/core` catalog definitions).
2. WHEN the web app receives a goal or view spec, THE SYSTEM SHALL treat it as data and SHALL NOT evaluate, load or execute generated code (no `eval`, no dynamic script loading, no generated HTML inserted into the page).
3. WHEN the web app shows item text from any source, THE SYSTEM SHALL render it as escaped text, and links SHALL use only `http`/`https` URLs.
4. IF a view spec references a component or field not in the web catalog, THE SYSTEM SHALL refuse to render that view and show a fallback.
5. WHEN the web app is served, THE SYSTEM SHALL send a Content-Security-Policy that blocks inline scripts and any third-party scripts except the ones sign-in requires (Clerk's scripts and domains). *(Configure CSP per Clerk's guidance for Vite/React apps.)*

### Requirement 2: Default and custom views, phone and desktop
**User Story:** As a user, I want every goal to have list, detail, and page screens automatically, on my phone or my laptop, so that a new goal is usable immediately anywhere.
#### Acceptance Criteria
1. WHEN a goal is created, THE SYSTEM SHALL provide default list, detail, and page views generated from its schema.
2. WHEN a goal declares custom views (e.g. Cooking Mode, Topic Page), THE SYSTEM SHALL render them in addition to the defaults.
3. WHEN any view is rendered, THE SYSTEM SHALL apply the shared theme.
4. WHEN the viewport is phone-width, THE SYSTEM SHALL lay out every catalog component in one column with touch-sized controls; WHEN it is desktop-width, THE SYSTEM SHALL use a wider layout (for example list and detail side by side).

### Requirement 3: Capture in the browser
**User Story:** As a signed-in user, I want to paste or upload anything into a named goal, so that capture works without a native app.
#### Acceptance Criteria
1. WHEN a signed-in user pastes a URL or text, or uploads one or more photos or a PDF, THE SYSTEM SHALL submit it as a source via the API.
2. WHEN a capture has no goal, THE SYSTEM SHALL show the suggested goal by name and let the user confirm or pick another.
3. WHEN a capture is submitted, THE SYSTEM SHALL show its compile status until the item is ready or failed.
4. IF the visitor is not signed in, THE SYSTEM SHALL show a sign-in prompt instead of submitting (auth-abuse Requirement 10).

### Requirement 4: Search UI
**User Story:** As a user, I want to search "Research Library" with a vague query, so that I can find what I saved by meaning.
#### Acceptance Criteria
1. WHEN the user searches in the web app search bar, THE SYSTEM SHALL show results with title, goal name, snippet, and source link.
2. WHEN the user scopes the search by goal name (selector or "in <goal name>" text), THE SYSTEM SHALL resolve the goal by name and show only its results.
3. IF the goal name is ambiguous, THE SYSTEM SHALL ask the user to pick between the closest matches.

### Requirement 5: Goal creation flow
**User Story:** As a signed-in user, I want to create a goal in the browser, so that I can start a new app in a minute.
#### Acceptance Criteria
1. WHEN a signed-in user enters a name and description, THE SYSTEM SHALL request a draft and show a rendered preview using the web catalog.
2. WHEN the user approves the preview, THE SYSTEM SHALL publish the goal.

### Requirement 6: Public read-only demo
**User Story:** As a judge or visitor, I want to open a public URL and look around without an account, so that I can see the app working immediately.
#### Acceptance Criteria
1. WHEN an anonymous visitor opens either app URL, THE SYSTEM SHALL show the demo tenant's goals, items, pages and search read-only, with no sign-in.
2. WHILE the visitor is anonymous, THE SYSTEM SHALL hide or disable capture, goal creation and edit controls, and SHALL show a "Sign in to import" action.
3. WHEN the visitor signs in (including with the judge demo login), THE SYSTEM SHALL enable capture and goal creation in the same session.

### Requirement 7: Two web apps from the two app folders
**User Story:** As a judge, I want two distinct apps built from one template, so that the Skeleton Crew claim is visible.
#### Acceptance Criteria
1. WHEN `/apps/recipe-box` or `/apps/research-library` is built, THE SYSTEM SHALL produce a web app that uses `/web-kit` and contains only its goal spec, a thin entry point and its custom component.
2. WHEN both apps are deployed, THE SYSTEM SHALL serve each at its own public URL or path (deployment path to be determined), on the shared `/v1` backend.


---

