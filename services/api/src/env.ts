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

const apiEnvSchema = providerRules(
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
  }),
)

export type ApiEnv = z.output<typeof apiEnvSchema>

/** Throws EnvError naming every missing or invalid variable. */
export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): ApiEnv {
  return parseEnv(apiEnvSchema, source)
}
