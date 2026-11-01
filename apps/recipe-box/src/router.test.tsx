/**
 * Requirements: 3.2 (AuthBridge injects useAuth() into router context),
 * 4.3 (router context bridge for Clerk auth).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRootRouteWithContext, createRoute } from '@tanstack/react-router'
import { AuthBridge, createAppRouter, type AppRouterContext } from './router'


interface MockAuth {
  isLoaded: boolean
  isSignedIn: boolean | undefined
  userId: string | null | undefined
}

const mockAuth: MockAuth = { isLoaded: false, isSignedIn: undefined, userId: undefined }

vi.mock('@clerk/react', () => ({
  useAuth: () => mockAuth,
}))

function buildRouter() {
  const rootRoute = createRootRouteWithContext<AppRouterContext>()()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: function Probe() {
      const { auth } = indexRoute.useRouteContext()
      return <div data-testid="auth">{JSON.stringify(auth)}</div>
    },
  })
  return createAppRouter(rootRoute.addChildren([indexRoute]))
}

async function renderedAuth() {
  const router = buildRouter()
  // createAppRouter's inferred type is narrower than AuthBridge's prop type.
  render(<AuthBridge router={router} />)
  const el = await screen.findByTestId('auth')
  return JSON.parse(el.textContent ?? '') as AppRouterContext['auth']
}

describe('AuthBridge', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollTo; the router's scroll restoration calls it.
    window.scrollTo = vi.fn()
    mockAuth.isLoaded = false
    mockAuth.isSignedIn = undefined
    mockAuth.userId = undefined
  })

  it('passes signed-in useAuth() state into the route context', async () => {
    mockAuth.isLoaded = true
    mockAuth.isSignedIn = true
    mockAuth.userId = 'user_123'

    expect(await renderedAuth()).toEqual({
      isLoaded: true,
      isSignedIn: true,
      userId: 'user_123',
    })
  })

  it('normalizes undefined loading values to false / null', async () => {
    expect(await renderedAuth()).toEqual({
      isLoaded: false,
      isSignedIn: false,
      userId: null,
    })
  })
})
