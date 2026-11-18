// `@cauldron/core/collection`: the tenant-scoped repository for goals, sources and items
// (01.7-walking-skeleton task 5.2). Node-only. The API uses `createCollectionStore`; the
// worker's compile handler calls the last three functions inside `ctx.scope()`.
export { escapeLike } from './like'
export {
  createCapture,
  getGoal,
  getItem,
  getSource,
  listGoals,
  listItems,
  loadCompileInput,
  recordCompileUsage,
  saveItem,
} from './repository'
export { createCollectionStore } from './store'
export {
  type CaptureClient,
  type CaptureKind,
  type CaptureMetadata,
  type CollectionStore,
  type CompileInput,
  type GoalRecord,
  type ItemEntry,
  type ItemRecord,
  type ListItemsQuery,
  type NewCapture,
  type NewItem,
  type NewUsage,
  type SourceStatus,
} from './types'
