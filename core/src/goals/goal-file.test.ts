// Property test for the goal file round trip (01.7-walking-skeleton task 3.4).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { goalFileArb } from './goal-file.arb'
import { goalFields, goalFileSchema } from './index'

describe('goal file', () => {
  // Feature: 01.7-walking-skeleton, Property 2: Goal file round trip
  // **Validates: Requirements 1.3, 1.4**
  it('survives JSON serialization and lists one field per property', () => {
    fc.assert(
      fc.property(goalFileArb, (goal) => {
        const parsed = goalFileSchema.parse(JSON.parse(JSON.stringify(goal)))
        expect(parsed).toEqual(goal)

        const fields = goalFields(parsed)
        expect(fields.map((field) => field.key)).toEqual(Object.keys(goal.schema.properties))
        const titles = fields.filter((field) => field.isTitle)
        expect(titles).toHaveLength(1)
        expect(titles[0]!.key).toBe(goal.schema.titleField)
        expect(titles[0]!.kind).toBe('text')
      }),
      { numRuns: 100 },
    )
  })

  it('generates between 1 and 6 properties with at most one image field', () => {
    fc.assert(
      fc.property(goalFileArb, (goal) => {
        const properties = Object.values(goal.schema.properties)
        expect(properties.length).toBeGreaterThanOrEqual(1)
        expect(properties.length).toBeLessThanOrEqual(6)
        expect(
          properties.filter((p) => p.type === 'string' && p.format === 'image').length,
        ).toBeLessThanOrEqual(1)
      }),
      { numRuns: 100 },
    )
  })
})
