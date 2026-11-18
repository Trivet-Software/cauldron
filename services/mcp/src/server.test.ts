import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'

import { createServer } from './server'

// Smoke test for the transport pattern from task 1.1. The tool tests are in task 9.4.
describe('mcp server over the in-memory transport', () => {
  const closers: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()))
  })

  it('lists the tools and the example goal resource', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createServer({
      baseUrl: 'http://localhost:8787',
      token: 'unused-in-this-test',
      fetch: () => Promise.reject(new Error('no request expected')),
    })
    const client = new Client({ name: 'test', version: '0.0.0' })
    closers.push(() => client.close(), () => server.close())

    await server.connect(serverTransport)
    await client.connect(clientTransport)

    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['capture', 'get_item', 'list_goals', 'search'])

    const { resources } = await client.listResources()
    expect(resources.map((resource) => resource.uri)).toEqual(['examples://goals/recipe-box'])
  })
})
