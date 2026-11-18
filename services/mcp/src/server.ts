// The Cauldron MCP server (01.7-walking-skeleton task 9.3, Requirements 9.1 to 9.8).
// It calls only the `/v1` API through `createApiClient`; the bearer token lives inside
// that client and is never formatted into a tool result or error.
//
// stdout belongs to the protocol, so nothing here writes to it. Tool failures are thrown
// as `ApiToolError`, which the SDK renders as an `isError` result reading `[code] message`.
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { CAPTURE_LIMITS, sniffImageType } from '@cauldron/core/compile'
import { McpServer, ResourceNotFoundError } from '@modelcontextprotocol/server'
import { z } from 'zod'

import { ApiToolError, createApiClient, resolveGoal, type ApiClient } from './api'

export const EXAMPLE_GOAL_SLUG = 'recipe-box'
export const EXAMPLE_GOAL_URI = `examples://goals/${EXAMPLE_GOAL_SLUG}`

export interface ServerDeps {
  /** `API_BASE_URL`. */
  baseUrl: string
  /** `DEV_API_TOKEN`. Handed to the API client and nowhere else. */
  token: string
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /**
   * Source of the `examples://goals/recipe-box` content: the goal file itself. Defaults to
   * the `spec` of `GET /v1/goals/recipe-box`, so the server stays an API-only client
   * and works from any working directory. Throw `ApiToolError('not_found', …)` for "missing".
   */
  exampleGoal?: () => Promise<unknown>
}

// Response shapes of the /v1 routes (design: API routes). Loose objects so an added
// API field passes through instead of failing the tool.
const goalFieldSchema = z.looseObject({
  key: z.string(),
  label: z.string(),
  kind: z.string(),
  required: z.boolean(),
  isTitle: z.boolean(),
})
const goalSummarySchema = z.looseObject({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  accentColor: z.string().nullable(),
  version: z.number(),
  fields: z.array(goalFieldSchema),
})
const itemEntrySchema = z.looseObject({
  id: z.string().nullable(),
  sourceId: z.string(),
  title: z.string(),
  state: z.enum(['queued', 'extracting', 'ready', 'failed']),
  failureReason: z.string().nullable(),
  capturedAt: z.string(),
})
const itemDetailSchema = z.looseObject({
  id: z.string(),
  sourceId: z.string(),
  goal: z.looseObject({ slug: z.string(), name: z.string(), version: z.number() }),
  title: z.string(),
  state: z.literal('ready'),
  data: z.record(z.string(), z.unknown()),
  capturedAt: z.string(),
})
const captureResultSchema = z.object({
  sourceId: z.string(),
  state: z.enum(['queued', 'extracting', 'ready', 'failed']),
})

type GoalSummary = z.infer<typeof goalSummarySchema>
type ItemEntry = z.infer<typeof itemEntrySchema>
type ItemDetail = z.infer<typeof itemDetailSchema>

function textResult(text: string, structuredContent: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text }], structuredContent }
}

function describeGoal(goal: GoalSummary): string {
  const fields = goal.fields
    .map((f) => {
      const flags = [f.kind, f.required ? 'required' : null, f.isTitle ? 'title' : null]
      return `${f.key} (${flags.filter(Boolean).join(', ')})`
    })
    .join(', ')
  const about = goal.description ? ` ${goal.description}` : ''
  return `${goal.slug}: ${goal.name}.${about} Fields: ${fields || 'none'}.`
}

function describeEntry(entry: ItemEntry): string {
  const id = entry.id ?? `source ${entry.sourceId}`
  const reason = entry.failureReason ? `: ${entry.failureReason}` : ''
  return `- ${entry.title} [${entry.state}${reason}] (id: ${id})`
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(describeValue).join(', ')
  return JSON.stringify(value)
}

function describeItem(item: ItemDetail): string {
  const lines = [`${item.title} (${item.goal.name}, id: ${item.id})`]
  for (const [key, value] of Object.entries(item.data)) {
    lines.push(`${key}: ${describeValue(value)}`)
  }
  return lines.join('\n')
}

/**
 * Reads a local image for capture. Every failure throws before any request is made
 * (Requirement 9.6): the path must be a regular file within the size limit and its
 * leading bytes must be JPEG, PNG or WebP. The extension and any declared type are ignored.
 */
async function readImage(imagePath: string): Promise<{ bytes: Uint8Array; filename: string; type: string }> {
  const resolved = path.resolve(imagePath)
  const limitMb = CAPTURE_LIMITS.maxImageBytes / (1024 * 1024)

  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(resolved)
  } catch {
    throw new ApiToolError('invalid_image', `Image file not found or not readable: ${imagePath}.`)
  }
  if (!info.isFile()) throw new ApiToolError('invalid_image', `Not a regular file: ${imagePath}.`)
  if (info.size > CAPTURE_LIMITS.maxImageBytes) {
    throw new ApiToolError('invalid_image', `Images are limited to ${limitMb} MB.`)
  }

  let bytes: Uint8Array
  try {
    bytes = await readFile(resolved)
  } catch {
    throw new ApiToolError('invalid_image', `Image file not found or not readable: ${imagePath}.`)
  }
  // The file can grow between stat and read.
  if (bytes.length > CAPTURE_LIMITS.maxImageBytes) {
    throw new ApiToolError('invalid_image', `Images are limited to ${limitMb} MB.`)
  }

  const type = sniffImageType(bytes)
  if (type === null) throw new ApiToolError('invalid_image', 'Images must be JPEG, PNG or WebP.')
  return { bytes, filename: path.basename(resolved), type }
}

