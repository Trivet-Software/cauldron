import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Header } from './index'

const clerk = vi.hoisted(() => ({ signedIn: false }))

vi.mock('@clerk/react', () => ({
  Show: ({ when, children }: { when: string; children: React.ReactNode }) =>
    (when === 'signed-in') === clerk.signedIn ? children : null,
  UserButton: () => <button data-testid="user-button">user</button>,
  SignInButton: () => <button>Sign in</button>,
  SignUpButton: () => <button>Sign up</button>,
}))

describe('Header snapshots', () => {
  afterEach(() => {
    cleanup()
    clerk.signedIn = false
  })

  it('matches when signed out', () => {
    const { container } = render(<Header appName="Recipe Box" />)
    expect(container).toMatchSnapshot()
  })

  it('matches when signed in', () => {
    clerk.signedIn = true
    const { container } = render(<Header appName="Recipe Box" />)
    expect(container).toMatchSnapshot()
  })
})
