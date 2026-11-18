// API configuration, validated before any port or connection opens
// (01.5-backend-foundation Requirements 1.1, 8.3). The entry point (task 9.8)
// catches EnvError, prints its message and exits 1.
import { z } from 'zod'
import {
  embeddingEnvShape,
  parseEnv,
  providerEnvShape,
  providerRules,
} from '@cauldron/core/env'

export const DEFAULT_PORT = 8787

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

// An exact origin is scheme + host + optional port, nothing else. CORS and
// Clerk's authorizedParties both compare origins by string equality, so a
// trailing slash or a path would silently never match. Messages never echo
// the value; parseEnv reports only the variable name.
function isExactOrigin(entry: string): boolean {
  try {
    const url = new URL(entry)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === entry
    )
  } catch {
    return false
  }
}

const appOrigins = z
  .string()
  .transform(splitList)
  .refine((list) => list.length > 0, 'At least one origin is required')
  .refine(
    (list) => list.every(isExactOrigin),
    'Each entry must be an exact origin such as https://app.example.com',
  )

const developerEmails = z
  .string()
  .transform((value) => splitList(value).map((email) => email.toLowerCase()))
  .default([])

export const AUTH_MODES = ['clerk', 'dev'] as const
export type AuthMode = (typeof AUTH_MODES)[number]

/** Shorter static tokens are too easy to guess (01.7-walking-skeleton Requirement 8.4). */
export const MIN_DEV_TOKEN_LENGTH = 32

const DEV_AUTH_REQUIRED = ['DEV_API_TOKEN', 'DEV_USER_ID', 'SUPABASE_SECRET_KEY'] as const

/**
 * Adds the AUTH_MODE=dev requirements (01.7-walking-skeleton Requirement 8.4).
 * Like providerRules, it reads the raw input so one error lists every problem,
 * and it reports names only, never the token.
 */
export function devAuthRules<S extends z.ZodObject>(schema: S): S {
  return schema.superRefine(
    (_value, ctx) => {
      const input = ctx.value as Record<string, unknown>
      if (input.AUTH_MODE !== 'dev') return
      for (const name of DEV_AUTH_REQUIRED) {
        if (input[name] === undefined) {
          ctx.addIssue({ code: 'custom', path: [name], message: 'Required when AUTH_MODE=dev' })
        }
      }
      const token = input.DEV_API_TOKEN
      if (typeof token === 'string' && token.length < MIN_DEV_TOKEN_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_API_TOKEN'],
          message: `Must be at least ${MIN_DEV_TOKEN_LENGTH} characters`,
        })
      }
    },
    { when: () => true },
  )
}

const apiEnvSchema = devAuthRules(providerRules(
  z.object({
    DATABASE_URL: z.string(),
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string(),
    CLERK_SECRET_KEY: z.string(),
    CLERK_JWT_KEY: z.string().optional(),
    APP_ORIGINS: appOrigins,
    DEVELOPER_EMAILS: developerEmails,
    ...providerEnvShape,
    ...embeddingEnvShape,
    PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
    // Railway injects the deployed commit; `/health` reports it as `version`.
    RAILWAY_GIT_COMMIT_SHA: z.string().default('dev'),
    // Dev auth mode: a static token stands in for a Clerk session, locally only.
    // checkAuthMode() in main.ts refuses it next to NODE_ENV=production or
    // RAILWAY_ENVIRONMENT. SUPABASE_SECRET_KEY serves only the dev principal's storage.
    AUTH_MODE: z.enum(AUTH_MODES).optional(),
    DEV_API_TOKEN: z.string().optional(),
    DEV_USER_ID: z.string().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    NODE_ENV: z.string().optional(),
    RAILWAY_ENVIRONMENT: z.string().optional(),
    // Directory holding `<app>/goal.json`; startApi applies the default (DEFAULT_APPS_DIR in main.ts).
    APPS_DIR: z.string().optional(),
  }),
))

export type ApiEnv = z.output<typeof apiEnvSchema>

/** Throws EnvError naming every missing or invalid variable. */
export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): ApiEnv {
  return parseEnv(apiEnvSchema, source)
}
