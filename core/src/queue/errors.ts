/**
 * Thrown by a handler when retrying can't help (capture-compile Requirement 4.5). The job
 * goes straight to `failed` with `reason` as its `failure_reason`, so the reason must be
 * readable by the end user and must not carry internal details.
 */
export class NonRetryableError extends Error {
  readonly reason: string

  constructor(reason: string, options?: { cause?: unknown }) {
    super(reason, { cause: options?.cause })
    this.name = 'NonRetryableError'
    this.reason = reason
  }
}
