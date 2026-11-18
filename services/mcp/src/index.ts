// MCP test transport (decided in task 1.1, reused by the tool tests in task 9.4):
// tests use the SDK's in-memory pair. Connect a Client and the server to the two ends of
// `InMemoryTransport.createLinkedPair()` (exported by `@modelcontextprotocol/client`).
// v2 ships it, it needs no child process or port, and it runs in-process, so a fake
// `fetch` can be injected into the tools. A stdio child process was not needed. `createServer`
// lives in `./server.ts` so tests import it without starting `serveStdio`. See
// `src/server.test.ts` for the working pattern.
//
// stdout belongs to the protocol. Write logs and errors to stderr only (`console.error`);
// never `console.log`.
import { EnvError } from '@cauldron/core/env'
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { parseMcpEnv } from './env'
import { createServer } from './server'

// Requirement 9.2: fail fast, naming the variables. The message carries names only.
function loadEnvOrExit() {
  try {
    return parseMcpEnv(process.env)
  } catch (err) {
    if (err instanceof EnvError) {
      process.stderr.write(`${err.message}\n`)
      process.exit(1)
    }
    throw err
  }
}

const env = loadEnvOrExit()

serveStdio(() => createServer({ baseUrl: env.API_BASE_URL, token: env.DEV_API_TOKEN }))
