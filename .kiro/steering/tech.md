# Tech Stack

## Monorepo

- **pnpm workspaces** — single lockfile, packages defined in `pnpm-workspace.yaml`: `core`, `web-kit`, `apps/*`.
- All `package.json` files are `private: true` and `"type": "module"` (ESM throughout).

## Language & Types

- **TypeScript 5.6+**, strict mode enforced from the root `tsconfig.json` (also: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `bundler` moduleResolution, `ES2022` target, `react-jsx`).
- Per-package `tsconfig.json` files extend the root and set their own `rootDir`/`paths`. Apps add the `@` path alias → `./src`.
- `noEmit` everywhere — Vite handles bundling; `tsc` is for type-checking only.

## Frontend

- **React 18** + React DOM.
- **Vite 5** — dev server and production bundler.
- **TanStack Router** (`@tanstack/react-router`) — type-safe file-based routing with `autoCodeSplitting`, wired via `@tanstack/router-plugin/vite`. Route files go in `src/routes/`; the generated `routeTree.gen.ts` is gitignored.
- **Clerk** (`@clerk/react` (v6, Core 3)) — authentication. Pattern: `ClerkProvider` → `AuthBridge` (injects `useAuth()` into router context) → `RouterProvider`. Protected routes use a pathless `_auth.tsx` route with a `beforeLoad` guard.

## Styling

- **Tailwind CSS v4** via `@tailwindcss/postcss` (PostCSS plugin, no `tailwind.config`).
- **shadcn/ui** — "new-york" style, zinc base color, CSS variables enabled, lucide icons (see `web-kit/components.json`).
- Theming uses CSS custom properties (`:root` / `.dark`) mapped into Tailwind through `@theme inline` in `web-kit/src/theme.css`. A theme swap is a data change — override the variables, not the components.
- Class merging via `cn()` (`clsx` + `tailwind-merge`) in `web-kit/src/lib/utils.ts`.

## Linting

- **ESLint 9** flat config at root (`eslint.config.js`): `js.configs.recommended`, `tseslint.configs.recommended`, plus React + JSX rules. `react-hooks/rules-of-hooks` is an error, `exhaustive-deps` is a warning.
- A Kiro **PostFileSave** hook (`.kiro/hooks/lint-on-save.json`) runs `eslint --fix` on saved `.ts/.tsx/.js/.jsx` files. It never blocks saves (always exits 0).

## Environment

- `.env.local` (gitignored) for local dev; Railway variables for production.
- Only `VITE_`-prefixed vars are exposed to client code via `import.meta.env`. Server-only secrets (e.g. `CLERK_SECRET_KEY`) must **not** carry the `VITE_` prefix.
- Apps validate required env vars fail-fast at startup (`src/lib/env.ts` → `validateEnv()`), throwing with a message naming the missing key.
- See `.env.example` for documented variables.

## Deployment

- **Railway** via `nixpacks.toml` — Node 20 LTS + pnpm, builds only the `recipe-box` workspace, outputs to `apps/recipe-box/dist/`.
- **Caddy** serves the static bundle (`Caddyfile`) with SPA fallback (`try_files {path} /index.html`) and a dedicated `/health` endpoint.

## Commands

Run from the repo root unless noted:

```sh
pnpm dev          # Dev server (Recipe Box only): vite
pnpm build        # Production build (Recipe Box only): vite build
pnpm lint         # ESLint across the repo: eslint .
pnpm typecheck    # tsc --noEmit across all workspaces
```

Per-package scripts (run inside the package dir):

```sh
pnpm dev          # vite (dev server)
pnpm build        # vite build
pnpm preview      # vite preview
pnpm typecheck    # tsc --noEmit
```

Note: `build` and `dev` currently filter to `recipe-box`. When adding a second deployable app, update the root `package.json` filter scripts accordingly.
