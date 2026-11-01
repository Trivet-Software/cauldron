/**
 * Pathless protected layout. Any route nested under `_auth` requires a signed-in user.
 *
 * Requirements: 4.2, 4.3.
 */
import { createFileRoute, redirect, Outlet } from '@tanstack/react-router'
import type { AppRouterContext } from '../router'

export const Route = createFileRoute('/_auth')({
  beforeLoad: ({ context, location }) => {
    const { auth } = context as AppRouterContext
    // Wait for Clerk to resolve before deciding; avoids redirecting signed-in users on reload.
    if (!auth.isLoaded) return
    if (!auth.isSignedIn) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
        replace: true,
      })
    }
  },
  component: () => <Outlet />,
})
