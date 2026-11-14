/**
 * Protected account page. Calls `GET /v1/me` on mount and shows the user ID,
 * tenant ID and developer role, or the error envelope's `message` on failure.
 * This exercises sign-in, token verification, CORS and the API together.
 *
 * Requirements: 4.2; 01.5-backend-foundation 9.2.
 */
import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useApiClient } from 'web-kit/auth'
import { validateEnv } from '../../lib/env'

export const Route = createFileRoute('/_auth/account')({
  component: AccountComponent,
})

interface Me {
  userId: string
  tenantId: string
  isDeveloper: boolean
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  | { status: 'error'; message: string }

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } }
    if (typeof body.error?.message === 'string') return body.error.message
  } catch {
    // Not a JSON envelope; fall through.
  }
  return `Request failed (${res.status}).`
}

function AccountComponent() {
  const env = validateEnv()
  const apiFetch = useApiClient(env.VITE_API_BASE_URL)
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const set = (next: State) => {
      if (!cancelled) setState(next)
    }
    apiFetch('/v1/me')
      .then(async (res) => {
        if (res.ok) set({ status: 'ready', me: (await res.json()) as Me })
        else set({ status: 'error', message: await readError(res) })
      })
      .catch((err: unknown) =>
        set({
          status: 'error',
          message: err instanceof Error ? err.message : 'Request failed.',
        }),
      )
    return () => {
      cancelled = true
    }
  }, [apiFetch])

  return (
    <main>
      <h1>Account</h1>
      {state.status === 'loading' && <p>Loading…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <dl>
          <dt>User ID</dt>
          <dd>{state.me.userId}</dd>
          <dt>Tenant ID</dt>
          <dd>{state.me.tenantId}</dd>
          <dt>Developer</dt>
          <dd>{state.me.isDeveloper ? 'Yes' : 'No'}</dd>
        </dl>
      )}
    </main>
  )
}
