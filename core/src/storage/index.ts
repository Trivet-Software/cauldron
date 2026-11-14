// Raw-source storage bound to one tenant (01.5-backend-foundation Requirements
// 5.2, 5.3; design: "Raw-Source Storage"). Node-only: the worker's variant holds
// the Supabase secret key.
//
// Every path is checked against the tenant prefix before Storage is contacted,
// for both variants. For `userStorage` that's defense in depth on top of the
// bucket's RLS policies; for `serviceStorage` it's the only tenant check,
// because the secret key bypasses those policies.
//
// There is deliberately no public-URL method: the bucket is private and reads
// go through signed URLs of at most 600 s.
import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js'

import {
  SOURCES_BUCKET,
  assertTenantId,
  assertTenantPath,
  clampSignedUrlExpiry,
  sourceObjectPath,
} from './paths'

export {
  DEFAULT_SIGNED_URL_SECONDS,
  FALLBACK_FILENAME,
  MAX_FILENAME_LENGTH,
  MAX_SIGNED_URL_SECONDS,
  MIN_SIGNED_URL_SECONDS,
  SOURCES_BUCKET,
  StoragePathError,
  assertTenantId,
  assertTenantPath,
  clampSignedUrlExpiry,
  sanitizeFilename,
  sourceObjectPath,
} from './paths'

export interface TenantStorage {
  readonly tenantId: string
  /** Uploads a new object and returns its path. Never overwrites. */
  put(
    sourceId: string,
    index: number,
    filename: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<string>
  get(path: string): Promise<Uint8Array>
  /** Signed read URL; the lifetime is clamped to 1–600 s, default 300. */
  signedReadUrl(path: string, expiresInSeconds?: number): Promise<string>
}

export interface StorageConfig {
  /** `SUPABASE_URL`. */
  url: string
  /** Optional fetch override, e.g. for tests that must see no network call. */
  fetch?: typeof fetch
}

export interface UserStorageConfig extends StorageConfig {
  /** `SUPABASE_PUBLISHABLE_KEY`. */
  publishableKey: string
}

export interface ServiceStorageConfig extends StorageConfig {
  /** `SUPABASE_SECRET_KEY`. Bypasses Storage RLS. */
  secretKey: string
}

/** A Storage call failed. Carries Storage's message and HTTP status, never keys. */
export class StorageOperationError extends Error {
  readonly operation: 'put' | 'get' | 'signedReadUrl'
  readonly status: number | undefined
  constructor(
    operation: StorageOperationError['operation'],
    message: string,
    status?: number,
    options?: { cause?: unknown },
  ) {
    super(`Storage ${operation} failed: ${message}`, options)
    this.name = 'StorageOperationError'
    this.operation = operation
    this.status = status
  }
}

interface StorageErrorLike {
  message: string
  status?: number
}

/**
 * The subset of supabase-js's bucket API that `TenantStorage` uses. Tests can
 * pass a fake to `tenantStorage()` instead of a real client.
 */
export interface SourcesBucket {
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: false },
  ): Promise<{ error: StorageErrorLike | null }>
  download(path: string): Promise<{ data: Blob | null; error: StorageErrorLike | null }>
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{ data: { signedUrl: string } | null; error: StorageErrorLike | null }>
}

function fail(
  operation: StorageOperationError['operation'],
  error: StorageErrorLike,
): never {
  throw new StorageOperationError(operation, error.message, error.status, {
    cause: error,
  })
}

/**
 * Builds a `TenantStorage` over a bucket client. `getBucket` is called lazily,
 * after a path passes its checks, so a rejected path never creates a client,
 * asks for a token or touches the network.
 */
export function tenantStorage(
  tenantId: string,
  getBucket: () => SourcesBucket,
): TenantStorage {
  assertTenantId(tenantId)
  let bucket: SourcesBucket | undefined
  const resolve = () => (bucket ??= getBucket())

  return {
    tenantId,

    async put(sourceId, index, filename, body, contentType) {
      const path = sourceObjectPath(tenantId, sourceId, index, filename)
      // Raw sources are immutable and the bucket has no update policy, so an
      // existing object is an error rather than an overwrite.
      const { error } = await resolve().upload(path, body, {
        contentType,
        upsert: false,
      })
      if (error) fail('put', error)
      return path
    },

    async get(path) {
      assertTenantPath(path, tenantId)
      const { data, error } = await resolve().download(path)
      if (error) fail('get', error)
      if (!data) fail('get', { message: 'empty response' })
      return new Uint8Array(await data.arrayBuffer())
    },

    async signedReadUrl(path, expiresInSeconds) {
      assertTenantPath(path, tenantId)
      const expiresIn = clampSignedUrlExpiry(expiresInSeconds)
      const { data, error } = await resolve().createSignedUrl(path, expiresIn)
      if (error) fail('signedReadUrl', error)
      if (!data) fail('signedReadUrl', { message: 'empty response' })
      return data.signedUrl
    },
  }
}

// Server-side clients: no session storage, no refresh timers, no URL parsing.
const SERVER_AUTH: SupabaseClientOptions<'public'>['auth'] = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
}

function bucketFrom(client: ReturnType<typeof createClient>): SourcesBucket {
  return client.storage.from(SOURCES_BUCKET)
}

/**
 * API variant: the publishable key plus the caller's Clerk session token, so
 * Storage evaluates the bucket's RLS policies as that user. `getToken` is only
 * called when a request is made; a missing token fails instead of silently
 * falling back to the anonymous key.
 */
export function userStorage(
  cfg: UserStorageConfig,
  getToken: () => Promise<string | null>,
  tenantId: string,
): TenantStorage {
  return tenantStorage(tenantId, () =>
    bucketFrom(
      createClient(cfg.url, cfg.publishableKey, {
        accessToken: async () => {
          const token = await getToken()
          if (!token) {
            throw new Error('User storage requires a session token.')
          }
          return token
        },
        auth: SERVER_AUTH,
        global: cfg.fetch ? { fetch: cfg.fetch } : undefined,
      }),
    ),
  )
}

/**
 * Worker variant: the secret key, which bypasses Storage RLS. The tenant
 * prefix check in `tenantStorage` runs before every call and is what keeps a
 * handler inside its job's tenant.
 */
export function serviceStorage(
  cfg: ServiceStorageConfig,
  tenantId: string,
): TenantStorage {
  return tenantStorage(tenantId, () =>
    bucketFrom(
      createClient(cfg.url, cfg.secretKey, {
        auth: SERVER_AUTH,
        global: cfg.fetch ? { fetch: cfg.fetch } : undefined,
      }),
    ),
  )
}
