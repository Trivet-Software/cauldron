# Implementation Plan: 01-foundation

## Overview

Build the walking skeleton for Cauldron: a pnpm workspace monorepo whose shared `web-kit` package is consumed by two Vite + TanStack Router SPAs (Recipe Box deployed, Research Library scaffolded). The skeleton proves the stack end to end — type-safe file-based routing, shadcn/ui + Tailwind CSS-variable theming, Clerk auth wired through a router-context bridge into pathless `_auth` route guards, fail-fast env validation, and a Railway/Caddy deployment with SPA fallback.

Implementation is TypeScript/TSX throughout (the design specifies concrete TS/TSX, not pseudocode). Tasks build incrementally and end with wiring the composition root (`main.tsx`) together, so nothing is left orphaned. No property-based tests apply (the design defines no Correctness Properties); testing uses unit, snapshot, and integration tests as sub-tasks.

## Tasks

- [ ] 1. Set up monorepo structure and workspace configuration
  - [ ] 1.1 Create root workspace files
    - Root `package.json` (private, `type: module`) with workspace scripts: `dev` (`pnpm --filter recipe-box dev`), `build` (`pnpm -r --filter=recipe-box build`), `lint` (`eslint .`), `typecheck` (`pnpm -r typecheck`); shared devDependencies: `typescript` ^5.6, `eslint` ^9
    - `pnpm-workspace.yaml` enumerating `core`, `web-kit`, `apps/*`
    - `.gitignore` including `node_modules`, `dist`, `.env.local`, and the generated `routeTree.gen.ts` files
    - _Requirements: 1.1, 1.3, 1.4_
  - [ ] 1.2 Scaffold `@cauldron/core` package
    - `core/package.json` (`name: @cauldron/core`, `type: module`, `typecheck` script)
    - `core/src/index.ts` placeholder export so the package resolves
    - _Requirements: 1.1_
  - [ ] 1.3 Scaffold `web-kit` package
    - `web-kit/package.json` (`name: web-kit`, private, `type: module`) with the scoped `exports` map (`./components`, `./components/*`, `./lib/utils`, `./theme.css`, `./auth`) and `peerDependencies` on `react` ^18 and `@clerk/clerk-react` ^6
    - _Requirements: 1.1, 1.2_

- [ ] 2. Set up build and dev tooling
  - [ ] 2.1 Configure TypeScript strict mode across workspaces
    - Root `tsconfig.json` (strict mode, ESNext module) and per-package `tsconfig.json` files for `core`, `web-kit`, `apps/recipe-box`, `apps/research-library` extending the root config
    - _Requirements: 7.1, 7.4_
  - [ ] 2.2 Configure ESLint flat config at root
    - `eslint.config.js` (flat config) supporting TypeScript and React/JSX, with the root `lint` script wired to it
    - _Requirements: 7.2_
  - [ ] 2.3 Create Kiro PostFileSave hook for lint-on-save
    - `.kiro/hooks/lint-on-save.json` v2 hook that runs ESLint on file save (matches saved source files)
    - _Requirements: 7.2_

- [ ] 3. Set up Vite + TanStack Router app shells
  - [ ] 3.1 Configure the Recipe Box Vite app entry
    - `apps/recipe-box/vite.config.ts` registering `TanStackRouterVite` (`target: 'react'`, `autoCodeSplitting: true`) and `@vitejs/plugin-react`, with the `@` path alias to `./src`
    - `apps/recipe-box/index.html` mounting `src/main.tsx`
    - _Requirements: 2.1, 2.3, 7.3_
  - [ ] 3.2 Create Recipe Box package.json with dependencies
    - `apps/recipe-box/package.json` depending on `web-kit` (`workspace:*`), `@clerk/clerk-react`, `@tanstack/react-router`, plus devDeps `@tanstack/router-plugin`, `vite`, `@vitejs/plugin-react`, `react`, `react-dom`
    - _Requirements: 1.2, 2.1, 3.1_
  - [ ] 3.3 Create Recipe Box `lib/env.ts` with fail-fast `validateEnv`
    - `apps/recipe-box/src/lib/env.ts` reading `import.meta.env`, requiring `VITE_CLERK_PUBLISHABLE_KEY` (throwing an `Error` naming the missing key and pointing to `.env.example`), and defaulting `VITE_API_BASE_URL` to `''`
    - Export the `AppEnv` shape
    - _Requirements: 5.1, 5.4, 5.6_
  - [ ] 3.4 Scaffold the Research Library Vite app
    - `apps/research-library/package.json` (depends on `web-kit` `workspace:*`), `vite.config.ts` (TanStack Router plugin + react + `@` alias), and `index.html` mirroring Recipe Box minimally — proves two real consumers of the shared package
    - _Requirements: 1.1_
  - [ ]* 3.5 Write unit tests for `validateEnv`
    - Test that a present env var returns its value; that a missing required var throws an `Error` whose message contains the variable name; edge case that an empty-string value is treated as missing
    - _Requirements: 5.4_

