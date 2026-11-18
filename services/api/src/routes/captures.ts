// `POST /v1/captures` (01.7-walking-skeleton task 6.7, Requirements 2.1 to
// 2.5). Multipart only: text or one image for one goal. Every check runs before
// anything is stored or queued, so a rejected capture leaves no trace. Neither
// the text nor the bytes are ever logged.
import { randomUUID } from 'node:crypto'
import { bodyLimit } from 'hono/body-limit'
import { type OpenAPIHono, z } from '@hono/zod-openapi'
import { type CollectionStore } from '@cauldron/core/collection'
import { CAPTURE_LIMITS, captureLabel, sniffImageType } from '@cauldron/core/compile'
import { type Logger } from 'pino'
import { type AppBindings } from '../http/bindings'
import { defineRoute } from '../http/define-route'
import { ApiError } from '../http/errors'
import { errorResponses } from '../http/openapi'
import { type StorageFor, requestStorage } from '../storage'

/** The 10 MB image cap plus multipart framing, so a larger body is refused before it is read. */
export const CAPTURE_BODY_LIMIT_BYTES = 12 * 1024 * 1024

const TEXT_FILENAME = 'capture.txt'
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8'

export const CaptureBodySchema = z
  .object({
    // Optional here so a missing goal gets the same "available goals" answer
    // as an unknown one (Requirement 2.2), not a generic validation error.
    goal: z.string().optional().openapi({ example: 'recipe-box', description: 'Goal slug.' }),
    client: z
      .enum(['web', 'mcp'])
      .default('web')
      .openapi({ description: 'A display label for where the capture came from, not a security attribute.' }),
    text: z.string().optional().openapi({ description: 'Up to 100,000 characters. Send this or `image`.' }),
    // `z.instanceof(File)` does not serialize into the OpenAPI document, so
    // the part is declared as a binary string and checked in the handler.
    image: z
      .any()
      .optional()
      .openapi({ type: 'string', format: 'binary', description: 'One JPEG, PNG or WebP file up to 10 MB.' }),
  })
  .openapi('CaptureRequest')

export const CaptureAcceptedSchema = z
  .object({
    sourceId: z.uuid(),
    state: z.literal('queued'),
  })
  .openapi('CaptureAccepted')

export type CaptureAccepted = z.infer<typeof CaptureAcceptedSchema>

export const createCaptureRoute = defineRoute({
  method: 'post',
  path: '/captures',
  summary: 'Capture text or one photo into a goal',
  // After the access check, before the multipart body is parsed.
  middleware: bodyLimit({
    maxSize: CAPTURE_BODY_LIMIT_BYTES,
    onError: () => {
      throw new ApiError(413, 'payload_too_large', 'The request is larger than 12 MB.')
    },
  }),
  request: {
    body: {
      required: true,
      content: { 'multipart/form-data': { schema: CaptureBodySchema } },
    },
  },
  responses: {
    202: {
      description: 'The capture was stored and queued for compiling.',
      content: { 'application/json': { schema: CaptureAcceptedSchema } },
    },
    ...errorResponses(400, 401, 413, 415, 503),
  },
})

export interface CapturesDeps {
  collection: CollectionStore
  storageFor: StorageFor
  logger: Logger
}

export function registerCaptures(v1: OpenAPIHono<AppBindings>, deps: CapturesDeps): void {
  v1.openapi(createCaptureRoute, async (c) => {
    const principal = c.get('principal')
    // requireUser (from defineRoute) already guarantees this.
    if (principal?.kind !== 'user') {
      throw new ApiError(401, 'unauthorized', 'A valid session token is required.')
    }
    const actor = { kind: 'user' as const, userId: principal.userId, tenantId: principal.tenantId }
    const body = c.req.valid('form')

    // 1. The goal. Missing and unknown get the same answer.
    const goals = await deps.collection.listGoals(actor)
    const goal = body.goal === undefined ? undefined : goals.find((candidate) => candidate.slug === body.goal)
    if (!goal) {
      const slugs = goals.map((candidate) => candidate.slug)
      throw new ApiError(
        400,
        'bad_request',
        `Unknown goal. Available goals: ${slugs.join(', ')}.`,
        slugs,
      )
    }

    // 2. Exactly one of text and image. An empty text field next to an image
    // is what a browser form sends, so it counts as absent.
    const text = body.text !== undefined && body.text.trim().length > 0 ? body.text : undefined
    const image: unknown = body.image
    const hasImage = image !== undefined && image !== null && image !== ''
    if (hasImage && !(image instanceof File)) {
      throw new ApiError(400, 'validation_failed', 'The image part must be a file.')
    }
    if ((text === undefined) === !hasImage) {
      throw new ApiError(
        400,
        'validation_failed',
        text === undefined
          ? 'Send either text or one image.'
          : 'Send either text or one image, not both.',
      )
    }

    // 3 and 4. Limits, then the magic-byte check (the declared type isn't trusted).
    let bytes: Uint8Array
    let filename: string
    let contentType: string
    let originalName: string | undefined
    if (text !== undefined) {
      if (text.length > CAPTURE_LIMITS.maxTextChars) {
        throw new ApiError(413, 'payload_too_large', 'Text is limited to 100,000 characters.')
      }
      bytes = new TextEncoder().encode(text)
      filename = TEXT_FILENAME
      contentType = TEXT_CONTENT_TYPE
    } else {
      const file = image as File
      if (file.size > CAPTURE_LIMITS.maxImageBytes) {
        throw new ApiError(413, 'payload_too_large', 'Images are limited to 10 MB.')
      }
      bytes = new Uint8Array(await file.arrayBuffer())
      const sniffed = sniffImageType(bytes)
      if (sniffed === null) {
        throw new ApiError(415, 'unsupported_media_type', 'Images must be JPEG, PNG or WebP.')
      }
      originalName = file.name
      filename = file.name
      contentType = sniffed
    }

    // 5. Upload first: an orphaned object after a failed insert is harmless,
    // while a source row pointing at nothing would fail its compile. The
    // storage path starts with the tenant ID (sourceObjectPath).
    const storage = requestStorage(c, deps.storageFor)
    const sourceId = randomUUID()
    const storagePath = await storage.put(sourceId, 0, filename, bytes, contentType)

    try {
      const created = await deps.collection.createCapture(actor, {
        sourceId,
        goalId: goal.id,
        kind: text !== undefined ? 'text' : 'photo',
        client: body.client,
        storagePath,
        metadata: {
          label: captureLabel({ text, filename: originalName }),
          ...(originalName ? { filename: originalName } : {}),
          contentType,
          bytes: bytes.byteLength,
        },
      })
      const accepted: CaptureAccepted = { sourceId: created.sourceId, state: 'queued' }
      return c.json(accepted, 202)
    } catch (err) {
      // Nothing is queued (source row and job share one transaction); also
      // drop the object so a failed capture leaves no raw data behind.
      const log = c.get('logger') ?? deps.logger
      try {
        await storage.remove(storagePath)
      } catch (removeErr) {
        log.warn({ err: removeErr, sourceId }, 'could not remove the upload after a failed capture')
      }
      throw err
    }
  })
}
