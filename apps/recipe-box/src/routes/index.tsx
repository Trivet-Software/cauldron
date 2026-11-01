import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomeComponent,
})

function HomeComponent() {
  return (
    <main>
      <h1>Welcome to Recipe Box</h1>
      <p>Your goal-driven capture and compile engine.</p>
    </main>
  )
}
