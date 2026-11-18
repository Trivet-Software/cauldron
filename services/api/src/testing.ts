// Shared fakes for API tests (01.7-walking-skeleton task 6.6): an in-memory
// CollectionStore and TenantStorage, so `createApp(deps)` runs with no database
// and no Storage. Test-only; nothing in the service imports this file.
import { pino } from 'pino'
import {
  type CollectionStore,
  type GoalRecord,
  type ItemEntry,
  type ItemRecord,
  type NewCapture,
  type SourceStatus,
} from '@cauldron/core/collection'
import { type Db } from '@cauldron/core/db'
import { type GoalFile } from '@cauldron/core/goals'
import {
  type TenantStorage,
  assertTenantPath,
  clampSignedUrlExpiry,
  sourceObjectPath,
} from '@cauldron/core/storage'
import { createApp } from './app'
import { SessionTokenError, type VerifySessionToken } from './auth/verify-token'
import { loadEnv } from './env'
import { type StorageFor } from './storage'

export const RECIPE_BOX_SPEC: GoalFile = {
  name: 'Recipe Box',
  description: 'Save recipes from text or a photo and find them later.',
  icon: 'chef-hat',
  accentColor: '#c2410c',
  schema: {
    type: 'object',
    titleField: 'title',
    required: ['title'],
    properties: {
      title: { type: 'string', title: 'Title' },
      ingredients: { type: 'array', items: { type: 'string' }, title: 'Ingredients' },
      notes: { type: 'string', format: 'long-text', title: 'Notes' },
      image: { type: 'string', format: 'image', title: 'Photo' },
    },
  },
}

export const RESEARCH_LIBRARY_SPEC: GoalFile = {
  name: 'Research Library',
  description: 'Keep papers and notes you want to find again.',
  schema: {
    type: 'object',
    titleField: 'title',
    required: ['title'],
    properties: {
      title: { type: 'string', title: 'Title' },
      authors: { type: 'array', items: { type: 'string' }, title: 'Authors' },
      summary: { type: 'string', format: 'long-text', title: 'Summary' },
    },
  },
}

export function goalRecord(
  id: string,
  slug: string,
  spec: GoalFile,
  version = 1,
): GoalRecord {
  return {
    id,
    slug,
    name: spec.name,
    description: spec.description ?? null,
    icon: spec.icon ?? null,
    accentColor: spec.accentColor ?? null,
    version,
    spec,
  }
}

export const DEFAULT_GOALS: GoalRecord[] = [
  goalRecord('00000000-0000-4000-8000-000000000001', 'recipe-box', RECIPE_BOX_SPEC),
  goalRecord('00000000-0000-4000-8000-000000000002', 'research-library', RESEARCH_LIBRARY_SPEC),
]

export interface InMemoryCollection extends CollectionStore {
  readonly goals: GoalRecord[]
  /** Every `createCapture` input, in call order. */
  readonly captures: NewCapture[]
  /** What `getSource`, `listItems` and `getItem` return; tests fill these in. */
  readonly sources: Map<string, SourceStatus>
  readonly entries: ItemEntry[]
  readonly items: Map<string, ItemRecord>
}

/** Goals default to Recipe Box and Research Library. Reads ignore the actor. */
export function createInMemoryCollection(
  goals: GoalRecord[] = DEFAULT_GOALS.slice(),
): InMemoryCollection {
  const captures: NewCapture[] = []
  const sources = new Map<string, SourceStatus>()
  const entries: ItemEntry[] = []
  const items = new Map<string, ItemRecord>()
  return {
    goals,
    captures,
    sources,
    entries,
    items,
    async listGoals() {
      return goals.slice()
    },
    async getGoal(_actor, slug) {
      return goals.find((goal) => goal.slug === slug) ?? null
    },
    async createCapture(_actor, input) {
      captures.push(input)
      return { sourceId: input.sourceId, state: 'queued' }
    },
    async getSource(_actor, sourceId) {
      return sources.get(sourceId) ?? null
    },
    async listItems() {
      return entries.slice()
    },
    async getItem(_actor, itemId) {
      return items.get(itemId) ?? null
    },
  }
}

export interface InMemoryStorage {
  /** The `StorageFor` to inject as `deps.storageFor`. */
  readonly storageFor: StorageFor
  /** Stored bytes by object path, across tenants. */
  readonly objects: Map<string, { body: Uint8Array; contentType: string }>
  /** Lifetimes passed to `signedReadUrl`, after clamping. */
  readonly signedExpiries: number[]
}

/** Enforces the tenant prefix like the real implementation. */
export function createInMemoryStorage(): InMemoryStorage {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>()
  const signedExpiries: number[] = []
  const storageFor: StorageFor = (principal) => {
    const storage: TenantStorage = {
      tenantId: principal.tenantId,
      async put(sourceId, index, filename, body, contentType) {
        const path = sourceObjectPath(principal.tenantId, sourceId, index, filename)
        if (objects.has(path)) throw new Error('object exists')
        objects.set(path, { body, contentType })
        return path
      },
      async get(path) {
        assertTenantPath(path, principal.tenantId)
        const object = objects.get(path)
        if (!object) throw new Error('object not found')
        return object.body
      },
      async remove(path) {
        assertTenantPath(path, principal.tenantId)
        objects.delete(path)
      },
      async signedReadUrl(path, expiresInSeconds) {
        assertTenantPath(path, principal.tenantId)
        const expiresIn = clampSignedUrlExpiry(expiresInSeconds)
        signedExpiries.push(expiresIn)
        return `https://storage.test/sign/${path}?expires=${expiresIn}`
      },
    }
    return storage
  }
  return { storageFor, objects, signedExpiries }
}

export const TEST_ORIGIN = 'https://app.example.com'

export const testEnv = loadEnv({
  DATABASE_URL: 'postgresql://unused',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  CLERK_SECRET_KEY: 'sk_test_x',
  APP_ORIGINS: TEST_ORIGIN,
  PROVIDERS: 'mock',
  MOCK_RECORDINGS_DIR: '/tmp/unused',
})

/** `Bearer good` is user_1 and `Bearer other` is user_2; any other token is rejected. */
export const verifyTestToken: VerifySessionToken = async (token) => {
  if (token === 'good') return { sub: 'user_1', sid: 'sess_1' }
  if (token === 'other') return { sub: 'user_2', sid: 'sess_2' }
  throw new SessionTokenError('invalid', 'token-invalid')
}

export const AUTH_HEADER = { Authorization: 'Bearer good' }

/** The real `createApp()` over the in-memory fakes. `db` is never touched by the routes under test. */
export function createTestApp(
  overrides: { collection?: InMemoryCollection; storage?: InMemoryStorage } = {},
) {
  const collection = overrides.collection ?? createInMemoryCollection()
  const storage = overrides.storage ?? createInMemoryStorage()
  const app = createApp({
    env: testEnv,
    db: {} as Db,
    verifyToken: verifyTestToken,
    health: { checkDatabase: async () => true },
    logger: pino({ level: 'silent' }),
    developerRole: async () => false,
    collection,
    storageFor: storage.storageFor,
  })
  return { app, collection, storage }
}
