/**
 * Placeholder protected route. TanStack Router's generator treats a pathless
 * layout with no children as a leaf at `/`, which collides with `index.tsx`.
 * This minimal child keeps `_auth.tsx` a real layout until feature routes
 * (e.g. `_auth/capture.tsx`) land in later specs; replace or remove it then.
 *
 * Requirements: 4.2.
 */
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_auth/account')({
  component: AccountComponent,
})

function AccountComponent() {
  return (
    <main>
      <h1>Account</h1>
    </main>
  )
}
