-- Extensions for the shared schema (Requirement 3.2; spec 01.5-backend-foundation, task 2.2).
--
-- vector:  pgvector, for items.embedding and its HNSW index.
-- pg_trgm: trigram matching, for fuzzy goal-name resolution (goal-engine Requirement 3.1).
--
-- Both live in the `extensions` schema, Supabase's convention, so their objects stay out of
-- `public`. Column types and operator classes are referenced as extensions.vector,
-- extensions.vector_cosine_ops and extensions.gin_trgm_ops in later migrations.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
