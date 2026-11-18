// Shared fast-check generator for valid goal files (01.7-walking-skeleton task 3.4).
// Properties 2, 4, 5 and 7 draw their goals from here. Every generated file
// satisfies goalFileSchema's refinements: keys match the key pattern, the title
// field is a plain text property, `required` names existing properties, at most
// one property is an image, and name, description and labels fit their limits.
// Optional members are omitted rather than set to undefined, so a JSON round
// trip reproduces the value exactly.
import fc from 'fast-check'

import { type GoalFile } from './index'

type GoalProperty = GoalFile['schema']['properties'][string]
type PropertyKind = 'text' | 'long-text' | 'list' | 'image'

const keyArb = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,11}$/)

const labelArb = fc.string({ minLength: 1, maxLength: 100 })

// Each property gets a kind and an optional label. The title slot is forced to
// text afterwards, and extra image picks are demoted to text.
function propertyArb(kind: PropertyKind): fc.Arbitrary<GoalProperty> {
  return fc
    .record({ title: labelArb }, { requiredKeys: [] })
    .map((label): GoalProperty => {
      switch (kind) {
        case 'text':
          return { type: 'string', ...label }
        case 'long-text':
          return { type: 'string', format: 'long-text', ...label }
        case 'image':
          return { type: 'string', format: 'image', ...label }
        case 'list':
          return { type: 'array', items: { type: 'string' }, ...label }
      }
    })
}

const kindArb = fc.constantFrom<PropertyKind>('text', 'long-text', 'list', 'image')

const schemaArb = fc
  .uniqueArray(keyArb, { minLength: 1, maxLength: 6 })
  .chain((keys) =>
    fc.record({
      keys: fc.constant(keys),
      titleIndex: fc.nat({ max: keys.length - 1 }),
      kinds: fc.array(kindArb, { minLength: keys.length, maxLength: keys.length }),
      required: fc.shuffledSubarray(keys),
    }),
  )
  .chain(({ keys, titleIndex, kinds, required }) => {
    let imageSeen = false
    const resolved = keys.map((_key, index): PropertyKind => {
      if (index === titleIndex) return 'text'
      if (kinds[index] !== 'image') return kinds[index]!
      if (imageSeen) return 'text'
      imageSeen = true
      return 'image'
    })
    return fc.tuple(...resolved.map(propertyArb)).map((properties) => ({
      type: 'object' as const,
      titleField: keys[titleIndex]!,
      required,
      properties: Object.fromEntries(keys.map((key, index) => [key, properties[index]!])),
    }))
  })

export const goalFileArb: fc.Arbitrary<GoalFile> = fc
  .record(
    {
      name: fc.string({ minLength: 1, maxLength: 100 }),
      description: fc.string({ maxLength: 200 }),
      icon: fc.string({ minLength: 1, maxLength: 30 }),
      accentColor: fc.stringMatching(/^#[0-9a-fA-F]{6}$/),
      schema: schemaArb,
    },
    { requiredKeys: ['name', 'schema'] },
  )
  .map((goal): GoalFile => goal)
