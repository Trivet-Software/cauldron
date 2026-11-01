/**
 * Public sign-in route.
 *
 * Renders Clerk's `SignIn` component. The `_auth` guard redirects signed-out
 * users here with `?redirect=<original location>`; after a successful sign-in
 * Clerk sends them back to that destination (falling back to `/`).
 *
 * Requirements: 3.3 (hosted sign-in component), 3.5 (return to saved destination).
 */
import { createFileRoute } from '@tanstack/react-router'
import { SignIn } from '@clerk/react'

export type SignInSearch = {
  redirect?: string
}

export const Route = createFileRoute('/sign-in')({
  // Accept only string values; anything else is dropped.
  validateSearch: (search: Record<string, unknown>): SignInSearch =>
    typeof search.redirect === 'string' && search.redirect !== ''
      ? { redirect: search.redirect }
      : {},
  component: SignInComponent,
})

function SignInComponent() {
  const { redirect } = Route.useSearch()

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-4">
      {/* Hash routing keeps Clerk's multi-step flow working in a SPA without a splat route. */}
      <SignIn routing="hash" forceRedirectUrl={redirect ?? '/'} />
    </main>
  )
}
