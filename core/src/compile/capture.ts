// Capture limits, image type sniffing and capture labels (01.7-walking-skeleton task 3.8,
// Requirements 2.3, 9.6). Pure and isomorphic: bytes are Uint8Array, never Buffer, so the
// API, the MCP server and web-kit share one set of limits and cannot drift.

export const CAPTURE_LIMITS = {
  maxTextChars: 100_000,
  maxImageBytes: 10 * 1024 * 1024,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
}

export type ImageType = (typeof CAPTURE_LIMITS.imageTypes)[number]

const MAX_LABEL_CHARS = 80

function startsWith(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

// The declared content type is not trusted; the leading bytes decide.
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  // WebP is a RIFF container: "RIFF", a 4-byte size, then "WEBP".
  if (startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp'
  }
  return null
}

export function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

// Cuts by code point so a surrogate pair is never split.
function truncate(value: string, max: number): string {
  const points = Array.from(value)
  return points.length <= max ? value : points.slice(0, max).join('').trimEnd()
}

/** A short name for a capture before it compiles: first text line, else the filename. */
export function captureLabel(input: { text?: string; filename?: string }): string {
  const line = input.text === undefined ? null : firstNonEmptyLine(input.text)
  if (line !== null) return truncate(line, MAX_LABEL_CHARS)
  const filename = input.filename?.trim()
  if (filename) return truncate(filename, MAX_LABEL_CHARS)
  return 'Untitled capture'
}
