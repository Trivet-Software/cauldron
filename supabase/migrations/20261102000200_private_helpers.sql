-- Helpers used by RLS policies and table triggers (Requirement 4.2; spec 01.5-backend-foundation,
-- task 2.2). See design.md, "Grants and RLS".
--
-- The `private` schema is not exposed through the Data API (only `public` and `graphql_public`
-- are, and the Data API is off anyway). anon and authenticated get USAGE on it and EXECUTE on
-- the policy helpers only, because Postgres evaluates policy expressions with the querying
-- role's privileges.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

-- The caller's tenant: the Clerk user ID in the token's `sub` claim (Requirement 2.2). Null for
-- anonymous callers, so `tenant_id = private.tenant_id()` never matches for them.
-- auth.jwt() reads `request.jwt.claims`, which both PostgREST/Storage and withActor() set.
create function private.tenant_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

-- The caller's user ID. Identical to tenant_id() today (one tenant per account); kept separate
-- so policies say which column they mean and a future multi-user tenant changes one function.
create function private.user_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

-- Whether a tenant's items and pages are publicly readable (the demo account, auth-abuse
-- Requirement 10). Security definer because no API role can read public_tenants directly.
-- PL/pgSQL rather than SQL: public_tenants is created by the tables migration that follows,
-- and PL/pgSQL bodies are resolved at call time, not at creation time.
create function private.is_public_tenant(t text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (select 1 from public.public_tenants where tenant_id = t);
end;
$$;

-- Maintains updated_at on tables whose rows change. Attached per table in the tables migration:
--   create trigger set_updated_at before update on <table>
--     for each row execute function private.set_updated_at();
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Functions are executable by PUBLIC by default. Close that, then grant only what policies need.
-- set_updated_at runs as a trigger, which needs no EXECUTE grant for the writing role.
revoke all on function private.tenant_id() from public, anon, authenticated;
revoke all on function private.user_id() from public, anon, authenticated;
revoke all on function private.is_public_tenant(text) from public, anon, authenticated;
revoke all on function private.set_updated_at() from public, anon, authenticated;

grant execute on function private.tenant_id() to anon, authenticated;
grant execute on function private.user_id() to anon, authenticated;
grant execute on function private.is_public_tenant(text) to anon, authenticated;
