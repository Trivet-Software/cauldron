// Which TenantStorage serves a request (01.7-walking-skeleton task 6.6, design
// "Storage selection"). Storage RLS verifies Clerk-issued JWTs, so a Clerk
// session reads and writes as the user (`userStorage`), while the static dev
// token can't and uses the secret key instead (`serviceStorage`). Both check
// the tenant prefix before any call.
import { type Context } from 'hono'
import { type TenantStorage, serviceStorage, userStorage } from '@cauldron/core/storage'
import { DEV_SESSION_ID } from './auth/dev-token'
import { parseBearer } from './auth/principal'
import { type ApiEnv } from './env'
import { type AppBindings, type Principal } from './http/bindings'
import { ApiError } from './http/errors'

export type UserPrincipal = Extract<Principal, { kind: 'user' }>

/** `bearer` is the verified session token, which `userStorage` forwards to Storage. */
export type StorageFor = (principal: UserPrincipal, bearer: string) => TenantStorage

export type StorageEnv = Pick<
  ApiEnv,
  'SUPABASE_URL' | 'SUPABASE_PUBLISHABLE_KEY' | 'SUPABASE_SECRET_KEY'
>

/** Production `storageFor`. Tests inject an in-memory TenantStorage instead. */
export function createStorageFor(env: StorageEnv): StorageFor {
  return (principal, bearer) => {
    if (principal.sessionId === DEV_SESSION_ID) {
      // devAuthRules makes the secret key mandatory in dev mode, so this only
      // fails if something other than loadEnv built the env.
      if (env.SUPABASE_SECRET_KEY === undefined) {
        throw new Error('SUPABASE_SECRET_KEY is required for the dev auth principal.')
      }
      return serviceStorage(
        { url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY },
        principal.tenantId,
      )
    }
    return userStorage(
      { url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY },
      async () => bearer,
      principal.tenantId,
    )
  }
}

/** The caller's storage, from the request's own principal and bearer token. */
export function requestStorage(c: Context<AppBindings>, storageFor: StorageFor): TenantStorage {
  const principal = c.get('principal')
  const bearer = parseBearer(c.req.header('Authorization') ?? '')
  // requireUser (from defineRoute) already guarantees both on `access: 'user'` routes.
  if (principal?.kind !== 'user' || bearer === null) {
    throw new ApiError(401, 'unauthorized', 'A valid session token is required.')
  }
  return storageFor(principal, bearer)
}
