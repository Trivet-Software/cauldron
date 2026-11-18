import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ApiRequestError,
  type CollectionClient,
  type GoalDetail,
  type ItemDetail as ItemDetailData,
} from '../../collection'
import { ItemDetail } from './index'

const GOAL: GoalDetail = {
  slug: 'recipe-box',
  name: 'Recipe Box',
  description: null,
  icon: null,
  accentColor: null,
  version: 1,
  spec: {},
  fields: [
    { key: 'title', label: 'Title', kind: 'text', required: true, isTitle: true },
    { key: 'summary', label: 'Summary', kind: 'text', required: false, isTitle: false },
    { key: 'notes', label: 'Notes', kind: 'long-text', required: false, isTitle: false },
    { key: 'ingredients', label: 'Ingredients', kind: 'list', required: false, isTitle: false },
    { key: 'image', label: 'Photo', kind: 'image', required: false, isTitle: false },
  ],
}

const ITEM: ItemDetailData = {
  id: 'item-1',
  sourceId: 'src-1',
  goal: { slug: 'recipe-box', name: 'Recipe Box', version: 1 },
  title: 'Tomato soup',
  state: 'ready',
  data: {
    title: 'Tomato soup',
    summary: 'A quick weeknight soup',
    notes: 'Simmer 20 minutes.\nSeason at the end.',
    ingredients: ['2 tomatoes', '1 onion'],
    image: 'https://storage.example/signed/soup.png?token=abc',
  },
  capturedAt: '2026-01-01T00:00:00.000Z',
}

function fakeClient(overrides: Partial<CollectionClient>): CollectionClient {
  return { getItem: vi.fn(), getGoal: vi.fn(), listItems: vi.fn(), capture: vi.fn(), ...overrides }
}

describe('ItemDetail (Requirements 7.4, 7.5)', () => {
  it('renders one field of each kind by its kind', async () => {
    const getItem = vi.fn<CollectionClient['getItem']>().mockResolvedValue(ITEM)
    const getGoal = vi.fn<CollectionClient['getGoal']>().mockResolvedValue(GOAL)
    const { container } = render(<ItemDetail client={fakeClient({ getItem, getGoal })} itemId="item-1" />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Tomato soup' })).toBeInTheDocument()
    expect(await screen.findByText('Summary')).toBeInTheDocument()

    expect(getItem).toHaveBeenCalledWith('item-1')
    expect(getGoal).toHaveBeenCalledWith('recipe-box')

    expect(screen.getByText('A quick weeknight soup')).toBeInTheDocument()
    expect(screen.getByText(/Simmer 20 minutes\./)).toHaveClass('whitespace-pre-wrap')
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(['2 tomatoes', '1 onion'])
    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('src', 'https://storage.example/signed/soup.png?token=abc')
    expect(image).toHaveAttribute('alt', 'Photo for Tomato soup')

    // The title field appears once, as the heading, not again as a row.
    expect(screen.queryByText('Title')).not.toBeInTheDocument()
    expect(container).toMatchSnapshot()
  })

  it('shows a dash for an absent field', async () => {
    const item = { ...ITEM, data: { title: 'Tomato soup' } }
    const client = fakeClient({
      getItem: vi.fn<CollectionClient['getItem']>().mockResolvedValue(item),
      getGoal: vi.fn<CollectionClient['getGoal']>().mockResolvedValue(GOAL),
    })
    render(<ItemDetail client={client} itemId="item-1" />)

    await screen.findByText('Ingredients')
    expect(screen.getAllByText('—')).toHaveLength(4)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it("shows the error envelope's message when the item request fails", async () => {
    const client = fakeClient({
      getItem: vi.fn<CollectionClient['getItem']>().mockRejectedValue(new ApiRequestError('Item not found.', 'not_found', 404)),
    })
    render(<ItemDetail client={client} itemId="missing" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Item not found.')
  })
})
