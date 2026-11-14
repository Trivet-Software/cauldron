// `@cauldron/core/db`: tenant-scoped data access for the services (01.5-backend-foundation
// task 3.1, Requirements 3.3 and 4.3). Node-only.
//
// Deliberately not exported: the privileged pool behind a Db (./internal, used by withActor
// and core/src/queue), withSystem (`@cauldron/core/db/system`, app-goal registration only)
// and the cross-tenant stale-embedding reads (`@cauldron/core/db/maintenance`, /health and
// the re-embed scheduler only).
export {
  SYSTEM_OWNER,
  type Actor,
  type AnonymousActor,
  type RequestActor,
  type SystemActor,
  type UserActor,
} from './actor'
export { createDb, type CreateDbOptions } from './connection'
export { EMBEDDING_COLUMN_DIMENSIONS } from './constants'
export { embeddingScope, type EmbeddingScope } from './embeddings'
export { ForbiddenError } from './errors'
export { type Db } from './internal'
export { withActor, type Scoped } from './scoped'
