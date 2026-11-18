// Startup failure paths (01.5-backend-foundation task 9.8, Requirement 8.3)
// and dev auth mode guards, logging and the AUTH_MODE-unset path
// (01.7-walking-skeleton task 6.3, Requirements 8.3, 8.5 and 8.6), plus the
// dev token and startup warning through startApi and `listening` waiting for
// app goal registration (task 6.9, Requirements 1.4, 8.1, 8.5, 8.6).
// The failure paths fail before any port or connection opens.
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EMBEDDING_COLUMN_DIMENSIONS } from '@cauldron/core/db'
import { loadEnv } from './env'
import {
  StartupError,
  checkAuthMode,
  checkEmbeddingDimensions,
  createLogger,
  main,
  startApi,
} from './main'

const DEV_TOKEN = 'dev-token-0123456789-0123456789-abcdef'

const baseSource = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'pk',
  CLERK_SECRET_KEY: 'sk_test_x',
  APP_ORIGINS: 'https://app.example.com',
  PROVIDERS: 'mock',
  MOCK_RECORDINGS_DIR: '/tmp/unused',
}

const devSource = {
  ...baseSource,
  AUTH_MODE: 'dev',
  DEV_API_TOKEN: DEV_TOKEN,
  DEV_USER_ID: 'user_dev_1',
  SUPABASE_SECRET_KEY: 'sb_secret_test_value',
}

// startApi registers app goals from APPS_DIR; an empty directory keeps these
// tests off the (unreachable) database and off the real apps/ folder.
let appsDir: string
let jwtKey: string

beforeAll(async () => {
  appsDir = await mkdtemp(path.join(tmpdir(), 'api-main-test-'))
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  jwtKey = publicKey.export({ type: 'spki', format: 'pem' }).toString()
})

afterAll(async () => {
  await rm(appsDir, { recursive: true, force: true })
})

/** A pino destination that keeps what was written. */
function captureStream() {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })
  return { stream, text: () => chunks.join('') }
}

describe('main', () => {
  it('names missing variables on stderr, without values, and exits 1', () => {
    const exit = vi.fn()
    const writeStderr = vi.fn()
    const running = main({ CLERK_SECRET_KEY: 'sk_test_secret' }, { exit, writeStderr })

    expect(running).toBeUndefined()
    expect(exit).toHaveBeenCalledWith(1)
    const message = writeStderr.mock.calls.map(([text]) => text).join('')
    expect(message).toContain('DATABASE_URL')
    expect(message).toContain('APP_ORIGINS')
    expect(message).not.toContain('sk_test_secret')
  })

  it('names a too-short DEV_API_TOKEN on stderr without echoing it, and exits 1 (8.4)', () => {
    const exit = vi.fn()
    const writeStderr = vi.fn()
    const shortToken = 'short-secret-token'
    const running = main({ ...devSource, DEV_API_TOKEN: shortToken }, { exit, writeStderr })

    expect(running).toBeUndefined()
    expect(exit).toHaveBeenCalledWith(1)
    const message = writeStderr.mock.calls.map(([text]) => text).join('')
    expect(message).toContain('DEV_API_TOKEN')
    expect(message).not.toContain(shortToken)
  })

  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['RAILWAY_ENVIRONMENT', { RAILWAY_ENVIRONMENT: 'production' }],
  ])('refuses to start in dev mode with %s and exits 1 (8.3)', (_label, extra) => {
    const exit = vi.fn()
    const writeStderr = vi.fn()
    // main() builds its own logger from LOG_LEVEL; silence it so the fatal line stays out of test output.
    const running = main({ ...devSource, ...extra, LOG_LEVEL: 'silent' }, { exit, writeStderr })

    expect(running).toBeUndefined()
    expect(exit).toHaveBeenCalledWith(1)
  })
})

describe('checkEmbeddingDimensions', () => {
  it('accepts the column size', () => {
    expect(() => checkEmbeddingDimensions(EMBEDDING_COLUMN_DIMENSIONS)).not.toThrow()
  })

  it('rejects any other size, naming both numbers', () => {
    expect(() => checkEmbeddingDimensions(768)).toThrow(StartupError)
    expect(() => checkEmbeddingDimensions(768)).toThrow(
      new RegExp(`768.*${EMBEDDING_COLUMN_DIMENSIONS}`),
    )
  })
})

