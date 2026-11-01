# Testing

## Current State

No test runner or test dependencies are installed yet, and there is no `test` script. Test tasks (3.5, 5.4, 6.7 to 6.10) are still open in `.kiro/specs/01-foundation/tasks.md`.

Verification today is `pnpm typecheck`, `pnpm lint` and `pnpm build`. Run all three after code changes.

## Planned Approach (from the foundation design)

- Example-based unit tests, snapshot tests, integration tests and smoke checks.
- No property-based tests: the design defines no correctness properties.
- Config files (Caddyfile, nixpacks.toml, workspace layout) are verified by smoke checks, not unit tests.
- Clerk is an external service. Mock `useAuth()` / `getToken()`; do not test Clerk's own behavior.

## Runner Choice

The runner is not yet chosen. Vitest with React Testing Library and jsdom fits the Vite stack, but confirm with the user and add it deliberately (pinned versions, a `test` script at the root and per package) before writing tests.

## What to Cover

- `validateEnv()`: present var returns value, missing var throws an error naming it, empty string counts as missing.
- `useApiClient`: sends `Authorization: Bearer <token>` when a token exists, omits the header when `getToken()` returns `null`.
- `Header`: renders the app name always, shows `UserButton` only when signed in.
- Router and `AuthBridge`: auth state reaches `router.context.auth`.
- Routing integration: public routes render signed out, protected routes redirect to `/sign-in` with a `redirect` search param, sign-out returns to `/`.
- Snapshots for the home page and header, to catch UI drift when `web-kit` changes.

## Conventions

- Co-locate tests next to the code as `*.test.ts` / `*.test.tsx`.
- Test behavior and rendered output, not implementation details.
- Mock Clerk at the module boundary (`@clerk/clerk-react`) and flip `isSignedIn` per test.
- Tests must be deterministic and run once (`vitest --run`), never in watch mode in automated runs.
