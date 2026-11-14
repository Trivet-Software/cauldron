// Unit tests for TenantStorage and its user/service variants
// (01.5-backend-foundation task 3.4, Requirements 5.2, 5.3). No network:
// supabase-js gets a `vi.fn()` fetch, and `tenantStorage` gets a fake bucket.
import { describe, expect, it, vi } from 'vitest'

import {
  StorageOperationError,
  StoragePathError,
  serviceStorage,
  tenantStorage,
  userStorage,
  type SourcesBucket,
} from './index'

const TENANT = 'user_tenantA'
const SOURCE = '0b6f1c1e-3c55-4c3e-9a51-0f4f2e8d9c11'
const VALID_PATH = `${TENANT}/${SOURCE}/0-a.pdf`
const URL = 'https://project.supabase.co'

const REJECTED_PATHS: Array<[string, string]> = [
  ['another tenant', `user_tenantB/${SOURCE}/0-a.pdf`],
  ['traversal', `${TENANT}/../0-a.pdf`],
  ['traversal to another tenant', `${TENANT}/../../user_tenantB/s/0-a.pdf`],
  ['leading slash', `/${VALID_PATH}`],
  ['empty segment', `${TENANT}//0-a.pdf`],
  ['percent-encoded slash', `${TENANT}/${SOURCE}/0-a%2Fb.pdf`],
  ['backslash', `${TENANT}\\${SOURCE}\\0-a.pdf`],
]

function fakeBucket(overrides: Partial<SourcesBucket> = {}): SourcesBucket {
  return {
    upload: vi.fn(async () => ({ error: null })),
    download: vi.fn(async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })),
    createSignedUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `${URL}/signed/${path}` },
      error: null,
    })),
    ...overrides,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('serviceStorage', () => {
  it.each(REJECTED_PATHS)('rejects %s without a network call', async (_label, path) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const storage = serviceStorage({ url: URL, secretKey: 'sb_secret_test', fetch }, TENANT)

    await expect(storage.get(path)).rejects.toThrow(StoragePathError)
    await expect(storage.signedReadUrl(path)).rejects.toThrow(StoragePathError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an invalid source ID on put without a network call', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const storage = serviceStorage({ url: URL, secretKey: 'sb_secret_test', fetch }, TENANT)

    await expect(
      storage.put('../user_tenantB', 0, 'a.pdf', new Uint8Array(), 'application/pdf'),
    ).rejects.toThrow(StoragePathError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an invalid tenant ID up front', () => {
    expect(() => serviceStorage({ url: URL, secretKey: 'sb_secret_test' }, '../x')).toThrow(
      StoragePathError,
    )
  })

  it('reaches Storage through the injected fetch for a valid path', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ signedURL: `/object/sign/sources/${VALID_PATH}?token=t` }),
    )
    const storage = serviceStorage({ url: URL, secretKey: 'sb_secret_test', fetch }, TENANT)

    const signed = await storage.signedReadUrl(VALID_PATH, 3600)
    expect(signed).toContain(`/object/sign/sources/${VALID_PATH}?token=t`)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = fetch.mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toEqual({ expiresIn: 600 })
  })
})

