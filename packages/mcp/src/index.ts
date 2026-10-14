#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { TOOLS } from './tools'
import { parseInput } from './draft-ops'
import type { Tool } from './tool-types'

export function createMcpServer(tools = TOOLS): McpServer {
  const server = new McpServer({ name: 'opengym', version: '0.3.0' })
  const invoke = async (tool: Tool, params: unknown) => {
    try {
      // Refuse unknown top-level keys within the credential scope, including diagnostics.
      const run = () => tool.handler(parseInput(z.object(tool.schema).strict(), params ?? {}))
      const result = await (tool.withRedaction ? tool.withRedaction(run) : run())
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    }
    catch (err) {
      const failure = err as { code?: string; message?: string }
      return { isError: true, content: [{ type: 'text' as const, text: `${failure.code || 'ERROR'}: ${failure.message || 'Tool failed.'}` }] }
    }
  }
  for (const tool of tools) server.tool(tool.name, tool.description, tool.schema, params => invoke(tool, params))
  // Keep the SDK's advertised schemas/listing; own the call boundary so its
  // pre-handler Zod errors cannot echo raw nested keys or invalid enum values.
  server.server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = tools.find(tool => tool.name === request.params.name)
    return tool ? invoke(tool, request.params.arguments) : { isError: true, content: [{ type: 'text' as const, text: 'EINVAL: Unknown tool.' }] }
  })
  return server
}
if (import.meta.main) {
  try {
    await createMcpServer().connect(new StdioServerTransport())
  } catch (err) {
    const failure = err as { code?: string; message?: string }
    console.error(`[opengym-mcp] ${failure.code || 'ERROR'}: ${failure.message || 'Startup failed.'}`)
    process.exitCode = 1
  }
}
