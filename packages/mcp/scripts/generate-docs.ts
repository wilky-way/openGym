import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/index'
import { TOOLS } from '../src/tools'
import { ROUTE_POLICY } from '../../contract/http/api'

// Schema listing only: never calls a tool, reads a profile, or opens a draft store.
export async function generateDocs(check = false): Promise<void> {
const server = createMcpServer()
const client = new Client({ name: 'documentation-generator', version: '1' })
const [a, b] = InMemoryTransport.createLinkedPair()
await server.connect(a)
await client.connect(b)
try {
  const { tools } = await client.listTools()
  if (tools.length !== 44 || new Set(tools.map(tool => tool.name)).size !== 44) throw new Error('Expected exactly 44 unique MCP tools')
  for (const tool of tools) {
    const registered = TOOLS.find(candidate => candidate.name === tool.name)
    if (!registered || JSON.stringify(Object.keys(tool.inputSchema.properties ?? {}).sort()) !== JSON.stringify(Object.keys(registered.schema).sort())) throw new Error(`MCP schema fields drifted: ${tool.name}`)
  }
  const outputs: Record<string, string> = {}
  outputs['docs/mcp-tools.json'] = JSON.stringify(tools, null, 2) + '\n'
  outputs['docs/MCP-TOOLS.md'] = '# MCP tool reference\n\nGenerated from the shipped registry. Schemas below reproduce the SDK listTools response, including its omission of additionalProperties on top-level objects. The runtime call boundary independently refuses unknown top-level keys with strict validation. Credentials belong in local environment configuration.\n\n' + tools.map(tool =>
    `## ${tool.name}\n\n${tool.description}\n\n\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\`\n`
  ).join('\n')
  const rows = Object.entries(ROUTE_POLICY).filter(([route]) => !route.includes('/media'))
  outputs['docs/HTTP-ROUTES.md'] = '# HTTP route-policy inventory\n\nGenerated from the executable contract policy. Retired media routes are omitted. Request/response shapes are in packages/contract/http/api.ts; current runtime security rules are described in API.md.\n\n| Route | Auth | CSRF | Rate buckets |\n| --- | --- | --- | --- |\n' + rows.map(([route, policy]) =>
    `| \`${route}\` | ${policy.auth} | ${policy.csrf} | ${'rate' in policy ? policy.rate.join(', ') : ''} |`
  ).join('\n') + '\n'
  if (!check) mkdirSync('docs', { recursive: true })
  for (const [path, text] of Object.entries(outputs)) {
    if (check) {
      if (readFileSync(path, 'utf8') !== text) throw new Error(`Generated documentation drift: ${path}`)
    } else writeFileSync(path, text)
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${tools.length} MCP tools and ${rows.length} route policies.`)
} finally {
  await client.close()
  await server.close()
}
}
if (import.meta.main) await generateDocs(process.argv.includes('--check'))
