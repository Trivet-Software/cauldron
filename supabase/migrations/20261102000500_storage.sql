-- Raw-source storage (Requirements 5.1, 5.2; spec 01.5-backend-foundation, task 2.5).
-- See design.md, "Raw-Source Storage".
--
-- Objects live at `{tenantId}/{sourceId}/{index}-{safeFilename}`. The first path segment is the
-- owning tenant, so the policies below compare it with the token's `sub` claim.
--
-- The API calls Storage with the caller's Clerk token, so these policies apply to it. The worker
-- uses the secret key, which bypasses them; its wrapper (serviceStorage) checks the tenant prefix
-- itself before calling Storage.

-- Private bucket: no public URLs, reads go through short-lived signed URLs (Requirement 5.3).
-- 20 MB matches the largest capture limit. Upsert so re-running keeps the settings authoritative.
insert into storage.buckets (id, name, public, file_size_limit)
values ('sources', 'sources', false, 20971520)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- authenticated: read, upload and delete only under the caller's own tenant prefix.
-- No update policy: raw sources are immutable (capture-compile Requirement 2.1), which also
-- rules out upsert-style overwrites. anon gets no policy, so it can't touch the bucket.
create policy sources_select_own_tenant on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = (select private.tenant_id())
  );

create policy sources_insert_own_tenant on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = (select private.tenant_id())
  );

create policy sources_delete_own_tenant on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sources'
    and (storage.foldername(name))[1] = (select private.tenant_id())
  );
