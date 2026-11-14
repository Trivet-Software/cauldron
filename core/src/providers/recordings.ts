// Recording stores for the mock and recording providers (01.5-backend-foundation
// Requirement 7.3). Node-only (node:fs), so this is reached through the
// `@cauldron/core/providers/mock` subpath, never the isomorphic `./providers`.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { CompletionResult, EmbeddingResult } from './types'
import type { RequestKind } from './request-key'

export type Recording =
  | { kind: 'complete'; request: unknown; result: CompletionResult }
  | { kind: 'embed'; request: unknown; result: EmbeddingResult }

/** Maps request keys (see `requestKey`) to recorded results. */
export interface RecordingStore {
  get(key: string): Promise<Recording | undefined>
  put(key: string, recording: Recording): Promise<void>
}

// Keys are SHA-256 hex. Checking the shape keeps a key from ever naming a
// path outside the recordings directory.
const KEY_PATTERN = /^[0-9a-f]{64}$/

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Invalid recording key: ${JSON.stringify(key)}`)
  }
}

const RECORDING_KINDS: readonly RequestKind[] = ['complete', 'embed']

function isRecording(value: unknown): value is Recording {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    RECORDING_KINDS.includes(v.kind as RequestKind) &&
    typeof v.result === 'object' &&
    v.result !== null
  )
}

/** In-memory store for tests. Values are cloned in and out, so callers can't mutate it. */
export function memoryRecordingStore(
  initial: Record<string, Recording> = {},
): RecordingStore & { readonly size: number; keys(): string[] } {
  const entries = new Map<string, Recording>()
  for (const [key, recording] of Object.entries(initial)) {
    entries.set(key, structuredClone(recording))
  }
  return {
    get size() {
      return entries.size
    },
    keys: () => [...entries.keys()],
    async get(key) {
      const recording = entries.get(key)
      return recording === undefined ? undefined : structuredClone(recording)
    },
    async put(key, recording) {
      entries.set(key, structuredClone(recording))
    },
  }
}

/** Reads and writes `<dir>/<key>.json`, one recording per file, for review in git. */
export function fileRecordingStore(dir: string): RecordingStore {
  const fileFor = (key: string) => {
    assertKey(key)
    return path.join(dir, `${key}.json`)
  }
  return {
    async get(key) {
      const file = fileFor(key)
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
      const parsed: unknown = JSON.parse(text)
      if (!isRecording(parsed)) {
        throw new Error(`Malformed recording file: ${file}`)
      }
      return parsed
    },
    async put(key, recording) {
      const file = fileFor(key)
      await mkdir(dir, { recursive: true })
      await writeFile(file, `${JSON.stringify(recording, null, 2)}\n`, 'utf8')
    },
  }
}
