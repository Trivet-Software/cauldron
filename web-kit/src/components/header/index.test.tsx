import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Header } from './index'

// Requirement 3.4: UserButton when signed in; sign-in/sign-up when signed out.
const clerkState = vi.hoisted(() => ({ isSignedIn: false }))

vi.mock('@clerk/react', () => ({
  Show: ({ when, children }: { when: string; children: ReactNode }) =>
    (when === 'signed-in') === clerkState.isSignedIn ? <>{children}</> : null,
  UserButton: () => <button data-testid="user-button" />,
  SignInButton: () => <button>Sign in</button>,
  SignUpButton: () => <button>Sign up</button>,
}))

describe('Header', () => {
  beforeEach(() => {
    clerkState.isSignedIn = false
  })

  it('renders the app name and UserButton when signed in', () => {
    clerkState.isSignedIn = true
    render(<Header appName="Recipe Box" />)

    expect(screen.getByText('Recipe Box')).toBeInTheDocument()
    expect(screen.getByTestId('user-button')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('renders the app name without UserButton when signed out', () => {
    render(<Header appName="Recipe Box" />)

    expect(screen.getByText('Recipe Box')).toBeInTheDocument()
    expect(screen.queryByTestId('user-button')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument()
  })
})
