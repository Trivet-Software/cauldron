import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, type CollectionClient, type ItemEntry } from '../../collection'
import { ItemList, SEARCH_DEBOUNCE_MS } from './index'

function entry(overrides: Partial<ItemEntry> & Pick<ItemEntry, 'sourceId' | 'title' | 'state'>): ItemEntry {
  return {
    id: overrides.state === 'ready' ? `item-${overrides.sourceId}` : null,
    failureReason: null,
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeClient(listItems: CollectionClient['listItems']): CollectionClient {
  return { listItems, getGoal: vi.fn(), capture: vi.fn(), getItem: vi.fn() }
}

function renderLink(item: ItemEntry, children: React.ReactNode) {
  return <a href={`/items/${item.id}`}>{children}</a>
}

// Lets the awaited fetch and the resulting state update settle.
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('ItemList (Requirements 7.2, 7.3, 7.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('links only ready rows and shows each row state and the failure reason', async () => {
    const listItems = vi.fn<CollectionClient['listItems']>().mockResolvedValue([
      entry({ sourceId: 'a', title: 'Soup', state: 'ready' }),
      entry({ sourceId: 'b', title: 'Stew', state: 'queued' }),
      entry({ sourceId: 'c', title: 'Pie', state: 'extracting' }),
      entry({ sourceId: 'd', title: 'Bread', state: 'failed', failureReason: 'Missing or invalid: title.' }),
    ])
    render(<ItemList client={fakeClient(listItems)} goal="recipe-box" renderLink={renderLink} />)
    await flush()

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveTextContent('Soup')
    expect(links[0]).toHaveAttribute('href', '/items/item-a')
    for (const title of ['Stew', 'Pie', 'Bread']) {
      expect(screen.getByText(title).closest('a')).toBeNull()
    }
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('Extracting')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Missing or invalid: title.')).toBeInTheDocument()
  })

  it('loads once with an empty query, then sends one request for a search after 250 ms and none before', async () => {
    const listItems = vi.fn<CollectionClient['listItems']>().mockResolvedValue([])
    render(<ItemList client={fakeClient(listItems)} goal="recipe-box" renderLink={renderLink} />)
    await flush()
    expect(listItems).toHaveBeenCalledTimes(1)
    expect(listItems).toHaveBeenLastCalledWith({ goal: 'recipe-box', q: '' })

    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'soup' } })
    await flush(SEARCH_DEBOUNCE_MS - 1)
    expect(listItems).toHaveBeenCalledTimes(1)

    await flush(1)
    expect(listItems).toHaveBeenCalledTimes(2)
    expect(listItems).toHaveBeenLastCalledWith({ goal: 'recipe-box', q: 'soup' })
  })

  it('restarts the debounce on each keystroke so only the final text is requested', async () => {
    const listItems = vi.fn<CollectionClient['listItems']>().mockResolvedValue([])
    render(<ItemList client={fakeClient(listItems)} goal="recipe-box" renderLink={renderLink} />)
    await flush()

    const input = screen.getByLabelText('Search items')
    fireEvent.change(input, { target: { value: 'so' } })
    await flush(200)
    fireEvent.change(input, { target: { value: '  soup ' } })
    await flush(200)
    expect(listItems).toHaveBeenCalledTimes(1)

    await flush(50)
    expect(listItems).toHaveBeenCalledTimes(2)
    expect(listItems).toHaveBeenLastCalledWith({ goal: 'recipe-box', q: 'soup' })
  })

  it('tells an empty list from an empty search', async () => {
    const listItems = vi.fn<CollectionClient['listItems']>().mockResolvedValue([])
    render(<ItemList client={fakeClient(listItems)} goal="recipe-box" renderLink={renderLink} />)
    await flush()
    expect(screen.getByText('Nothing saved yet.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'zzz' } })
    await flush(SEARCH_DEBOUNCE_MS)
    expect(screen.getByText('No items match your search.')).toBeInTheDocument()
  })

  it("shows the error envelope's message when the request fails", async () => {
    const listItems = vi
      .fn<CollectionClient['listItems']>()
      .mockRejectedValue(new ApiRequestError('Unknown goal.', 'bad_request', 400))
    render(<ItemList client={fakeClient(listItems)} goal="nope" renderLink={renderLink} />)
    await flush()

    expect(screen.getByRole('alert')).toHaveTextContent('Unknown goal.')
  })

  it('reloads the list when refreshKey is bumped and not on an unchanged rerender', async () => {
    const listItems = vi
      .fn<CollectionClient['listItems']>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([entry({ sourceId: 'a', title: 'Soup', state: 'ready' })])
    const client = fakeClient(listItems)
    const { rerender } = render(
      <ItemList client={client} goal="recipe-box" renderLink={renderLink} refreshKey={0} />,
    )
    await flush()
    expect(listItems).toHaveBeenCalledTimes(1)

    rerender(<ItemList client={client} goal="recipe-box" renderLink={renderLink} refreshKey={0} />)
    await flush()
    expect(listItems).toHaveBeenCalledTimes(1)

    rerender(<ItemList client={client} goal="recipe-box" renderLink={renderLink} refreshKey={1} />)
    await flush()
    expect(listItems).toHaveBeenCalledTimes(2)
    expect(listItems).toHaveBeenLastCalledWith({ goal: 'recipe-box', q: '' })
    expect(screen.getByRole('link')).toHaveTextContent('Soup')
  })
})
