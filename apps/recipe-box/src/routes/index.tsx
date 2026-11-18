import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomeComponent,
})

function HomeComponent() {
  return (
    <main>
      <h1>Welcome to Recipe Box</h1>
      <p>Your goal-driven capture and compile engine.</p>
      <p>
        <Link to="/items">Your items</Link>
      </p>
    </main>
  )
}
