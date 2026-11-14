// Unit tests for request keys (01.5-backend-foundation task 5.4, Requirement 7.3).
import { describe, expect, it } from 'vitest'

import { canonicalize, requestKey } from './request-key'
import { type CompletionRequest } from './types'

function request(image: Uint8Array): CompletionRequest {
  return {
    model: 'mock/compile',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract the recipe' },
          { type: 'image', mediaType: 'image/png', data: image },
        ],
      },
    ],
    output: { name: 'recipe', jsonSchema: { type: 'object' } },
  }
}

describe('requestKey', () => {
  it('is a 64-character hex SHA-256', async () => {
    const key = await requestKey('complete', request(new Uint8Array([1, 2, 3])))
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable across object key order', async () => {
    const a = { model: 'm', output: { name: 'n', jsonSchema: { a: 1, b: 2 } } }
    const b = { output: { jsonSchema: { b: 2, a: 1 }, name: 'n' }, model: 'm' }
    expect(await requestKey('complete', a)).toBe(await requestKey('complete', b))
  })

  it('changes when image bytes change', async () => {
    const a = await requestKey('complete', request(new Uint8Array([1, 2, 3])))
    const b = await requestKey('complete', request(new Uint8Array([1, 2, 4])))
    expect(a).not.toBe(b)
  })

  it('ignores the abort signal and undefined fields', async () => {
    const base = request(new Uint8Array([1]))
    const withExtras: CompletionRequest = {
      ...base,
      signal: new AbortController().signal,
      temperature: undefined,
    }
    expect(await requestKey('complete', withExtras)).toBe(
      await requestKey('complete', base),
    )
  })

  it('differs by kind for the same request', async () => {
    const req = { model: 'm', inputs: ['a'] }
    expect(await requestKey('complete', req)).not.toBe(
      await requestKey('embed', req),
    )
  })
})

describe('canonicalize', () => {
  it('replaces byte arrays with their hash and keeps array positions', async () => {
    const out = await canonicalize({ list: [new Uint8Array([0]), undefined, 1] })
    expect(out).toEqual({
      list: [{ $sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }, null, 1],
    })
  })
})
