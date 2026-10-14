import { expect, it } from 'vitest'
import { createTools } from '../src/tools'
import { createMcpServer } from '../src/index'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
const initial = 'synthetic-redaction-initial-secret', renewed = 'synthetic-redaction-renewed-secret'
const fixture = () => createTools({env: {OPENGYM_URL: 'http://localhost:1', OPENGYM_UID: 'u', OPENGYM_TOKEN: initial}, fetcher: async url => new Response(JSON.stringify(
  url.endsWith('/api/me') ? {user: {id: 'u', name: initial}, token: renewed} : url.endsWith('/api/data/rev') ? {rev: 1} : {rev: 1, state: {routines: [{id: 'r', name: initial, note: renewed, ex: []}], workouts: [], unit: 'kg'}}))})
it('redacts initial and renewed credentials from legacy read results', async () => {
  const tools = fixture(), result = await tools.find(t => t.name === 'get_routine')!.handler({routine_id: 'r'})
  expect(JSON.stringify(result)).not.toContain(initial); expect(JSON.stringify(result)).not.toContain(renewed)
})
it('rejects unknown top-level keys inside the redaction scope on the SDK wire', async () => {
  const server = createMcpServer(fixture()), client = new Client({name: 'i03', version: '1'})
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)])
  try {
    const result = await client.callTool({name: 'get_routine', arguments: {routine_id: 'r', [initial]: true}})
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain(initial)
  } finally {await client.close(); await server.close()}
})
