# Production Setup Runbook

The one-time checklist for standing up a Cauldron environment: Clerk, Supabase, GitHub and Railway. Follow it once per environment (production today; a dev or staging project later), top to bottom. Each section ends with a check you can see.

This runbook belongs to the `01.5-backend-foundation` spec (task 2.6). Component shapes, variable meanings and the reasoning behind each setting are in `.kiro/specs/01.5-backend-foundation/design.md`.

Some files this runbook refers to land in later tasks of the same spec. Until they exist, the matching steps can't be completed:

| File | Task |
|------|------|
| `Dockerfile.service`, `.dockerignore` | 13.1 |
| `Dockerfile.app` (replaces `nixpacks.toml`) | 13.2 |
| `.github/workflows/migrate.yml` | 13.3 |
| `scripts/smoke-production.sh` | 13.5 |
| `GET /v1/me` on the Account page | 9.6, 11.3 |

Dashboard menu names below were current when this was written. If a label has moved, the linked vendor docs describe the current location.

## Before you start

- Owner or admin access to the Clerk instance, the Supabase project, the GitHub repository and the Railway project.
- A production Clerk instance, a Supabase project on Postgres 17 (it must match `[db] major_version` in `supabase/config.toml`), and an empty Railway project with one `production` environment.
- An OpenRouter API key if production runs with `PROVIDERS=openrouter`.
- Keep secrets in a password manager while you work. Never paste them into issues, PRs, commit messages or chat.

## 1. Clerk as a Supabase third-party auth provider

