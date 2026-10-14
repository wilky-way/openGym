import { mkdirSync, writeFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/index'
import { ROUTE_POLICY } from '../../contract/http/api'

// Schema listing only: never calls a tool, reads a profile, or opens a draft store.
const server = createMcpServer()
const client = new Client({ name: 'documentation-generator', version: '1' })
const [a, b] = InMemoryTransport.createLinkedPair()
await server.connect(a)
await client.connect(b)
try {
  const { tools } = await client.listTools()
  mkdirSync('docs', { recursive: true })
  writeFileSync('docs/mcp-tools.json', JSON.stringify(tools, null, 2) + '\n')
  writeFileSync('docs/MCP-TOOLS.md', '# MCP tool reference\n\nGenerated from the shipped registry. Input objects are strict; credentials belong in local environment configuration.\n\n' + tools.map(tool =>
    `## ${tool.name}\n\n${tool.description}\n\n\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\`\n`
  ).join('\n'))
  const rows = Object.entries(ROUTE_POLICY).filter(([route]) => !route.includes('/media'))
  writeFileSync('docs/HTTP-ROUTES.md', '# HTTP route-policy inventory\n\nGenerated from the executable contract policy. Retired media routes are omitted. Request/response shapes are in packages/contract/http/api.ts; current runtime security rules are described in API.md.\n\n| Route | Auth | CSRF | Rate buckets |\n| --- | --- | --- | --- |\n' + rows.map(([route, policy]) =>
    `| \`${route}\` | ${policy.auth} | ${policy.csrf} | ${'rate' in policy ? policy.rate.join(', ') : ''} |`
  ).join('\n') + '\n')
  console.log(`Generated ${tools.length} MCP tools and ${rows.length} route policies.`)
} finally {
  await client.close()
  await server.close()
}
