# Project Structure

pnpm monorepo. Three categories of packages: a `core` domain library, a shared `web-kit` UI/auth library, and one or more apps under `apps/`.

```
cauldron/
├─ package.json            # Root: workspace scripts (dev/build/lint/typecheck), shared devDeps
├─ pnpm-workspace.yaml     # Workspaces: core, web-kit, apps/*
├─ tsconfig.json           # Base TS config (strict), extended by every package
├─ eslint.config.js        # Flat ESLint config (TS + React/JSX)
├─ nixpacks.toml           # Railway deploy build config
├─ Caddyfile               # Static server config with SPA fallback
├─ .env.example            # Documented env vars (VITE_ client, server-only secrets)
├─ .gitignore              # node_modules, dist, .env.local, routeTree.gen.ts
│
├─ core/                   # @cauldron/core — domain logic (goal engine, capture, search)
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ src/index.ts         # Placeholder; domain logic lands in later specs
│
├─ web-kit/                # Shared UI + auth library, consumed by both apps
│  ├─ package.json         # Scoped exports map + peerDeps on react, react-dom & @clerk/react (v6)
│  ├─ components.json      # shadcn/ui config
│  ├─ tsconfig.json
│  └─ src/
│     ├─ theme.css         # Tailwind CSS-variable theme tokens (light/dark)
│     ├─ lib/utils.ts      # cn() class-merge helper
│     ├─ components/       # Shared components (header/)
│     └─ auth/             # Clerk auth helpers (useApiClient)
│
└─ apps/
   ├─ recipe-box/          # Primary deployed SPA
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
   │        └─ _auth.tsx   # (planned) Pathless protected layout (beforeLoad guard)
   │
   └─ research-library/    # Second web-kit consumer (scaffolded only)
      ├─ package.json
      ├─ vite.config.ts
      ├─ tsconfig.json
      ├─ index.html
      └─ src/main.tsx     # Minimal placeholder entry
```

## Conventions

- **Package naming**: `@cauldron/core` for the domain package; `web-kit` and app names are bare (no scope). All are `private` and `"type": "module"`.
- **web-kit exports**: uses a scoped `exports` map (`./components`, `./components/*`, `./lib/utils`, `./theme.css`, `./auth`) rather than a single barrel `index.ts`. Import subpaths explicitly.
- **Path alias**: apps alias `@` → `./src`. Use `@/...` imports within app source.
- **Routing**: TanStack file-based routes live in `src/routes/`. Protected routes nest under the pathless `_auth.tsx` layout; the `beforeLoad` guard reads auth state from router context. Generated `routeTree.gen.ts` is gitignored — never edit by hand.
- **Specs**: `.kiro/specs/` holds numbered spec directories (`NN-name/`), each with `requirements.md`, `design.md`, and `tasks.md`. Read the relevant spec before working in that area.
- **Hooks**: `.kiro/hooks/` holds Kiro v2 hook JSON (currently `lint-on-save.json`).
- **Steering**: `.kiro/steering/` holds these always-included guidance docs.
- **Planned vs. present**: entries marked "(planned)" above are defined in `.kiro/specs/01-foundation/tasks.md` but not yet on disk. Check the task checkboxes there before assuming a file exists.
