import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { useAuth } from '@clerk/react'
import { Header } from 'web-kit/components'
import type { AppRouterContext } from '../router'

export const Route = createRootRouteWithContext<AppRouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  const { isLoaded } = useAuth()

  return (
    <>
      <Header appName="Recipe Box" />
      {isLoaded ? (
        <Outlet />
      ) : (
        <div role="status" aria-live="polite">
          Loading…
        </div>
      )}
    </>
  )
}
