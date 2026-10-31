# Spec: submission

# Requirements: Repo Foundation and Hackathon Submission

Requirements are labelled `SUB-n`. Re-check hackathon rules before submission.

## Requirements

### Requirement SUB-1: Repo skeleton
#### Acceptance Criteria
1. WHEN the repo is created, THE SYSTEM SHALL contain `/.kiro` (specs, steering, hooks) committed and not gitignored, `/core`, `/web-kit`, `/apps/recipe-box`, `/apps/research-library` (both web apps), and an OSI-approved `LICENSE`; `/ios-kit` only if the iOS stretch ships (web-first).
2. WHEN a file is saved in Kiro, THE SYSTEM SHALL run lint and tests via Kiro hooks.

### Requirement SUB-2: Tests, demo mode, hosted demo
#### Acceptance Criteria
1. WHEN CI runs, THE SYSTEM SHALL run golden tests per goal with the mock LLM.
2. WHEN a judge opens either public app URL, THE SYSTEM SHALL serve a working read-only demo tenant without sign-in, protected by an LLM spend cap.
3. WHEN a judge signs in with the demo login from the Devpost credentials field, THE SYSTEM SHALL allow capture and compile in demo mode (mock LLM or capped budget).
4. WHILE the Judging Period runs (until Fri Jan 29, 2027, 4:00 PM EST), THE SYSTEM SHALL keep both app URLs, the API, the MCP server and the demo login working.

### Requirement SUB-3: Demo video
#### Acceptance Criteria
1. WHEN the video is played, THE SYSTEM SHALL be shown in a phone browser and a desktop browser creating Recipe Box, then Research Library, finding an article by name, then creating a third goal over MCP from Kiro, within about 3 minutes.

### Requirement SUB-4: Kiro usage write-up
#### Acceptance Criteria
1. WHEN judges read the write-up, THE SYSTEM SHALL be documented showing how Kiro specs, steering, hooks, and MCP were used.


---

