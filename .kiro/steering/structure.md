# Project Structure

pnpm monorepo. Four categories of packages: a `core` domain library, a shared `web-kit` UI/auth library, deployable services under `services/`, and apps under `apps/`. Plus a `supabase/` directory for the database.

```
cauldron/
├─ package.json            # Root: workspace scripts (dev, dev:stack, db:*, test, test:db), shared devDeps, engines.node >=24
├─ pnpm-workspace.yaml     # Workspaces: core, web-kit, apps/*, services/*
├─ tsconfig.json           # Base TS config (strict), extended by every package
├─ eslint.config.js        # Flat ESLint config (TS + React/JSX)
├─ .nvmrc                  # Node 24
├─ Dockerfile.service      # One image recipe for api and worker (ARG SERVICE)
├─ Dockerfile.app          # One image recipe for static apps (ARG APP), served by Caddy
├─ Caddyfile               # Static server config with SPA fallback; root is {$SITE_ROOT}
├─ .github/workflows/      # migrate.yml: supabase db push on main
├─ docs/                   # production-setup.md
├─ scripts/                # smoke-production.sh
├─ .env.example            # Documented env vars (VITE_ client, server-only secrets)
├─ .gitignore              # node_modules, dist, .env.local, routeTree.gen.ts
│
├─ supabase/               # config.toml (local stack), migrations/ (ordered SQL), seed.sql (local only)
│
├─ core/                   # @cauldron/core — domain logic and server-side data access
│  ├─ package.json         # Subpath exports map (see Conventions)
│  ├─ tsconfig.json
│  └─ src/
│     ├─ index.ts          # Isomorphic root export (types, provider interfaces)
│     ├─ env/              # parseEnv(): fail-fast env validation
│     ├─ providers/        # LLM + embedding interfaces, OpenRouter, mock, recordings
│     ├─ db/               # connection, Actor, withActor(), registerGoal(), db integration-test harness
│     ├─ queue/            # enqueue, claim, heartbeat, complete, fail, release, reap
│     ├─ storage/          # source paths, signed URLs
│     ├─ goals/            # goal-file Zod schema, validateItem, llmJsonSchema, canonicalJson (pure)
│     ├─ compile/          # capture limits, text/image mapper, compile state, extraction request (pure)
│     └─ collection/       # tenant-scoped SQL for goals, sources and items; createCollectionStore()
│
├─ services/               # Node services (workspace packages); api and worker are bundled with tsup
│  ├─ api/                 # Hono /v1 API: src/{app,env,main,index}.ts, http/, auth/ (incl. dev-token.ts), goals/, routes/
│  ├─ worker/              # Job loop: src/{worker,maintenance,env,index}.ts, handlers/ (ping, reembed, compile)
│  └─ mcp/                 # Local stdio MCP server: src/{index,server,api,env}.ts; calls only /v1, started by Kiro, not deployed
│
├─ web-kit/                # Shared UI + auth library, consumed by both apps
│  ├─ package.json         # Scoped exports map + peerDeps on react, react-dom & @clerk/react (v6)
│  ├─ components.json      # shadcn/ui config
│  ├─ tsconfig.json
│  └─ src/
│     ├─ theme.css         # Tailwind CSS-variable theme tokens (light/dark)
│     ├─ lib/utils.ts      # cn() class-merge helper
│     ├─ components/       # Shared components (header/, capture-form/, item-list/, item-detail/)
│     ├─ auth/             # Clerk auth helpers (useApiClient)
│     └─ collection/       # /v1 collection client and hooks (useGoal, useItems, useItem)
│
└─ apps/
   ├─ recipe-box/          # Primary deployed SPA
   │  ├─ goal.json         # The app's goal file (see Conventions)
   │  ├─ package.json      # deps: web-kit (workspace:*), clerk, tanstack router
   │  ├─ vite.config.ts    # TanStack Router plugin + react + @ alias
   │  ├─ postcss.config.js # @tailwindcss/postcss
   │  ├─ tsconfig.json     # extends root, adds @ path alias
   │  ├─ index.html        # mounts src/main.tsx (not yet created)
   │  └─ src/
   │     ├─ main.tsx       # (planned) Composition root (ClerkProvider → AuthBridge → RouterProvider)
   │     ├─ router.tsx     # (planned) AppRouterContext + AuthBridge + createAppRouter
   │     ├─ lib/env.ts     # validateEnv() — fail-fast env validation
   │     └─ routes/        # TanStack file-based routes
   │        ├─ __root.tsx  # (planned) Root layout (Header + Outlet)
   │        ├─ index.tsx   # Public home route
   │        ├─ sign-in.tsx # (planned) Public Clerk sign-in route
   │        ├─ _auth.tsx   # (planned) Pathless protected layout (beforeLoad guard)
   │        └─ _auth/      # Protected routes: account, items.index (capture + list), items.$itemId (detail)
   │
   └─ research-library/    # Second web-kit consumer (scaffolded only)
      ├─ goal.json         # Registered by the API, but the app has no UI yet
      ├─ package.json
      ├─ vite.config.ts
      ├─ tsconfig.json
      ├─ index.html
      └─ src/main.tsx     # Minimal placeholder entry
```