export function createServer(deps: ServerDeps): McpServer {
  const api: ApiClient = createApiClient({ baseUrl: deps.baseUrl, token: deps.token, fetch: deps.fetch })
  const server = new McpServer(
    { name: 'cauldron', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  )

  async function fetchGoals(signal?: AbortSignal): Promise<GoalSummary[]> {
    const { goals } = await api.get<{ goals: GoalSummary[] }>('/v1/goals', undefined, signal)
    return goals
  }

  const goalArg = z
    .string()
    .min(1)
    .describe('Goal slug or exact name, case-insensitive. Use list_goals to see them.')

  server.registerTool(
    'list_goals',
    {
      title: 'List goals',
      description: 'List the apps (goals) you can capture into, with each one’s fields.',
      inputSchema: z.object({}),
      outputSchema: z.object({ goals: z.array(goalSummarySchema) }),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) => {
      const goals = await fetchGoals(ctx.mcpReq.signal)
      const text = goals.length > 0 ? goals.map(describeGoal).join('\n') : 'No goals are available.'
      return textResult(text, { goals })
    },
  )

  server.registerTool(
    'capture',
    {
      title: 'Capture',
      description:
        'Save something into a goal. Pass exactly one of `text` or `imagePath` ' +
        '(a local JPEG, PNG or WebP file, at most 10 MB). The item compiles in the background.',
      inputSchema: z.object({
        goal: goalArg,
        text: z.string().optional().describe('Text to capture, at most 100,000 characters.'),
        imagePath: z.string().min(1).optional().describe('Path to a local image file.'),
      }),
      outputSchema: captureResultSchema,
    },
    async ({ goal, text, imagePath }, ctx) => {
      if ((text === undefined) === (imagePath === undefined)) {
        throw new ApiToolError('validation_failed', 'Provide exactly one of `text` or `imagePath`.')
      }

      // Everything that can be checked locally is checked before the first request.
      const form = new FormData()
      if (text !== undefined) {
        if (text.trim() === '') throw new ApiToolError('validation_failed', 'Text must not be empty.')
        if (text.length > CAPTURE_LIMITS.maxTextChars) {
          throw new ApiToolError(
            'payload_too_large',
            `Text is limited to ${CAPTURE_LIMITS.maxTextChars.toLocaleString('en-US')} characters.`,
          )
        }
        form.set('text', text)
      } else if (imagePath !== undefined) {
        const image = await readImage(imagePath)
        form.set('image', new File([image.bytes], image.filename, { type: image.type }))
      }

      const goals = await fetchGoals(ctx.mcpReq.signal)
      form.set('goal', resolveGoal(goals, goal).slug)
      form.set('client', 'mcp')

      const result = await api.postForm<z.infer<typeof captureResultSchema>>(
        '/v1/captures',
        form,
        ctx.mcpReq.signal,
      )
      const structured = { sourceId: result.sourceId, state: result.state }
      return textResult(
        `Saved. Compile state: ${result.state}. Source ID: ${result.sourceId}.`,
        structured,
      )
    },
  )

  server.registerTool(
    'search',
    {
      title: 'Search',
      description:
        'Search saved items in a goal by title. An empty query lists recent items. ' +
        'Returns each item’s id, title and compile state.',
      inputSchema: z.object({
        goal: goalArg,
        query: z.string().describe('Part of a title. Leave empty to list recent items.'),
        limit: z.number().int().min(1).max(100).optional().describe('Maximum results, default 50.'),
      }),
      outputSchema: z.object({ items: z.array(itemEntrySchema) }),
      annotations: { readOnlyHint: true },
    },
    async ({ goal, query, limit }, ctx) => {
      const resolved = resolveGoal(await fetchGoals(ctx.mcpReq.signal), goal)
      const params: Record<string, string> = { goal: resolved.slug }
      if (query.trim() !== '') params.q = query.trim()
      if (limit !== undefined) params.limit = String(limit)

      const { items } = await api.get<{ items: ItemEntry[] }>('/v1/items', params, ctx.mcpReq.signal)
      const header = `Found ${items.length} ${items.length === 1 ? 'item' : 'items'} in ${resolved.name}.`
      return textResult([header, ...items.map(describeEntry)].join('\n'), { items })
    },
  )

  server.registerTool(
    'get_item',
    {
      title: 'Get item',
      description: 'Get one saved item by id, with all its fields. An image field is a short-lived signed URL.',
      inputSchema: z.object({ id: z.string().min(1).describe('Item id from search.') }),
      outputSchema: itemDetailSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ id }, ctx) => {
      const item = await api.get<ItemDetail>(`/v1/items/${encodeURIComponent(id)}`, undefined, ctx.mcpReq.signal)
      return textResult(describeItem(item), item)
    },
  )

  server.registerResource(
    'recipe-box-goal',
    EXAMPLE_GOAL_URI,
    {
      title: 'Recipe Box goal file',
      description: 'The Recipe Box goal file, as an example of what a goal looks like.',
      mimeType: 'application/json',
    },
    async (uri, ctx) => {
      let spec: unknown
      try {
        spec = deps.exampleGoal
          ? await deps.exampleGoal()
          : (
              await api.get<{ spec: unknown }>(
                `/v1/goals/${EXAMPLE_GOAL_SLUG}`,
                undefined,
                ctx.mcpReq.signal,
              )
            ).spec
      } catch (err) {
        if (err instanceof ApiToolError && err.code === 'not_found') {
          throw new ResourceNotFoundError(uri.href)
        }
        throw err
      }
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(spec, null, 2) }],
      }
    },
  )

  return server
}
