import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { ApiToolError, resolveGoal, type GoalRef } from './api'

// Slugs are folder names; names are free text. Both are kept to ASCII so "upper/lower-case
// variant" has one meaning (non-ASCII case mapping is not one-to-one, e.g. 'ß' -> 'SS').
const slugArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,11}$/)
const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,19}$/)

// Resolution lets a slug match win over a name match, so a goal list in which one goal's
// name equals another's slug (ignoring case) is ambiguous by design. The property is stated
// for lists whose slugs and names are all distinct from one another, ignoring case.
const goalsArb = fc
  .array(fc.record({ slug: slugArb, name: nameArb }), { minLength: 1, maxLength: 6 })
  .filter((goals) => {
    const identifiers = goals.flatMap((g) => [g.slug.toLowerCase(), g.name.toLowerCase()])
    return new Set(identifiers).size === identifiers.length
  })

const caseMaskArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 24 })

function applyCaseMask(text: string, mask: boolean[]): string {
  return [...text]
    .map((ch, i) => (mask[i % mask.length] ? ch.toUpperCase() : ch.toLowerCase()))
    .join('')
}

function resolutionError(goals: GoalRef[], text: string): unknown {
  try {
    resolveGoal(goals, text)
  } catch (error) {
    return error
  }
  return undefined
}

describe('resolveGoal', () => {
  it('returns the goal for its slug or name in any letter case', () => {
    // Feature: 01.7-walking-skeleton, Property 10: Goal resolution by slug or name
    // **Validates: Requirements 9.4**
    fc.assert(
      fc.property(
        goalsArb,
        fc.nat(),
        fc.constantFrom('slug', 'name'),
        caseMaskArb,
        (goals, index, field, mask) => {
          const goal = goals[index % goals.length]
          expect(resolveGoal(goals, goal[field])).toBe(goal)
          expect(resolveGoal(goals, applyCaseMask(goal[field], mask))).toBe(goal)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('throws an error listing every available slug when nothing matches', () => {
    // Feature: 01.7-walking-skeleton, Property 10: Goal resolution by slug or name
    // **Validates: Requirements 9.4**
    fc.assert(
      fc.property(
        goalsArb,
        fc.string({ maxLength: 30 }),
        (goals, text) => {
          fc.pre(
            goals.every(
              (g) =>
                g.slug.toLowerCase() !== text.toLowerCase() &&
                g.name.toLowerCase() !== text.toLowerCase(),
            ),
          )
          const error = resolutionError(goals, text)
          expect(error).toBeInstanceOf(ApiToolError)
          for (const goal of goals) {
            expect((error as ApiToolError).message).toContain(goal.slug)
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('reports that no goals are available for an empty list', () => {
    const error = resolutionError([], 'recipe-box')
    expect(error).toBeInstanceOf(ApiToolError)
    expect((error as ApiToolError).message).toContain('none')
  })
})
