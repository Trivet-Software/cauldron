import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { sniffImageType } from './capture'

const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

const suffix = fc.uint8Array({ maxLength: 64 })
const sizeField = fc.uint8Array({ minLength: 4, maxLength: 4 })

function concat(...parts: ArrayLike<number>[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => Array.from(part)))
}

function hasPrefix(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

describe('sniffImageType', () => {
  // Feature: 01.7-walking-skeleton, Property 3: Image type detection follows the leading bytes
  // **Validates: Requirements 2.3, 9.6**
  it('returns the matching type for any bytes that start with a JPEG, PNG or WebP signature', () => {
    fc.assert(
      fc.property(suffix, sizeField, (rest, size) => {
        expect(sniffImageType(concat(JPEG, rest))).toBe('image/jpeg')
        expect(sniffImageType(concat(PNG, rest))).toBe('image/png')
        expect(sniffImageType(concat(RIFF, size, WEBP, rest))).toBe('image/webp')
      }),
    )
  })

  it('returns null for any bytes that start with none of the three signatures', () => {
    const unsigned = fc.uint8Array({ maxLength: 64 }).filter(
      (bytes) =>
        !(bytes.length >= 3 && hasPrefix(bytes, 0, JPEG)) &&
        !(bytes.length >= 4 && hasPrefix(bytes, 0, PNG)) &&
        !(bytes.length >= 12 && hasPrefix(bytes, 0, RIFF) && hasPrefix(bytes, 8, WEBP)),
    )
    fc.assert(
      fc.property(unsigned, (bytes) => {
        expect(sniffImageType(bytes)).toBeNull()
      }),
    )
  })

  it('returns null for a RIFF container that is not WebP', () => {
    const notWebp = fc
      .uint8Array({ minLength: 4, maxLength: 4 })
      .filter((tag) => !tag.every((byte, index) => byte === WEBP[index]))
    fc.assert(
      fc.property(sizeField, notWebp, suffix, (size, tag, rest) => {
        expect(sniffImageType(concat(RIFF, size, tag, rest))).toBeNull()
      }),
    )
  })

  it('returns null for empty input and truncated signatures', () => {
    expect(sniffImageType(new Uint8Array())).toBeNull()
    expect(sniffImageType(Uint8Array.from(JPEG.slice(0, 2)))).toBeNull()
    expect(sniffImageType(Uint8Array.from(PNG.slice(0, 3)))).toBeNull()
    expect(sniffImageType(concat(RIFF, [0, 0, 0, 0], WEBP.slice(0, 3)))).toBeNull()
  })
})
