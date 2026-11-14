// Pure helpers for raw-source storage paths and signed-URL expiry
// (01.5-backend-foundation Requirements 5.2, 5.3; design: "Raw-Source Storage").
// No I/O here, so task 3.4 can unit-test every rule directly.

/** The private bucket created by migration 20261102000500_storage.sql. */
export const SOURCES_BUCKET = 'sources'

/** Signed read URLs never outlive 10 minutes (Requirement 5.3). */
export const MAX_SIGNED_URL_SECONDS = 600
export const MIN_SIGNED_URL_SECONDS = 1
export const DEFAULT_SIGNED_URL_SECONDS = 300

/** Longest sanitized filename, before the `{index}-` prefix is added. */
export const MAX_FILENAME_LENGTH = 100

/** Used when sanitizing leaves nothing (e.g. a name made only of emoji). */
export const FALLBACK_FILENAME = 'file'

// Tenant IDs (`user_…`, `system`) and source IDs (UUIDs) need no dots, so a
// segment can never be `.` or `..`. 128 characters is far above either format.
const ID_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/
const FILENAME_CHARS = /^[A-Za-z0-9._-]+$/
const DISALLOWED_FILENAME_CHARS = /[^A-Za-z0-9._-]+/g
// `{index}-{safeFilename}`: a non-negative integer without leading zeros.
const OBJECT_SEGMENT = new RegExp(
  `^(0|[1-9][0-9]{0,8})-[A-Za-z0-9._-]{1,${MAX_FILENAME_LENGTH}}$`,
)

/** A path or path part that would escape its tenant prefix or is malformed. */
export class StoragePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoragePathError'
  }
}

/**
 * Reduces a client-supplied filename to `[A-Za-z0-9._-]`, at most 100
 * characters. Runs of other characters (including `/`, `\`, `%`, spaces and
 * non-ASCII) become a single `_`. Names that end up empty or made only of dots
 * fall back to `file`, so the result is never `.` or `..`.
 */
export function sanitizeFilename(filename: string): string {
  // Keep only the last path component a client might have sent ("C:\x\a.pdf").
  const base = filename.split(/[/\\]/).pop() ?? ''
  const replaced = base.normalize('NFKC').replace(DISALLOWED_FILENAME_CHARS, '_')
  // Trim from the front so the extension survives truncation.
  const trimmed =
    replaced.length > MAX_FILENAME_LENGTH
      ? replaced.slice(replaced.length - MAX_FILENAME_LENGTH)
      : replaced
  return /^[._]*$/.test(trimmed) ? FALLBACK_FILENAME : trimmed
}

function assertIdSegment(label: string, value: string): void {
  if (!ID_SEGMENT.test(value)) {
    throw new StoragePathError(`Invalid ${label} for a storage path.`)
  }
}

function assertIndex(index: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > 999_999_999) {
    throw new StoragePathError('Invalid source index for a storage path.')
  }
}

/** Validates a tenant ID as the first path segment. Throws `StoragePathError`. */
export function assertTenantId(tenantId: string): void {
  assertIdSegment('tenant ID', tenantId)
}

/**
 * Builds `{tenantId}/{sourceId}/{index}-{safeFilename}` (Requirement 5.2).
 * The filename is sanitized; the IDs and index are validated, never rewritten,
 * because silently changing them would point at a different object.
 */
export function sourceObjectPath(
  tenantId: string,
  sourceId: string,
  index: number,
  filename: string,
): string {
  assertIdSegment('tenant ID', tenantId)
  assertIdSegment('source ID', sourceId)
  assertIndex(index)
  return `${tenantId}/${sourceId}/${index}-${sanitizeFilename(filename)}`
}

/**
 * Checks that `path` is exactly the shape `sourceObjectPath` produces and that
 * its first segment is `tenantId`. Rejects traversal (`..`), absolute paths,
 * empty segments, backslashes and percent-encoded separators, because every
 * character outside `[A-Za-z0-9._-]` and the two `/` separators is refused.
 * Returns the path unchanged so callers can use it inline.
 */
export function assertTenantPath(path: string, tenantId: string): string {
  assertIdSegment('tenant ID', tenantId)
  const segments = path.split('/')
  if (segments.length !== 3) {
    throw new StoragePathError('Storage path must have the form tenant/source/file.')
  }
  const [tenant, source, object] = segments as [string, string, string]
  if (!ID_SEGMENT.test(tenant) || !ID_SEGMENT.test(source)) {
    throw new StoragePathError('Storage path has an invalid segment.')
  }
  if (!OBJECT_SEGMENT.test(object) || !FILENAME_CHARS.test(object)) {
    throw new StoragePathError('Storage path has an invalid file name.')
  }
  if (tenant !== tenantId) {
    throw new StoragePathError('Storage path is outside the tenant prefix.')
  }
  return path
}

/**
 * Clamps a requested signed-URL lifetime to whole seconds in [1, 600].
 * `undefined` and `NaN` give the 300 s default (Requirement 5.3).
 */
export function clampSignedUrlExpiry(expiresInSeconds?: number): number {
  if (expiresInSeconds === undefined || Number.isNaN(expiresInSeconds)) {
    return DEFAULT_SIGNED_URL_SECONDS
  }
  const whole = Math.floor(expiresInSeconds)
  return Math.min(MAX_SIGNED_URL_SECONDS, Math.max(MIN_SIGNED_URL_SECONDS, whole))
}
