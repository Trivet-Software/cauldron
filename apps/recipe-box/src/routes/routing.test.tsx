/**
 * Routing + auth integration tests.
 *
 * Requirements: 4.1 (public routes), 4.2 (protected redirect), 4.3 (guard reads
 * router context), 3.5 (return to saved destination).
 *
 * `routeTree.gen.ts` isn't generated under Vitest, so the tree is built in code
 * from the real route files' options (guard, components, search validation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, createRoute } from '@tanstack/react-router'
import { createRootRouteWithContext } from '@tanstack/react-router'
import { AuthBridge, createAppRouter, type AppRouterContext } from '../router'
import { Route as RootFileRoute } from './__root'
import { Route as IndexFileRoute } from './index'
import { Route as SignInFileRoute } from './sign-in'
import { Route as AuthFileRoute } from './_auth'


const mockAuth = {
  isLoaded: true,
  isSignedIn: false,
  userId: null as string | null,
}

vi.mock('@clerk/react', () => ({
  useAuth: () => mockAuth,
  SignIn: () => <div>Sign in page</div>,
  UserButton: () => <div>User button</div>,
  SignInButton: () => <button>Sign in</button>,
  SignUpButton: () => <button>Sign up</button>,
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    (when === 'signed-in') === mockAuth.isSignedIn ? <>{children}</> : null,
}))

function setAuth(signedIn: boolean) {
  mockAuth.isSignedIn = signedIn
  mockAuth.userId = signedIn ? 'user_123' : null
}

function buildRouter(initialEntry: string) {
  const rootRoute = createRootRouteWithContext<AppRouterContext>()({
    component: RootFileRoute.options.component,
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: IndexFileRoute.options.component,
  })
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    validateSearch: SignInFileRoute.options.validateSearch,
    component: SignInFileRoute.options.component,
  })
  // Pathless layout reusing the real guard.
  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_auth',
    // The file route's options are typed against the (ungenerated) Register; re-type the call.
    beforeLoad: (opts) => AuthFileRoute.options.beforeLoad?.(opts as never),
    component: AuthFileRoute.options.component,
  })
  const protectedRoute = createRoute({
    getParentRoute: () => authRoute,
    path: '/protected',
    component: () => <div>Protected content</div>,
  })
  const routeTree = rootRoute.addChildren([
    indexRoute,
    signInRoute,
    authRoute.addChildren([protectedRoute]),
  ])
  const router = createAppRouter(routeTree)
  router.update({
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    context: router.options.context,
  })
  return router
}

function renderApp(initialEntry: string) {
  const router = buildRouter(initialEntry)
  const bridge = () => <AuthBridge router={router} />
  const utils = render(bridge())
  // A fresh element is required, otherwise React bails out and useAuth() isn't re-read.
  return { router, rerender: () => utils.rerender(bridge()) }
}

describe('routing + auth', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollTo; the router's scroll restoration calls it.
    window.scrollTo = vi.fn()
    mockAuth.isLoaded = true
    setAuth(false)
  })

  it('renders the public home route when signed out, without redirecting', async () => {
    const { router } = renderApp('/')

    expect(await screen.findByText('Welcome to Recipe Box')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/')
  })

  it('redirects signed-out users from a protected route to /sign-in with the original href', async () => {
    const { router, rerender } = renderApp('/protected')

    expect(await screen.findByText('Sign in page')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/sign-in')
    const redirectTo = (router.state.location.search as { redirect?: string }).redirect
    expect(redirectTo).toBe('/protected')
    expect(screen.queryByText('Protected content')).toBeNull()

    // Simulate completing sign-in: Clerk returns the user to the saved destination.
    setAuth(true)
    rerender()
    await router.navigate({ href: redirectTo as string })

    expect(await screen.findByText('Protected content')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/protected')
  })

  it('redirects away from a protected route when auth flips to signed out', async () => {
    // Limit: Clerk's own sign-out and its afterSignOutUrl="/" navigation are not
    // exercised (Clerk is mocked); this covers the guard reacting to the change.
    setAuth(true)
    const { router, rerender } = renderApp('/protected')
    expect(await screen.findByText('Protected content')).toBeTruthy()

    setAuth(false)
    rerender()

    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(await screen.findByText('Sign in page')).toBeTruthy()
    expect(screen.queryByText('Protected content')).toBeNull()
  })

  it('redirects to /sign-in once Clerk finishes loading signed out on a protected URL', async () => {
    mockAuth.isLoaded = false
    setAuth(false)
    const { router, rerender } = renderApp('/protected')
    // While loading, the guard defers (no redirect) and the root shows its loading state.
    expect(await screen.findByText('Loading…')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/protected')

    mockAuth.isLoaded = true
    rerender()

    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    const redirectTo = (router.state.location.search as { redirect?: string }).redirect
    expect(redirectTo).toBe('/protected')
    // Rendered output isn't asserted: RootLayout reads useAuth() directly, and this
    // mock is a plain object (no React subscription), so the memoized root match
    // keeps its stale "Loading…" view. Real Clerk's context-backed hook re-renders it.
  })
})
