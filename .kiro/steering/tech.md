# Tech Stack

## Monorepo

- **pnpm workspaces** — single lockfile, packages defined in `pnpm-workspace.yaml`: `core`, `web-kit`, `apps/*`, `services/*`.
- All `package.json` files are `private: true` and `"type": "module"` (ESM throughout).

## Runtime

- **Node 24 LTS** for local development, builds and every deployed service. Node 20 reached end of life in April 2026; don't target it.
- `@types/node` should match (`^24`). The root `engines` field (`>=24`), `.nvmrc` (`24`) and the Node 24 Dockerfiles all say the same.

## Language & Types

- **TypeScript 5.6+**, strict mode enforced from the root `tsconfig.json` (also: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `bundler` moduleResolution, `ES2022` target, `react-jsx`).
- Per-package `tsconfig.json` files extend the root and set their own `rootDir`/`paths`. Apps add the `@` path alias → `./src`.
- `noEmit` everywhere — Vite handles bundling; `tsc` is for type-checking only.

## Frontend

- **React 18** + React DOM.
- **Vite 5** — dev server and production bundler.
- **TanStack Router** (`@tanstack/react-router`) — type-safe file-based routing with `autoCodeSplitting`, wired via `@tanstack/router-plugin/vite`. Route files go in `src/routes/`; the generated `routeTree.gen.ts` is gitignored.
- **Clerk** (`@clerk/react` (v6, Core 3)) — authentication. Pattern: `ClerkProvider` → `AuthBridge` (injects `useAuth()` into router context) → `RouterProvider`. Protected routes use a pathless `_auth.tsx` route with a `beforeLoad` guard.

## Backend

- **API (`services/api`)**: Hono with `@hono/zod-openapi` on `@hono/node-server`. Every endpoint lives under `/v1`, is declared once with `defineRoute()` (Zod schemas, `access: 'user' | 'anonymous'`, closed by default), and appears in the generated OpenAPI 3.1 document at `/v1/openapi.json`. `/health` sits outside `/v1`. Logs are `pino` JSON.
- **Clerk backend verification**: `@clerk/backend` `verifyToken()` on the `Authorization: Bearer` header only, with `authorizedParties` = `APP_ORIGINS`. `CLERK_JWT_KEY` enables networkless verification, otherwise `CLERK_SECRET_KEY` and the cached JWKS. The `sub` claim is both user ID and tenant ID. The developer role comes from the Clerk Backend API plus `DEVELOPER_EMAILS`, never from the request.
- **API routes**: `GET /v1/goals`, `GET /v1/goals/{slug}` (anonymous, app goals only), `POST /v1/captures` (multipart, text or one image, 12 MB body limit), `GET /v1/sources/{id}`, `GET /v1/items` (`goal`, `q`, `limit`) and `GET /v1/items/{id}`. Error codes `payload_too_large` (413) and `unsupported_media_type` (415) were added for captures. At startup `registerAppGoals` reads `apps/*/goal.json` (`APPS_DIR` overrides) and stores each valid one as an app goal; a bad file is logged and skipped.
- **Dev auth mode**: `AUTH_MODE=dev` with `DEV_API_TOKEN` (at least 32 characters), `DEV_USER_ID` and `SUPABASE_SECRET_KEY` makes `withDevToken()` accept that one bearer token as `DEV_USER_ID` (user and tenant ID), compared in constant time. Any other token still goes to the Clerk verifier. The dev principal reads and writes Storage through `serviceStorage` because Storage RLS only trusts Clerk JWTs. `startApi` refuses dev mode when `NODE_ENV=production` or `RAILWAY_ENVIRONMENT` is set, and logs a warning when it is on. For local use only; unset or `AUTH_MODE=clerk` accepts Clerk tokens only.
- **MCP server (`services/mcp`)**: TypeScript stdio server on `@modelcontextprotocol/server` v2, started by Kiro (`pnpm --silent --filter mcp start`, run with `tsx`, not bundled or deployed). It calls only the `/v1` API with `DEV_API_TOKEN` as the bearer token and reads `API_BASE_URL` and `DEV_API_TOKEN` (fails fast naming either). Tools: `list_goals`, `capture` (text or a local image path), `search`, `get_item`. Resource: `examples://goals/recipe-box`. stdout carries the protocol, so log to stderr only. There is no Kiro config file in the repo; the README documents manual registration.
- **Worker (`services/worker`)**: a Node loop that claims jobs from the Postgres `jobs` table with `FOR UPDATE SKIP LOCKED`, 60 s leases, fenced writes. Registered handlers: `ping`, `reembed`, `compile`. `compile` turns a captured source into one item: the deterministic text/image mapper by default, or one structured LLM call with `COMPILE_MODE=llm`. It validates against the goal's item schema and upserts the item, so a rerun leaves one item.
- **Database**: Supabase Postgres with `vector` and `pg_trgm`, RLS on every user-data table, Clerk as a third-party auth provider, and a private `sources` Storage bucket. Schema changes are SQL migrations in `supabase/migrations/`, applied by the Supabase CLI (`supabase` devDependency) locally and in production.
- **Data access**: `postgres` (postgres.js) with hand-written SQL, no ORM. User-data queries run through `withActor()` in `@cauldron/core/db`, which sets the `authenticated` or `anon` role and the JWT claims inside a transaction so RLS applies. `DATABASE_URL` is the transaction-mode pooler, so `prepare: false`.
- **LLM and embeddings**: OpenRouter for both (`openai/text-embedding-3-small`, 1536 dimensions), behind the interfaces in `@cauldron/core/providers`. `PROVIDERS=mock` selects the recording-replay mock used by tests and demo mode.
- **Env validation**: services call `parseEnv()` from `@cauldron/core/env` before opening a port or connection, and exit 1 naming missing variables.
- **Build**: services bundle with `tsup` and run from `dist/`; `tsx watch` for dev.

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
- Backend variables (Clerk, Supabase, OpenRouter, `APP_ORIGINS`, `DEVELOPER_EMAILS`, worker tuning, and the local-slice variables `AUTH_MODE`, `DEV_API_TOKEN`, `DEV_USER_ID`, `APPS_DIR`, `COMPILE_MODE`, `API_BASE_URL`) are documented in `.env.example`. `DEV_API_TOKEN` is a local-only secret. Server-only secrets are never `VITE_`-prefixed.

