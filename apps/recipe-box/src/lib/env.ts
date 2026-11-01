/**
 * Fail-fast validation of required environment variables.
 *
 * Reads from `import.meta.env` (Vite-injected) and throws a clear error naming
 * every missing key before React mounts. See `main.tsx` for the call site, and
 * `.env.example` for the documented variables.
 */

// The Clerk CLI's `env pull` writes CLERK_PUBLISHABLE_KEY, while Vite apps
// conventionally use VITE_CLERK_PUBLISHABLE_KEY. Accept either; `envPrefix` in
// vite.config.ts exposes exactly CLERK_PUBLISHABLE_KEY (never CLERK_SECRET_KEY).
function requiredPublishableKey(): string {
  const value = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
    import.meta.env.CLERK_PUBLISHABLE_KEY) as string | undefined
  if (!value) {
    throw new Error(
      'Missing required environment variable: VITE_CLERK_PUBLISHABLE_KEY ' +
        '(or CLERK_PUBLISHABLE_KEY). Copy .env.example to .env.local and fill ' +
        'in the values, or run `npx clerk env pull --file .env.local`.',
    )
  }
  return value
}

export interface AppEnv {
  /** Clerk publishable key — ships to the client. Required. */
  VITE_CLERK_PUBLISHABLE_KEY: string
  /** Base URL for the future backend API. Optional until a backend exists. */
  VITE_API_BASE_URL: string
}

export function validateEnv(): AppEnv {
  return {
    VITE_CLERK_PUBLISHABLE_KEY: requiredPublishableKey(),
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? '',
  }
}
