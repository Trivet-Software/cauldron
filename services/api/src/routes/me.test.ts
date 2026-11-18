// `GET /v1/me` (01.5-backend-foundation task 9.11, Requirements 2.3 and 2.5).
// Runs the real createApp() with a fake token verifier and a developer-role
// lookup built over an injected Clerk `getUser` fake.
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { type Db } from '@cauldron/core/db'
import { createApp } from '../app'
import { type DeveloperRoleUser, createDeveloperRoleLookup } from '../auth/developer'
import { SessionTokenError, type VerifySessionToken } from '../auth/verify-token'
import { loadEnv } from '../env'
import { ErrorResponseSchema } from '../http/errors'
import { createInMemoryCollection, createInMemoryStorage } from '../testing'

const env = loadEnv({
  DATABASE_URL: 'postgresql://unused',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  CLERK_SECRET_KEY: 'sk_test_x',
  APP_ORIGINS: 'https://app.example.com',
  PROVIDERS: 'mock',
  MOCK_RECORDINGS_DIR: '/tmp/unused',
})

const verifyToken: VerifySessionToken = async (token) => {
  if (token === 'good') return { sub: 'user_1', sid: 'sess_1' }
  throw new SessionTokenError('invalid', 'token-invalid')
}

function buildApp(getUser: (id: string) => Promise<DeveloperRoleUser>) {
  return createApp({
    env,
    db: {} as Db,
    verifyToken,
    health: { checkDatabase: async () => true },
    logger: pino({ level: 'silent' }),
    developerRole: createDeveloperRoleLookup({
      getUser,
      developerEmails: ['dev@example.com'],
    }),
    collection: createInMemoryCollection(),
    storageFor: createInMemoryStorage().storageFor,
  })
}

const AUTH = { headers: { Authorization: 'Bearer good' } }

function clerkUser(overrides: Partial<DeveloperRoleUser> = {}): () => Promise<DeveloperRoleUser> {
  return async () => ({ publicMetadata: {}, emailAddresses: [], ...overrides })
}

function listedEmail(verified: boolean): DeveloperRoleUser['emailAddresses'] {
  return [
    {
      emailAddress: 'dev@example.com',
      verification: { status: verified ? 'verified' : 'unverified' },
    },
  ] as DeveloperRoleUser['emailAddresses']
}

describe('GET /v1/me', () => {
  it('returns the 401 envelope without a token', async () => {
    const res = await buildApp(clerkUser()).request('/v1/me')
    expect(res.status).toBe(401)
    expect(ErrorResponseSchema.parse(await res.json()).error).toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })

  it('returns userId = tenantId = sub for a valid token', async () => {
    const res = await buildApp(clerkUser()).request('/v1/me', AUTH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'user_1', tenantId: 'user_1', isDeveloper: false })
  })

  it('reports isDeveloper for the metadata role', async () => {
    const app = buildApp(clerkUser({ publicMetadata: { role: 'developer' } }))
    const res = await app.request('/v1/me', AUTH)
    expect(await res.json()).toMatchObject({ isDeveloper: true })
  })

  it('reports isDeveloper for a verified listed email', async () => {
    const app = buildApp(clerkUser({ emailAddresses: listedEmail(true) }))
    const res = await app.request('/v1/me', AUTH)
    expect(await res.json()).toMatchObject({ isDeveloper: true })
  })

  it('reports isDeveloper false for an unverified listed email', async () => {
    const app = buildApp(clerkUser({ emailAddresses: listedEmail(false) }))
    const res = await app.request('/v1/me', AUTH)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ isDeveloper: false })
  })

  it('returns 503 when Clerk fails', async () => {
    const app = buildApp(async () => {
      throw new Error('clerk down')
    })
    const res = await app.request('/v1/me', AUTH)
    expect(res.status).toBe(503)
    expect(ErrorResponseSchema.parse(await res.json()).error.status).toBe(503)
  })

  it('is listed in the OpenAPI document with bearerAuth', async () => {
    const res = await buildApp(clerkUser()).request('/v1/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { security?: unknown }>>
    }
    expect(doc.paths['/me'].get.security).toEqual([{ bearerAuth: [] }])
  })
})
