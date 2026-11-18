// `compile` job handler (01.7-walking-skeleton task 7.1, Requirements 3.1 to 3.7, 4.3 and
// 5.1 to 5.5; design, "Compile handler"). Turns one captured source into one item: the
// deterministic mapper by default, or one structured LLM call when COMPILE_MODE=llm.
//
// Everything runs through ctx: `ctx.scope` is the job user's withActor, `ctx.storage` is bound
// to the job's tenant. Errors carry field keys at most, never source text or field values,
// because those come from user content or a model.
import {
  loadCompileInput,
  recordCompileUsage,
  saveItem,
} from '@cauldron/core/collection'
import {
  buildExtractionRequest,
  mapImage,
  mapText,
  sniffImageType,
} from '@cauldron/core/compile'
import { type Scoped } from '@cauldron/core/db'
import { type GoalFile, failureReasonFor, goalFields, validateItem } from '@cauldron/core/goals'
import { NonRetryableError } from '@cauldron/core/queue'

import { type JobHandler } from './index'

export const COMPILE_MODES = ['mapper', 'llm'] as const
export type CompileMode = (typeof COMPILE_MODES)[number]

export const COMPILE_STAGE = 'extracting'

/** The OpenRouter providers are the only real ones; the mock reports under the same name. */
const USAGE_PROVIDER = 'openrouter'

export interface CompileHandlerOptions {
  mode: CompileMode
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function imageFieldKey(goal: GoalFile): string | undefined {
  return goalFields(goal).find((field) => field.kind === 'image')?.key
}

export function createCompileHandler(options: CompileHandlerOptions): JobHandler {
  const { mode } = options

  return async (ctx) => {
    const payload = ctx.job.payload as { sourceId?: unknown } | null
    const sourceId = payload?.sourceId
    if (typeof sourceId !== 'string' || sourceId === '') {
      throw new NonRetryableError('The capture could not be found.')
    }

    await ctx.setStage(COMPILE_STAGE)

    const input = await ctx.scope((scope) => loadCompileInput(scope, sourceId))
    if (input === null) throw new NonRetryableError('The capture could not be found.')
    if (input.storagePath === null) {
      throw new NonRetryableError('The capture has no stored source.')
    }
    const { goal } = input
    const storagePath = input.storagePath

    const bytes = await ctx.storage.get(storagePath)
    const imageType = input.kind === 'photo' ? sniffImageType(bytes) : null
    if (input.kind === 'photo' && imageType === null) {
      throw new NonRetryableError('The image must be a JPEG, PNG or WebP file.')
    }

    let candidate: unknown
    let model: string | undefined
    let usage:
      | { model: string; inputTokens: number; outputTokens: number; costUsd: number }
      | undefined

    if (mode === 'mapper') {
      candidate =
        input.kind === 'photo'
          ? mapImage(goal.spec, { filename: input.metadata.filename, storagePath })
          : mapText(goal.spec, new TextDecoder().decode(bytes))
    } else {
      const request = buildExtractionRequest(
        goal.spec,
        input.kind === 'photo'
          ? { kind: 'image', mediaType: imageType!, data: bytes }
          : { kind: 'text', text: new TextDecoder().decode(bytes) },
        ctx.providers.models.compile,
      )
      const result = await ctx.providers.llm.complete({ ...request, signal: ctx.signal })
      model = result.model
      usage = { model: result.model, ...result.usage }

      // The model never sees storage paths, so any image value it returns is discarded and
      // only a photo capture gets the path of its own stored file.
      const imageKey = imageFieldKey(goal.spec)
      if (isRecord(result.output) && imageKey !== undefined) {
        const rest = { ...result.output }
        delete rest[imageKey]
        candidate = input.kind === 'photo' ? { ...rest, [imageKey]: storagePath } : rest
      } else {
        candidate = result.output
      }
    }

    const validation = validateItem(goal.spec, candidate)

    // The idempotency key makes a second record a no-op, so a retry counts the spend once.
    const recordUsage = async (scope: Scoped) => {
      if (usage === undefined) return
      await recordCompileUsage(scope, {
        sourceId,
        jobId: ctx.job.id,
        provider: USAGE_PROVIDER,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
      })
    }

    if (!validation.ok) {
      // The call cost money even though its output doesn't fit the goal. Its own scope, so
      // that throwing below can't roll the usage row back.
      await ctx.scope(recordUsage)
      throw new NonRetryableError(failureReasonFor(validation.fields))
    }

    const titleKey = goalFields(goal.spec).find((field) => field.isTitle)?.key
    const title = titleKey === undefined ? undefined : validation.data[titleKey]
    if (typeof title !== 'string') {
      // validateItem requires the title field, so this guards the type, not a real case.
      throw new NonRetryableError(failureReasonFor(titleKey === undefined ? [] : [titleKey]))
    }

    ctx.signal.throwIfAborted()

    await ctx.scope(async (scope) => {
      await saveItem(scope, {
        sourceId,
        goalId: goal.id,
        goalVersion: goal.version,
        title,
        data: validation.data,
        provenance: {
          mode,
          sourceKind: input.kind,
          ...(model === undefined ? {} : { model }),
        },
      })
      await recordUsage(scope)
    })

    return { outcome: 'ready' }
  }
}
