// Unit tests for task 3.2 that need no database. The SQL behind embeddingScope().filter and
// the stale-item reads is covered by embeddings.db.test.ts.
import { afterAll, describe, expect, it } from 'vitest'

import { createDb } from './connection'
import { embeddingScope } from './embeddings'
import { countItemsNeedingReembed, selectStaleItems } from './maintenance'

// Nothing listens on port 1. Connections open lazily, so this only fails if a query is sent.
const db = createDb('postgres://nobody@127.0.0.1:1/none', { max: 1 })
afterAll(() => db.close({ timeoutSeconds: 0 }))

describe('embeddingScope', () => {
  it('carries the configured model and dimensions', () => {
    const scope = embeddingScope({ model: 'openai/text-embedding-3-small', dimensions: 1536 })
    expect(scope.model).toBe('openai/text-embedding-3-small')
    expect(scope.dimensions).toBe(1536)
    expect(Object.isFrozen(scope)).toBe(true)
  })

  it('rejects an empty model', () => {
    expect(() => embeddingScope({ model: '', dimensions: 1536 })).toThrow(/model/)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects %s dimensions', (dimensions) => {
    expect(() => embeddingScope({ model: 'm', dimensions })).toThrow(/dimension/)
  })
})

describe('stale-item reads', () => {
  it.each([0, -1, 2.5, Number.NaN])('selectStaleItems rejects limit %s before querying', async (limit) => {
    await expect(selectStaleItems(db, 'm', limit)).rejects.toBeInstanceOf(RangeError)
  })

  it('rejects an empty model before querying', async () => {
    await expect(countItemsNeedingReembed(db, '')).rejects.toThrow(/model/)
    await expect(selectStaleItems(db, '', 10)).rejects.toThrow(/model/)
  })
})
