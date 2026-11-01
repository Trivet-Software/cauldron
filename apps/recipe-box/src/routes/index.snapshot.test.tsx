import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Route } from './index'

describe('home route snapshot', () => {
  afterEach(cleanup)

  it('matches the rendered home page', async () => {
    // The home component uses no router hooks, so render it directly.
    const Home = Route.options.component as () => React.JSX.Element
    const { container } = render(<Home />)
    await screen.findByRole('heading', { name: 'Welcome to Recipe Box' })
    expect(container).toMatchSnapshot()
  })
})
