// LIKE-pattern escaping for title search (01.7-walking-skeleton task 5.2, Requirement 6.2).

/**
 * Escapes `\`, `%` and `_` so user input matches literally inside an `ilike ... escape '\'`
 * pattern. Without it a search for `100%` or `a_b` would act as a wildcard.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}
