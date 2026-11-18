// API client and goal resolution for the MCP server (01.7-walking-skeleton task 9.1,
// Requirements 9.4 and 9.8). Everything here talks to `/v1` only.
//
// stdout belongs to the MCP protocol, so nothing in this module writes to it.
// The bearer token is attached inside `createApiClient` and nowhere else. No error
// path formats the request, its headers or the underlying fetch error, so the token
// cannot reach a tool result.

/**
 * An error that is safe to show to the model as a tool error. `message` reads
 * `[code] text`, so a thrown instance renders the same way wherever the SDK
 * turns it into an `isError` result. `detail` is the text without the code.
 */
export class ApiToolError extends Error {
  readonly detail: string

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`)
    this.name = 'ApiToolError'
    this.detail = message
  }
}

export interface ApiClient {
  get<T>(path: string, query?: Record<string, string>, signal?: AbortSignal): Promise<T>
  postForm<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T>
}

export interface ApiClientOptions {
  baseUrl: string
  token: string
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch
}

interface EnvelopeBody {
  error: { code: string; message: string }
}

function isEnvelope(body: unknown): body is EnvelopeBody {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false
  const error = (body as { error: unknown }).error
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return typeof code === 'string' && typeof message === 'string'
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const doFetch = opts.fetch ?? fetch

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    init: { query?: Record<string, string>; body?: FormData; signal?: AbortSignal },
  ): Promise<T> {
    const search = init.query ? new URLSearchParams(init.query).toString() : ''
    const url = `${baseUrl}${path}${search ? `?${search}` : ''}`

    let response: Response
    try {
      response = await doFetch(url, {
        method,
        headers: { Authorization: `Bearer ${opts.token}`, Accept: 'application/json' },
        body: init.body,
        signal: init.signal,
      })
    } catch {
      // The caught error is dropped on purpose: it can carry request details.
      if (init.signal?.aborted) throw new ApiToolError('cancelled', 'The request was cancelled.')
      throw new ApiToolError('unreachable', `Could not reach the API at ${baseUrl}.`)
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }

    if (!response.ok) {
      if (isEnvelope(body)) throw new ApiToolError(body.error.code, body.error.message)
      throw new ApiToolError('http_error', `Request failed (${response.status}).`)
    }
    if (body === undefined) {
      throw new ApiToolError('bad_response', 'The API returned a response that is not JSON.')
    }
    return body as T
  }

  return {
    get: (path, query, signal) => request('GET', path, { query, signal }),
    // No Content-Type header: fetch sets multipart/form-data with its boundary.
    postForm: (path, form, signal) => request('POST', path, { body: form, signal }),
  }
}

export interface GoalRef {
  slug: string
  name: string
}

/**
 * Finds a goal by exact slug, else exact name, both case-insensitive
 * (Requirement 9.4). No match throws an error listing every available goal.
 */
export function resolveGoal<G extends GoalRef>(goals: readonly G[], text: string): G {
  const wanted = text.toLowerCase()
  const match =
    goals.find((g) => g.slug.toLowerCase() === wanted) ??
    goals.find((g) => g.name.toLowerCase() === wanted)
  if (match) return match

  const available =
    goals.length > 0 ? goals.map((g) => `${g.slug} (${g.name})`).join(', ') : 'none'
  throw new ApiToolError('not_found', `No goal matches "${text}". Available goals: ${available}.`)
}
