/**
 * Fail-fast validation of required environment variables.
 *
 * Reads from `import.meta.env` (Vite-injected) and throws a clear error naming
 * every missing key before React mounts. See `main.tsx` for the call site, and
 * `.env.example` for the documented variables.
 */

export interface AppEnv {
  /** Clerk publishable key — ships to the client. Required. */
  VITE_CLERK_PUBLISHABLE_KEY: string
  /**
   * Base URL of the `api` service. Required since the Account page calls
   * `GET /v1/me` (01.5-backend-foundation Requirement 9.2).
   */
  VITE_API_BASE_URL: string
}

export function validateEnv(): AppEnv {
  // The Clerk CLI's `env pull` writes CLERK_PUBLISHABLE_KEY, while Vite apps
  // conventionally use VITE_CLERK_PUBLISHABLE_KEY. Accept either; `envPrefix` in
  // vite.config.ts exposes exactly CLERK_PUBLISHABLE_KEY (never CLERK_SECRET_KEY).
  const publishableKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
    import.meta.env.CLERK_PUBLISHABLE_KEY) as string | undefined
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined

  // Empty strings count as missing. Collect every missing name so one failed
  // start reports all of them.
  const missing: string[] = []
  if (!publishableKey) {
    missing.push('VITE_CLERK_PUBLISHABLE_KEY (or CLERK_PUBLISHABLE_KEY)')
  }
  if (!apiBaseUrl) missing.push('VITE_API_BASE_URL')

  if (!publishableKey || !apiBaseUrl) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env.local and fill in the values, or run ' +
        '`npx clerk env pull --file .env.local` for the Clerk key.',
    )
  }

  return {
    VITE_CLERK_PUBLISHABLE_KEY: publishableKey,
    VITE_API_BASE_URL: apiBaseUrl,
  }
}
