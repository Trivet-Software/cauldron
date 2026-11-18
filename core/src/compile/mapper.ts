// Deterministic mapper from a source to item fields, no LLM (01.7-walking-skeleton task 3.8,
// Requirements 3.2, 3.3). Pure and isomorphic. The result is not validated here: the compile
// handler runs validateItem on it, so a text with no title fails on `title`.
import { type GoalField, type GoalFile, goalFields } from '../goals'

import { firstNonEmptyLine } from './capture'

// The item must start with a non-space character: a marker followed only by whitespace is not
// a bullet and stays in the remainder, so no empty list item appears and no line is lost.
const BULLET = /^\s*[-*]\s+(\S.*)$/

function firstOfKind(fields: GoalField[], kind: GoalField['kind']): GoalField | undefined {
  return fields.find((field) => field.kind === kind)
}

export function mapText(goal: GoalFile, text: string): Record<string, unknown> {
  const fields = goalFields(goal)
  const titleField = fields.find((field) => field.isTitle)
  const listField = firstOfKind(fields, 'list')
  const longTextField = firstOfKind(fields, 'long-text')

  const lines = text.split(/\r?\n/)
  const titleLine = firstNonEmptyLine(text)
  const titleIndex = lines.findIndex((line) => line.trim().length > 0)

  const result: Record<string, unknown> = {}
  if (titleField && titleLine !== null) result[titleField.key] = titleLine

  const bullets: string[] = []
  const remainder: string[] = []
  for (const line of titleIndex === -1 ? [] : lines.slice(titleIndex + 1)) {
    const bullet = listField ? BULLET.exec(line) : null
    if (bullet) bullets.push(bullet[1]!.trim())
    else remainder.push(line)
  }

  if (listField && bullets.length > 0) result[listField.key] = bullets
  const rest = remainder.join('\n').trim()
  if (longTextField && rest.length > 0) result[longTextField.key] = rest
  return result
}

function titleFromFilename(filename: string | undefined): string {
  const name = filename?.trim() ?? ''
  const dot = name.lastIndexOf('.')
  const base = (dot > 0 ? name.slice(0, dot) : name).trim()
  return base.length > 0 ? base : 'Untitled photo'
}

// A goal without an image field saves the item without a link: there is nowhere to put it.
export function mapImage(
  goal: GoalFile,
  input: { filename?: string; storagePath: string },
): Record<string, unknown> {
  const fields = goalFields(goal)
  const titleField = fields.find((field) => field.isTitle)
  const imageField = firstOfKind(fields, 'image')

  const result: Record<string, unknown> = {}
  if (titleField) result[titleField.key] = titleFromFilename(input.filename)
  if (imageField) result[imageField.key] = input.storagePath
  return result
}