// Requirement 8.3.
describe('checkAuthMode', () => {
  it('throws a StartupError naming both variables for dev mode with NODE_ENV=production', () => {
    const env = { AUTH_MODE: 'dev' as const, NODE_ENV: 'production', RAILWAY_ENVIRONMENT: undefined }
    expect(() => checkAuthMode(env)).toThrow(StartupError)
    expect(() => checkAuthMode(env)).toThrow(/NODE_ENV=production.*RAILWAY_ENVIRONMENT/)
  })

  it('throws for dev mode with RAILWAY_ENVIRONMENT set, whatever NODE_ENV is', () => {
    const env = { AUTH_MODE: 'dev' as const, NODE_ENV: undefined, RAILWAY_ENVIRONMENT: 'production' }
    expect(() => checkAuthMode(env)).toThrow(StartupError)
    expect(() => checkAuthMode({ ...env, NODE_ENV: 'development' })).toThrow(StartupError)
  })

  it('never puts the token in the message', () => {
    const env = loadEnv({ ...devSource, NODE_ENV: 'production' })
    const message = (() => {
      try {
        checkAuthMode(env)
      } catch (err) {
        return (err as Error).message
      }
      return ''
    })()
    expect(message).not.toBe('')
    expect(message).not.toContain(DEV_TOKEN)
    expect(message).not.toContain(devSource.SUPABASE_SECRET_KEY)
  })

  it('allows dev mode outside a deployed environment', () => {
    expect(() =>
      checkAuthMode({ AUTH_MODE: 'dev', NODE_ENV: undefined, RAILWAY_ENVIRONMENT: undefined }),
    ).not.toThrow()
    expect(() =>
      checkAuthMode({ AUTH_MODE: 'dev', NODE_ENV: 'development', RAILWAY_ENVIRONMENT: undefined }),
    ).not.toThrow()
  })

  it.each([undefined, 'clerk' as const])(
    'allows AUTH_MODE=%s in a deployed environment',
    (mode) => {
      expect(() =>
        checkAuthMode({ AUTH_MODE: mode, NODE_ENV: 'production', RAILWAY_ENVIRONMENT: 'production' }),
      ).not.toThrow()
    },
  )

  it('makes startApi throw before it opens a pool or a port', () => {
    const env = loadEnv({ ...devSource, RAILWAY_ENVIRONMENT: 'production' })
    expect(() => startApi(env, { log: createLogger('silent') })).toThrow(StartupError)
  })
})

// Requirement 8.6 (the token is never logged).
describe('logger redaction', () => {
  it('redacts DEV_API_TOKEN and SUPABASE_SECRET_KEY when env is logged', () => {
    const logs = captureStream()
    const log = createLogger('info', logs.stream)
    log.info({ env: loadEnv(devSource) }, 'config')
    log.warn({ config: { DEV_API_TOKEN: DEV_TOKEN, SUPABASE_SECRET_KEY: 'sb_secret_test_value' } }, 'config')

    const text = logs.text()
    expect(text).toContain('[redacted]')
    expect(text).not.toContain(DEV_TOKEN)
    expect(text).not.toContain('sb_secret_test_value')
  })

  it('redacts the Authorization header', () => {
    const logs = captureStream()
    createLogger('info', logs.stream).info(
      { req: { headers: { authorization: `Bearer ${DEV_TOKEN}` } } },
      'request',
    )
    expect(logs.text()).not.toContain(DEV_TOKEN)
  })
})

// Requirement 8.5: with AUTH_MODE unset only Clerk session tokens are accepted.
// Runs the real startApi on a free port with a networkless Clerk key. No request
// reaches the database: the dev token is rejected before any route runs.
describe('startApi with AUTH_MODE unset', () => {
  it('returns 401 for the dev token string, even when DEV_API_TOKEN is configured, and never logs it', async () => {
    const env = loadEnv({
      ...baseSource,
      APPS_DIR: appsDir,
      CLERK_JWT_KEY: jwtKey,
      DEV_API_TOKEN: DEV_TOKEN,
      DEV_USER_ID: 'user_dev_1',
    })
    expect(env.AUTH_MODE).toBeUndefined()

    const logs = captureStream()
    const running = startApi(env, { port: 0, log: createLogger('info', logs.stream) })
    try {
      const port = await running.listening
      const res = await fetch(`http://127.0.0.1:${port}/v1/me`, {
        headers: { Authorization: `Bearer ${DEV_TOKEN}` },
      })
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ error: { code: 'unauthorized', status: 401 } })
      expect(logs.text()).not.toContain(DEV_TOKEN)
    } finally {
      await running.stop()
    }
  })

})

