// Property test for item validation (01.7-walking-skeleton task 3.5).
// The oracle below restates the validity rule from the design on its own, so it
// doesn't share code with validateItem. Goals come from the shared goalFileArb.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { goalFileArb } from './goal-file.arb'
import { FIELD_KEY_PATTERN, type GoalFile, failureReasonFor, validateItem } from './index'

// Appears only inside item values, never in keys or labels. If it shows up in
// validateItem's failure output or in the failure reason, a value leaked.
const SECRET = 'SECRET_VALUE_7f3a91'
const REASON_PREFIX = "The capture doesn't fit this app. Missing or invalid: "
const UNKNOWN_FIELD = '(unknown field)'

const ABSENT = Symbol('absent')

type Kind = 'text' | 'long-text' | 'list' | 'image'

function kindOf(property: GoalFile['schema']['properties'][string]): Kind {
  if (property.type === 'array') return 'list'
  return property.format ?? 'text'
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

// Keys of the schema whose value in `data` is missing or has the wrong shape.
function expectedBadKeys(goal: GoalFile, data: Record<string, unknown>): string[] {
  const { titleField, required, properties } = goal.schema
  const bad: string[] = []
  for (const [key, property] of Object.entries(properties)) {
    const isRequired = key === titleField || required.includes(key)
    if (!Object.hasOwn(data, key)) {
      if (isRequired) bad.push(key)
      continue
    }
    const value = data[key]
    if (kindOf(property) === 'list') {
      if (!isStringArray(value)) bad.push(key)
    } else if (typeof value !== 'string' || (isRequired && value.trim().length === 0)) {
      bad.push(key)
    }
  }
  return bad
}

const anyValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.constant(''),
  fc.constant('   '),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(SECRET),
  fc.constant([SECRET]),
  fc.constant([SECRET, 1]),
  fc.constant({ nested: SECRET }),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.array(fc.oneof(fc.string(), fc.integer()), { maxLength: 3 }),
)

function validValueArb(kind: Kind): fc.Arbitrary<unknown> {
  return kind === 'list'
    ? fc.array(fc.string(), { maxLength: 4 })
    : fc.stringMatching(/^[A-Za-z0-9]{1,10}$/)
}

// One entry per schema key: absent, a value of the right kind, or anything at all.
function candidateArb(goal: GoalFile): fc.Arbitrary<Record<string, unknown>> {
  const entries = Object.entries(goal.schema.properties).map(([key, property]) =>
    fc
      .oneof(
        { weight: 2, arbitrary: fc.constant<unknown>(ABSENT) },
        { weight: 5, arbitrary: validValueArb(kindOf(property)) },
        { weight: 3, arbitrary: anyValueArb },
      )
      .map((value) => [key, value] as const),
  )
  return fc
    .tuple(...entries)
    .map((pairs) => Object.fromEntries(pairs.filter(([, value]) => value !== ABSENT)))
}

const goalAndCandidateArb = goalFileArb.chain((goal) =>
  fc.record({ goal: fc.constant(goal), data: candidateArb(goal) }),
)

function reasonKeys(reason: string): string[] {
  expect(reason.startsWith(REASON_PREFIX)).toBe(true)
  expect(reason.endsWith('.')).toBe(true)
  return reason.slice(REASON_PREFIX.length, -1).split(', ')
}

describe('validateItem', () => {
  // Feature: 01.7-walking-skeleton, Property 5: Item validation accepts exactly the schema and reports only field keys
  // **Validates: Requirements 3.5**
  it('accepts exactly the data that fits the schema and reports only schema keys', () => {
    fc.assert(
      fc.property(goalAndCandidateArb, ({ goal, data }) => {
        const result = validateItem(goal, data)
        const bad = expectedBadKeys(goal, data)

        expect(result.ok).toBe(bad.length === 0)
        if (result.ok) {
          expect(result.data).toEqual(data)
          return
        }

        const schemaKeys = Object.keys(goal.schema.properties)
        expect(result.fields.length).toBeGreaterThan(0)
        expect(result.fields.every((field) => schemaKeys.includes(field))).toBe(true)
        expect([...result.fields].sort()).toEqual([...bad].sort())

        // The reason is fixed wording plus exactly those keys.
        const reason = failureReasonFor(result.fields)
        expect(reasonKeys(reason)).toEqual(result.fields)
      }),
      { numRuns: 100 },
    )
  })

  // Feature: 01.7-walking-skeleton, Property 5: Item validation accepts exactly the schema and reports only field keys
  // **Validates: Requirements 3.5**
  it('rejects keys outside the schema and names them only as plain keys', () => {
    const extraKeyArb = fc
      .oneof(fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,11}$/), fc.string({ minLength: 1, maxLength: 80 }))
      .filter((key) => key !== '__proto__')

    fc.assert(
      fc.property(
        goalAndCandidateArb,
        fc.uniqueArray(extraKeyArb, { minLength: 1, maxLength: 3 }),
        ({ goal, data }, extraKeys) => {
          const schemaKeys = Object.keys(goal.schema.properties)
          const extras = extraKeys.filter((key) => !schemaKeys.includes(key))
          fc.pre(extras.length > 0)

          const withExtras = { ...data }
          for (const key of extras) withExtras[key] = SECRET

          const result = validateItem(goal, withExtras)
          expect(result.ok).toBe(false)
          if (result.ok) return

          // An unknown key is reported by name only when it looks like a field key.
          const isPlainKey = (key: string) => key.length <= 50 && FIELD_KEY_PATTERN.test(key)
          const allowed = new Set([
            ...schemaKeys,
            ...extras.filter(isPlainKey),
            ...(extras.some((key) => !isPlainKey(key)) ? [UNKNOWN_FIELD] : []),
          ])
          expect(result.fields.every((field) => allowed.has(field))).toBe(true)
          for (const key of expectedBadKeys(goal, data)) expect(result.fields).toContain(key)
          for (const key of extras.filter(isPlainKey)) expect(result.fields).toContain(key)
        },
      ),
      { numRuns: 100 },
    )
  })

  // Feature: 01.7-walking-skeleton, Property 5: Item validation accepts exactly the schema and reports only field keys
  // **Validates: Requirements 3.5**
  it('never puts a field value into the failure output', () => {
    fc.assert(
      fc.property(goalAndCandidateArb, ({ goal, data }) => {
        const result = validateItem(goal, { ...data, unexpected: SECRET })
        expect(result.ok).toBe(false)
        if (result.ok) return

        expect(JSON.stringify(result)).not.toContain(SECRET)
        expect(failureReasonFor(result.fields)).not.toContain(SECRET)
      }),
      { numRuns: 100 },
    )
  })

  it('rejects data that is not an object, and leaks nothing', () => {
    fc.assert(
      fc.property(
        goalFileArb,
        fc.constantFrom<unknown>(null, undefined, SECRET, 42, [SECRET], [{ title: SECRET }]),
        (goal, data) => {
          const result = validateItem(goal, data)
          expect(result.ok).toBe(false)
          expect(JSON.stringify(result)).not.toContain(SECRET)
        },
      ),
      { numRuns: 100 },
    )
  })
})
