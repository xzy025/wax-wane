import type { ToolModule } from '../types'

export const schema = {
  name: 'getMarketBreadth',
  description:
    'Get current A-share market breadth: advance/decline/flat counts, limit-up/down counts, ' +
    'promotion rate (consecutive limit-up rate), and new-high stock count. ' +
    'Use when the user asks about overall market sentiment or breadth.',
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
}

export async function execute(): Promise<unknown> {
  const res = await fetch('/api/mcp/ashare/breadth')
  if (!res.ok) {
    const text = await res.text()
    return { error: `Failed to fetch market breadth: ${res.status} ${text}` }
  }
  return res.json()
}

export const getMarketBreadth: ToolModule = { schema, execute }
