# Spec: app-recipe-box

# Requirements: App 1 — Recipe Box

Lives in `/apps/recipe-box`. Requirements below are labelled `RB-n`. Engine behavior is cross-referenced, not duplicated. Recipe Box serves exactly one app goal, defined by its goal file (goal-engine Requirement 8).

## Requirements

### Requirement RB-1: Recipe Box goal file
**User Story:** As a home cook, I want my recipes captured as structured recipes, so that I can cook from them.
#### Acceptance Criteria
1. WHEN a recipe source is compiled, THE SYSTEM SHALL produce a `Recipe` item with required `title`, `ingredients[{qty, unit, item, note}]` (with `item` required) and `steps[{text, timer_seconds}]` (with `text` required), and optional `servings`, `total_time`, `cuisine`, `tags` and `image`.
2. WHEN a web page contains JSON-LD `Recipe`, THE SYSTEM SHALL map it deterministically before calling the LLM (capture-compile Requirement 7).
3. WHEN the source is one or more photos, THE SYSTEM SHALL compile them through the photo path (capture-compile Requirement 6).
4. WHEN recipes are saved, THE SYSTEM SHALL group them into pages by `cuisine`.
5. WHEN the goal file marks searchable fields, THE SYSTEM SHALL include `title`, `ingredients.item`, `cuisine` and `tags`.
6. *(Stretch)* WHEN a user creates a collection and adds recipes to it, THE SYSTEM SHALL show it as a page alongside the cuisine pages.

### Requirement RB-2: Cooking Mode custom view
**User Story:** As a cook with messy hands, I want step-by-step cooking with timers and voice "next", so that I don't touch my phone.
#### Acceptance Criteria
1. WHEN the user opens Cooking Mode on a recipe, THE SYSTEM SHALL show one step at a time with next/previous navigation.
2. WHEN a step has `timer_seconds`, THE SYSTEM SHALL offer a timer for that step that alerts with sound and on screen when it ends.
3. WHEN voice control is on and the user says "next" or "back", THE SYSTEM SHALL move to the next or previous step.
4. IF the browser has no speech recognition or the user denies microphone access, THEN THE SYSTEM SHALL hide the voice control and keep large tap targets for next/previous.
5. WHILE Cooking Mode is open, THE SYSTEM SHALL keep the screen awake where the browser supports the Screen Wake Lock API.

### Requirement RB-3: Thin app target
**User Story:** As a judge, I want to see the app is the skeleton plus one file and one custom view, so that the template's reuse is obvious.
#### Acceptance Criteria
1. WHEN the Recipe Box app is built, THE SYSTEM SHALL consist of the goal file, a thin web entry point, and the CookingMode component, with everything else from `/web-kit` and `/core` (web-kit Requirement 7).
2. WHEN the Recipe Box app is deployed, THE SYSTEM SHALL serve it at a public URL that works in phone and desktop browsers.

---
