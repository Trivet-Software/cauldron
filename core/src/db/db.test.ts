// Unit tests for the parts of task 3.1 that need no database. Behavior against Postgres
// (claims, roles, RLS) is covered by the *.db.test.ts suites (tasks 3.5 and 3.6).
import { PostgresError } from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

import * as dbModule from './index'
import { createDb, ForbiddenError, type RequestActor, SYSTEM_OWNER, withActor } from './index'
import { mapDbError } from './errors'

// Nothing listens on port 1. Connections open lazily, so this only fails if a query is sent.
const db = createDb('postgres://nobody@127.0.0.1:1/none', { max: 1 })
afterAll(() => db.close({ timeoutSeconds: 0 }))

describe('withActor', () => {
  it('rejects the system actor before touching the database', async () => {
    const system = { kind: 'system' } as unknown as RequestActor
    await expect(withActor(db, system, async () => 1)).rejects.toThrow(/withSystem/)
  })

  it('rejects a user actor whose tenantId differs from its userId', async () => {
    const actor: RequestActor = { kind: 'user', userId: 'user_a', tenantId: 'user_b' }
    await expect(withActor(db, actor, async () => 1)).rejects.toThrow(/tenantId/)
  })

  it('rejects a user actor with an empty userId', async () => {
    const actor: RequestActor = { kind: 'user', userId: '', tenantId: '' }
    await expect(withActor(db, actor, async () => 1)).rejects.toThrow(/userId/)
  })
})

describe('createDb', () => {
  it('rejects a pool size below 1', () => {
    expect(() => createDb('postgres://127.0.0.1:1/none', { max: 0 })).toThrow(RangeError)
  })
})

describe('mapDbError', () => {
  it('maps insufficient_privilege (42501) to ForbiddenError', () => {
    const pgError = new PostgresError({
      message: 'new row violates row-level security policy for table "items"',
      code: '42501',
    })
    const mapped = mapDbError(pgError)
    expect(mapped).toBeInstanceOf(ForbiddenError)
    expect((mapped as ForbiddenError).cause).toBe(pgError)
    expect((mapped as ForbiddenError).message).not.toContain('items')
  })

  it('leaves other errors unchanged', () => {
    const unique = new PostgresError({ message: 'duplicate key', code: '23505' })
    const plain = new Error('boom')
    expect(mapDbError(unique)).toBe(unique)
    expect(mapDbError(plain)).toBe(plain)
  })
})

describe('@cauldron/core/db exports', () => {
  it('exposes neither the privileged pool nor the system actor', () => {
    expect(Object.keys(dbModule).sort()).toEqual(
      [
        'EMBEDDING_COLUMN_DIMENSIONS',
        'ForbiddenError',
        'SYSTEM_OWNER',
        'createDb',
        'embeddingScope',
        'withActor',
      ].sort(),
    )
    expect(SYSTEM_OWNER).toBe('system')
  })
})
