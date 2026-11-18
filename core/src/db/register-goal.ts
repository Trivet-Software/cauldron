// App-goal registration SQL (01.7-walking-skeleton task 5.1, Requirements 1.4 and 1.5;
// goal-engine Requirements 8.1 and 8.2). Re-exported from `@cauldron/core/db/system`, whose
// only permitted importer is the API's registration module, which reads the goal files and
// calls this inside withSystem(). The SQL lives here so `pnpm test:db` covers it in core.
// Node-only: it hashes with node:crypto.
import { createHash } from 'node:crypto'

import type postgres from 'postgres'

import { canonicalJson, type GoalFile } from '../goals'

import { SYSTEM_OWNER } from './actor'
import { type Scoped } from './scoped'

export type RegisterStatus = 'created' | 'updated' | 'unchanged'

export interface RegisterResult {
  status: RegisterStatus
  /** The goal's latest version after the call. */
  version: number
}

export interface RegisterGoalInput {
  /** The app folder name (goal-engine Requirement 8.3). */
  slug: string
  /** A goal file that already passed `goalFileSchema`. */
  spec: GoalFile
}

/** `sha256` of the canonical JSON, so key order and whitespace never change the hash. */
export function goalContentHash(spec: GoalFile): string {
  return createHash('sha256').update(canonicalJson(spec)).digest('hex')
}

/**
 * Stores `spec` as the app goal `slug`, creating a new version only when the content differs
 * from the latest one. Must run inside the caller's `withSystem()` transaction.
 *
 * 1. Insert the goal if absent.
 * 2. Lock its row. Two API instances starting together queue here, and the second one reads the
 *    first one's committed `latest_version` (READ COMMITTED re-reads a locked row), so it
 *    sees `unchanged` instead of racing to insert the same version. The
 *    `unique (goal_id, version)` constraint is the backstop.
 * 3. Compare hashes: equal means nothing is written.
 * 4. Otherwise insert the next version and update the goal's display fields.
 *
 * Statements use no named prepared statements, which the transaction-mode pooler requires
 * (`prepare: false`).
 */
export async function registerGoal(
  scope: Scoped,
  input: RegisterGoalInput,
): Promise<RegisterResult> {
  // Guards against a user scope: these rows are owned by 'system', which a user's RLS context
  // could not write anyway, but a clear error beats an RLS violation.
  if (scope.actor.kind !== 'system') {
    throw new TypeError('registerGoal() must run inside withSystem().')
  }

  const { sql } = scope
  const { slug, spec } = input

  await sql`
    insert into public.goals (tenant_id, user_id, kind, slug, name, description, icon, accent_color)
    values (${SYSTEM_OWNER}, ${SYSTEM_OWNER}, 'app', ${slug}, ${spec.name},
            ${spec.description ?? null}, ${spec.icon ?? null}, ${spec.accentColor ?? null})
    on conflict (tenant_id, slug) do nothing`

  const [goal] = await sql<{ id: string; latest_version: number | null }[]>`
    select id, latest_version
    from public.goals
    where tenant_id = ${SYSTEM_OWNER} and slug = ${slug}
    for update`
  if (!goal) {
    throw new Error(`App goal "${slug}" is missing right after it was inserted.`)
  }

  const contentHash = goalContentHash(spec)
  const latest = goal.latest_version

  if (latest !== null) {
    const [current] = await sql<{ content_hash: string }[]>`
      select content_hash
      from public.goal_versions
      where tenant_id = ${SYSTEM_OWNER} and goal_id = ${goal.id} and version = ${latest}`
    if (current?.content_hash === contentHash) {
      return { status: 'unchanged', version: latest }
    }
  }

  const version = (latest ?? 0) + 1
  await sql`
    insert into public.goal_versions
      (tenant_id, user_id, goal_id, version, schema_version, spec, content_hash, author)
    values (${SYSTEM_OWNER}, ${SYSTEM_OWNER}, ${goal.id}, ${version}, 1,
            ${sql.json(spec as unknown as postgres.JSONValue)}, ${contentHash}, 'deploy')`
  await sql`
    update public.goals
    set name = ${spec.name},
        description = ${spec.description ?? null},
        icon = ${spec.icon ?? null},
        accent_color = ${spec.accentColor ?? null},
        latest_version = ${version}
    where tenant_id = ${SYSTEM_OWNER} and id = ${goal.id}`

  return { status: version === 1 ? 'created' : 'updated', version }
}
