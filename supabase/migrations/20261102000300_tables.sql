-- The shared tables (Requirements 3.1, 3.2, 3.3, 7.5; spec 01.5-backend-foundation, task 2.3).
-- See design.md, "Data Models". Grants and RLS follow in 20261102000400_grants_rls.sql.
--
-- Conventions on every user-data table:
-- - tenant_id and user_id are `text not null`. 'system' is the reserved owner of app goals.
-- - A reference to another row of the same tenant is a composite (tenant_id, x_id) foreign key,
--   so a row can't point at another tenant's row. Each referenced table carries a
--   unique (tenant_id, id) constraint for that purpose.
-- - References from user rows to goals are plain goal_id foreign keys: users capture into app
--   goals owned by 'system', so the tenants differ by design.
-- - updated_at is maintained by private.set_updated_at() on tables whose rows change.

-- goals: one row per goal, app (owned by 'system') or draft (owned by the developer).
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  kind text not null check (kind in ('app', 'draft')),
  slug text not null,
  name text not null,
  description text,
  icon text,
  accent_color text,
  latest_version int check (latest_version > 0),
  schema_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- App goals and only app goals belong to the system owner (Requirement 3.3).
  constraint goals_app_owned_by_system check ((kind = 'app') = (tenant_id = 'system')),
  constraint goals_tenant_slug_key unique (tenant_id, slug),
  constraint goals_tenant_id_key unique (tenant_id, id)
);

-- Goal names are unique per owner, case-insensitively (goal-engine Requirement 2.2).
create unique index goals_tenant_name_key on public.goals (tenant_id, lower(name));

-- Fuzzy goal resolution by name and description (goal-engine Requirement 3.1).
create index goals_name_description_trgm on public.goals
  using gin ((name || ' ' || coalesce(description, '')) extensions.gin_trgm_ops);

-- goal_versions: immutable published specs. unique (goal_id, version) is what makes concurrent
-- startup registration produce one version (goal-engine Requirement 8.2).
create table public.goal_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  goal_id uuid not null,
  version int not null check (version > 0),
  schema_version int not null,
  spec jsonb not null,
  content_hash text not null,
  author text not null,
  created_at timestamptz not null default now(),
  constraint goal_versions_goal_version_key unique (goal_id, version),
  constraint goal_versions_goal_fkey foreign key (tenant_id, goal_id)
    references public.goals (tenant_id, id) on delete cascade
);

-- sources: raw captures.
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  goal_id uuid not null references public.goals (id),
  kind text not null check (kind in ('url', 'text', 'photo', 'pdf')),
  url text,
  normalized_url text,
  storage_paths text[] not null default '{}',
  client text not null check (client in ('web', 'mcp', 'api')),
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sources_tenant_id_key unique (tenant_id, id)
);

-- Duplicate-link detection (capture-compile Requirement 2.3).
create unique index sources_tenant_goal_normalized_url_key on public.sources
  (tenant_id, goal_id, normalized_url) where normalized_url is not null;
create index sources_tenant_goal_captured_at on public.sources
  (tenant_id, goal_id, captured_at desc);

-- jobs: the queue (Requirements 6.1, 6.2). status is the queue's own lifecycle; handlers report
-- progress in stage and their result in outcome. See design.md, "Job Queue".
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  stage text,
  outcome text,
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts >= 1),
  run_after timestamptz not null default now(),
  lease_expires_at timestamptz,
  locked_by text,
  last_error text,
  failure_reason text,
  dedupe_key text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_tenant_id_key unique (tenant_id, id)
);

-- Claiming: the oldest runnable queued job.
create index jobs_claim on public.jobs (run_after, created_at) where status = 'queued';
-- The reaper: running jobs whose lease has expired.
create index jobs_lease on public.jobs (lease_expires_at) where status = 'running';
-- enqueue(dedupeKey): at most one queued or running job per tenant and key
-- (`on conflict (tenant_id, dedupe_key) where ... do nothing`). Per tenant, not global: a
-- global key would let one tenant's job silently block another tenant's enqueue, and the
-- blocked tenant couldn't even see the conflicting row under RLS.
create unique index jobs_dedupe_key on public.jobs (tenant_id, dedupe_key)
  where status in ('queued', 'running');
-- Status lookups per tenant.
create index jobs_tenant_created_at on public.jobs (tenant_id, created_at desc);

