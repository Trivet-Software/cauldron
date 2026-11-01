import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/react'

// Requirement 3.4: identity + sign-out when signed in; sign-in/sign-up when
// signed out. Modal mode keeps users in place and needs no extra routes.
export function Header({ appName }: { appName: string }) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <nav>{appName}</nav>
      <div className="flex items-center gap-2">
        <Show when="signed-out">
          <SignInButton mode="modal" />
          <SignUpButton mode="modal" />
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </div>
    </header>
  )
}