## Deployment

- **Railway**: Dockerfile deploys, Node 24. `Dockerfile.service` (build arg `SERVICE`) builds `api` and `worker`; `Dockerfile.app` (build arg `APP`) builds a static app served by Caddy. `nixpacks.toml` is gone. The API uses `/health` as its health check.
- **Migrations in CI**: `.github/workflows/migrate.yml` runs `supabase db push` on pushes to `main` that touch `supabase/migrations/**`.
- **Caddy** serves the static bundle (`Caddyfile`) from `{$SITE_ROOT}` with SPA fallback (`try_files {path} /index.html`) and a dedicated `/health` endpoint.

## Commands

Run from the repo root unless noted:

```sh
pnpm dev          # Dev server (Recipe Box only): vite
pnpm build        # Production build (Recipe Box only): vite build
pnpm lint         # ESLint across the repo: eslint .
pnpm typecheck    # tsc --noEmit across all workspaces
pnpm test         # Vitest unit tests across all workspaces (no database needed)
pnpm test:db      # Database integration tests (needs the local Supabase stack)
pnpm dev:stack    # api + worker + recipe-box in parallel
pnpm db:start     # supabase start (local Postgres, Storage, Studio)
pnpm db:reset     # supabase db reset (re-applies migrations and seed.sql)
pnpm db:push      # supabase db push (apply migrations to the linked project)
```

Per-package scripts (run inside the package dir):

```sh
pnpm dev          # vite (dev server)
pnpm build        # vite build
pnpm preview      # vite preview
pnpm typecheck    # tsc --noEmit
```

`api` and `worker` also have `pnpm build` (tsup) and `pnpm start` (`node dist/index.js`). `mcp` has only `pnpm start` (`tsx src/index.ts`, loading the repo-root `.env.local`), which Kiro runs as `pnpm --silent --filter mcp start`.

Note: `build` and `dev` currently filter to `recipe-box`. When adding a second deployable app, update the root `package.json` filter scripts accordingly.
