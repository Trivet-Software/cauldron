// Model-scoped vector comparison (01.5-backend-foundation task 3.2, Requirements 7.5 and 7.6;
// design, "Embedding model changes"). Vectors from different embedding models live in the
// same `items.embedding` column, and comparing across models gives meaningless distances,
// so every search query must filter on the configured model.
import { type Fragment, type TransactionSql } from 'postgres'

import { type EmbeddingProvider } from '../providers/types'

/** The embedding model a query may compare against, from the configured provider. */
export interface EmbeddingScope {
  readonly model: string
  readonly dimensions: number
  /**
   * SQL predicate `<alias>.embedding_model = <model>`, for a query's `where` clause.
   * `alias` is the items table's alias in that query; omit it when there is none.
   */
  filter(sql: TransactionSql, alias?: string): Fragment
}

/** The model filter search queries must apply (design: `embeddingScope(providers.embeddings)`). */
export function embeddingScope(
  embeddings: Pick<EmbeddingProvider, 'model' | 'dimensions'>,
): EmbeddingScope {
  const { model, dimensions } = embeddings
  if (typeof model !== 'string' || model === '') {
    throw new TypeError('embeddingScope() needs a non-empty embedding model.')
  }
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0) {
    throw new TypeError('embeddingScope() needs a positive integer dimension count.')
  }
  return Object.freeze({
    model,
    dimensions,
    filter: (sql: TransactionSql, alias?: string) =>
      sql`${sql(alias ? `${alias}.embedding_model` : 'embedding_model')} = ${model}`,
  })
}
