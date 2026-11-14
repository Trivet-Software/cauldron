// Deterministic request keys for the mock and recording providers
// (01.5-backend-foundation Requirement 7.3, capture-compile Requirement 16.2).
// Web Crypto only, so this file stays isomorphic.

export type RequestKind = 'complete' | 'embed'

const encoder = new TextEncoder()

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view: subtle.digest rejects
  // SharedArrayBuffer-backed views, and the copy satisfies BufferSource typing.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Values that carry no request semantics and are dropped from the key.
function isDropped(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === 'function' ||
    (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal)
  )
}

/**
 * Canonical form of a request: object keys sorted, `undefined`, functions and
 * `AbortSignal`s dropped, and byte arrays replaced by `{ $sha256 }` so the key
 * depends on image content without serializing the image.
 */
export async function canonicalize(value: unknown): Promise<unknown> {
  if (value instanceof Uint8Array) return { $sha256: await sha256Hex(value) }
  if (Array.isArray(value)) {
    // JSON turns dropped array entries into null; mirror that so arrays keep
    // their positions.
    return Promise.all(
      value.map((v) => (isDropped(v) ? null : canonicalize(v))),
    )
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = value[key]
      if (isDropped(v)) continue
      out[key] = await canonicalize(v)
    }
    return out
  }
  return value
}

/** SHA-256 (hex) over the canonical JSON of `{ kind, request }`. */
export async function requestKey(
  kind: RequestKind,
  req: unknown,
): Promise<string> {
  const canonical = await canonicalize({ kind, request: req })
  return sha256Hex(encoder.encode(JSON.stringify(canonical)))
}
