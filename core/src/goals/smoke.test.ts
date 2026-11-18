// Basic sanity checks for the goals module (01.7-walking-skeleton task 3.2).
// The dedicated property and parsing tests are tasks 3.3 to 3.7.
import { describe, expect, it } from 'vitest'

import {
  canonicalJson,
  failureReasonFor,
  goalFields,
  goalFileSchema,
  llmJsonSchema,
  validateItem,
} from './index'

const goal = goalFileSchema.parse({
  name: 'Recipe Box',
  description: 'Save recipes.',
  schema: {
    type: 'object',
    titleField: 'title',
    required: ['title'],
    properties: {
      title: { type: 'string', title: 'Title' },
      ingredients: { type: 'array', items: { type: 'string' } },
      image: { type: 'string', format: 'image' },
    },
  },
})

describe('goals', () => {
  it('lists fields in property order', () => {
    expect(goalFields(goal).map((f) => [f.key, f.kind, f.required])).toEqual([
      ['title', 'text', true],
      ['ingredients', 'list', false],
      ['image', 'image', false],
    ])
  })

  it('rejects an unknown key, a non-text title field and two image fields', () => {
    const base = structuredClone(goal)
    expect(goalFileSchema.safeParse({ ...base, extra: 1 }).success).toBe(false)
    expect(
      goalFileSchema.safeParse({ ...base, schema: { ...base.schema, titleField: 'ingredients' } }).success,
    ).toBe(false)
    expect(
      goalFileSchema.safeParse({
        ...base,
        schema: {
          ...base.schema,
          properties: { ...base.schema.properties, photo: { type: 'string', format: 'image' } },
        },
      }).success,
    ).toBe(false)
  })

  it('reports field keys and never values', () => {
    const result = validateItem(goal, { title: '   ', ingredients: 'secret-value' })
    expect(result).toEqual({ ok: false, fields: ['title', 'ingredients'] })
    expect(failureReasonFor(['title'])).toBe(
      "The capture doesn't fit this app. Missing or invalid: title.",
    )
    expect(validateItem(goal, { title: 'Soup' })).toEqual({ ok: true, data: { title: 'Soup' } })
  })

  it('leaves the image field out of the LLM schema', () => {
    const schema = llmJsonSchema(goal) as { properties: Record<string, unknown>; additionalProperties: boolean }
    expect(Object.keys(schema.properties)).toEqual(['title', 'ingredients'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('serializes with sorted keys and no whitespace', () => {
    expect(canonicalJson({ b: [1, { z: 1, a: undefined, y: 2 }], a: 'x' })).toBe(
      '{"a":"x","b":[1,{"y":2,"z":1}]}',
    )
  })
})
