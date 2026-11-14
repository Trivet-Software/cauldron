// Worker configuration, validated before any connection opens
// (01.5-backend-foundation Requirements 6.1, 8.3). The entry point (task 7.5)
// catches EnvError, prints its message and exits 1.
import { z } from 'zod'
import {
  embeddingEnvShape,
  parseEnv,
  providerEnvShape,
  providerRules,
} from '@cauldron/core/env'

export const DEFAULT_WORKER_CONCURRENCY = 4
export const DEFAULT_POLL_INTERVAL_MS = 1000
// Below Railway's 30 s draining window (RAILWAY_DEPLOYMENT_DRAINING_SECONDS).
export const DEFAULT_SHUTDOWN_GRACE_MS = 25_000

function positiveInt(fallback: number) {
  return z.coerce.number().int().positive().default(fallback)
}

const workerEnvSchema = providerRules(
  z.object({
    DATABASE_URL: z.string(),
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string(),
    ...providerEnvShape,
    ...embeddingEnvShape,
    WORKER_CONCURRENCY: positiveInt(DEFAULT_WORKER_CONCURRENCY),
    POLL_INTERVAL_MS: positiveInt(DEFAULT_POLL_INTERVAL_MS),
    SHUTDOWN_GRACE_MS: positiveInt(DEFAULT_SHUTDOWN_GRACE_MS),
  }),
)

export type WorkerEnv = z.output<typeof workerEnvSchema>

/** Throws EnvError naming every missing or invalid variable. */
export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): WorkerEnv {
  return parseEnv(workerEnvSchema, source)
}
