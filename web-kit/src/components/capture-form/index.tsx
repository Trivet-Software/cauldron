import { type FormEvent, useRef, useState } from 'react'
import { type CollectionClient } from '../../collection'
import { cn } from '../../lib/utils'

// 01.7-walking-skeleton Requirement 7.1: a text area and a single image
// picker that submit to POST /v1/captures for one goal. Requirement 7.5: a
// failed request shows the error envelope's message.
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'

export interface CaptureFormProps {
  client: CollectionClient
  goal: string
  onCaptured: (sourceId: string) => void
  className?: string
}

export function CaptureForm({ client, goal, onCaptured, className }: CaptureFormProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return

    const image = fileRef.current?.files?.[0]
    const hasText = text.trim() !== ''
    // The API takes exactly one of the two, so say so before sending.
    if (hasText && image) {
      setError('Add text or a photo, not both.')
      return
    }
    if (!hasText && !image) {
      setError('Add some text or choose a photo.')
      return
    }

    setSending(true)
    setError(null)
    try {
      const result = await client.capture(hasText ? { goal, text } : { goal, image })
      setText('')
      if (fileRef.current) fileRef.current.value = ''
      onCaptured(result.sourceId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className={cn('flex flex-col gap-3', className)}>
      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
        Text
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={sending}
          rows={5}
          placeholder="Paste a recipe or any text"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm font-normal text-foreground placeholder:text-muted-foreground disabled:opacity-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
        Photo
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          disabled={sending}
          className="text-sm font-normal text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1 file:text-sm file:text-foreground disabled:opacity-50"
        />
      </label>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={sending}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {sending ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
