// Storage policy integration tests (01.5-backend-foundation task 3.7; Requirements 5.2, 5.3).
// Runs against the local Supabase stack's Storage API, not the database pool.
//
// Needs, besides TEST_DATABASE_URL (checked by vitest.db.config.ts):
//   TEST_SUPABASE_URL              API URL, e.g. http://127.0.0.1:54321
//   TEST_SUPABASE_PUBLISHABLE_KEY  PUBLISHABLE_KEY from `supabase status -o env`
//   TEST_SUPABASE_SECRET_KEY       SECRET_KEY, used only to clean up uploaded objects
//   TEST_SUPABASE_JWT_SECRET       JWT_SECRET, used to sign test user tokens
// If any is unset the suite is skipped, so `pnpm test:db` still runs the database suites.
//
// Tokens: the local stack still accepts HS256 JWTs signed with its own JWT secret while Clerk
// third-party auth is on, and Storage RLS reads `sub` from them through private.tenant_id(), the
// same claim a Clerk session token carries. That stands in for Clerk tokens, which the local
// stack can't mint.
//
// Cross-tenant cases call supabase-js directly with user B's token. Going through `userStorage`
// would stop at its own tenant-prefix check before Storage is contacted, and this suite is about
// the bucket policies themselves.
import { createHmac, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'

import { SOURCES_BUCKET, userStorage } from './index'

const env = {
  url: process.env.TEST_SUPABASE_URL,
  publishableKey: process.env.TEST_SUPABASE_PUBLISHABLE_KEY,
  secretKey: process.env.TEST_SUPABASE_SECRET_KEY,
  jwtSecret: process.env.TEST_SUPABASE_JWT_SECRET,
}
const missing = Object.entries({
  TEST_SUPABASE_URL: env.url,
  TEST_SUPABASE_PUBLISHABLE_KEY: env.publishableKey,
  TEST_SUPABASE_SECRET_KEY: env.secretKey,
  TEST_SUPABASE_JWT_SECRET: env.jwtSecret,
})
  .filter(([, value]) => !value)
  .map(([name]) => name)

const SERVER_AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** An `authenticated` user token for `sub`, signed with the local stack's JWT secret. */
function signUserToken(sub: string, jwtSecret: string): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' })
  const payload = base64url({
    sub,
    role: 'authenticated',
    aud: 'authenticated',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
  })
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(missing.length > 0)(
  missing.length > 0
    ? `storage policies (skipped: set ${missing.join(', ')})`
    : 'storage policies',
  () => {
    const url = env.url as string
    const publishableKey = env.publishableKey as string
    const jwtSecret = env.jwtSecret as string

    // Unique per run so reruns never collide with leftovers.
    const run = randomUUID().slice(0, 8)
    const tenantA = `user_a_${run}`
    const tenantB = `user_b_${run}`
    const tokenA = signUserToken(tenantA, jwtSecret)
    const tokenB = signUserToken(tenantB, jwtSecret)
    const uploaded: string[] = []

    const storageA = userStorage({ url, publishableKey }, async () => tokenA, tenantA)

    function rawClientFor(token: string): SupabaseClient {
      return createClient(url, publishableKey, { accessToken: async () => token, auth: SERVER_AUTH })
    }
    const bucketB = rawClientFor(tokenB).storage.from(SOURCES_BUCKET)

    async function putAsA(filename: string, text: string): Promise<string> {
      const path = await storageA.put(
        randomUUID(),
        0,
        filename,
        new TextEncoder().encode(text),
        'text/plain',
      )
      uploaded.push(path)
      return path
    }

    afterAll(async () => {
      if (uploaded.length === 0) return
      const admin = createClient(url, env.secretKey as string, { auth: SERVER_AUTH })
      const { error } = await admin.storage.from(SOURCES_BUCKET).remove(uploaded)
      if (error) throw new Error(`Cleanup failed: ${error.message}`)
    })

    it('lets A upload under its own prefix and read the object back', async () => {
      const path = await putAsA('note.txt', 'hello from A')
      expect(path.startsWith(`${tenantA}/`)).toBe(true)
      expect(new TextDecoder().decode(await storageA.get(path))).toBe('hello from A')
    })

    it("doesn't let B download A's object or sign a URL for it", async () => {
      const path = await putAsA('private.txt', 'secret')

      const download = await bucketB.download(path)
      expect(download.data).toBeNull()
      expect(download.error).not.toBeNull()

      const signed = await bucketB.createSignedUrl(path, 60)
      expect(signed.data).toBeNull()
      expect(signed.error).not.toBeNull()
    })

    it("doesn't show B any of A's objects when listing A's prefix", async () => {
      const path = await putAsA('listed.txt', 'listed')
      const sourceFolder = path.split('/').slice(0, 2).join('/')

      // Control: A sees the object, so an empty result for B means the policy filtered it.
      const asA = await rawClientFor(tokenA).storage.from(SOURCES_BUCKET).list(sourceFolder)
      expect(asA.error).toBeNull()
      expect(asA.data?.map((entry) => entry.name)).toContain('0-listed.txt')

      for (const prefix of [tenantA, sourceFolder]) {
        const asB = await bucketB.list(prefix)
        expect(asB.data ?? []).toEqual([])
      }
    })

    it("doesn't let B upload under A's prefix", async () => {
      const path = `${tenantA}/${randomUUID()}/0-intruder.txt`
      const { error } = await bucketB.upload(path, new TextEncoder().encode('nope'), {
        contentType: 'text/plain',
        upsert: false,
      })
      if (!error) uploaded.push(path)
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/row-level security/i)
    })

    it('serves a signed URL for A until it expires', async () => {
      const path = await putAsA('signed.txt', 'signed body')
      const signedUrl = await storageA.signedReadUrl(path, 1)

      const fresh = await fetch(signedUrl)
      expect(fresh.status).toBe(200)
      expect(await fresh.text()).toBe('signed body')

      // exp is whole seconds after iat, so 1 s can mean up to ~2 s of validity.
      await sleep(2_500)
      const expired = await fetch(signedUrl)
      await expired.body?.cancel()
      expect([400, 401, 403]).toContain(expired.status)
    })
  },
)
