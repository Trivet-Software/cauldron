// App-goal registration at startup (01.7-walking-skeleton task 6.4, Requirements 1.4, 1.5
// and 1.6; goal-engine Requirements 8.1 to 8.3). Reads apps/*/goal.json and stores each valid
// file as an app goal owned by the system owner, with the folder name as the slug. This is the
// one module allowed to import `@cauldron/core/db/system` (see eslint.config.js); the SQL
// itself lives in core's registerGoal().
//
// A bad file never stops startup: it is logged and skipped, and registerAppGoals() never
// rejects. Logs carry the file path and Zod issue paths and messages only, never the file's
// contents: JSON.parse messages quote the text, and database error details quote values.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { type Logger } from 'pino'

import { type Db } from '@cauldron/core/db'
import {
  type RegisterResult,
  registerGoal as defaultRegisterGoal,
  withSystem as defaultWithSystem,
} from '@cauldron/core/db/system'
import { goalFileSchema } from '@cauldron/core/goals'

export interface RegistrationOutcome {
  /** The app folder name. */
  slug: string
  status: RegisterResult['status'] | 'invalid' | 'error'
  version?: number
  /** Present for `invalid` (Zod issues) and for `error` outcomes that name a cause. */
  errors?: { path: string; message: string }[]
}

export interface RegisterAppGoalsOptions {
  db: Db
  /** Directory holding one folder per app, each with a goal.json. */
  appsDir: string
  logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>
  /** Injectable so tests need no database. Defaults to the system-actor transaction. */
  withSystem?: typeof defaultWithSystem
  /** Injectable alongside `withSystem`. Defaults to core's registerGoal(). */
  registerGoal?: typeof defaultRegisterGoal
}

const GOAL_FILE = 'goal.json'
// Postgres SQLSTATE unique_violation, and the tables migration's index that makes goal names
// unique per owner, case-insensitively.
const UNIQUE_VIOLATION = '23505'
const NAME_INDEX = 'goals_tenant_name_key'

/**
 * Registers every valid goal.json found one level below `appsDir`. Resolves with one outcome per app folder that
 * has a goal file, in folder-name order. Never rejects.
 */
export async function registerAppGoals(
  options: RegisterAppGoalsOptions,
): Promise<RegistrationOutcome[]> {
  const { appsDir, logger } = options
  try {
    let entries: string[]
    try {
      entries = (await readdir(appsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort()
    } catch (error) {
      logger.error({ appsDir, code: errorCode(error) }, 'could not list the apps directory')
      return []
    }

    const outcomes: RegistrationOutcome[] = []
    for (const slug of entries) {
      const outcome = await registerOne(options, slug)
      if (outcome) outcomes.push(outcome)
    }
    return outcomes
  } catch (error) {
    // Unreachable in practice (registerOne catches its own failures); the promise contract
    // is that startup never fails here.
    logger.error({ appsDir, errorName: errorName(error) }, 'app goal registration failed')
    return []
  }
}

/** Returns `undefined` for a folder without a goal file. */
async function registerOne(
  options: RegisterAppGoalsOptions,
  slug: string,
): Promise<RegistrationOutcome | undefined> {
  const { db, appsDir, logger } = options
  const withSystem = options.withSystem ?? defaultWithSystem
  const registerGoal = options.registerGoal ?? defaultRegisterGoal
  const file = path.join(appsDir, slug, GOAL_FILE)

  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      logger.debug({ path: file }, 'no goal file in app folder, skipping')
      return undefined
    }
    logger.error({ path: file, code }, 'could not read goal file, skipping')
    return { slug, status: 'error' }
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    // Not the SyntaxError message: it quotes the offending text.
    const errors = [{ path: '', message: 'The file is not valid JSON.' }]
    logger.error({ path: file, errors }, 'goal file is not valid JSON, skipping')
    return { slug, status: 'invalid', errors }
  }

  const parsed = goalFileSchema.safeParse(json)
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
    logger.error({ path: file, errors }, 'goal file is invalid, skipping')
    return { slug, status: 'invalid', errors }
  }

  try {
    const result = await withSystem(db, (scope) =>
      registerGoal(scope, { slug, spec: parsed.data }),
    )
    logger.info({ slug, status: result.status, version: result.version }, 'app goal registered')
    return { slug, status: result.status, version: result.version }
  } catch (error) {
    if (isDuplicateName(error)) {
      const errors = [{ path: 'name', message: 'Another app goal already uses this name.' }]
      logger.warn({ path: file, slug, errors }, 'duplicate app goal name, skipping')
      return { slug, status: 'error', errors }
    }
    // Name, SQLSTATE and constraint only: a Postgres message or detail can quote goal values.
    logger.error(
      { path: file, slug, errorName: errorName(error), code: errorCode(error) },
      'could not register app goal, skipping',
    )
    return { slug, status: 'error' }
  }
}

/** A name collision with another app goal. Duck-typed: `postgres` is off limits here. */
function isDuplicateName(error: unknown): boolean {
  // withSystem() rethrows driver errors as they are, except privilege errors it wraps.
  const candidates = [error, error instanceof Error ? error.cause : undefined]
  return candidates.some(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { code?: unknown }).code === UNIQUE_VIOLATION &&
      (candidate as { constraint_name?: unknown }).constraint_name === NAME_INDEX,
  )
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
