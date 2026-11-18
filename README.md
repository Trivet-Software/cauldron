# Cauldron

Cauldron is a skeleton for building "save it and find it later" apps. Each app is defined by one goal file. Recipe Box and Research Library are two apps built on it.

Cauldron is being built with Kiro for Kiroween 2026, in the Skeleton Crew category.

> **Status:** in development for Kiroween 2026. Nothing is deployed yet. The foundation spec (monorepo, Recipe Box app shell, Clerk sign-in, Railway deploy config) is partly built. Sections marked *planned* describe what the specs call for, not working features.

## The pitch

Most of us save links we never find again. Recipes end up in screenshots and bookmarks, and articles pile up in read-later apps. With Recipe Box, you paste a link, text, photos or a PDF, and Cauldron pulls out the ingredients, steps and timings. Research Library does the same for articles, pulling out the summary, key points and topics, and groups them into topic pages. Every field links back to where it came from in the source. Search by meaning, even from a vague memory like "that piece about on-device models from last month."

**Who it's for:**
- **Home cooks** who want saved recipes in one clean, searchable place, with a step-by-step Cooking Mode.
- **Students and researchers** who collect articles, papers and PDFs and need to find and cite them later.
- **Developers** who want their own collection app, like a gear list, travel planner or reading log. Fork the skeleton, write a goal file, and get capture, extraction, search and screens for free. Or use the hosted API and MCP server instead.

**For the Skeleton Crew judges:** Recipe Box and Research Library look like separate apps, but each one is just a goal file, a thin entry point and one custom view. In the video, Kiro creates a third goal over MCP, and it renders without any new code.

## The two apps

Both apps sit on the same skeleton. Each app folder contains only its goal file, a thin web entry point and one custom view, and each app shows exactly one goal.

- **Recipe Box** (`apps/recipe-box`, planned). Captures recipes into structured `Recipe` items with servings, timings, ingredients and steps, grouped by cuisine. Its custom view is **Cooking Mode**: one step at a time, with step timers and voice "next".
- **Research Library** (`apps/research-library`, planned). Captures articles, arXiv papers and PDFs into `Article` items with summaries, key points and topics, grouped into topic pages. Its custom view is the **Topic Page**, and it's built to find things from a vague memory.

## How it works

1. **A developer defines a goal.** A goal is plain data: a schema for its items, parser rules (deterministic mappers such as JSON-LD `Recipe` or arXiv metadata, plus LLM extraction instructions), a page grouping rule, and JSON view specs. Developers draft goals from a name and description over MCP (for example from Kiro) or the `/v1` API, preview and approve them in the app's Developer section, then run `pnpm create-app <name>` to turn the goal file into an app folder. On startup, the API registers every `apps/*/goal.json`; no migrations are needed. Every goal is checked by a validator before it's saved. Two Kiro skills, `cauldron-setup` and `cauldron-new-app` (planned), automate the stack setup and these steps.
2. **A user captures.** A signed-in user pastes a URL or text, or uploads photos or a PDF, into an app. The raw source is stored unchanged, and a compile job goes into a Postgres job queue.
3. **Compile.** A worker claims jobs from the queue. It fetches URLs through a locked-down fetcher and turns the page into clean text and metadata. It runs the deterministic mappers first and calls the LLM only to fill fields the mappers missed. Output has to validate against the goal's schema. Failed extractions get up to two repair attempts, then are kept as `needs_review` drafts the user can fix, rather than dropped. Each field records where it came from.
4. **Index and group.** Items get embeddings for semantic search and are assigned to pages, and each page gets an LLM-written summary that links back to its items.
5. **Render.** The web apps draw every screen from the goal's view specs using a fixed component catalog. Specs are treated as data: no generated code is ever loaded or run.

```mermaid
flowchart LR
    D[Developer] -->|drafts over MCP or API| G[Goal file<br/>schema, parser, pages, views]
    U[User] -->|captures URL, text, photo, PDF| API["/v1 API"]
    API --> S[(Raw source<br/>Supabase Storage)]
    API --> Q[(Job queue<br/>Postgres)]
    Q --> W[Worker]
    G --> W
    W -->|mappers first, then LLM| I[(Items, pages, embeddings<br/>Postgres + pgvector)]
    I --> API
    API --> R[Web renderer<br/>fixed component catalog]
    G --> R
    R --> U
```

Everything goes through the versioned `/v1` API: both web apps, the MCP server and the SDKs.

## Tech stack

Planned unless noted.

