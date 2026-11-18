// Property test for the text mapper (01.7-walking-skeleton task 3.10).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { goalFields } from '../goals'
import { goalFileArb } from '../goals/goal-file.arb'

import { mapText } from './mapper'

// Lines are built from fragments weighted toward what the mapper cares about: bullet
// markers, blank and whitespace-only lines, and padding around content.
const fragmentArb = fc.constantFrom('-', '*', ' ', '  ', '\t', '\u00a0', 'a', 'Zed', 'x y', '1.', '-a', '- ')
const lineArb = fc.array(fragmentArb, { maxLength: 6 }).map((parts) => parts.join(''))
const textArb = fc
  .tuple(
    fc.array(lineArb, { maxLength: 12 }),
    fc.array(fc.constantFrom('\n', '\r\n'), { minLength: 12, maxLength: 12 }),
  )
  .map(([lines, separators]) => lines.map((line, i) => (i === 0 ? line : separators[i]! + line)).join(''))

describe('mapText', () => {
  // Feature: 01.7-walking-skeleton, Property 4: Text mapper keeps every line and the title rule
  // **Validates: Requirements 3.2**
  it('keeps every later line in the list or long-text field and sets the title from the first line', () => {
    fc.assert(
      fc.property(goalFileArb, textArb, (goal, text) => {
        const fields = goalFields(goal)
        const titleField = fields.find((field) => field.isTitle)!
        const listField = fields.find((field) => field.kind === 'list')
        const longTextField = fields.find((field) => field.kind === 'long-text')

        const trimmed = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
        const [title, ...later] = trimmed

        const result = mapText(goal, text)

        // Title rule.
        if (title === undefined) expect(result).not.toHaveProperty(titleField.key)
        else expect(result[titleField.key]).toBe(title)

        // Every later line lands in exactly one place, bullets in the list field in source order.
        const isBullet = (line: string) => listField !== undefined && /^[-*]\s+\S/.test(line)
        const expectedItems = later.filter(isBullet).map((line) => line.slice(1).trim())
        const expectedRest = later.filter((line) => !isBullet(line))

        if (listField && expectedItems.length > 0) expect(result[listField.key]).toEqual(expectedItems)
        else if (listField) expect(result).not.toHaveProperty(listField.key)

        if (longTextField && expectedRest.length > 0) {
          const kept = (result[longTextField.key] as string)
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
          expect(kept).toEqual(expectedRest)
        } else if (longTextField) {
          expect(result).not.toHaveProperty(longTextField.key)
        }

        // Nothing else is written, and the same input maps to the same output.
        const written = [titleField.key, listField?.key, longTextField?.key]
        expect(Object.keys(result).filter((key) => !written.includes(key))).toEqual([])
        expect(mapText(goal, text)).toEqual(result)
      }),
      { numRuns: 100 },
    )
  })
})
