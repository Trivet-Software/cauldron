// Environment for the MCP server (01.7-walking-skeleton task 9.3, Requirement 9.2).
// `parseEnv` errors name the missing or invalid variables and never print their values,
// so the token cannot reach stderr through a startup failure.
import { parseEnv } from '@cauldron/core/env'
import { z } from 'zod'

export const mcpEnvSchema = z.object({
  API_BASE_URL: z.url({ protocol: /^https?$/ }),
  DEV_API_TOKEN: z.string().min(1),
})

export type McpEnv = z.output<typeof mcpEnvSchema>

/** Throws `EnvError` naming every missing or invalid variable. */
export function parseMcpEnv(source: Record<string, string | undefined>): McpEnv {
  return parseEnv(mcpEnvSchema, source)
}
