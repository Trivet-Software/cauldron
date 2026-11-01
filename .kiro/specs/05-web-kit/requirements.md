# Spec: web-kit

# Requirements: Web Kit (web renderer, app shell, capture, search UI, public demo)

Lives in `/web-kit`. The renderer target is the web (not native iOS). Uses only the `/v1` API. Web stack: Vite + TanStack Router + TanStack Query + shadcn/ui + Tailwind CSS. Auth via `@clerk/react` (v6).

## Introduction

`web-kit` is the skeleton every app is built from. It holds the app shell (routing, auth, header), the renderer that draws screens from a goal's view specs, the capture, review and search screens, a Developer section for users with the developer role, and the `create-app` scaffold command. An app adds only its goal file, a thin entry point and an optional custom view. Each app shows exactly one goal (goal-engine Requirement 8).

## Requirements

### Requirement 1: Declarative view specs from a fixed web component catalog
**User Story:** As a user, I want generated screens that are polished and safe in my browser, so that a new goal looks like a real app and can't run anything harmful.
#### Acceptance Criteria
1. WHEN the web app renders a goal screen, THE SYSTEM SHALL build it only from the JSON view spec using the fixed v1 web component catalog (same component names and field types as the `/core` catalog definitions), plus the app's registered custom view if the spec names it.
2. WHEN the web app receives a goal or view spec, THE SYSTEM SHALL treat it as data and SHALL NOT evaluate, load or execute generated code (no `eval`, no dynamic script loading, no generated HTML inserted into the page).
3. WHEN the web app shows item text from any source, THE SYSTEM SHALL render it as escaped text, and links SHALL use only `http`/`https` URLs.
4. IF a view spec references a component or field not in the web catalog, THE SYSTEM SHALL refuse to render that view and show a fallback.
5. WHEN the web app is served, THE SYSTEM SHALL send a Content-Security-Policy that blocks inline scripts and any third-party scripts except the ones sign-in requires (Clerk's scripts and domains). *(Configure CSP per Clerk's guidance for Vite/React apps.)*

### Requirement 2: Default and custom views, phone and desktop
**User Story:** As a user, I want every goal to have list, detail, and page screens automatically, on my phone or my laptop, so that a new goal is usable immediately anywhere.
#### Acceptance Criteria
1. WHEN a goal is rendered, THE SYSTEM SHALL provide default list, detail, and page views generated from its schema.
2. WHEN a goal declares a custom view that the app registers (e.g. Cooking Mode, Topic Page), THE SYSTEM SHALL render it in addition to the defaults.
3. WHEN any view is rendered, THE SYSTEM SHALL apply the shared theme with the goal's accent color.
4. WHEN the viewport is phone-width, THE SYSTEM SHALL lay out every catalog component in one column with touch-sized controls; WHEN it is desktop-width, THE SYSTEM SHALL use a wider layout (for example list and detail side by side).

### Requirement 3: Capture in the browser
**User Story:** As a signed-in user, I want to paste or upload anything into the app, so that capture works without a native app.
#### Acceptance Criteria
1. WHEN a signed-in user pastes a URL or text, or uploads one or more photos or a PDF, THE SYSTEM SHALL submit it as a source for the app's goal via the API.
2. WHEN a capture is submitted, THE SYSTEM SHALL show its compile status (capture-compile Requirement 4) until it is `ready`, `needs_review` or `failed`, and show the failure reason when it fails.
3. IF the pasted URL is from a social network (capture-compile Requirement 3), THEN THE SYSTEM SHALL ask the user to paste the post text or upload screenshots instead.
4. IF a capture exceeds a limit (capture-compile Requirement 1.3), THEN THE SYSTEM SHALL show which limit before uploading.
5. IF the visitor is not signed in, THE SYSTEM SHALL show a sign-in prompt instead of submitting (auth-abuse Requirement 10).

### Requirement 4: Search UI
**User Story:** As a user, I want to search my collection with a vague query, so that I can find what I saved by meaning.
#### Acceptance Criteria
1. WHEN the user searches in the app's search bar, THE SYSTEM SHALL search the app's goal (search Requirement 1.1) and show results with title, snippet, and source link.
2. WHEN a search returns no results, THE SYSTEM SHALL say so.

