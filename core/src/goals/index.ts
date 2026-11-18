// Goal file schema and item validation (01.7-walking-skeleton task 3.2,
// Requirements 1.3, 3.5, 5.1, 5.5). Pure and isomorphic: no Node imports, so
// web-kit and the MCP server can share it. The format is a strict subset of the
// goal-engine goal file, so goal-engine extends these files instead of replacing
// them. Nothing here ever puts an item value into an error: validation reports
// field keys only, because values come from user content or an LLM.
import { z } from 'zod'

export const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/

export type FieldKind = 'text' | 'long-text' | 'list' | 'image'

const labelSchema = z.string().min(1).max(100)

const stringPropertySchema = z.strictObject({
  type: z.literal('string'),
  format: z.enum(['long-text', 'image']).optional(),
  title: labelSchema.optional(),
})

const listPropertySchema = z.strictObject({
  type: z.literal('array'),
  items: z.strictObject({ type: z.literal('string') }),
  title: labelSchema.optional(),
})

const propertySchema = z.discriminatedUnion('type', [stringPropertySchema, listPropertySchema])

type GoalProperty = z.infer<typeof propertySchema>

function kindOf(property: GoalProperty): FieldKind {
  if (property.type === 'array') return 'list'
  if (property.format === 'image') return 'image'
  if (property.format === 'long-text') return 'long-text'
  return 'text'
}

export const goalFileSchema = z
  .strictObject({
    name: z.string().min(1).max(100),
    description: z.string().max(200).optional(),
    icon: z.string().min(1).optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #c2410c')
      .optional(),
    schema: z.strictObject({
      type: z.literal('object'),
      titleField: z.string(),
      required: z.array(z.string()),
      properties: z.record(z.string().regex(FIELD_KEY_PATTERN), propertySchema),
    }),
  })
  .superRefine((goal, ctx) => {
    const { titleField, required, properties } = goal.schema

    const title = properties[titleField]
    if (!title) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema', 'titleField'],
        message: 'titleField must name a property',
      })
    } else if (kindOf(title) !== 'text') {
      ctx.addIssue({
        code: 'custom',
        path: ['schema', 'titleField'],
        message: 'titleField must be a plain text property',
      })
    }

    required.forEach((key, index) => {
      if (!Object.hasOwn(properties, key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['schema', 'required', index],
          message: 'required must name properties that exist',
        })
      }
    })

    const imageKeys = Object.keys(properties).filter((key) => kindOf(properties[key]!) === 'image')
    if (imageKeys.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema', 'properties'],
        message: 'At most one image field is allowed',
      })
    }
  })

export type GoalFile = z.infer<typeof goalFileSchema>

export interface GoalField {
  key: string
  label: string
  kind: FieldKind
  required: boolean
  isTitle: boolean
}

// The title field always counts as required: an item without a title can't be
// listed or saved, whether or not the file repeats it under `required`.
export function goalFields(goal: GoalFile): GoalField[] {
  const { titleField, required, properties } = goal.schema
  return Object.entries(properties).map(([key, property]) => ({
    key,
    label: property.title ?? key,
    kind: kindOf(property),
    required: key === titleField || required.includes(key),
    isTitle: key === titleField,
  }))
}

function itemFieldSchema(field: GoalField): z.ZodType {
  let schema: z.ZodType
  switch (field.kind) {
    case 'list':
      schema = z.array(z.string())
      break
    case 'text':
    case 'long-text':
    case 'image':
      schema = field.required
        ? z.string().refine((value) => value.trim().length > 0)
        : z.string()
      break
  }
  return field.required ? schema : schema.optional()
}

function safeKey(key: string): string {
  return key.length <= 50 && FIELD_KEY_PATTERN.test(key) ? key : '(unknown field)'
}

export type ItemValidation =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; fields: string[] }

export function validateItem(goal: GoalFile, data: unknown): ItemValidation {
  const shape: Record<string, z.ZodType> = {}
  for (const field of goalFields(goal)) shape[field.key] = itemFieldSchema(field)

  const result = z.strictObject(shape).safeParse(data)
  if (result.success) return { ok: true, data: result.data }

  // Issue messages can echo values, so only paths and unknown key names are read.
  const fields = new Set<string>()
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields.add(safeKey(key))
    } else if (typeof issue.path[0] === 'string') {
      fields.add(issue.path[0])
    }
  }
  return { ok: false, fields: [...fields] }
}

export function failureReasonFor(fields: string[]): string {
  const base = "The capture doesn't fit this app."
  return fields.length === 0 ? base : `${base} Missing or invalid: ${fields.join(', ')}.`
}

// The image field is left out because the model can't produce a storage path;
// the compile handler sets it after validating the model's output.
export function llmJsonSchema(goal: GoalFile): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const field of goalFields(goal)) {
    if (field.kind === 'image') continue
    const base = field.kind === 'list' ? { type: 'array', items: { type: 'string' } } : { type: 'string' }
    properties[field.key] = field.label === field.key ? base : { ...base, title: field.label }
    if (field.required) required.push(field.key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

// Sorted keys and no whitespace, so equal content always hashes the same
// (goal registration compares content hashes). Follows JSON.stringify for
// undefined, functions, non-finite numbers and toJSON.
export function canonicalJson(value: unknown): string {
  return canonicalize(value) ?? 'null'
}

function canonicalize(input: unknown): string | undefined {
  let value = input
  if (value !== null && typeof value === 'object' && 'toJSON' in value) {
    const toJSON = (value as { toJSON: unknown }).toJSON
    if (typeof toJSON === 'function') value = toJSON.call(value)
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item) ?? 'null').join(',')}]`
  }
  const record = value as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(record).sort()) {
    const serialized = canonicalize(record[key])
    if (serialized !== undefined) parts.push(`${JSON.stringify(key)}:${serialized}`)
  }
  return `{${parts.join(',')}}`
}