## Conventions

- **Package naming**: `@cauldron/core` for the domain package; `web-kit`, `api`, `worker` and app names are bare (no scope). All are `private` and `"type": "module"`.
- **web-kit exports**: uses a scoped `exports` map (`./components`, `./components/*`, `./lib/utils`, `./theme.css`, `./auth`, `./collection`) rather than a single barrel `index.ts`. Import subpaths explicitly.
- **core exports**: root `.` is isomorphic. `./goals` and `./compile` are pure and isomorphic too (web-kit and `services/mcp` import them). Node-only code is in subpaths: `./env`, `./providers`, `./providers/mock`, `./db`, `./db/system`, `./db/maintenance`, `./queue`, `./storage`, `./collection`. Services import only these; a browser bundle never reaches the Node-only ones. `./db/system` (which exports `registerGoal`) is for the API's registration module only (`services/api/src/goals/register-app-goals.ts`). ESLint confines `postgres` imports to `core/src/db/**` and `core/src/queue/**`.
- **Goal files**: each app has `apps/<name>/goal.json`, parsed with `goalFileSchema` from `@cauldron/core/goals`. The folder name is the slug. The API registers every file at startup as an app goal owned by the system owner (`APPS_DIR` overrides the location), and a restart with unchanged content changes nothing. The Dockerfiles don't copy `apps/*/goal.json` into the API image yet.
- **Collection SQL**: all SQL for goals, sources and items lives in `core/src/collection`. The API depends on `CollectionStore` (`createCollectionStore(db)`); the worker's compile handler calls the repository functions inside `ctx.scope()`. Neither service contains SQL for these tables.
- **Services**: depend on `@cauldron/core` (`workspace:*`) and keep domain logic out of the service. Tests are co-located; `*.db.test.ts` files need the local database (see testing.md). `services/mcp` has no `build` or Dockerfile; it runs with `tsx` (`pnpm --silent --filter mcp start`) and talks to the API over HTTP only.
- **Migrations**: schema changes are new SQL files in `supabase/migrations/`, never edits to applied ones.
- **Dockerfiles**: one `Dockerfile.service` and one `Dockerfile.app`, parameterized by build arg, instead of one file per deployable.
- **Path alias**: apps alias `@` → `./src`. Use `@/...` imports within app source.
- **Routing**: TanStack file-based routes live in `src/routes/`. Protected routes nest under the pathless `_auth.tsx` layout; the `beforeLoad` guard reads auth state from router context. Generated `routeTree.gen.ts` is gitignored — never edit by hand.
- **Specs**: `.kiro/specs/` holds numbered spec directories (`NN-name/`), each with `requirements.md`, `design.md`, and `tasks.md`. Read the relevant spec before working in that area. To insert a spec between two existing ones without renumbering, use a half step (`NN.5-name/`, e.g. `01.5-backend-foundation`); it sorts between `NN-` and the next number. Specs cross-reference each other by name, not number.
- **Hooks**: `.kiro/hooks/` holds Kiro v2 hook JSON (currently `lint-on-save.json`).
- **Steering**: `.kiro/steering/` holds these always-included guidance docs.
- **Planned vs. present**: entries marked "(planned)" above are defined in `.kiro/specs/01-foundation/tasks.md` but not yet on disk. Check the task checkboxes there before assuming a file exists.
