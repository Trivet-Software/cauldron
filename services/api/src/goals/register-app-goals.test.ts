// Tests for app-goal registration (01.7-walking-skeleton task 6.5, Requirements 1.4 and
// 1.6). `withSystem` and `registerGoal` are injected, so no database is needed.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Db, type Scoped } from '@cauldron/core/db'

import { registerAppGoals, type RegisterAppGoalsOptions } from './register-app-goals'

const SECRET = 'SECRET-FILE-CONTENT'

const validGoal = (name: string) => ({
  name,
  description: 'A test app.',
  schema: {
    type: 'object',
    titleField: 'title',
    required: ['title'],
    properties: { title: { type: 'string', title: 'Title' } },
  },
})

type RegisterGoal = NonNullable<RegisterAppGoalsOptions['registerGoal']>

let appsDir: string

beforeEach(async () => {
  appsDir = await mkdtemp(path.join(tmpdir(), 'register-app-goals-'))
})

afterEach(async () => {
  await rm(appsDir, { recursive: true, force: true })
})

async function writeApp(slug: string, contents?: string): Promise<string> {
  const dir = path.join(appsDir, slug)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'goal.json')
  if (contents !== undefined) await writeFile(file, contents)
  return file
}

function setup(registerGoal?: RegisterGoal) {
  const scope = { tenantId: 'system' } as unknown as Scoped
  const register = vi.fn<RegisterGoal>(
    registerGoal ?? (async () => ({ status: 'created', version: 1 })),
  )
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const options: RegisterAppGoalsOptions = {
    db: {} as Db,
    appsDir,
    logger,
    withSystem: async (_db, fn) => fn(scope),
    registerGoal: register,
  }
  const logged = () => JSON.stringify(Object.values(logger).flatMap((fn) => fn.mock.calls))
  return { options, register, logger, logged }
}