- [ ] 4. Checkpoint — monorepo, tooling, and app shells in place
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement theming and shared UI in `web-kit`
  - [ ] 5.1 Create `web-kit` theme.css with Tailwind CSS variables
    - `web-kit/src/theme.css` defining shadcn/ui tokens (light `:root` and `.dark`) as CSS custom properties mapped into Tailwind via `@theme`, so a theme swap is a data change, not a component edit
    - _Requirements: 2.5_
  - [ ] 5.2 Set up Tailwind + shadcn/ui base across `web-kit` and Recipe Box
    - `web-kit/src/lib/utils.ts` (`cn` class-merge helper), `web-kit/components.json` (shadcn config), and Recipe Box `tailwind.config` + `postcss.config` importing the `web-kit` theme tokens
    - _Requirements: 2.4, 2.5_
  - [ ] 5.3 Create the `web-kit` Header component
    - `web-kit/src/components/header/index.tsx` rendering the app name nav and, via Clerk `useAuth()` and the `UserButton`, showing identity and a sign-out action only when signed in; plus the `./components` barrel export
    - _Requirements: 3.4_
  - [ ]* 5.4 Write unit tests for the Header component
    - Test the header renders the app name and shows `UserButton` when `isSignedIn` is true (mock Clerk), and renders the app name without `UserButton` when signed out
    - _Requirements: 3.4_

- [ ] 6. Implement routing and the auth bridge
  - [ ] 6.1 Create `router.tsx` auth bridge and app router
    - `apps/recipe-box/src/router.tsx` defining `AppRouterContext` (auth: `isLoaded`, `isSignedIn`, `userId`), the `AuthBridge` wrapper that reads `useAuth()` and injects it into `RouterProvider` `context`, and `createAppRouter`
    - _Requirements: 3.2, 4.3_
  - [ ] 6.2 Create the `__root.tsx` layout route
    - `apps/recipe-box/src/routes/__root.tsx` rendering the shared `Header` (from `web-kit`) and a `<Outlet />`
    - _Requirements: 2.2_
  - [ ] 6.3 Create the public home route
    - `apps/recipe-box/src/routes/index.tsx` — public `/` rendering a home page with header and navigation placeholder, no sign-in required
    - _Requirements: 2.2, 4.1_
  - [ ] 6.4 Create the public sign-in route
    - `apps/recipe-box/src/routes/sign-in.tsx` — public `/sign-in` rendering Clerk's hosted sign-in component, typed with `SignInSearch` (`redirect?: string`) and returning the user to the saved destination after sign-in
    - _Requirements: 3.3, 3.5_
  - [ ] 6.5 Create the pathless `_auth.tsx` protected layout route
    - `apps/recipe-box/src/routes/_auth.tsx` with a `beforeLoad` guard reading `context.auth`: return early while `!isLoaded`, else `throw redirect({ to: '/sign-in', search: { redirect: location.href }, replace: true })` when signed out — securing every child route via inheritance
    - _Requirements: 4.2, 4.3_
  - [ ] 6.6 Create the `web-kit` API client with Clerk token
    - `web-kit/src/auth/api-client.ts` exposing `useApiClient()` that calls `getToken()` and attaches `Authorization: Bearer <token>` (omitting the header when null), plus the `./auth` barrel export; `VITE_API_BASE_URL` is read by callers
    - _Requirements: 3.6_
  - [ ]* 6.7 Write unit tests for the AuthBridge / router context
    - Test that `useAuth()` state (`isSignedIn: true`) flows into `router.context.auth.isSignedIn`
    - _Requirements: 3.2, 4.3_
  - [ ]* 6.8 Write unit tests for the API client
    - Test `useApiClient` attaches `Authorization: Bearer <token>` when `getToken()` resolves a token, and omits the header when the token is `null` (mock `getToken`)
    - _Requirements: 3.6_
  - [ ]* 6.9 Write integration tests for routing + auth
    - Test public route access (signed out → home renders, no redirect); protected route redirect (signed out → redirected to `/sign-in` with a `redirect` search param, and after "sign-in" lands on the original route); sign-out redirect (→ `/`). Use a mocked Clerk auth context to flip `isSignedIn`
    - _Requirements: 4.1, 4.2, 4.3, 3.5_
  - [ ]* 6.10 Write snapshot tests for the home page and header
    - Render the home route and the header with mocked auth state and snapshot the output to catch unintended UI drift when `web-kit` changes
    - _Requirements: 2.2, 3.4_

