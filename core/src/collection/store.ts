// The CollectionStore the API depends on: each repository function in its own withActor()
// transaction (01.7-walking-skeleton task 5.2, Requirements 2.5 and 6.5).
import { type Db, withActor } from '../db'

import {
  createCapture,
  getGoal,
  getItem,
  getSource,
  listGoals,
  listItems,
} from './repository'
import { type CollectionStore } from './types'

export function createCollectionStore(db: Db): CollectionStore {
  return {
    listGoals: (actor) => withActor(db, actor, (scope) => listGoals(scope)),
    getGoal: (actor, slug) => withActor(db, actor, (scope) => getGoal(scope, slug)),
    createCapture: (actor, input) => withActor(db, actor, (scope) => createCapture(scope, input)),
    getSource: (actor, sourceId) => withActor(db, actor, (scope) => getSource(scope, sourceId)),
    listItems: (actor, query) => withActor(db, actor, (scope) => listItems(scope, query)),
    getItem: (actor, itemId) => withActor(db, actor, (scope) => getItem(scope, itemId)),
  }
}
