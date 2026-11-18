// Unit tests for the image mapper and capture labels (01.7-walking-skeleton task 3.11,
// Requirement 3.3).
import { describe, expect, it } from 'vitest'

import { type GoalFile, goalFileSchema } from '../goals'

import { captureLabel } from './capture'
import { mapImage } from './mapper'

function goalWith(properties: Record<string, unknown>, titleField = 'title'): GoalFile {
  return goalFileSchema.parse({
    name: 'Test',
    schema: { type: 'object', titleField, required: [titleField], properties },
  })
}

const withImage = goalWith({
  title: { type: 'string' },
  photo: { type: 'string', format: 'image' },
})
const withoutImage = goalWith({ title: { type: 'string' }, notes: { type: 'string', format: 'long-text' } })

const STORAGE_PATH = 'tenant-1/source-1/0/pie.jpg'

describe('mapImage', () => {
  it('titles the item from the filename without its extension and links the stored image', () => {
    expect(mapImage(withImage, { filename: 'apple-pie.jpg', storagePath: STORAGE_PATH })).toEqual({
      title: 'apple-pie',
      photo: STORAGE_PATH,
    })
  })

  it('removes only the last extension', () => {
    const result = mapImage(withImage, { filename: 'scan.v2.final.png', storagePath: STORAGE_PATH })
    expect(result.title).toBe('scan.v2.final')
  })

  it('keeps a filename that has no extension', () => {
    const result = mapImage(withImage, { filename: 'Grandma pie', storagePath: STORAGE_PATH })
    expect(result.title).toBe('Grandma pie')
  })

  it('trims whitespace around the title', () => {
    const result = mapImage(withImage, { filename: '  pie .jpg ', storagePath: STORAGE_PATH })
    expect(result.title).toBe('pie')
  })

  it('uses "Untitled photo" when there is no filename', () => {
    expect(mapImage(withImage, { storagePath: STORAGE_PATH })).toEqual({
      title: 'Untitled photo',
      photo: STORAGE_PATH,
    })
  })

  it('uses "Untitled photo" when the filename is blank', () => {
    const result = mapImage(withImage, { filename: '   ', storagePath: STORAGE_PATH })
    expect(result.title).toBe('Untitled photo')
  })

  it('writes the title to whichever field the goal marks as its title', () => {
    const goal = goalWith({ name: { type: 'string' }, photo: { type: 'string', format: 'image' } }, 'name')
    expect(mapImage(goal, { filename: 'soup.webp', storagePath: STORAGE_PATH })).toEqual({
      name: 'soup',
      photo: STORAGE_PATH,
    })
  })

  it('saves the title without a link when the goal has no image field', () => {
    expect(mapImage(withoutImage, { filename: 'pie.png', storagePath: STORAGE_PATH })).toEqual({
      title: 'pie',
    })
  })
})

describe('captureLabel', () => {
  it('uses the first non-empty line of the text', () => {
    expect(captureLabel({ text: '\n  \n  Pancakes  \n- flour' })).toBe('Pancakes')
  })

  it('keeps a line of exactly 80 characters', () => {
    const line = 'a'.repeat(80)
    expect(captureLabel({ text: line })).toBe(line)
  })

  it('cuts a longer line to 80 characters', () => {
    expect(captureLabel({ text: 'a'.repeat(81) })).toBe('a'.repeat(80))
    expect(captureLabel({ text: 'b'.repeat(500) })).toHaveLength(80)
  })

  it('drops trailing whitespace left by the cut', () => {
    const label = captureLabel({ text: `${'a'.repeat(79)} ${'b'.repeat(20)}` })
    expect(label).toBe('a'.repeat(79))
  })

  it('does not split a surrogate pair at the cut', () => {
    const label = captureLabel({ text: `${'a'.repeat(79)}😀😀` })
    expect(label).toBe(`${'a'.repeat(79)}😀`)
  })

  it('falls back to the filename when the text has no non-empty line', () => {
    expect(captureLabel({ text: ' \n\t\n', filename: 'photo.jpg' })).toBe('photo.jpg')
  })

  it('uses the filename for an image capture and cuts it to 80 characters', () => {
    expect(captureLabel({ filename: ' pie.jpg ' })).toBe('pie.jpg')
    expect(captureLabel({ filename: `${'f'.repeat(200)}.jpg` })).toBe('f'.repeat(80))
  })

  it('prefers the text over the filename', () => {
    expect(captureLabel({ text: 'Soup', filename: 'photo.jpg' })).toBe('Soup')
  })

  it('returns "Untitled capture" when there is no usable text or filename', () => {
    expect(captureLabel({})).toBe('Untitled capture')
    expect(captureLabel({ text: '' })).toBe('Untitled capture')
    expect(captureLabel({ text: '  \n ', filename: '   ' })).toBe('Untitled capture')
  })
})
