import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, type CaptureResult, type CollectionClient } from '../../collection'
import { CaptureForm } from './index'

function fakeClient(capture: CollectionClient['capture']): CollectionClient {
  return { capture, getGoal: vi.fn(), listItems: vi.fn(), getItem: vi.fn() }
}

const RESULT: CaptureResult = { sourceId: 'src-1', state: 'queued' }

describe('CaptureForm (Requirements 7.1, 7.5)', () => {
  it('submits the text for the goal, reports the source and clears the field', async () => {
    const capture = vi.fn<CollectionClient['capture']>().mockResolvedValue(RESULT)
    const onCaptured = vi.fn()
    render(<CaptureForm client={fakeClient(capture)} goal="recipe-box" onCaptured={onCaptured} />)

    const textarea = screen.getByLabelText('Text')
    await userEvent.type(textarea, 'Soup')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onCaptured).toHaveBeenCalledWith('src-1'))
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith({ goal: 'recipe-box', text: 'Soup' })
    expect(textarea).toHaveValue('')
  })

  it('submits a chosen photo for the goal', async () => {
    const capture = vi.fn<CollectionClient['capture']>().mockResolvedValue(RESULT)
    const onCaptured = vi.fn()
    render(<CaptureForm client={fakeClient(capture)} goal="recipe-box" onCaptured={onCaptured} />)

    const file = new File(['x'], 'soup.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText('Photo'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onCaptured).toHaveBeenCalledWith('src-1'))
    expect(capture).toHaveBeenCalledWith({ goal: 'recipe-box', image: file })
  })

  it('disables the controls while the request is in flight and re-enables them after', async () => {
    let resolve: (value: CaptureResult) => void = () => {}
    const capture = vi.fn<CollectionClient['capture']>().mockReturnValue(
      new Promise<CaptureResult>((r) => {
        resolve = r
      }),
    )
    render(<CaptureForm client={fakeClient(capture)} goal="recipe-box" onCaptured={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Text'), 'Soup')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const busy = await screen.findByRole('button', { name: 'Saving…' })
    expect(busy).toBeDisabled()
    expect(screen.getByLabelText('Text')).toBeDisabled()
    expect(screen.getByLabelText('Photo')).toBeDisabled()

    resolve(RESULT)
    expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByLabelText('Text')).toBeEnabled()
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it("shows the error envelope's message in an alert and keeps the text", async () => {
    const capture = vi
      .fn<CollectionClient['capture']>()
      .mockRejectedValue(new ApiRequestError('Text is limited to 100,000 characters.', 'payload_too_large', 413))
    const onCaptured = vi.fn()
    render(<CaptureForm client={fakeClient(capture)} goal="recipe-box" onCaptured={onCaptured} />)

    await userEvent.type(screen.getByLabelText('Text'), 'Soup')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Text is limited to 100,000 characters.')
    expect(screen.getByLabelText('Text')).toHaveValue('Soup')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(onCaptured).not.toHaveBeenCalled()
  })

  it('shows a client-side error and sends nothing when both inputs are empty', async () => {
    const capture = vi.fn<CollectionClient['capture']>()
    render(<CaptureForm client={fakeClient(capture)} goal="recipe-box" onCaptured={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Text'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Add some text or choose a photo.')
    expect(capture).not.toHaveBeenCalled()
  })

  it('shows a client-side error and sends nothing when both text and photo are given', async () => {
    const capture = vi.fn<CollectionClient['capture']>()
    render(<CaptureForm client={fakeClient(capture)} goal="recipe-box" onCaptured={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Text'), 'Soup')
    await userEvent.upload(screen.getByLabelText('Photo'), new File(['x'], 'soup.png', { type: 'image/png' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Add text or a photo, not both.')
    expect(capture).not.toHaveBeenCalled()
  })
})
