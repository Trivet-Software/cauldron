// Schema facts the services check at startup (01.5-backend-foundation design, "Embedding
// model changes"; Error Handling: dimension mismatch exits 1).

/**
 * Size of `items.embedding`, declared `vector(1536)` in
 * supabase/migrations/20261102000300_tables.sql. pgvector's HNSW index needs a fixed size,
 * so `EMBEDDING_DIMENSIONS` must equal this; a different size needs a new migration and an
 * update here.
 */
export const EMBEDDING_COLUMN_DIMENSIONS = 1536
