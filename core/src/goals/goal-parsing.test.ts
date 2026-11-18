// Unit tests for goal file parsing (01.7-walking-skeleton task 3.7).
// Reads the shipped goal files from the repo so a bad edit to either one fails here.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { goalFields, goalFileSchema } from './index'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function readGoal(app: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, 'apps', app, 'goal.json'), 'utf8'))
}

function validGoal() {
  return structuredClone(readGoal('recipe-box')) as {
    schema: { titleField?: string; properties: Record<string, unknown> } & Record<string, unknown>
  } & Record<string, unknown>
}

function issueMessages(input: unknown): { path: string; message: string }[] {
  const result = goalFileSchema.safeParse(input)
  if (result.success) throw new Error('Expected the goal file to fail parsing')
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }))
}

describe('shipped goal files', () => {
  // Requirements 1.1, 1.2
  it.each(['recipe-box', 'research-library'])('%s parses with goalFileSchema', (app) => {
    expect(goalFileSchema.safeParse(readGoal(app)).success).toBe(true)
  })

  it('give each app a title field of kind text', () => {
    for (const app of ['recipe-box', 'research-library']) {
      const goal = goalFileSchema.parse(readGoal(app))
      const titles = goalFields(goal).filter((field) => field.isTitle)
      expect(titles).toHaveLength(1)
      expect(titles[0]!.key).toBe(goal.schema.titleField)
      expect(titles[0]!.kind).toBe('text')
    }
  })

  it('define different item schemas', () => {
    const recipeBox = goalFileSchema.parse(readGoal('recipe-box'))
    const library = goalFileSchema.parse(readGoal('research-library'))

    expect(Object.keys(recipeBox.schema.properties)).not.toEqual(
      Object.keys(library.schema.properties),
    )
    expect(recipeBox.schema.properties).not.toEqual(library.schema.properties)
    expect(goalFields(recipeBox).some((field) => field.kind === 'image')).toBe(true)
    expect(goalFields(library).some((field) => field.kind === 'image')).toBe(false)
  })
})

describe('goal file refinements', () => {
  // Requirement 1.6: a file that fails to parse is reported with its issue paths.
  it('rejects a goal whose titleField is missing', () => {
    const goal = validGoal()
    delete goal.schema.titleField

    expect(issueMessages(goal).map((issue) => issue.path)).toContain('schema.titleField')
  })

  it('rejects a titleField that names no property', () => {
    const goal = validGoal()
    goal.schema.titleField = 'heading'

    expect(issueMessages(goal)).toContainEqual({
      path: 'schema.titleField',
      message: 'titleField must name a property',
    })
  })

  it('rejects a goal with two image fields', () => {
    const goal = validGoal()
    goal.schema.properties.cover = { type: 'string', format: 'image', title: 'Cover' }

    expect(issueMessages(goal)).toContainEqual({
      path: 'schema.properties',
      message: 'At most one image field is allowed',
    })
  })

  it('rejects an unknown top-level key', () => {
    const goal = { ...validGoal(), colour: 'red' }

    expect(goalFileSchema.safeParse(goal).success).toBe(false)
    expect(issueMessages(goal).some((issue) => issue.message.includes('colour'))).toBe(true)
  })

  it('rejects an unknown key inside a property', () => {
    const goal = validGoal()
    goal.schema.properties.title = { type: 'string', maxLength: 10 }

    expect(goalFileSchema.safeParse(goal).success).toBe(false)
  })
})
