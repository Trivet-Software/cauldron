/**
 * Account page: calls GET /v1/me and renders the result or the error message.
 * Requirements: 01.5-backend-foundation 9.2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route } from './account'

const getToken = async () => 'tok_abc'

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken }),
}))

const fetchMock = vi.fn()

function renderPage() {
  const Component = Route.options.component as React.ComponentType
  return render(<Component />)
}

describe('Account page', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_abc')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('renders user ID, tenant ID and developer role from /v1/me', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ userId: 'user_1', tenantId: 'user_1', isDeveloper: true }),
    )
    renderPage()

    expect(await screen.findByText('Developer')).toBeTruthy()
    expect(screen.getAllByText('user_1')).toHaveLength(2)
    expect(screen.getByText('Yes')).toBeTruthy()

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.example.com/v1/me')
    expect(init.headers.Authorization).toBe('Bearer tok_abc')
  })

  it("renders the error envelope's message on failure", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'unauthorized',
            message: 'A valid session token is required.',
            status: 401,
            requestId: 'req_1',
          },
        },
        { status: 401 },
      ),
    )
    renderPage()

    expect((await screen.findByRole('alert')).textContent).toBe(
      'A valid session token is required.',
    )
  })
})
