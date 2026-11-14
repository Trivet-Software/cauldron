-- Grants and row-level security (Requirement 4.2; spec 01.5-backend-foundation, task 2.4).
-- See design.md, "Grants and RLS".
--
-- Two layers, both required for an API role to touch a row:
-- 1. Table grants decide which statements anon and authenticated may run at all.
-- 2. RLS policies decide which rows those statements see or may write.
--
-- RLS is enabled but not forced, so the table owner (the privileged connection used by
-- withActor's system branch and by the queue) bypasses it. That path is confined to
-- core/src/db and core/src/queue.

-- Start from nothing. Supabase grants anon and authenticated everything on public objects by
-- default, including objects created later; close both the existing grants and the defaults
-- for objects this role (the migration role) creates in future.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Grants, per the design's grants table. Anything not listed stays revoked:
-- anon gets nothing on sources, drafts, jobs, usage or api_keys; authenticated can't update or
-- delete jobs or usage, or delete api_keys; nobody but the owner touches public_tenants.
grant select on public.goals, public.goal_versions to anon;
grant select, insert, update, delete on public.goals, public.goal_versions to authenticated;

grant select on public.items, public.pages, public.page_items to anon;
grant select, insert, update, delete on public.items, public.pages, public.page_items
  to authenticated;

grant select, insert, update, delete on public.sources, public.drafts to authenticated;

grant select, insert on public.jobs to authenticated;
grant select, insert on public.usage to authenticated;
grant select, insert, update on public.api_keys to authenticated;

-- RLS on every user-data table, plus public_tenants. public_tenants has no grants and no
-- policies; enabling RLS there is defense in depth in case a grant is ever added by mistake.
-- private.is_public_tenant() reads it as the owner, which RLS doesn't apply to.
alter table public.goals enable row level security;
alter table public.goal_versions enable row level security;
alter table public.sources enable row level security;
alter table public.jobs enable row level security;
alter table public.items enable row level security;
alter table public.drafts enable row level security;
alter table public.pages enable row level security;
alter table public.page_items enable row level security;
alter table public.api_keys enable row level security;
alter table public.usage enable row level security;
alter table public.public_tenants enable row level security;

-- The _own template: a signed-in user sees and writes only their tenant's rows, and every row
-- they write carries their own user ID. `(select ...)` makes Postgres evaluate the helper once
-- per statement instead of once per row. Table grants still limit which commands apply.
-- Anonymous callers have no `sub`, so the helpers return null and nothing matches.
create policy goals_own on public.goals for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

create policy goal_versions_own on public.goal_versions for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

create policy sources_own on public.sources for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

create policy jobs_own on public.jobs for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

create policy items_own on public.items for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

create policy drafts_own on public.drafts for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

create policy pages_own on public.pages for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

create policy page_items_own on public.page_items for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

create policy api_keys_own on public.api_keys for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

create policy usage_own on public.usage for all to authenticated
  using (tenant_id = (select private.tenant_id()))
  with check (
    tenant_id = (select private.tenant_id())
    and user_id = (select private.user_id())
  );

-- Shared reads (auth-abuse Requirement 2.3). Select-only, so they never widen what anyone may
-- write. App goals belong to the system owner and are readable by everyone; only the system
-- actor writes them (auth-abuse Requirement 2.5), since no Clerk `sub` equals 'system'.
create policy goals_system_read on public.goals for select to anon, authenticated
  using (tenant_id = 'system');

create policy goal_versions_system_read on public.goal_versions for select to anon, authenticated
  using (tenant_id = 'system');

-- Items and pages of public tenants (the demo account, auth-abuse Requirement 10). The helper
-- takes the row's tenant_id, so it runs per row; it is a single primary-key lookup.
create policy items_public_read on public.items for select to anon, authenticated
  using (private.is_public_tenant(tenant_id));

create policy pages_public_read on public.pages for select to anon, authenticated
  using (private.is_public_tenant(tenant_id));

create policy page_items_public_read on public.page_items for select to anon, authenticated
  using (private.is_public_tenant(tenant_id));
