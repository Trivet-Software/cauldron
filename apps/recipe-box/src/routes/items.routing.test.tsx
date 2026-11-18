/**
 * Routing tests for the items screens.
 *
 * Requirements: 01.7-walking-skeleton 7.7 (signed-out visits redirect to
 * /sign-in), 7.1 and 7.2 (signed-in /items mounts the capture form and list).
 *
 * `routeTree.gen.ts` isn't generated under Vitest, so the tree is built in code
 * from the real route files' options (guard and components), as in
 * `routing.test.tsx`. The collection client is faked at the module boundary, so
 * no request leaves the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
} from '@tanstack/react-router'
import { AuthBridge, createAppRouter, type AppRouterContext } from '../router'
import { Route as RootFileRoute } from './__root'
import { Route as SignInFileRoute } from './sign-in'
import { Route as AuthFileRoute } from './_auth'
import { Route as ItemsIndexFileRoute } from './_auth/items.index'
import { Route as ItemDetailFileRoute } from './_auth/items.$itemId'

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

// One stable object: the hooks refetch whenever the client identity changes.
const fakeClient = vi.hoisted(() => ({
  getGoal: vi.fn(),
  listItems: vi.fn(),
  capture: vi.fn(),
  getItem: vi.fn(),
}))

vi.mock('web-kit/collection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('web-kit/collection')>()),
  useCollectionClient: () => fakeClient,
}))

function setAuth(signedIn: boolean) {
  mockAuth.isSignedIn = signedIn
  mockAuth.userId = signedIn ? 'user_123' : null
}

function buildRouter(initialEntry: string) {
  const rootRoute = createRootRouteWithContext<AppRouterContext>()({
    component: RootFileRoute.options.component,
  })
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sign-in',
    validateSearch: SignInFileRoute.options.validateSearch,
    component: SignInFileRoute.options.component,
  })
  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_auth',
    // The file route's options are typed against the (ungenerated) Register; re-type the call.
    beforeLoad: (opts) => AuthFileRoute.options.beforeLoad?.(opts as never),
    component: AuthFileRoute.options.component,
  })
  const itemsRoute = createRoute({
    getParentRoute: () => authRoute,
    path: '/items',
    component: ItemsIndexFileRoute.options.component,
  })
  const itemDetailRoute = createRoute({
    getParentRoute: () => authRoute,
    path: '/items/$itemId',
    component: ItemDetailFileRoute.options.component,
  })
  const routeTree = rootRoute.addChildren([
    signInRoute,
    authRoute.addChildren([itemsRoute, itemDetailRoute]),
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
  render(<AuthBridge router={router} />)
  return router
}

describe('items routes', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollTo; the router's scroll restoration calls it.
    window.scrollTo = vi.fn()
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_abc')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
    mockAuth.isLoaded = true
    setAuth(false)
    fakeClient.listItems.mockResolvedValue([
      {
        id: 'item_1',
        sourceId: 'source_1',
        title: 'Lemon tart',
        state: 'ready',
        failureReason: null,
        capturedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    for (const fn of Object.values(fakeClient)) fn.mockReset()
  })

  it('redirects a signed-out visit to /items to /sign-in with the original href', async () => {
    const router = renderApp('/items')

    expect(await screen.findByText('Sign in page')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/sign-in')
    expect((router.state.location.search as { redirect?: string }).redirect).toBe('/items')
    expect(screen.queryByRole('heading', { name: 'Items' })).toBeNull()
    expect(fakeClient.listItems).not.toHaveBeenCalled()
  })

  it('redirects a signed-out visit to /items/x to /sign-in with the original href', async () => {
    const router = renderApp('/items/x')

    expect(await screen.findByText('Sign in page')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/sign-in')
    expect((router.state.location.search as { redirect?: string }).redirect).toBe('/items/x')
    expect(fakeClient.getItem).not.toHaveBeenCalled()
  })

  it('mounts the capture form and the item list for a signed-in visit to /items', async () => {
    setAuth(true)
    const router = renderApp('/items')

    expect(await screen.findByRole('heading', { name: 'Items' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/items')

    // Capture form: text area, photo picker and submit button.
    expect(screen.getByLabelText('Text')).toBeTruthy()
    expect(screen.getByLabelText('Photo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()

    // Item list: search box, and the fake client's entry linked to its detail page.
    expect(screen.getByLabelText('Search items')).toBeTruthy()
    const link = await screen.findByRole('link', { name: 'Lemon tart' })
    expect(link.getAttribute('href')).toBe('/items/item_1')
    await waitFor(() =>
      expect(fakeClient.listItems).toHaveBeenCalledWith({ goal: 'recipe-box', q: '' }),
    )
  })
})
