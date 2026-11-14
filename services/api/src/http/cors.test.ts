import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { cors } from './cors'

const ALLOWED = 'https://app.example.com'

function makeApp() {
  const app = new Hono()
  app.use('/v1/*', cors([ALLOWED, 'http://localhost:5173']))
  app.get('/v1/ping', (c) => c.json({ ok: true }))
  return app
}

function get(origin: string) {
  return makeApp().request('/v1/ping', { headers: { Origin: origin } })
}

function preflight(origin: string) {
  return makeApp().request('/v1/ping', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization, x-evil',
    },
  })
}

describe('cors', () => {
  it('echoes an allowed origin and varies on Origin', async () => {
    const res = await get(ALLOWED)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED)
    expect(res.headers.get('Vary')).toContain('Origin')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it.each([
    'https://evil.example',
    'https://app.example.com.evil.com',
    'https://evilapp.example.com',
    'http://app.example.com',
    'https://app.example.com:8443',
    'https://app.example.com/',
    'http://localhost:5174',
    'null',
  ])('sends no Access-Control-Allow-Origin for %s', async (origin) => {
    const res = await get(origin)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('sends no Access-Control-Allow-Origin without an Origin header', async () => {
    const res = await makeApp().request('/v1/ping')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers a preflight with the fixed headers, max age and no credentials', async () => {
    const res = await preflight(ALLOWED)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED)
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
      'Authorization,Content-Type',
    )
    expect(res.headers.get('Access-Control-Max-Age')).toBe('600')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('gives a preflight from another origin no Access-Control-Allow-Origin', async () => {
    const res = await preflight('https://app.example.com.evil.com')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