- [ ] 7. Checkpoint — routing and auth wired
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Environment and deployment configuration
  - [ ] 8.1 Create `.env.example` documenting required variables
    - `.env.example` listing `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`, and the server-only `CLERK_SECRET_KEY` (no `VITE_` prefix, staged for a future backend), with notes that `.env.local` is gitignored and production reads from Railway's variable configuration
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ] 8.2 Create the Railway deploy config
    - `railway.json` or `nixpacks.toml` specifying the build command (`pnpm install` + `vite build`) and the static output directory (`apps/recipe-box/dist/`), with `VITE_CLERK_PUBLISHABLE_KEY` passed through Vite's `import.meta.env`/`define` so it is available client-side
    - _Requirements: 5.5, 5.6, 6.1, 6.3_
  - [ ] 8.3 Create the Caddyfile with SPA fallback
    - `Caddyfile` serving the static bundle with `try_files {path} /index.html` for client-side routing fallback, plus a `/health` rewrite so Railway health checks don't fall through to `index.html`
    - _Requirements: 6.2, 6.4_

- [ ] 9. Wire the composition root and verify the build
  - [ ] 9.1 Finalize Recipe Box `main.tsx` composition root
    - `apps/recipe-box/src/main.tsx` calling `validateEnv()`, creating the app router from `routeTree.gen`, and rendering `ClerkProvider` (publishableKey from env) → `AuthBridge` → `RouterProvider`, importing `web-kit/theme.css`; wires every prior step together with no orphaned code
    - _Requirements: 2.1, 3.1, 5.4, 6.2_
  - [ ]* 9.2 Run TypeScript strict typecheck
    - Run `pnpm typecheck` (`tsc --noEmit` across all workspaces); the build fails on any type error
    - _Requirements: 7.1, 7.4_
  - [ ]* 9.3 Run the production build
    - Run `pnpm build` and confirm it produces `apps/recipe-box/dist/` with `index.html` and hashed assets, exit code 0
    - _Requirements: 6.1, 7.4_
  - [ ]* 9.4 Run ESLint
    - Run `pnpm lint` and confirm it exits 0 with no errors, verifying the lint tooling is wired
    - _Requirements: 7.2_

- [ ] 10. Final checkpoint — Ensure all tests pass and the build is green
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, though the unit, snapshot, and integration tests are the primary verification for this skeleton (the design defines no Correctness Properties, so no property-based tests apply).
- Each task references specific requirements for traceability; see `requirements.md` for the acceptance criteria and `design.md` for the exact component shapes and code.
- Checkpoints ensure incremental validation between phases.
- The deployment verification checks in the design (opening the public Railway URL, completing a real Clerk sign-in, confirming identity in the header, OAuth origin allowlisting) are one-shot production verifications against a live deploy — not coding tasks — so they are performed manually after deploy, not listed here.
- `_auth.tsx` children such as `_auth/capture.tsx` are intentionally left for future specs; only the guard layout is scaffolded now.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.3", "8.1", "8.2", "8.3"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "3.2", "3.4"] },
    { "id": 2, "tasks": ["3.3", "5.1", "5.2", "6.1", "6.6"] },
    { "id": 3, "tasks": ["5.3", "6.3", "6.4", "6.5"] },
    { "id": 4, "tasks": ["6.2"] },
    { "id": 5, "tasks": ["9.1"] },
    { "id": 6, "tasks": ["3.5", "5.4", "6.7", "6.8", "6.9", "6.10"] },
    { "id": 7, "tasks": ["9.2", "9.3", "9.4"] }
  ]
}
```