Requirement 4.1. Supabase must accept Clerk session tokens so that `auth.jwt()` in RLS and Storage policies sees the Clerk user's `sub`. This replaces the deprecated JWT-template integration; don't share the Supabase JWT secret with Clerk ([Supabase: Clerk third-party auth](https://supabase.com/docs/guides/auth/third-party/clerk)).

1. In the Clerk dashboard, open the production instance and activate the Supabase integration (Clerk's "Connect with Supabase" setup page). This adds the claim `"role": "authenticated"` to every session token.
2. Copy the instance's Frontend API domain (for example `clerk.example.com`, or `xxx.clerk.accounts.dev` on a development instance). This is the value the local stack reads from `CLERK_DOMAIN`.
3. In the Supabase dashboard, open Authentication → Third-Party Auth, add a Clerk integration, and enter that domain.
4. Disable the Data API (PostgREST) on the hosted project, in the project's Data API settings. Nothing uses it: the browser calls `/v1`, and the services use SQL and the Storage API. With third-party auth on, any Clerk user could otherwise call PostgREST directly with their session token. Local development already has it off (`[api] enabled = false` in `supabase/config.toml`).

**Local equivalent.** The local stack registers Clerk through `[auth.third_party.clerk]` in `supabase/config.toml`, which reads `CLERK_DOMAIN` from the environment. Point it at the Clerk development instance, not production.

**Check.**

- Sign in to a Clerk-backed app, copy a session token from the browser (`await window.Clerk.session.getToken()` in the console), and decode it locally (for example with `jq -R 'split(".")[1] | @base64d | fromjson'`). The payload contains `"role": "authenticated"`. Don't paste production tokens into online decoders.
- Supabase lists Clerk under Third-Party Auth as enabled, and the Data API shows as disabled.

## 2. Supabase project values

Collect these from the Supabase dashboard. Section 4 needs them.

| Value | Where | Used as |
|-------|-------|---------|
| Project ref | Project Settings → General | `SUPABASE_PROJECT_REF` (GitHub) |
| Database password | Set at project creation; reset under Database settings if lost | `SUPABASE_DB_PASSWORD` (GitHub) |
| Transaction pooler connection string, port **6543** | Connect → Connection string → Transaction pooler | `DATABASE_URL` (Railway `api`, `worker`) |
| Project URL | Project Settings → API | `SUPABASE_URL` (Railway `api`, `worker`) |
| Publishable key | Project Settings → API Keys | `SUPABASE_PUBLISHABLE_KEY` (Railway `api`) |
| Secret key | Project Settings → API Keys | `SUPABASE_SECRET_KEY` (Railway `worker` only) |

Use the transaction pooler (port 6543), not the direct connection or the session pooler. The services connect with `prepare: false` and rely on transaction-scoped `set local` for RLS (design: Data Access).

`DATABASE_URL` and `SUPABASE_SECRET_KEY` are privileged: the first connects as the table owner and the second bypasses Storage RLS. Give each only to the services listed.

## 3. GitHub `production` environment

The `migrate` workflow (`.github/workflows/migrate.yml`, task 13.3) runs `supabase link` and `supabase db push` on every push to `main` that touches `supabase/migrations/**`. Its secrets live in an environment, not at repository level, so only jobs that name `environment: production` can read them.

1. In the repository, open Settings → Environments and create `production`.
2. Under Deployment branches and tags, allow only `main`.
3. Add these environment secrets:

   | Secret | Value |
   |--------|-------|
   | `SUPABASE_ACCESS_TOKEN` | A Supabase personal access token (Account → Access Tokens). Name it after this repo so it's easy to revoke |
   | `SUPABASE_DB_PASSWORD` | The database password from section 2 |
   | `SUPABASE_PROJECT_REF` | The project ref from section 2 |

4. Don't add required reviewers to the environment. The workflow runs unattended, and a pending approval would hold every deploy that waits for it (section 4.5).

**Check.** Once task 13.3 has landed, start the workflow by hand (Actions → migrate → Run workflow, on `main`). It links the project and reports that the remote database is up to date, or applies the pending migrations. Then run `supabase migration list --linked` locally (after `supabase link`) and confirm every file in `supabase/migrations/` shows as applied remotely.

## 4. Railway services

Requirement 9.1. Three services in the one `production` environment, all built from the repository root with the shared Dockerfiles. Railway uses the Dockerfile that `RAILWAY_DOCKERFILE_PATH` names, and passes service variables to the build only for matching `ARG` lines ([Railway: Dockerfiles](https://docs.railway.com/guides/dockerfiles), [build-time vs runtime variables](https://docs.railway.com/guides/build-time-vs-runtime-secrets)).

Create each service from the GitHub repository, connected to the `main` branch, with no root directory set (the build context must be the repo root so pnpm sees the whole workspace). Name the services exactly `api`, `worker` and `recipe-box`; the reference variables below use those names.

### 4.1 Build settings

| Service | `RAILWAY_DOCKERFILE_PATH` | Build selector | Public domain |
|---------|---------------------------|----------------|---------------|
| `api` | `Dockerfile.service` | `SERVICE=api` | yes |
| `worker` | `Dockerfile.service` | `SERVICE=worker` | no |
| `recipe-box` | `Dockerfile.app` | `APP=recipe-box` | yes |

Set `SERVICE` and `APP` as service variables. Generate the public domains for `api` and `recipe-box` (Settings → Networking) before setting the reference variables, because they read `RAILWAY_PUBLIC_DOMAIN`.

### 4.2 Variables

Service variables are runtime environment variables, except where marked build-time. Mark secrets as sealed where Railway offers it. Both services fail fast at startup and print the name of every missing or invalid variable, never its value (Requirement 8.3), so the deploy log tells you what's wrong.

**`api`**

| Variable | Value | Notes |
|----------|-------|-------|
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.service` | |
| `SERVICE` | `api` | build-time |
| `DATABASE_URL` | transaction pooler URL (port 6543) | **secret** |
| `SUPABASE_URL` | project URL | |
| `SUPABASE_PUBLISHABLE_KEY` | publishable key | |
| `CLERK_SECRET_KEY` | production instance secret key | **secret**; used for JWKS and the Backend API |
| `CLERK_JWT_KEY` | instance PEM public key | optional; enables networkless token verification |
| `APP_ORIGINS` | `https://${{recipe-box.RAILWAY_PUBLIC_DOMAIN}}` | comma-separated exact origins: scheme, host and optional port, no trailing slash or path. Add a custom domain here too if you attach one |
| `DEVELOPER_EMAILS` | comma-separated emails | optional; only verified addresses grant the developer role |
| `PROVIDERS` | `openrouter` or `mock` | see "Providers" below |
| `EMBEDDING_MODEL` | `openai/text-embedding-3-small` | optional; this is the default |
| `EMBEDDING_DIMENSIONS` | `1536` | optional; any other value stops startup, because `items.embedding` is `vector(1536)` |
| `LOG_LEVEL` | `info` | optional |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `15` | above the API's 10 s shutdown grace (`SHUTDOWN_GRACE_MS` in `services/api/src/main.ts`) |

**`worker`**

| Variable | Value | Notes |
|----------|-------|-------|
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.service` | |
| `SERVICE` | `worker` | build-time |
| `DATABASE_URL` | transaction pooler URL (port 6543) | **secret** |
| `SUPABASE_URL` | project URL | |
| `SUPABASE_SECRET_KEY` | secret key | **secret**; bypasses Storage RLS |
| `PROVIDERS`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | same as `api` | keep them identical across both services |
| `WORKER_CONCURRENCY` | `4` | optional; the database pool is this plus 2 |
| `POLL_INTERVAL_MS` | `1000` | optional |
| `SHUTDOWN_GRACE_MS` | `25000` | optional; must stay below the draining window |
| `LOG_LEVEL` | `info` | optional |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30` | Railway waits this long after `SIGTERM` before `SIGKILL`, so the worker can finish or release its jobs |

**`recipe-box`**

| Variable | Value | Notes |
|----------|-------|-------|
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.app` | |
| `APP` | `recipe-box` | build-time |
| `VITE_CLERK_PUBLISHABLE_KEY` | production instance publishable key | build-time; baked into the bundle |
| `VITE_API_BASE_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` | build-time; required, the build's `validateEnv()` fails without it |

Only `VITE_`-prefixed values reach the browser bundle. Never give a secret the `VITE_` prefix, and never add backend secrets to `recipe-box`.

**Providers.** `PROVIDERS` picks the LLM and embedding implementation, and each mode has its own required variables:

| `PROVIDERS` | Also required |
|-------------|---------------|
| `openrouter` | `OPENROUTER_API_KEY` (**secret**), `LLM_COMPILE_MODEL`, `LLM_DRAFT_MODEL` (OpenRouter model slugs) |
| `mock` | `MOCK_RECORDINGS_DIR` (the recordings directory inside the image) |

`record` calls OpenRouter and writes recordings. It is for refreshing fixtures by hand and refuses to run when `NODE_ENV=production`; don't use it on Railway.

Railway sets `PORT` and `RAILWAY_GIT_COMMIT_SHA` itself. Don't set them. The API listens on `PORT` and reports the commit as `version` on `/health`.

### 4.3 Health checks and restart policy

| Service | Healthcheck path | Restart policy |
|---------|------------------|----------------|
| `api` | `/health` | On failure |
| `worker` | none (it serves no HTTP) | On failure |
| `recipe-box` | `/health` (served by Caddy) | On failure |

Set these in each service's Settings → Deploy. The API's `/health` returns 503 when the database doesn't answer within 2 s, so a deploy that can't reach Postgres never replaces the running one.

### 4.4 Watch paths

Watch paths stop a commit from redeploying services it doesn't affect. Railway config files don't follow a service's root directory, so set these in each service's settings.

| Service | Watch paths |
|---------|-------------|
| `api` | `services/api/**`, `core/**`, `pnpm-lock.yaml`, `Dockerfile.service` |
| `worker` | `services/worker/**`, `core/**`, `pnpm-lock.yaml`, `Dockerfile.service` |
| `recipe-box` | `apps/recipe-box/**`, `web-kit/**`, `core/**`, `pnpm-lock.yaml`, `Dockerfile.app`, `Caddyfile` |

A commit that only changes `supabase/migrations/**` deploys no service. That's fine: migrations are additive, so the running services keep working against the new schema.

### 4.5 Wait for CI

Turn on "Wait for CI" for `api` and `worker` (Settings → Source). The toggle appears only once the repository has a workflow that runs on `push`, so do this after task 13.3 has landed on `main`.

With it on, a deploy from a `main` commit stays in a WAITING state until every GitHub Actions workflow on that commit has finished. A failed migration therefore blocks the deploy that needs it ([Railway: Wait for CI](https://docs.railway.com/guides/github-autodeploys)). Behaviors to know:

- A failed workflow skips the deploy. A skipped or neutral workflow never blocks.
- A cancelled workflow blocks only if no other workflow on the same commit succeeded. `migrate` uses a non-cancelling concurrency group, but GitHub still cancels an older *pending* run when a newer one queues. Merge migration PRs one at a time and let each `migrate` run finish.
- Deploys still waiting after two hours are skipped.

Leave it off for `recipe-box`; it doesn't depend on the schema.

**Check.** The Railway canvas shows `api` and `recipe-box` healthy and `worker` running, each built from its Dockerfile. In each service's build log, the base image is `node:24-slim` (the runtime image for `recipe-box` is Caddy).

## 5. Make `migrate` a required status check

GitHub only offers a check as required after it has reported at least once.

1. Wait for the first `migrate` run on `main` (or the manual run from section 3) to succeed.
2. Open Settings → Rules → Rulesets → `protect-main`, and under "Require status checks to pass" add the `migrate` workflow's `push` job.

Because `migrate` only runs when `supabase/migrations/**` changes, confirm that PRs without migration changes can still merge. If the required check holds them as "expected", remove the `paths` filter from the workflow so the job runs on every push (it becomes a no-op `supabase db push`), and re-check.

## 6. Production checks

### 6.1 Automated: smoke script

Run after every deploy, first:

```sh
scripts/smoke-production.sh https://<api-domain> https://<recipe-box-domain>
```

The script (task 13.5) exits non-zero on the first failure. It checks that the API's `/health` returns 200 with `"status":"ok"`, that `/v1/me` without a token returns 401 with the error envelope (Requirement 9.3), that a foreign `Origin` on `/v1/openapi.json` gets no `Access-Control-Allow-Origin`, and that the app serves `/`, `/account` and `/health`.

### 6.2 Manual: once after the first deploy

The script can't sign in or touch the database. Run these by hand after the first deploy, and again after changes to auth, the queue or deploy settings.

1. **Sign-in to `/v1/me`** (Requirement 9.2). Open Recipe Box, sign in, and open Account. It shows your user ID, tenant ID (the same value, your Clerk `sub`) and developer flag, loaded from `GET /v1/me`. An error message on the page is the API's error envelope: a 401 usually means `APP_ORIGINS` doesn't exactly match the app's origin (the token's `azp` claim), and a CORS error in the browser console means the same.
2. **A `ping` job reaches `done`.** Connect with `psql` to the project's direct or session connection (the dashboard's Connect panel), and run:

   ```sql
   insert into public.jobs (tenant_id, user_id, type)
   values ('user_runbook_check', 'user_runbook_check', 'ping')
   returning id;

   -- A few seconds later:
   select status, attempts, finished_at from public.jobs where id = '<id>';
   ```

   Expect `status = 'done'` with `attempts = 1`. Delete the row afterwards.
3. **Redeploying `worker` mid-job leaves nothing running.** This spec has no slow job type, so load the queue instead: insert a few hundred `ping` jobs (`insert ... select ... from generate_series(1, 500)`), redeploy `worker` from the Railway dashboard straight away, and wait 90 s. Then confirm that no job is stuck:

   ```sql
   select status, count(*) from public.jobs
   where tenant_id = 'user_runbook_check' group by status;
   ```

   Every row ends up `done`. None stays `running`: the worker released unfinished jobs on `SIGTERM`, or the reaper re-queued them after their 60 s lease expired. Delete the rows afterwards.
4. **"Wait for CI" with commits that don't trigger `migrate`.** Merge a PR that changes `services/api/**` but no migration. Confirm the `api` deploy proceeds instead of waiting the full two hours. If Railway holds it, remove the `paths` filter from `migrate.yml` (as in section 5) so every commit has a workflow run to wait for.

## When something is wrong

| Symptom | Likely cause |
|---------|--------------|
| Deploy log: `Missing or invalid environment variables: …` | A variable in section 4.2 is unset, empty or malformed (for example an `APP_ORIGINS` entry with a trailing slash) |
| Deploy log: `EMBEDDING_DIMENSIONS is …` | `EMBEDDING_DIMENSIONS` isn't 1536 |
| `api` deploy never turns healthy | `/health` is 503: `DATABASE_URL` is wrong, points at the wrong port, or the database is down |
| Every `/v1` call returns 401 with a valid session | `APP_ORIGINS` doesn't match the app origin exactly, or `CLERK_SECRET_KEY` / `CLERK_JWT_KEY` belong to another Clerk instance |
| Deploys sit in WAITING | A workflow on the commit is still running, pending, or was cancelled with nothing else passing (section 4.5) |
| Jobs stay `queued` | `worker` isn't running, or its `DATABASE_URL` points at another project |
