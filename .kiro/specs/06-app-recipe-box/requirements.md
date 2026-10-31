# Spec: app-recipe-box

# Requirements: App 1 — Recipe Box

Lives in `/apps/recipe-box`. Requirements below are labelled `RB-n`. Engine behavior is cross-referenced, not duplicated.

## Requirements

### Requirement RB-1: Recipe Box goal spec
**User Story:** As a home cook, I want my recipes captured as structured recipes, so that I can cook from them.
#### Acceptance Criteria
1. WHEN a recipe source is compiled, THE SYSTEM SHALL produce a `Recipe` item with title, servings, total_time, ingredients[{qty, unit, item, note}], steps[{text, timer_seconds}], cuisine, tags, and image.
2. WHEN a web page contains JSON-LD `Recipe`, THE SYSTEM SHALL map it deterministically before calling the LLM.
3. WHEN the source is one or more photos, THE SYSTEM SHALL OCR them before extraction (where OCR runs: open question).
4. WHEN recipes are saved, THE SYSTEM SHALL group them into pages by `cuisine` and by user collections.

### Requirement RB-2: Cooking Mode custom view
**User Story:** As a cook with messy hands, I want step-by-step cooking with timers and voice "next", so that I don't touch my phone.
#### Acceptance Criteria
1. WHEN the user opens Cooking Mode on a recipe, THE SYSTEM SHALL show one step at a time with next/previous navigation.
2. WHEN a step has `timer_seconds`, THE SYSTEM SHALL offer a timer for that step.
3. WHEN the user says "next", THE SYSTEM SHALL advance to the next step.

### Requirement RB-3: Thin app target
**User Story:** As a judge, I want to see the app is the skeleton plus one file and one custom view, so that the template's reuse is obvious.
#### Acceptance Criteria
1. WHEN the Recipe Box app is built, THE SYSTEM SHALL consist of the goal spec, a thin web entry point, and the CookingMode component, with everything else from `/web-kit` and `/core` (web-first).
2. WHEN the Recipe Box app is deployed, THE SYSTEM SHALL serve it at a public URL that works in phone and desktop browsers.


---

