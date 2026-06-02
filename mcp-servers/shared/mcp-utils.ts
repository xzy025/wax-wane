// Shared MCP Server utilities
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// ── Tool Definition Type ──────────────────────────────────

export interface MCPToolDef {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
    }>
    required?: string[]
  }
}

export type MCPToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }> }>

// ── MCP Server Builder ────────────────────────────────────

export function createMCPServer(
  name: string,
  version: string,
  tools: Array<{ def: MCPToolDef; handler: MCPToolHandler }>,
): Server {
  const server = new Server(
    { name, version },
    { capabilities: { tools: {} } },
  )

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => t.def),
    }
  })

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: args } = request.params

    const tool = tools.find((t) => t.def.name === toolName)
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      }
    }

    try {
      return await tool.handler((args ?? {}) as Record<string, unknown>)
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        }],
        isError: true,
      }
    }
  })

  return server
}

// ── Start Server ──────────────────────────────────────────

export async function startMCPServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[MCP] Server started`)
}

// ── Response Helpers ──────────────────────────────────────

export function textResult(text: string) {
  return { content: [{ type: 'text', text }] }
}

export function jsonResult(data: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}
