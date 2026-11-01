# Product

Cauldron is a goal-driven capture-and-compile engine. You name a goal — like Recipe Box or Research Library — and Cauldron turns pages you capture into structured, searchable collections. A single shared skeleton powers two apps.

Built with Kiro for Kiroween 2026.

## Apps

- **Recipe Box** — the primary deployed app and the reference consumer of the shared `web-kit` package.
- **Research Library** — a second consumer of `web-kit`, scaffolded to prove the shared-package model. Not yet implemented.

## Roadmap

Specs live in `.kiro/specs/` and are numbered by implementation order. The planned capability areas:

1. foundation — monorepo, app shell, routing, auth, deploy
2. goal-engine — naming and managing goals
3. capture-compile — turning captured pages into structured data
4. search — searching compiled collections
5. web-kit — shared component library
6. app-recipe-box — Recipe Box UI/features
7. app-research-library — Research Library UI/features
8. public-api-sdk — public API and SDK
9. auth-abuse — auth and abuse protection
10. mcp-server — Model Context Protocol server
11. submission — packaging for submission
12. ios-kit — iOS app

Only the foundation spec is partially implemented today; most packages are placeholders. When working in a spec area, read its `requirements.md` and `design.md` first.
