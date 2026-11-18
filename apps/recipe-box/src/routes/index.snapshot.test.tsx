import { cleanup, render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './index'

describe('home route snapshot', () => {
  afterEach(cleanup)
  beforeEach(() => {
    // jsdom doesn't implement scrollTo; the router's scroll restoration calls it.
    window.scrollTo = vi.fn()
  })

  it('matches the rendered home page', async () => {
    // The home page links to /items, so it needs a router. Mount only the home
    // component under a bare root, plus a stub /items so the link resolves.
    const rootRoute = createRootRoute({ component: Outlet })
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: Route.options.component,
    })
    const itemsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/items',
      component: () => null,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute, itemsRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    const { container } = render(<RouterProvider router={router} />)
    await screen.findByRole('heading', { name: 'Welcome to Recipe Box' })
    expect(container).toMatchSnapshot()
  })
})
