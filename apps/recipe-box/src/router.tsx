/**
 * Auth bridge: connects Clerk's `useAuth()` hook to TanStack Router's context.
 *
 * React hooks can't run inside `beforeLoad` guards — those execute outside the
 * React render cycle — so `AuthBridge` extracts the auth state on each render
 * and injects it into `RouterProvider` via `context`. Each `beforeLoad` guard
 * then reads `context.auth` to decide whether to redirect. See `design.md` for
 * the composition order: `ClerkProvider` → `AuthBridge` → `RouterProvider`.
 *
 * Passing a new `context` prop only updates the router's options; it does not
 * re-run `beforeLoad`. The `_auth` guard returns early while Clerk is loading,
 * so without a reload a signed-out visitor on a protected URL would never be
 * redirected, and a mid-session sign-out would leave protected content on
 * screen. `AuthBridge` therefore calls `router.invalidate()` whenever the auth
 * snapshot changes. `RouterProvider` applies the new context via
 * `router.update()` during render, and this effect runs after that commit, so
 * guards see the fresh values.
 *
 * Requirements: 3.2 (AuthBridge reads useAuth and injects into RouterProvider
 * context), 4.3 (router context bridge for Clerk auth).
 */
import { useEffect, useRef } from 'react'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import type { AnyRoute, AnyRouter } from '@tanstack/react-router'
import { useAuth } from '@clerk/react'

export type AppRouterContext = {
  auth: {
    /** Clerk has finished resolving the initial auth state. */
    isLoaded: boolean
    /** Whether a user session is active. */
    isSignedIn: boolean
    /** Clerk user ID when signed in, null otherwise. */
    userId: string | null
  }
}

/**
 * Extracts hook state and passes it into `router.context`.
 *
 * The snapshot is narrowed to the three fields guards need (matching
 * `AppRouterContext.auth`) so the router context stays stable: `isSignedIn`
 * and `userId` are coerced away from Clerk's `| undefined` loading variant.
 * Coercion is behavior-preserving because `_auth` guards short-circuit on
 * `!isLoaded` before reading `isSignedIn`.
 */
export function AuthBridge({ router }: { router: AnyRouter }) {
  const { isLoaded, isSignedIn: rawSignedIn, userId: rawUserId } = useAuth()
  const isSignedIn = rawSignedIn ?? false
  const userId = rawUserId ?? null

  // Skip the first mount: the router's initial load already sees this context.
  // Comparing against the last seen snapshot also keeps StrictMode's double
  // effect run from invalidating.
  const lastSnapshot = useRef<string | null>(null)
  useEffect(() => {
    const snapshot = JSON.stringify([isLoaded, isSignedIn, userId])
    const previous = lastSnapshot.current
    lastSnapshot.current = snapshot
    if (previous !== null && previous !== snapshot) {
      void router.invalidate()
    }
  }, [router, isLoaded, isSignedIn, userId])

  return <RouterProvider router={router} context={{ auth: { isLoaded, isSignedIn, userId } }} />
}

/**
 * Creates the app router seeded with a signed-out auth context.
 *
 * `AuthBridge` overwrites this context on every render, so the seed values only
 * apply before Clerk's first resolve (or if the bridge is ever bypassed).
 */
export const createAppRouter = <TRouteTree extends AnyRoute>(routeTree: TRouteTree) => {
  const router = createRouter({
    routeTree,
    context: {
      auth: { isLoaded: false, isSignedIn: false, userId: null },
    },
  })
  return router
}
