import { afterEach, expect, test, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/index'
import { target } from './http-helpers'
let api: Awaited<ReturnType<typeof target>> | undefined
afterEach(async () => { vi.unstubAllEnvs(); if (api) { await api.close(); api = undefined } })
test('stdio entry permits token-free local authoring', () => {
  const result = spawnSync('bun', [new URL('../src/index.ts', import.meta.url).pathname], { env: { ...process.env, OPENGYM_URL: '', OPENGYM_UID: '', OPENGYM_TOKEN: '' }, encoding: 'utf8', timeout: 10000 })
  expect(result.stderr).not.toContain('CONFIG_REQUIRED'); expect(result.status).toBe(0)
})
test('actual MCP server lists legacy and authoring tools, serves authenticated JSON and wraps write errors', async () => {
  api = await target({ _rev: 7, _wid: 'epoch', routines: [{ id: 'r', name: 'Synthetic', ex: [] }], workouts: [] })
  for (const [key, value] of Object.entries(api.env)) vi.stubEnv(key, value)
  const server = createMcpServer(), client = new Client({ name: 'synthetic-client', version: '1' }), [a, b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(a); await client.connect(b)
    const listed = (await client.listTools()).tools
    expect(listed).toHaveLength(44); expect(listed.map(t=>t.name)).toContain('set_training_max'); expect(listed.map(t=>t.name)).toContain('create_routine')
    const answer: any = await client.callTool({ name: 'list_routines', arguments: {} })
    expect(JSON.parse(answer.content[0].text).routines[0].name).toBe('Synthetic')
    vi.stubEnv('OPENGYM_ENABLE_PROGRAMME_WRITES', '0')
    const refusal: any = await client.callTool({ name: 'shift_programme', arguments: { cycle_id: 'c', expected_rev: 7, expected_wid: 'epoch' } })
    expect(refusal.isError).toBe(true); expect(refusal.content[0].text).toMatch(/^WRITES_DISABLED:/)
    const maxRefusal: any = await client.callTool({name:'set_training_max',arguments:{cycle_id:'c',lift:'bench',value:100,unit:'lb',expected_rev:7,expected_wid:'epoch'}})
    expect(maxRefusal.isError).toBe(true);expect(maxRefusal.content[0].text).toMatch(/^NO_STATE:/)
  } finally { await client.close(); await server.close() }
})

test.each([
  {OPENGYM_URL:'http://127.0.0.1:1',OPENGYM_UID:'synthetic',OPENGYM_TOKEN:''},
  {OPENGYM_URL:'http://127.0.0.1:1',OPENGYM_UID:'synthetic',OPENGYM_TOKEN:'synthetic-unavailable'},
])('stdio local tools start with partial or unavailable API configuration %j',config=>{
  const result=spawnSync('bun',[new URL('../src/index.ts',import.meta.url).pathname],{env:{...process.env,...config},encoding:'utf8',timeout:10000})
  expect(result.status).toBe(0);expect(result.stderr).not.toContain('CONFIG_REQUIRED');expect(result.stderr).not.toContain('API_UNAVAILABLE')
})
