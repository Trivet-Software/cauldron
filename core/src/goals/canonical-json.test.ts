// Property test for canonicalJson (01.7-walking-skeleton task 3.3,
// Requirement 1.5): goal registration compares content hashes, so equal
// content must serialize identically whatever order its keys were written in.
import { createHash } from 'node:crypto'

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { canonicalJson } from './index'

// Small seeded PRNG so a failing run replays from the seed fast-check prints.
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Rebuilds every object with its keys inserted in a shuffled order.
function shuffleKeys(value: unknown, random: () => number): unknown {
  if (Array.isArray(value)) return value.map((item) => shuffleKeys(item, random))
  if (value === null || typeof value !== 'object') return value
  const keys = Object.keys(value)
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[keys[i], keys[j]] = [keys[j]!, keys[i]!]
  }
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    // defineProperty keeps a generated "__proto__" key an own property.
    Object.defineProperty(out, key, {
      value: shuffleKeys((value as Record<string, unknown>)[key], random),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

describe('canonicalJson properties', () => {
  // Feature: 01.7-walking-skeleton, Property 1: Canonical JSON round trip and key-order invariance
  // **Validates: Requirements 1.5**
  it('round-trips through JSON.parse for any JSON value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        // JSON.stringify drops the sign of -0, so compare against the JSON form of the input.
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)))
      }),
      { numRuns: 100 },
    )
  })

  // Feature: 01.7-walking-skeleton, Property 1: Canonical JSON round trip and key-order invariance
  // **Validates: Requirements 1.5**
  it('returns the same string and content hash for any key order', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.integer(), (value, seed) => {
        const shuffled = shuffleKeys(value, prng(seed))
        const expected = canonicalJson(value)
        expect(canonicalJson(shuffled)).toBe(expected)
        expect(sha256(canonicalJson(shuffled))).toBe(sha256(expected))
      }),
      { numRuns: 100 },
    )
  })
})