describe('registerAppGoals', () => {
  it('registers a valid goal under its folder name and logs the others by path and issues', async () => {
    const validFile = await writeApp('a-valid', JSON.stringify(validGoal('Valid App')))
    const malformedFile = await writeApp('b-malformed', `{"name": "${SECRET}", `)
    const invalidFile = await writeApp(
      'c-invalid',
      JSON.stringify({ ...validGoal('Invalid'), name: 42, extra: SECRET }),
    )
    const { options, register, logger, logged } = setup()

    const outcomes = await registerAppGoals(options)

    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0]![1]).toMatchObject({
      slug: 'a-valid',
      spec: { name: 'Valid App' },
    })
    expect(outcomes).toEqual([
      { slug: 'a-valid', status: 'created', version: 1 },
      {
        slug: 'b-malformed',
        status: 'invalid',
        errors: [{ path: '', message: expect.any(String) }],
      },
      {
        slug: 'c-invalid',
        status: 'invalid',
        errors: expect.arrayContaining([{ path: 'name', message: expect.any(String) }]),
      },
    ])

    const errorCalls = logger.error.mock.calls
    expect(errorCalls).toHaveLength(2)
    const malformedCall = errorCalls.find(([fields]) => fields.path === malformedFile)
    const invalidCall = errorCalls.find(([fields]) => fields.path === invalidFile)
    expect(malformedCall?.[0].errors).toHaveLength(1)
    expect(invalidCall?.[0].errors).toEqual(
      expect.arrayContaining([{ path: 'name', message: expect.any(String) }]),
    )
    expect(logger.error.mock.calls.some(([fields]) => fields.path === validFile)).toBe(false)
    expect(logged()).not.toContain(SECRET)
  })

  it('skips a folder without goal.json', async () => {
    await writeApp('no-goal')
    await writeApp('has-goal', JSON.stringify(validGoal('Has Goal')))
    const { options, register } = setup()

    const outcomes = await registerAppGoals(options)

    expect(outcomes.map((o) => o.slug)).toEqual(['has-goal'])
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('ignores plain files next to the app folders', async () => {
    await writeFile(path.join(appsDir, 'README.md'), 'not an app')
    const { options, register } = setup()

    await expect(registerAppGoals(options)).resolves.toEqual([])
    expect(register).not.toHaveBeenCalled()
  })

  it('resolves to [] when the apps directory does not exist', async () => {
    const { options, logger } = setup()
    options.appsDir = path.join(appsDir, 'missing')

    await expect(registerAppGoals(options)).resolves.toEqual([])
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('logs a registerGoal failure and keeps processing the next folder', async () => {
    await writeApp('a-fails', JSON.stringify(validGoal('Fails')))
    await writeApp('b-works', JSON.stringify(validGoal('Works')))
    const { options, register, logger, logged } = setup(async (_scope, input) => {
      if (input.slug === 'a-fails') {
        throw Object.assign(new Error(`connection said ${SECRET}`), { code: '08006' })
      }
      return { status: 'updated', version: 3 }
    })

    const outcomes = await registerAppGoals(options)

    expect(register).toHaveBeenCalledTimes(2)
    expect(outcomes).toEqual([
      { slug: 'a-fails', status: 'error' },
      { slug: 'b-works', status: 'updated', version: 3 },
    ])
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'a-fails', code: '08006' }),
      expect.any(String),
    )
    expect(logged()).not.toContain(SECRET)
  })

  it('logs a duplicate goal name and keeps processing', async () => {
    await writeApp('a-dup', JSON.stringify(validGoal('Same Name')))
    await writeApp('b-ok', JSON.stringify(validGoal('Other Name')))
    const { options, logger, logged } = setup(async (_scope, input) => {
      if (input.slug === 'a-dup') {
        throw Object.assign(new Error(`duplicate key value (name)=(${SECRET})`), {
          code: '23505',
          constraint_name: 'goals_tenant_name_key',
          detail: `Key (name)=(${SECRET}) already exists.`,
        })
      }
      return { status: 'created', version: 1 }
    })

    const outcomes = await registerAppGoals(options)

    expect(outcomes).toEqual([
      {
        slug: 'a-dup',
        status: 'error',
        errors: [{ path: 'name', message: expect.any(String) }],
      },
      { slug: 'b-ok', status: 'created', version: 1 },
    ])
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logged()).not.toContain(SECRET)
  })

  it('recognizes a duplicate name wrapped as an error cause', async () => {
    await writeApp('a-dup', JSON.stringify(validGoal('Same Name')))
    const { options } = setup(async () => {
      throw new Error('wrapped', {
        cause: { code: '23505', constraint_name: 'goals_tenant_name_key' },
      })
    })

    await expect(registerAppGoals(options)).resolves.toEqual([
      { slug: 'a-dup', status: 'error', errors: [{ path: 'name', message: expect.any(String) }] },
    ])
  })

  it('treats a unique violation on another constraint as a plain error', async () => {
    await writeApp('a-other', JSON.stringify(validGoal('Other')))
    const { options, logger } = setup(async () => {
      throw Object.assign(new Error('boom'), { code: '23505', constraint_name: 'other_key' })
    })

    await expect(registerAppGoals(options)).resolves.toEqual([{ slug: 'a-other', status: 'error' }])
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('processes folders in name order', async () => {
    for (const slug of ['zeta', 'alpha', 'mid']) {
      await writeApp(slug, JSON.stringify(validGoal(`App ${slug}`)))
    }
    const { options, register } = setup()

    const outcomes = await registerAppGoals(options)

    expect(outcomes.map((o) => o.slug)).toEqual(['alpha', 'mid', 'zeta'])
    expect(register.mock.calls.map(([, input]) => input.slug)).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('never logs file contents for malformed or invalid files', async () => {
    await writeApp('a-malformed', `{"name": "${SECRET}" oops`)
    await writeApp('b-invalid', JSON.stringify({ name: SECRET, unknownKey: SECRET }))
    const { options, logged } = setup()

    await registerAppGoals(options)

    expect(logged()).not.toContain(SECRET)
  })
})