-- items: compiled, validated items.
create table public.items (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  goal_id uuid not null references public.goals (id),
  source_id uuid not null,
  goal_version int not null,
  data jsonb not null,
  provenance jsonb not null default '{}',
  title text not null,
  item_date timestamptz,
  search_text text,
  -- Written by the indexer with per-goal field weights, so not a generated column.
  fts tsvector not null default ''::tsvector,
  embedding extensions.vector(1536),
  embedding_model text,
  embedding_dimensions int check (embedding_dimensions > 0),
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_tenant_id_key unique (tenant_id, id),
  constraint items_source_fkey foreign key (tenant_id, source_id)
    references public.sources (tenant_id, id) on delete cascade,
  -- An embedding is always stored with its model and dimension count (Requirement 7.5).
  constraint items_embedding_metadata check (
    embedding is null
    or (embedding_model is not null
        and embedding_dimensions = extensions.vector_dims(embedding))
  )
);

-- One full-text index and one vector index serving every goal (Requirement 3.2).
create index items_fts_gin on public.items using gin (fts);
create index items_embedding_hnsw on public.items
  using hnsw (embedding extensions.vector_cosine_ops);
create index items_tenant_goal_item_date on public.items (tenant_id, goal_id, item_date desc);
create index items_tenant_source on public.items (tenant_id, source_id);

-- drafts: extraction output that failed validation (capture-compile Requirement 9). Goal drafts
-- are goals rows with kind = 'draft', not rows here.
create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  goal_id uuid not null references public.goals (id),
  source_id uuid not null,
  job_id uuid,
  data jsonb not null,
  errors jsonb not null default '[]',
  status text not null default 'needs_review'
    check (status in ('needs_review', 'resolved', 'discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drafts_source_fkey foreign key (tenant_id, source_id)
    references public.sources (tenant_id, id) on delete cascade,
  -- Clear only job_id when the job row goes; tenant_id is not null and shared with source_id.
  constraint drafts_job_fkey foreign key (tenant_id, job_id)
    references public.jobs (tenant_id, id) on delete set null (job_id)
);

create index drafts_tenant_goal_status on public.drafts (tenant_id, goal_id, status);
create index drafts_tenant_source on public.drafts (tenant_id, source_id);

-- pages: summary pages, one per group key.
create table public.pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  goal_id uuid not null references public.goals (id),
  group_key text not null,
  title text not null,
  summary text,
  summary_citations jsonb not null default '[]',
  summarized_at timestamptz,
  dirty_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pages_tenant_goal_group_key_key unique (tenant_id, goal_id, group_key),
  constraint pages_tenant_id_key unique (tenant_id, id)
);

create table public.page_items (
  page_id uuid not null,
  item_id uuid not null,
  tenant_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (page_id, item_id),
  constraint page_items_page_fkey foreign key (tenant_id, page_id)
    references public.pages (tenant_id, id) on delete cascade,
  constraint page_items_item_fkey foreign key (tenant_id, item_id)
    references public.items (tenant_id, id) on delete cascade
);

create index page_items_tenant_item on public.page_items (tenant_id, item_id);

-- api_keys: no plaintext column exists (auth-abuse Requirement 4.1).
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  name text not null,
  prefix text not null unique,
  key_hash text not null,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_keys_tenant_id_key unique (tenant_id, id)
);

create index api_keys_tenant on public.api_keys (tenant_id);

-- usage: one row per provider call. idempotency_key makes retries count once (capture-compile
-- Requirement 4.4; reembed uses reembed:<item id>:<model>). Rows are never updated.
create table public.usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  user_id text not null,
  api_key_id uuid,
  job_id uuid,
  operation text not null check (operation in (
    'compile', 'repair', 'draft', 'summary', 'embed_item', 'embed_query', 'reembed'
  )),
  provider text not null,
  model text not null,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  constraint usage_api_key_fkey foreign key (tenant_id, api_key_id)
    references public.api_keys (tenant_id, id) on delete set null (api_key_id),
  constraint usage_job_fkey foreign key (tenant_id, job_id)
    references public.jobs (tenant_id, id) on delete set null (job_id)
);

-- Daily spend caps (auth-abuse Requirement 3).
create index usage_user_created_at on public.usage (user_id, created_at);

-- public_tenants: tenants whose items and pages anyone may read (the demo account, auth-abuse
-- Requirement 10). Internal, beyond the ten tables of Requirement 3.1. Only seeding writes it;
-- policies read it through private.is_public_tenant().
create table public.public_tenants (
  tenant_id text primary key,
  note text,
  created_at timestamptz not null default now()
);

-- updated_at triggers.
create trigger set_updated_at before update on public.goals
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.sources
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.jobs
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.items
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.drafts
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.pages
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.api_keys
  for each row execute function private.set_updated_at();
