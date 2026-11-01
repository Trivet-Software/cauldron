/**
 * Composition root: StrictMode → ClerkProvider → AuthBridge → RouterProvider.
 *
 * `validateEnv()` runs before mount so missing config fails fast.
 * Requirements: 2.1, 3.1, 5.4, 6.2.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import 'web-kit/theme.css'
import { validateEnv } from './lib/env'
import { AuthBridge, createAppRouter } from './router'
import { routeTree } from './routeTree.gen'

const env = validateEnv()
const router = createAppRouter(routeTree)

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={env.VITE_CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
      <AuthBridge router={router} />
    </ClerkProvider>
  </StrictMode>,
)
