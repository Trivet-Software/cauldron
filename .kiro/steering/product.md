# Product

Cauldron is a skeleton for building "save it and find it later" apps. Each app is defined by one goal file. Users paste links, text, photos or PDFs, and Cauldron turns them into structured, searchable items grouped into summary pages. Recipe Box and Research Library are two apps built on it.

Built with Kiro for Kiroween 2026, Skeleton Crew category. The pitch lives in `README.md`; keep the two in sync and claim only features that work.

## Product model

- **Developers create goals.** A goal is plain data: schema, parser rules, page grouping rule, view specs. A developer is a user with the developer role on their own (self-hosted) deployment. They draft goals over MCP (e.g. from Kiro) or the `/v1` API, preview and approve them in the app's `/developer` section, then run `pnpm create-app` to ship the goal file as `apps/<name>/`.
- **App goals** come from `apps/*/goal.json`. The API registers them at startup under a built-in system owner; they change only by redeploying. There is no separate admin backend.
- **End users never create goals.** They open an app and capture into its one goal. Each app shows exactly one goal, shared read-only with every user.
- **Deployment:** one Railway production environment; each app is its own static service next to `api`, `worker` and `mcp`.
- **Kiro skills:** `cauldron-setup` (one-time stack setup through the Supabase, Clerk and Railway MCP servers) and `cauldron-new-app` (draft → approve → scaffold → deploy).
- **One tenant per account.** Each user's sources, items and pages are private to them.
- **Two special accounts:** a public demo account that anonymous visitors browse read-only, and a capped judge account that resets nightly.
- End-user goal creation in the browser is roadmap, not in scope.

## Apps

- **Recipe Box** — the primary deployed app and the reference consumer of the shared `web-kit` package. Custom view: Cooking Mode.
- **Research Library** — a second consumer of `web-kit`, scaffolded to prove the shared-package model. Custom view: Topic Page. Not yet implemented.

## Roadmap

Specs live in `.kiro/specs/` and are numbered by implementation order. The planned capability areas:

1. foundation — monorepo, app shell, routing, auth, deploy
1.5. backend-foundation — `/v1` API skeleton, Clerk token verification, shared schema + RLS, storage, job queue + worker skeleton, provider interfaces + mock
2. goal-engine — drafting, validating, versioning and publishing goals as apps
3. capture-compile — turning captured pages into structured data
4. search — searching compiled collections
5. web-kit — app shell, renderer, capture/review/search UI, goal preview
6. app-recipe-box — Recipe Box UI/features
7. app-research-library — Research Library UI/features
8. public-api-sdk — public API and SDK
9. auth-abuse — auth and abuse protection
10. mcp-server — Model Context Protocol server
11. submission — packaging for submission
12. ios-kit — iOS app

Only the foundation spec is partially implemented today; most packages are placeholders. When working in a spec area, read its `requirements.md` and `design.md` first.
