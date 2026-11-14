// Per-file setup for `pnpm test:db` (task 3.5): close the shared test pool after each file.
import { afterAll } from 'vitest'

import { closeTestDb } from './testing'

afterAll(() => closeTestDb())
