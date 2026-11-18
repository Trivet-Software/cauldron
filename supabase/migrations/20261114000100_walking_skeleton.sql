-- Walking skeleton additions (spec 01.7-walking-skeleton). Additive only.
-- One item per (source, ordinal): lets the compile job upsert, so a retry or a
-- re-run leaves one item. The skeleton always uses ordinal 0; capture-compile
-- can use higher ordinals for several items from one source.
alter table public.items
  add column ordinal int not null default 0 check (ordinal >= 0);
alter table public.items
  add constraint items_tenant_source_ordinal_key unique (tenant_id, source_id, ordinal);

-- Title search (Requirement 6.2): ilike '%q%' and similarity() both use trigrams.
create index items_search_text_trgm on public.items
  using gin (search_text extensions.gin_trgm_ops);

-- Latest compile job for a source (Requirements 4.1, 6.1).
create index jobs_compile_source on public.jobs
  (tenant_id, (payload->>'sourceId'), created_at desc)
  where type = 'compile';