### Requirement 5: Goal preview for developers
**User Story:** As a developer, I want to see a goal rendered before I publish it, so that I know the app will look right without writing code.
#### Acceptance Criteria
1. WHEN a developer opens the preview URL for one of their goals (draft or published), THE SYSTEM SHALL render its default views and any catalog-only custom views with sample items generated from the schema.
2. WHEN a goal is drafted through MCP or the API, THE SYSTEM SHALL return this preview URL (mcp-server `preview_goal`).
3. IF the visitor is not the goal's owner, THEN THE SYSTEM SHALL refuse to show the preview.
4. WHEN the preview is served, THE SYSTEM SHALL host it in the Developer section of the app shell (Requirement 9), so every app deployment can show it and no separate service is needed.

### Requirement 6: Public read-only demo
**User Story:** As a judge or visitor, I want to open a public URL and look around without an account, so that I can see the app working immediately.
#### Acceptance Criteria
1. WHEN an anonymous visitor opens either app URL, THE SYSTEM SHALL show the public demo account's items, pages and search for that app's goal, read-only, with no sign-in (auth-abuse Requirement 10).
2. WHILE the visitor is anonymous, THE SYSTEM SHALL hide or disable capture and edit controls, and SHALL show a "Sign in to import" action.
3. WHEN the visitor signs in (including with the judge account), THE SYSTEM SHALL switch to the signed-in user's own collection and enable capture in the same session.

### Requirement 7: Two thin web apps on one skeleton
**User Story:** As a judge, I want two distinct apps built from one template, so that the Skeleton Crew claim is visible.
#### Acceptance Criteria
1. WHEN `/apps/recipe-box` or `/apps/research-library` is built, THE SYSTEM SHALL produce a web app that takes its shell (routing, auth, header, capture, review, search, default views) from `/web-kit` and contains only its goal file, a thin entry point and its custom view.
2. WHEN the foundation's app shell (router, `AuthBridge`, routes, env validation in `apps/recipe-box`) is reused by a second app, THE SYSTEM SHALL have it moved into `/web-kit` so neither app duplicates it.
3. WHEN both apps are deployed, THE SYSTEM SHALL serve each as its own Railway service and public URL, in one shared production environment with the `api`, `worker` and `mcp` services, on the shared `/v1` backend.
4. WHEN a developer runs `pnpm create-app <name> [--goal <path>]`, THE SYSTEM SHALL create `apps/<name>/` from a template containing the goal file (from `--goal`, or a minimal valid example), a thin entry point that bundles the app's goal slug, a `package.json`, and its own build and deploy config; IF `apps/<name>/` already exists or the goal file fails validation, THEN THE SYSTEM SHALL stop without writing anything.
5. WHEN an app is built or deployed, THE SYSTEM SHALL build only that app's folder, so adding an app needs no change to the root build scripts or to other apps' config.

### Requirement 8: Item detail, provenance and review
**User Story:** As a user, I want to see where each field came from and fix failed captures, so that I can trust my collection and nothing is lost.
#### Acceptance Criteria
1. WHEN the user opens an item's detail view, THE SYSTEM SHALL let them see each field's provenance (capture-compile Requirement 11), including whether a quote is `unverified`.
2. WHEN the user has `needs_review` drafts or `failed` captures, THE SYSTEM SHALL list them in a review screen with their errors or failure reasons.
3. WHEN the user edits a draft's fields, THE SYSTEM SHALL validate on save and show any remaining errors next to the fields.
4. WHEN the user chooses retry on a draft or failed capture, THE SYSTEM SHALL request a recompile (capture-compile Requirement 9.4).

### Requirement 9: Settings and the Developer section
**User Story:** As a developer, I want my drafts, approvals, keys and app status in one place in the app, so that I can manage goals without a separate admin backend and an AI client can't act without me.
#### Acceptance Criteria
1. WHEN a signed-in user opens settings, THE SYSTEM SHALL let them create, list (by prefix and scopes) and revoke API keys (auth-abuse Requirement 4), showing a new key once.
2. WHEN an MCP client requests `publish_goal` or `update_goal`, THE SYSTEM SHALL show the pending request in the Developer section, with a diff of the goal spec, where the owner approves or declines it (mcp-server Requirement 3).
3. WHEN a user with the developer role (auth-abuse Requirement 11) is signed in, THE SYSTEM SHALL show a Developer section at `/developer` in every app; for everyone else, THE SYSTEM SHALL hide the link and return "not found" for the route. The server SHALL enforce the role on every Developer API call; hiding the route is only for convenience.
4. WHEN a developer opens the Developer section, THE SYSTEM SHALL list their drafts with preview links (Requirement 5) and their pending approvals.
5. WHEN a developer opens the Developer section, THE SYSTEM SHALL show every app goal's registration status from `/health` (goal-engine Requirement 8.5): slug, current spec version, and any errors from the last startup.

---