- **Language:** TypeScript everywhere, in a pnpm workspace (present). Swift only for the Swift SDK and the optional iOS app.
- **Web apps:** Vite and TanStack Router (a client-side single-page app, not TanStack Start), TanStack Query, shadcn/ui and Tailwind CSS.
- **Auth:** Clerk, through `@clerk/react` on the web. Sign in with Apple through Clerk is planned for the iOS app. Supabase Auth is not used. Every account is its own tenant.
- **Data:** Supabase Postgres with row-level security, pgvector for semantic search, Postgres full-text search, and Supabase Storage for raw sources.
- **Backend services:**
  - the `/v1` public REST API (`services/api`), with an OpenAPI description
  - a worker that claims compile jobs from a Postgres jobs table with `FOR UPDATE SKIP LOCKED` (no Redis)
  - a remote MCP server (`services/mcp`) for drafting goals, capturing and searching from any MCP client, with Clerk sign-in and hashed per-user API keys as a fallback
- **AI:** LLM calls go through OpenRouter behind a provider interface, with a mock for tests and demos. The model is set in config and will be chosen by a small bake-off. Embeddings also go through OpenRouter, using `openai/text-embedding-3-small`, so one OpenRouter key covers all AI calls.
- **SDKs:** a TypeScript `/v1` client in `web-kit` and a Swift SDK.
- **Hosting:** everything runs on Railway. The tentative domain is `cauldron.trivetsoftware.com`, with `recipes.`, `library.`, `api.` and `mcp.` subdomains. None of this is final.

### Safety and abuse controls (planned)
- one tenant per account, enforced with Postgres row-level security
- daily LLM spend caps per user, per API key and globally, plus rate limits
- API keys shown once, stored only as hashes, scoped and revocable
- an SSRF-hardened fetcher: http and https only, private IP ranges blocked after DNS lookup, redirects re-checked, size and time limits
- captured content treated as untrusted: the compile step gets no tools and can't change goals or settings
- goals published by an AI over MCP need the owner's approval in the web app
- a read-only public demo account for anonymous visitors, and a capped judge login that resets nightly

## Repo layout
```
.kiro/specs/             Kiro specs, numbered in build order (present)
  01-foundation/         requirements, design and tasks (present)
  01.5-backend-foundation/   requirements (present)
  02-goal-engine/ … 12-ios-kit/   requirements (present)
core/                    shared domain logic: goal engine, capture, compile, search (scaffolded)
web-kit/                 app shell, renderer, component catalog, theme, auth, /v1 client (partly built)
apps/recipe-box/         Recipe Box app (partly built)
apps/research-library/   Research Library app (scaffolded)
services/api/            /v1 API service (planned)
services/worker/         compile-job worker (planned)
services/mcp/            MCP server (planned)
supabase/migrations/     shared schema and RLS policies (planned)
ios-kit/                 Swift package; the iOS app is a stretch goal (planned)
LICENSE                  MIT (present)
```

## Built with Kiro

Cauldron is being built with Kiro, mainly Kiro Crew. The work follows Kiro's spec-driven flow: each feature has a spec in `.kiro/specs/` with requirements, then a design and a task list, worked through in numbered order starting with `01-foundation`. Steering files and agent hooks live in `.kiro/`. The `.kiro/` folder is committed on purpose so anyone can see how the project was planned and built.

## Local development

### Prerequisites

- Node 24 (see `.nvmrc`)
- pnpm
- Docker, running (the local Supabase stack runs in containers)
- A Clerk application, for sign-in

### Run the local stack

1. Install dependencies: `pnpm install`.
2. Start local Supabase (Postgres, Storage and the rest). Pass your Clerk instance domain so the local stack trusts Clerk tokens:
   ```
   CLERK_DOMAIN=<your-clerk-domain> pnpm db:start
   ```
   `pnpm db:reset` rebuilds the local database from the migrations.
3. Copy the environment file: `cp .env.example .env.local`. Fill in your Clerk keys and `OPENROUTER_API_KEY`. For the Supabase values, run `supabase status -o env` and copy the keys it prints (the default `DATABASE_URL` and `SUPABASE_URL` already point at the local stack). To work without an OpenRouter key, set `PROVIDERS=mock` and `MOCK_RECORDINGS_DIR`.
4. Start the api, worker and Recipe Box together: `pnpm dev:stack`. The web app is at http://localhost:5173 and the api at http://localhost:8787.

`pnpm dev` starts only the Recipe Box web app.

`CLERK_DOMAIN` is needed by every Supabase CLI command that reads `supabase/config.toml`, including `pnpm db:reset`: `CLERK_DOMAIN=<your-clerk-domain> pnpm db:reset`. The services don't read it.

