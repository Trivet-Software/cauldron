// Unit tests for the pure storage path and expiry helpers
// (01.5-backend-foundation task 3.4, Requirements 5.2, 5.3).
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SIGNED_URL_SECONDS,
  FALLBACK_FILENAME,
  MAX_FILENAME_LENGTH,
  MAX_SIGNED_URL_SECONDS,
  StoragePathError,
  assertTenantPath,
  clampSignedUrlExpiry,
  sanitizeFilename,
  sourceObjectPath,
} from './paths'

const TENANT = 'user_2abcDEF'
const SOURCE = '0b6f1c1e-3c55-4c3e-9a51-0f4f2e8d9c11'

describe('sanitizeFilename', () => {
  it('keeps a name that is already safe', () => {
    expect(sanitizeFilename('recipe-01.final_v2.pdf')).toBe('recipe-01.final_v2.pdf')
  })

  it('keeps only the last path component', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('C:\\Users\\me\\scan.jpg')).toBe('scan.jpg')
  })

  it('collapses runs of disallowed characters into one underscore', () => {
    expect(sanitizeFilename('my file (1).pdf')).toBe('my_file_1_.pdf')
    expect(sanitizeFilename('a%2Fb.txt')).toBe('a_2Fb.txt')
    expect(sanitizeFilename('café.pdf')).toBe('caf_.pdf')
  })

  it('falls back when nothing usable is left', () => {
    for (const name of ['', '.', '..', '...', '🍰', '/', 'dir/']) {
      expect(sanitizeFilename(name)).toBe(FALLBACK_FILENAME)
    }
  })

  it('truncates from the front so the extension survives', () => {
    const result = sanitizeFilename(`${'a'.repeat(200)}.pdf`)
    expect(result).toHaveLength(MAX_FILENAME_LENGTH)
    expect(result.endsWith('.pdf')).toBe(true)
  })

  it('always returns 1–100 safe characters that are not . or ..', () => {
    const inputs = ['x', ' ', '\u0000', 'a/../b', '%00', '\\..\\', 'ｆｕｌｌ.txt', 'é'.repeat(300)]
    for (const input of inputs) {
      const result = sanitizeFilename(input)
      expect(result).toMatch(/^[A-Za-z0-9._-]{1,100}$/)
      expect(['.', '..']).not.toContain(result)
    }
  })
})

describe('sourceObjectPath', () => {
  it('builds {tenantId}/{sourceId}/{index}-{safeFilename}', () => {
    expect(sourceObjectPath(TENANT, SOURCE, 0, 'My Recipe.pdf')).toBe(
      `${TENANT}/${SOURCE}/0-My_Recipe.pdf`,
    )
    expect(sourceObjectPath('system', SOURCE, 12, 'a.png')).toBe(
      `system/${SOURCE}/12-a.png`,
    )
  })

  it('sanitizes a traversal filename instead of escaping the prefix', () => {
    expect(sourceObjectPath(TENANT, SOURCE, 1, '../../other/x.pdf')).toBe(
      `${TENANT}/${SOURCE}/1-x.pdf`,
    )
  })

  it('produces paths that pass assertTenantPath', () => {
    const path = sourceObjectPath(TENANT, SOURCE, 999_999_999, 'é'.repeat(300))
    expect(assertTenantPath(path, TENANT)).toBe(path)
  })

  it.each(['', '..', '.', 'user/a', 'user\\a', 'a%2Fb', 'x'.repeat(129)])(
    'rejects tenant ID %j',
    (tenantId) => {
      expect(() => sourceObjectPath(tenantId, SOURCE, 0, 'a.pdf')).toThrow(StoragePathError)
    },
  )

  it.each(['', '..', 'a/b', 'a b'])('rejects source ID %j', (sourceId) => {
    expect(() => sourceObjectPath(TENANT, sourceId, 0, 'a.pdf')).toThrow(StoragePathError)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000])(
    'rejects index %s',
    (index) => {
      expect(() => sourceObjectPath(TENANT, SOURCE, index, 'a.pdf')).toThrow(StoragePathError)
    },
  )
})

describe('assertTenantPath', () => {
  const valid = `${TENANT}/${SOURCE}/0-a.pdf`

  it('returns a well-formed path inside the tenant prefix unchanged', () => {
    expect(assertTenantPath(valid, TENANT)).toBe(valid)
  })

  it.each([
    ['another tenant', `user_other/${SOURCE}/0-a.pdf`],
    ['traversal in tenant segment', `../${SOURCE}/0-a.pdf`],
    ['traversal in source segment', `${TENANT}/../0-a.pdf`],
    ['traversal to another tenant', `${TENANT}/../../user_other/s/0-a.pdf`],
    ['leading slash', `/${valid}`],
    ['trailing slash', `${valid}/`],
    ['empty segment', `${TENANT}//0-a.pdf`],
    ['percent-encoded slash', `${TENANT}/${SOURCE}/0-a%2Fb.pdf`],
    ['percent-encoded traversal', `${TENANT}/%2E%2E/0-a.pdf`],
    ['backslash separators', `${TENANT}\\${SOURCE}\\0-a.pdf`],
    ['backslash in file name', `${TENANT}/${SOURCE}/0-..\\a.pdf`],
    ['missing index', `${TENANT}/${SOURCE}/a.pdf`],
    ['leading-zero index', `${TENANT}/${SOURCE}/01-a.pdf`],
    ['too few segments', `${TENANT}/0-a.pdf`],
    ['empty path', ''],
  ])('rejects %s', (_label, path) => {
    expect(() => assertTenantPath(path, TENANT)).toThrow(StoragePathError)
  })

  it('rejects an invalid expected tenant ID', () => {
    expect(() => assertTenantPath(valid, '..')).toThrow(StoragePathError)
  })
})

describe('clampSignedUrlExpiry', () => {
  it.each([
    [0, 1],
    [300, 300],
    [601, MAX_SIGNED_URL_SECONDS],
    [3600, MAX_SIGNED_URL_SECONDS],
    [600, 600],
    [1, 1],
    [-30, 1],
    [59.9, 59],
    [Number.POSITIVE_INFINITY, MAX_SIGNED_URL_SECONDS],
  ])('clamps %s to %s', (input, expected) => {
    expect(clampSignedUrlExpiry(input)).toBe(expected)
  })

  it('defaults to 300 s for undefined and NaN', () => {
    expect(clampSignedUrlExpiry()).toBe(DEFAULT_SIGNED_URL_SECONDS)
    expect(clampSignedUrlExpiry(Number.NaN)).toBe(DEFAULT_SIGNED_URL_SECONDS)
    expect(DEFAULT_SIGNED_URL_SECONDS).toBe(300)
  })
})
