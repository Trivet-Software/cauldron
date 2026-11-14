// Developer-role lookup (01.5-backend-foundation task 9.6, Requirement 2.5).
// Clerk's Backend API is replaced by an injected getUser fake.
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http/errors'
import { type DeveloperRoleUser, createDeveloperRoleLookup } from './developer'

function user(overrides: Partial<DeveloperRoleUser> = {}): DeveloperRoleUser {
  return { publicMetadata: {}, emailAddresses: [], ...overrides }
}

function email(address: string, status = 'verified') {
  return { emailAddress: address, verification: { status } }
}

describe('createDeveloperRoleLookup', () => {
  it('grants the role from publicMetadata.role', async () => {
    const lookup = createDeveloperRoleLookup({
      getUser: async () => user({ publicMetadata: { role: 'developer' } }),
      developerEmails: [],
    })
    expect(await lookup('user_1')).toBe(true)
  })

  it('grants the role for a verified listed email, matching case-insensitively', async () => {
    const lookup = createDeveloperRoleLookup({
      getUser: async () => user({ emailAddresses: [email('Dev@Example.com')] }),
      developerEmails: ['dev@EXAMPLE.com'],
    })
    expect(await lookup('user_1')).toBe(true)
  })

  it('denies a listed email that is not verified', async () => {
    const lookup = createDeveloperRoleLookup({
      getUser: async () =>
        user({
          emailAddresses: [
            email('dev@example.com', 'unverified'),
            { emailAddress: 'dev@example.com', verification: null },
          ],
        }),
      developerEmails: ['dev@example.com'],
    })
    expect(await lookup('user_1')).toBe(false)
  })

  it('denies a user with no role and no listed email', async () => {
    const lookup = createDeveloperRoleLookup({
      getUser: async () =>
        user({ publicMetadata: { role: 'admin' }, emailAddresses: [email('a@example.com')] }),
      developerEmails: ['dev@example.com'],
    })
    expect(await lookup('user_1')).toBe(false)
  })

  it('reuses a result within the TTL and refetches after it', async () => {
    let clock = 0
    const getUser = vi.fn(async () => user({ publicMetadata: { role: 'developer' } }))
    const lookup = createDeveloperRoleLookup({
      getUser,
      developerEmails: [],
      ttlMs: 60_000,
      now: () => clock,
    })

    await lookup('user_1')
    clock = 59_999
    await lookup('user_1')
    expect(getUser).toHaveBeenCalledTimes(1)

    clock = 60_000
    await lookup('user_1')
    expect(getUser).toHaveBeenCalledTimes(2)
  })

  it('caches per user and shares one call between concurrent lookups', async () => {
    const getUser = vi.fn(async () => user())
    const lookup = createDeveloperRoleLookup({ getUser, developerEmails: [] })

    await Promise.all([lookup('user_1'), lookup('user_1'), lookup('user_2')])
    expect(getUser).toHaveBeenCalledTimes(2)
  })

  it('drops the oldest entry beyond maxEntries', async () => {
    const getUser = vi.fn(async () => user())
    const lookup = createDeveloperRoleLookup({ getUser, developerEmails: [], maxEntries: 2 })

    await lookup('user_1')
    await lookup('user_2')
    await lookup('user_3')
    await lookup('user_3')
    expect(getUser).toHaveBeenCalledTimes(3)
    await lookup('user_1')
    expect(getUser).toHaveBeenCalledTimes(4)
  })

  it('throws ApiError 503 on a Clerk failure, without caching it', async () => {
    const getUser = vi
      .fn<(id: string) => Promise<DeveloperRoleUser>>()
      .mockRejectedValueOnce(new Error('clerk said: secret detail'))
      .mockResolvedValueOnce(user({ publicMetadata: { role: 'developer' } }))
    const lookup = createDeveloperRoleLookup({ getUser, developerEmails: [] })

    const err = await lookup('user_1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 503, code: 'internal' })
    expect((err as ApiError).message).not.toContain('secret detail')

    expect(await lookup('user_1')).toBe(true)
    expect(getUser).toHaveBeenCalledTimes(2)
  })
})