describe('userStorage', () => {
  it.each(REJECTED_PATHS)(
    'rejects %s without asking for a token or calling the network',
    async (_label, path) => {
      const fetch = vi.fn<typeof globalThis.fetch>()
      const getToken = vi.fn(async () => 'clerk-session-token')
      const storage = userStorage(
        { url: URL, publishableKey: 'sb_publishable_test', fetch },
        getToken,
        TENANT,
      )

      await expect(storage.get(path)).rejects.toThrow(StoragePathError)
      await expect(storage.signedReadUrl(path)).rejects.toThrow(StoragePathError)
      expect(getToken).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('sends the session token for a valid path', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ signedURL: `/object/sign/sources/${VALID_PATH}?token=t` }),
    )
    const getToken = vi.fn(async () => 'clerk-session-token')
    const storage = userStorage(
      { url: URL, publishableKey: 'sb_publishable_test', fetch },
      getToken,
      TENANT,
    )

    await storage.signedReadUrl(VALID_PATH)
    expect(getToken).toHaveBeenCalled()
    const [, init] = fetch.mock.calls[0]!
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer clerk-session-token')
  })

  it('fails instead of falling back to the anonymous key when there is no token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const storage = userStorage(
      { url: URL, publishableKey: 'sb_publishable_test', fetch },
      async () => null,
      TENANT,
    )

    await expect(storage.signedReadUrl(VALID_PATH)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('tenantStorage', () => {
  it('does not create a bucket client for a rejected path', async () => {
    const getBucket = vi.fn(() => fakeBucket())
    const storage = tenantStorage(TENANT, getBucket)

    await expect(storage.get(`user_tenantB/${SOURCE}/0-a.pdf`)).rejects.toThrow(StoragePathError)
    expect(getBucket).not.toHaveBeenCalled()
  })

  it('put uploads to the built path with upsert: false and returns it', async () => {
    const bucket = fakeBucket()
    const storage = tenantStorage(TENANT, () => bucket)
    const body = new Uint8Array([7])

    const path = await storage.put(SOURCE, 2, 'My Scan.jpg', body, 'image/jpeg')

    expect(path).toBe(`${TENANT}/${SOURCE}/2-My_Scan.jpg`)
    expect(bucket.upload).toHaveBeenCalledWith(path, body, {
      contentType: 'image/jpeg',
      upsert: false,
    })
  })

  it('get returns the downloaded bytes', async () => {
    const storage = tenantStorage(TENANT, () => fakeBucket())
    expect(await storage.get(VALID_PATH)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it.each([
    [undefined, 300],
    [0, 1],
    [300, 300],
    [601, 600],
    [3600, 600],
  ])('signedReadUrl(%s) requests %s s', async (requested, expected) => {
    const bucket = fakeBucket()
    const storage = tenantStorage(TENANT, () => bucket)

    expect(await storage.signedReadUrl(VALID_PATH, requested)).toBe(
      `${URL}/signed/${VALID_PATH}`,
    )
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(VALID_PATH, expected)
  })

  it('wraps Storage errors in StorageOperationError', async () => {
    const storageError = { message: 'The resource already exists', status: 409 }
    const storage = tenantStorage(TENANT, () =>
      fakeBucket({
        upload: async () => ({ error: storageError }),
        download: async () => ({ data: null, error: { message: 'Object not found', status: 404 } }),
        createSignedUrl: async () => ({ data: null, error: { message: 'denied', status: 403 } }),
      }),
    )

    const putError = await storage
      .put(SOURCE, 0, 'a.pdf', new Uint8Array(), 'application/pdf')
      .catch((e: unknown) => e)
    expect(putError).toBeInstanceOf(StorageOperationError)
    expect(putError).toMatchObject({
      operation: 'put',
      status: 409,
      message: 'Storage put failed: The resource already exists',
      cause: storageError,
    })

    await expect(storage.get(VALID_PATH)).rejects.toMatchObject({
      name: 'StorageOperationError',
      operation: 'get',
      status: 404,
    })
    await expect(storage.signedReadUrl(VALID_PATH)).rejects.toMatchObject({
      name: 'StorageOperationError',
      operation: 'signedReadUrl',
      status: 403,
    })
  })

  it('treats an empty success response as a StorageOperationError', async () => {
    const storage = tenantStorage(TENANT, () =>
      fakeBucket({
        download: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: null, error: null }),
      }),
    )

    await expect(storage.get(VALID_PATH)).rejects.toBeInstanceOf(StorageOperationError)
    await expect(storage.signedReadUrl(VALID_PATH)).rejects.toBeInstanceOf(
      StorageOperationError,
    )
  })
})
