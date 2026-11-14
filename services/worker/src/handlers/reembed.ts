// `reembed` job handler (01.5-backend-foundation task 7.4, Requirements 7.5 and 7.6; design,
// "Embedding model changes"). Embeds `search_text` for a batch of one tenant's items with the
// configured model and stores the vector with its model and dimension count.
//
// Idempotent: it only touches rows whose model still differs, and each usage row has the
// key `reembed:<item id>:<model>`, so a second run (or a lost-lease re-run) neither
// re-embeds finished items nor double-counts spend.
import { type JobHandler } from './index'

/** The OpenRouter providers are the only real ones; the mock reports under the same name. */
const USAGE_PROVIDER = 'openrouter'

interface StaleRow {
  id: string
  search_text: string
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

/** Splits a batch's total across `count` items so the parts add up to the total. */
function splitInt(total: number, count: number, index: number): number {
  const base = Math.floor(total / count)
  return index === 0 ? base + (total - base * count) : base
}

export const reembedHandler: JobHandler = async (ctx) => {
  const payload = ctx.job.payload as { itemIds?: unknown }
  const itemIds = payload?.itemIds
  if (!Array.isArray(itemIds) || !itemIds.every((id) => typeof id === 'string')) {
    throw new TypeError('reembed payload needs an itemIds string array.')
  }
  if (itemIds.length === 0) return
  const { model, dimensions } = ctx.providers.embeddings
  const tenantId = ctx.job.tenantId

  const rows = await ctx.scope(
    ({ sql }) => sql<StaleRow[]>`
      select id, search_text
      from public.items
      where tenant_id = ${tenantId}
        and id = any(${itemIds}::uuid[])
        and search_text is not null
        and embedding_model is distinct from ${model}
      order by id`,
  )
  if (rows.length === 0) return

  const result = await ctx.providers.embeddings.embed(
    rows.map((r) => r.search_text),
    ctx.signal,
  )
  if (result.vectors.length !== rows.length) {
    throw new Error(
      `Embedding provider returned ${result.vectors.length} vectors for ${rows.length} inputs.`,
    )
  }
  ctx.signal.throwIfAborted()

  await ctx.scope(async ({ sql }) => {
    for (const [i, row] of rows.entries()) {
      const vector = result.vectors[i]
      if (vector.length !== dimensions) {
        throw new Error(`Embedding has ${vector.length} dimensions, expected ${dimensions}.`)
      }
      await sql`
        update public.items
        set embedding = ${vectorLiteral(vector)}::extensions.vector,
            embedding_model = ${result.model},
            embedding_dimensions = ${vector.length},
            embedded_at = now()
        where tenant_id = ${tenantId}
          and id = ${row.id}
          and embedding_model is distinct from ${result.model}`
      // The call cost money whether or not another run got to the row first.
      await sql`
        insert into public.usage
          (tenant_id, user_id, job_id, operation, provider, model,
           input_tokens, output_tokens, cost_usd, idempotency_key)
        values (${tenantId}, ${ctx.job.userId}, ${ctx.job.id}, 'reembed', ${USAGE_PROVIDER},
                ${result.model},
                ${splitInt(result.usage.inputTokens, rows.length, i)},
                ${splitInt(result.usage.outputTokens, rows.length, i)},
                ${Number((result.usage.costUsd / rows.length).toFixed(6))},
                ${`reembed:${row.id}:${result.model}`})
        on conflict (idempotency_key) do nothing`
    }
  })
}
