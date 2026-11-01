# Spec: submission

# Requirements: Repo Foundation and Hackathon Submission

Requirements are labelled `SUB-n`. Checked against the [Kiroween 2026 rules](https://kiroween.devpost.com/rules) on Nov 1, 2026; re-check before submitting.

Key dates: submissions close **Fri Dec 4, 2026, 2:00 PM PT**. The Judging Period runs Dec 16, 2026 to **Fri Jan 29, 2027, 1:00 PM PT** (4:00 PM EST).

## Requirements

### Requirement SUB-1: Repo skeleton
#### Acceptance Criteria
1. WHEN the repo is published, THE SYSTEM SHALL be a public GitHub repository containing `/.kiro` (specs, steering, hooks) committed and not gitignored, `/core`, `/web-kit`, `/apps/recipe-box` and `/apps/research-library` (two separate folders for the two apps), and an OSI-approved `LICENSE` that GitHub detects and shows in the repository's About section; `/ios-kit` only if the iOS stretch ships.
2. WHEN a file is saved in Kiro, THE SYSTEM SHALL run lint and the affected tests via Kiro hooks.
3. WHEN the repo is cloned, THE SYSTEM SHALL include the source, assets and README instructions needed to run both apps, including a self-hosting guide that lists every external account (Clerk, Supabase, Railway, OpenRouter), each environment variable, and how to grant the developer role.

### Requirement SUB-2: Tests, demo accounts, hosted demo
#### Acceptance Criteria
1. WHEN CI runs, THE SYSTEM SHALL run golden tests per app goal with the mock LLM (capture-compile Requirement 16.2).
2. WHEN a judge opens either public app URL, THE SYSTEM SHALL serve the public demo account read-only without sign-in, protected by the public spend cap (auth-abuse Requirement 10).
3. WHEN a judge signs in with the judge account from the Devpost credentials field, THE SYSTEM SHALL allow capture and compile under that account's cap (auth-abuse Requirement 9).
4. WHILE the Judging Period runs, THE SYSTEM SHALL keep both app URLs, the API, the MCP server and the judge account working, free of charge.

### Requirement SUB-3: Demo video
#### Acceptance Criteria
1. WHEN the video is played, it SHALL be under 3 minutes, publicly visible on YouTube, and free of third-party copyrighted music or material.
2. WHEN the video is played, it SHALL show, in a phone browser and a desktop browser: capturing a recipe into Recipe Box and opening Cooking Mode; capturing an article into Research Library and finding it from a vague description; then Kiro, using the `cauldron-new-app` skill, drafting a third goal over MCP, the developer previewing and approving it in the Developer section, Kiro scaffolding `apps/<third-app>/`, and the new app rendering with no new pipeline or UI code.

### Requirement SUB-4: Pitch and Kiro usage write-up
#### Acceptance Criteria
1. WHEN judges read the submission text, it SHALL describe only features that work in the deployed apps, matching the pitch in `README.md`.
2. WHEN judges read the Kiro write-up, it SHALL explain how Kiro was used: spec-driven development, steering, agent hooks, MCP, skills, Kiro Crew and any custom agents or powers, with concrete examples from this repo.

### Requirement SUB-5: Kiro skills for setup and new apps
**User Story:** As a developer who forks Cauldron, I want Kiro to set up the stack and create new apps for me, so that I go from fork to a running app without reading every setup guide.
#### Acceptance Criteria
1. WHEN the repo is cloned, THE SYSTEM SHALL include two skills in `.kiro/skills/`, each with a `SKILL.md` following the Agent Skills format: `cauldron-setup` and `cauldron-new-app`.
2. WHEN `cauldron-setup` runs, it SHALL use the Supabase, Clerk and Railway MCP servers (and the Clerk CLI where the MCP server lacks a setting) to: create the Supabase project and apply migrations with pgvector enabled; create the Clerk app and enable username + password, CIMD and the custom scopes; create the Railway project with the `api`, `worker`, `mcp` and app services; write `.env.local` and the Railway variables; and add the developer's email to `DEVELOPER_EMAILS`.
3. WHEN `cauldron-setup` needs something no connected tool can do (the OpenRouter API key, DNS records), it SHALL stop, tell the developer exactly what to do, and continue after they confirm.
4. WHEN `cauldron-new-app` runs, it SHALL draft the goal over the Cauldron MCP server, return the preview link, wait until the developer approves the goal in the Developer section, export the goal file, run `pnpm create-app` (web-kit Requirement 7.4), optionally write a custom view, and add the app's Railway service.
5. WHEN either skill is about to create a paid or billable resource, it SHALL ask the developer to confirm first.
6. WHEN either skill handles a secret, it SHALL write it only to `.env.local` (gitignored) or Railway variables, and SHALL NOT print it in chat, logs or committed files.
7. WHEN `cauldron-new-app` reaches the publish step, it SHALL NOT approve the goal itself; approval happens only in the web app (mcp-server Requirement 3).
8. *(Optional)* WHEN the skills and the four MCP server configs (Cauldron, Supabase, Clerk, Railway) are ready, THE SYSTEM MAY package them as a Cauldron Kiro power for one-step install.

---
