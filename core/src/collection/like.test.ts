import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { escapeLike } from './like'

type LikeToken = { kind: 'literal'; char: string } | { kind: 'any-string' } | { kind: 'any-char' }

// Parses a LIKE pattern with `\` as the escape character, as in `ilike ... escape '\'`.
function parseLike(pattern: string): LikeToken[] {
  const chars = Array.from(pattern)
  const tokens: LikeToken[] = []
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    if (char === '\\') {
      i += 1
      if (i >= chars.length) throw new Error('LIKE pattern must not end with the escape character')
      tokens.push({ kind: 'literal', char: chars[i] })
    } else if (char === '%') {
      tokens.push({ kind: 'any-string' })
    } else if (char === '_') {
      tokens.push({ kind: 'any-char' })
    } else {
      tokens.push({ kind: 'literal', char })
    }
  }
  return tokens
}

// Case-sensitive reference matcher: `%` is any run of characters, `_` is exactly one.
function likeMatches(pattern: string, text: string): boolean {
  const tokens = parseLike(pattern)
  const chars = Array.from(text)
  const memo = new Map<string, boolean>()

  function match(t: number, c: number): boolean {
    const key = `${t}:${c}`
    const cached = memo.get(key)
    if (cached !== undefined) return cached

    let result: boolean
    if (t === tokens.length) {
      result = c === chars.length
    } else {
      const token = tokens[t]
      if (token.kind === 'any-string') {
        result = match(t + 1, c) || (c < chars.length && match(t, c + 1))
      } else if (token.kind === 'any-char') {
        result = c < chars.length && match(t + 1, c + 1)
      } else {
        result = c < chars.length && chars[c] === token.char && match(t + 1, c + 1)
      }
    }
    memo.set(key, result)
    return result
  }

  return match(0, 0)
}

// Inverse of the escaping: removes each backslash that precedes `\`, `%` or `_`.
function unescapeLike(value: string): string {
  return value.replace(/\\([\\%_])/g, '$1')
}

// Weights the three special characters so most generated strings contain them.
const searchString = fc.oneof(
  fc.string({ unit: fc.constantFrom('\\', '%', '_', 'a', 'B', '1', ' ', 'é'), maxLength: 12 }),
  fc.string({ unit: 'grapheme', maxLength: 12 }),
)

describe('escapeLike', () => {
  // Feature: 01.7-walking-skeleton, Property 8: LIKE escaping round trip
  // **Validates: Requirements 6.2**
  it('unescapes back to the input and leaves no unescaped % or _', () => {
    fc.assert(
      fc.property(searchString, (q) => {
        const escaped = escapeLike(q)
        expect(unescapeLike(escaped)).toBe(q)

        // Every `%` or `_` must be consumed as the escaped character of a `\` pair.
        const tokens = parseLike(escaped)
        expect(tokens.every((token) => token.kind === 'literal')).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  // Feature: 01.7-walking-skeleton, Property 8: LIKE escaping round trip
  // **Validates: Requirements 6.2**
  it('as a LIKE pattern matches exactly the input and no other string', () => {
    fc.assert(
      fc.property(searchString, searchString, (q, other) => {
        const escaped = escapeLike(q)
        expect(likeMatches(escaped, q)).toBe(true)
        expect(likeMatches(escaped, other)).toBe(other === q)
      }),
      { numRuns: 100 },
    )
  })

  it('escapes the three special characters', () => {
    expect(escapeLike('100%_\\')).toBe('100\\%\\_\\\\')
    expect(likeMatches(escapeLike('a_b'), 'axb')).toBe(false)
  })
})
