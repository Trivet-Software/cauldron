// Fail-fast environment validation for the services (01.5-backend-foundation
// Requirement 8.3). Errors name the variables that are missing or invalid and
// never include their values, so the message is safe for Railway's deploy log.
import { z } from 'zod'

export class EnvError extends Error {
  /** Names of the missing or invalid variables, sorted and de-duplicated. */
  readonly names: readonly string[]

  constructor(names: readonly string[]) {
    super(
      `Missing or invalid environment variables: ${names.join(', ')}. ` +
        'See .env.example.',
    )
    this.name = 'EnvError'
    this.names = names
  }
}

// Fallback for issues Zod reports without a path, e.g. a refinement on the
// whole object that forgot to set one. The error must still name something.
const UNKNOWN_NAME = '(environment)'

function issueNames(issue: z.core.$ZodIssue): string[] {
  if (issue.code === 'unrecognized_keys') return issue.keys
  const name = issue.path.map(String).join('.')
  return [name === '' ? UNKNOWN_NAME : name]
}

/**
 * Validates `source` (usually `process.env`) against `schema`.
 * Empty strings count as missing, matching `validateEnv()` in the apps.
 * Throws `EnvError` listing every missing or invalid name.
 */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined>,
): z.output<S> {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  )
  const result = schema.safeParse(cleaned)
  if (!result.success) {
    const names = [...new Set(result.error.issues.flatMap(issueNames))].sort()
    throw new EnvError(names)
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Shared fragments for provider and embedding settings (design: Environment
// Variables). Services spread these shapes into their own z.object() and
// apply `providerRules` so the conditional requirements hold.

export const PROVIDER_MODES = ['openrouter', 'mock', 'record'] as const
export type ProviderMode = (typeof PROVIDER_MODES)[number]

export const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small'
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536

export const providerEnvShape = {
  PROVIDERS: z.enum(PROVIDER_MODES),
  OPENROUTER_API_KEY: z.string().optional(),
  LLM_COMPILE_MODEL: z.string().optional(),
  LLM_DRAFT_MODEL: z.string().optional(),
  MOCK_RECORDINGS_DIR: z.string().optional(),
}

export const embeddingEnvShape = {
  EMBEDDING_MODEL: z.string().default(DEFAULT_EMBEDDING_MODEL),
  EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_EMBEDDING_DIMENSIONS),
}

const REQUIRED_BY_MODE: Record<ProviderMode, readonly string[]> = {
  openrouter: ['OPENROUTER_API_KEY', 'LLM_COMPILE_MODEL', 'LLM_DRAFT_MODEL'],
  record: [
    'OPENROUTER_API_KEY',
    'LLM_COMPILE_MODEL',
    'LLM_DRAFT_MODEL',
    'MOCK_RECORDINGS_DIR',
  ],
  mock: ['MOCK_RECORDINGS_DIR'],
}

function isProviderMode(value: unknown): value is ProviderMode {
  return (PROVIDER_MODES as readonly unknown[]).includes(value)
}

/**
 * Adds the conditional provider requirements to an object schema built from
 * `providerEnvShape`. It runs even when other fields failed, so one error
 * lists every missing name rather than only the first batch.
 */
export function providerRules<S extends z.ZodObject>(schema: S): S {
  return schema.superRefine(
    (_value, ctx) => {
      // Read the raw input: with `when` always true, the parsed output may be
      // incomplete when other fields failed.
      const input = ctx.value as Record<string, unknown>
      const mode = input.PROVIDERS
      if (!isProviderMode(mode)) return // the enum already reported it
      for (const name of REQUIRED_BY_MODE[mode]) {
        if (input[name] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: `Required when PROVIDERS=${mode}`,
          })
        }
      }
    },
    { when: () => true },
  )
}

/** Provider and embedding settings on their own, for tests and small tools. */
export const providerEnvSchema = providerRules(
  z.object({ ...providerEnvShape, ...embeddingEnvShape }),
)
export type ProviderEnv = z.output<typeof providerEnvSchema>