const WARNING = 'dev auth mode is active'

function logLines(text: string): { level: number; msg?: string }[] {
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { level: number; msg?: string })
}

// Requirements 8.1, 8.6 and 8.7: the dev token through the real startApi.
// The developer role lookup is replaced because it would call Clerk's API.
describe('startApi in dev mode', () => {
  it('accepts the dev token as DEV_USER_ID, and any other token still goes to Clerk', async () => {
    const env = loadEnv({ ...devSource, APPS_DIR: appsDir, CLERK_JWT_KEY: jwtKey })
    const running = startApi(env, {
      port: 0,
      log: createLogger('silent'),
      developerRole: async () => false,
    })
    try {
      const port = await running.listening
      const ok = await fetch(`http://127.0.0.1:${port}/v1/me`, {
        headers: { Authorization: `Bearer ${DEV_TOKEN}` },
      })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toEqual({
        userId: 'user_dev_1',
        tenantId: 'user_dev_1',
        isDeveloper: false,
      })

      const other = await fetch(`http://127.0.0.1:${port}/v1/me`, {
        headers: { Authorization: `Bearer ${DEV_TOKEN}x` },
      })
      expect(other.status).toBe(401)
    } finally {
      await running.stop()
    }
  })

  it('logs one startup warning at warn level and never the token', async () => {
    const env = loadEnv({ ...devSource, APPS_DIR: appsDir, CLERK_JWT_KEY: jwtKey })
    const logs = captureStream()
    const running = startApi(env, { port: 0, log: createLogger('info', logs.stream) })
    try {
      const port = await running.listening
      // A request with the token, so a request log line exists to be checked too.
      await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Authorization: `Bearer ${DEV_TOKEN}` },
      })
    } finally {
      await running.stop()
    }

    const warnings = logLines(logs.text()).filter((line) => line.msg?.includes(WARNING))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.level).toBe(40)
    expect(logs.text()).not.toContain(DEV_TOKEN)
    expect(logs.text()).not.toContain(devSource.SUPABASE_SECRET_KEY)
  })

  it.each([
    ['unset', undefined],
    ['clerk', 'clerk'],
  ])('logs no dev warning when AUTH_MODE is %s', async (_label, mode) => {
    const env = loadEnv({
      ...baseSource,
      APPS_DIR: appsDir,
      CLERK_JWT_KEY: jwtKey,
      ...(mode === undefined ? {} : { AUTH_MODE: mode }),
    })
    const logs = captureStream()
    const running = startApi(env, { port: 0, log: createLogger('info', logs.stream) })
    try {
      await running.listening
    } finally {
      await running.stop()
    }
    expect(logs.text()).not.toContain(WARNING)
  })
})

// Requirement 1.4: `listening` waits for registration, which logs and moves on
// from a bad goal file (and from a missing apps directory).
describe('startApi app goal registration', () => {
  it('has finished registration when listening resolves', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'api-main-apps-'))
    await mkdir(path.join(dir, 'broken'))
    await writeFile(path.join(dir, 'broken', 'goal.json'), '{}')
    const logs = captureStream()
    const running = startApi(loadEnv({ ...baseSource, APPS_DIR: dir, CLERK_JWT_KEY: jwtKey }), {
      port: 0,
      log: createLogger('info', logs.stream),
    })
    try {
      await running.listening
      const lines = logLines(logs.text())
      expect(lines.some((line) => line.msg === 'goal file is invalid, skipping')).toBe(true)
    } finally {
      await running.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('still listens when the apps directory does not exist', async () => {
    const running = startApi(
      loadEnv({ ...baseSource, APPS_DIR: path.join(appsDir, 'missing'), CLERK_JWT_KEY: jwtKey }),
      { port: 0, log: createLogger('silent') },
    )
    try {
      expect(await running.listening).toBeGreaterThan(0)
    } finally {
      await running.stop()
    }
  })
})
