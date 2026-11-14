// `ping` job handler (01.5-backend-foundation task 7.2, Requirement 6.3). A no-op: the
// worker marks the job done when the handler resolves, which proves claim → dispatch →
// complete works end to end.
import { type JobHandler } from './index'

export const pingHandler: JobHandler = async () => {}
