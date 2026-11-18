// registerGoal() against the real schema and policies (01.7-walking-skeleton task 5.4,
// Requirements 1.4 and 1.5). Each test runs in a rolled-back transaction, so the app goals
// registered here never reach the local stack. Slugs are unique per test so they can't collide
// with goals the seed already holds.
import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { type GoalFile } from '../goals'

import { SYSTEM_OWNER } from './actor'
import { registerGoal } from './register-goal'
import { withRollback } from './testing'

function uniqueSlug(): string {
  return `test-app-${randomUUID().slice(0, 8)}`
}

function goalFile(name: string): GoalFile {
  return {
    name,
    description: 'A goal used by the registerGoal tests.',
    accentColor: '#c2410c',
    schema: {
      type: 'object',
      titleField: 'title',
      required: ['title'],
      properties: {
        title: { type: 'string', title: 'Title' },
        notes: { type: 'string', format: 'long-text' },
      },
    },
  }
}

// The same content as goalFile(), with every object's keys written in a different order.
function reorderedGoalFile(name: string): GoalFile {
  return {
    schema: {
      properties: {
        notes: { format: 'long-text', type: 'string' },
        title: { title: 'Title', type: 'string' },
      },
      required: ['title'],
      titleField: 'title',
      type: 'object',
    },
    accentColor: '#c2410c',
    description: 'A goal used by the registerGoal tests.',
    name,
  }
}

describe('registerGoal', () => {
  it('creates version 1 on the first call', async () => {
    const slug = uniqueSlug()
    await withRollback(async (tx) => {
      const result = await tx.asSystem((scope) =>
        registerGoal(scope, { slug, spec: goalFile(`Test ${slug}`) }),
      )
      expect(result).toEqual({ status: 'created', version: 1 })

      const { goal, versions } = await tx.asSystem(async ({ sql }) => {
        const [goal] = await sql<
          { id: string; kind: string; user_id: string; latest_version: number; name: string }[]
        >`
          select id, kind, user_id, latest_version, name from public.goals
          where tenant_id = ${SYSTEM_OWNER} and slug = ${slug}`
        const versions = await sql<{ version: number; author: string; content_hash: string }[]>`
          select version, author, content_hash from public.goal_versions
          where tenant_id = ${SYSTEM_OWNER} and goal_id = ${goal!.id}`
        return { goal: goal!, versions }
      })
      expect(goal).toMatchObject({
        kind: 'app',
        user_id: SYSTEM_OWNER,
        latest_version: 1,
        name: `Test ${slug}`,
      })
      expect(versions).toHaveLength(1)
      expect(versions[0]).toMatchObject({ version: 1, author: 'deploy' })
      expect(versions[0]!.content_hash).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  it('reports the same file as unchanged and writes no second version', async () => {
    const slug = uniqueSlug()
    await withRollback(async (tx) => {
      const spec = goalFile(`Test ${slug}`)
      await tx.asSystem((scope) => registerGoal(scope, { slug, spec }))
      const second = await tx.asSystem((scope) => registerGoal(scope, { slug, spec }))
      expect(second).toEqual({ status: 'unchanged', version: 1 })

      const count = await countVersions(tx, slug)
      expect(count).toBe(1)
    })
  })

  it('creates version 2 when the file changed', async () => {
    const slug = uniqueSlug()
    await withRollback(async (tx) => {
      await tx.asSystem((scope) => registerGoal(scope, { slug, spec: goalFile(`Test ${slug}`) }))

      const changed = { ...goalFile(`Test ${slug} renamed`), description: 'A changed description.' }
      const result = await tx.asSystem((scope) => registerGoal(scope, { slug, spec: changed }))
      expect(result).toEqual({ status: 'updated', version: 2 })

      const goal = await tx.asSystem(async ({ sql }) => {
        const [row] = await sql<{ latest_version: number; name: string; description: string }[]>`
          select latest_version, name, description from public.goals
          where tenant_id = ${SYSTEM_OWNER} and slug = ${slug}`
        return row
      })
      expect(goal).toEqual({
        latest_version: 2,
        name: `Test ${slug} renamed`,
        description: 'A changed description.',
      })
      expect(await countVersions(tx, slug)).toBe(2)
    })
  })

  it('treats a file with reordered keys as unchanged', async () => {
    const slug = uniqueSlug()
    await withRollback(async (tx) => {
      const name = `Test ${slug}`
      await tx.asSystem((scope) => registerGoal(scope, { slug, spec: goalFile(name) }))
      const result = await tx.asSystem((scope) =>
        registerGoal(scope, { slug, spec: reorderedGoalFile(name) }),
      )
      expect(result).toEqual({ status: 'unchanged', version: 1 })
      expect(await countVersions(tx, slug)).toBe(1)
    })
  })

  it('rejects a call outside a system scope', async () => {
    const slug = uniqueSlug()
    await withRollback(async (tx) => {
      await expect(
        tx.asUser('user_not_system', (scope) =>
          registerGoal(scope, { slug, spec: goalFile(`Test ${slug}`) }),
        ),
      ).rejects.toThrow(TypeError)
    })
  })

  it('lets an anonymous caller read the registered app goal and its version', async () => {
    const slug = uniqueSlug()
    await withRollback(async (tx) => {
      await tx.asSystem((scope) => registerGoal(scope, { slug, spec: goalFile(`Test ${slug}`) }))

      const { goals, versions } = await tx.asAnon(async ({ sql }) => {
        const goals = await sql<{ id: string; name: string; latest_version: number }[]>`
          select id, name, latest_version from public.goals where slug = ${slug}`
        const versions = await sql<{ version: number; spec: GoalFile }[]>`
          select version, spec from public.goal_versions
          where goal_id = ${goals[0]?.id ?? randomUUID()}`
        return { goals, versions }
      })
      expect(goals).toHaveLength(1)
      expect(goals[0]).toMatchObject({ name: `Test ${slug}`, latest_version: 1 })
      expect(versions).toHaveLength(1)
      expect(versions[0]!.spec).toEqual(goalFile(`Test ${slug}`))
    })
  })
})

async function countVersions(
  tx: Parameters<Parameters<typeof withRollback>[0]>[0],
  slug: string,
): Promise<number> {
  return tx.asSystem(async ({ sql }) => {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from public.goal_versions v
      join public.goals g on g.id = v.goal_id
      where g.tenant_id = ${SYSTEM_OWNER} and g.slug = ${slug}`
    return row!.count
  })
}
