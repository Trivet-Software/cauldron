import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CollectionClient } from './client'
import { useItems } from './hooks'
import { type ItemEntry } from './types'

function entry(state: ItemEntry['state']): ItemEntry {
  return {
    id: state === 'ready' ? 'i1' : null,
    sourceId: 's1',
    title: 'Soup',
    state,
    failureReason: null,
    capturedAt: '2026-01-01T00:00:00.000Z',
  }
}

function fakeClient(listItems: CollectionClient['listItems']): CollectionClient {
  return {
    listItems,
    getGoal: vi.fn(),
    capture: vi.fn(),
    getItem: vi.fn(),
  }
}

// Lets the awaited fetch and the resulting state update settle.
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useItems polling (Requirement 7.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refetches every 2 s while a row is pending and stops once none is', async () => {
    const listItems = vi
      .fn<CollectionClient['listItems']>()
      .mockResolvedValueOnce([entry('queued')])
      .mockResolvedValueOnce([entry('extracting')])
      .mockResolvedValue([entry('ready')])
    const client = fakeClient(listItems)

    const { result } = renderHook(() => useItems(client, 'recipe-box', ''))
    await flush()
    expect(listItems).toHaveBeenCalledTimes(1)
    expect(result.current.data?.[0]?.state).toBe('queued')

    await flush(1999)
    expect(listItems).toHaveBeenCalledTimes(1)
    await flush(1)
    expect(listItems).toHaveBeenCalledTimes(2)
    expect(result.current.data?.[0]?.state).toBe('extracting')

    await flush(2000)
    expect(listItems).toHaveBeenCalledTimes(3)
    expect(result.current.data?.[0]?.state).toBe('ready')

    await flush(10_000)
    expect(listItems).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not poll when every row is ready or failed', async () => {
    const listItems = vi
      .fn<CollectionClient['listItems']>()
      .mockResolvedValue([entry('ready'), entry('failed')])
    const client = fakeClient(listItems)

    renderHook(() => useItems(client, 'recipe-box', ''))
    await flush(10_000)

    expect(listItems).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no timer after unmount and fetches no more', async () => {
    const listItems = vi.fn<CollectionClient['listItems']>().mockResolvedValue([entry('queued')])
    const client = fakeClient(listItems)

    const { unmount } = renderHook(() => useItems(client, 'recipe-box', ''))
    await flush()
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)

    await flush(10_000)
    expect(listItems).toHaveBeenCalledTimes(1)
  })

  it('exposes the error message and stops polling when a refetch fails', async () => {
    const listItems = vi
      .fn<CollectionClient['listItems']>()
      .mockResolvedValueOnce([entry('queued')])
      .mockRejectedValueOnce(new Error('Server unavailable.'))
    const client = fakeClient(listItems)

    const { result } = renderHook(() => useItems(client, 'recipe-box', ''))
    await flush(2000)

    expect(result.current.error?.message).toBe('Server unavailable.')
    expect(result.current.data?.[0]?.state).toBe('queued')
    await flush(10_000)
    expect(listItems).toHaveBeenCalledTimes(2)
  })
})
