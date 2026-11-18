// Wire shapes of the /v1 collection routes (01.7-walking-skeleton design,
// "web-kit and Recipe Box"). Declared here rather than imported because the
// route schemas live in services/api and `@cauldron/core/collection` is
// Node-only; web-kit takes only the isomorphic `goals` and `compile` types.
import { type CompileState } from '@cauldron/core/compile'
import { type GoalField } from '@cauldron/core/goals'

export type { CompileState, GoalField }

export interface GoalSummary {
  slug: string
  name: string
  description: string | null
  icon: string | null
  accentColor: string | null
  version: number
  fields: GoalField[]
}

export interface GoalDetail extends GoalSummary {
  spec: Record<string, unknown>
}

export interface ItemEntry {
  id: string | null
  sourceId: string
  title: string
  state: CompileState
  failureReason: string | null
  capturedAt: string
}

export interface ItemDetail {
  id: string
  sourceId: string
  goal: { slug: string; name: string; version: number }
  title: string
  state: 'ready'
  // The image field's value is a short-lived signed URL, not a storage path.
  data: Record<string, unknown>
  capturedAt: string
}

export interface CaptureInput {
  goal: string
  text?: string
  image?: File
}

export interface CaptureResult {
  sourceId: string
  state: CompileState
}