### Walking skeleton (in progress)

The walking skeleton (`.kiro/specs/01.7-walking-skeleton/`) is one thin path through every layer: a goal file defines an app, a user captures text or a photo, the worker compiles it into an item without an LLM, and the user finds it again by title, in Recipe Box or from Kiro over MCP. The capture and item API routes, the Recipe Box screens and parts of the MCP server are still being built, so the steps below describe the intended path. Check the task list in that spec for what exists.

Each app's goal file is `apps/<name>/goal.json`. The API registers every one at startup. `APPS_DIR` overrides where it looks.

**Run it**

1. Do steps 1 to 3 of "Run the local stack" above. Use `PROVIDERS=mock` if you have no OpenRouter key. `COMPILE_MODE` defaults to `mapper`, which compiles deterministically and makes no LLM call. `COMPILE_MODE=llm` makes one LLM call per capture instead.
2. Turn on dev auth mode in `.env.local`. It lets the local MCP server act as you with a static token, in place of a Clerk session:
   ```
   AUTH_MODE=dev
   DEV_API_TOKEN=<output of: openssl rand -hex 32>
   DEV_USER_ID=<your Clerk user ID, user_...>
   SUPABASE_SECRET_KEY=<from supabase status -o env>
   API_BASE_URL=http://localhost:8787
   ```
   `DEV_API_TOKEN` is a local-only secret. Keep it in the gitignored `.env.local`, and never set `AUTH_MODE=dev` in Railway: the API refuses to start in dev mode when `NODE_ENV=production` or `RAILWAY_ENVIRONMENT` is set. With `DEV_USER_ID` set to your own Clerk user ID, items captured over MCP show up in Recipe Box when you sign in, because both use the same tenant.
3. Start the stack with `pnpm dev:stack`. It starts the API, the worker and Recipe Box. It doesn't start the MCP server; Kiro does.

**Register the MCP server in Kiro (manual setup)**

The repo doesn't ship a Kiro MCP config. Add a `cauldron` server in Kiro (workspace config `.kiro/settings/mcp.json`, or your user config) that runs this command from the repo root:

```
pnpm --silent --filter mcp start
```

Set `API_BASE_URL` (for example `http://localhost:8787`) and `DEV_API_TOKEN` in the server's `env`, or leave them out: the `start` script also loads them from the repo-root `.env.local`. Use your real token only in your local config, and don't commit it. `--silent` keeps pnpm's output off stdout, which carries the MCP protocol. If Kiro doesn't start the server from the repo root, add `--dir <path to this repo>` to the pnpm arguments.

The server exposes the tools `list_goals`, `capture`, `search` and `get_item`, and the resource `examples://goals/recipe-box`. To try it without Kiro, run the MCP Inspector and point it at the same command and environment:

```
npx @modelcontextprotocol/inspector
```

**Manual check**

With local Supabase running, `.env.local` set as above (`PROVIDERS=mock` is fine) and `pnpm dev:stack` up:

1. Sign in to Recipe Box, open `/items`, paste a recipe with a title line and `-` bullets, and see the row go from `queued` to `ready` within 5 seconds.
2. Upload a JPEG. See it reach `ready`, open it, and see the photo on the detail page.
3. Type part of a title in the search box and see only the matching items.
4. In Kiro, call the `cauldron` `capture` tool with some text, and see the item appear in Recipe Box.
5. Call the `search` tool with part of that title and see the item returned.

### Tests

- `pnpm test` runs the unit tests. They don't need a database.
- `pnpm test:db` runs the integration tests against local Supabase. It needs `pnpm db:start` running and the `TEST_*` values in `.env.local` (the storage suite is skipped if any `TEST_SUPABASE_*` value is unset).

Also available: `pnpm lint` and `pnpm typecheck`.

### Using a dev Supabase project instead

You can point the services at a hosted dev Supabase project instead of the local stack, and skip Docker and `pnpm db:start`:

1. Link the project and apply the migrations: `supabase link --project-ref <ref>`, then `pnpm db:push`.
2. In `.env.local`, set `DATABASE_URL` to the project's transaction pooler URL, and set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` from the project's API settings.
3. Configure the project to accept your Clerk tokens as a third-party auth provider.
4. Run `pnpm dev:stack` as usual.

Don't run `pnpm test:db` against a shared or hosted project. Keep the `TEST_*` values pointed at the local stack.

## License

[MIT](LICENSE), © 2026 Trivet Software LLC.
