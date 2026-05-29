import type { ToolModule } from '../types'

export const schema = {
  name: 'getLimitPool',
  description:
    'Get the current A-share limit-up or limit-down stock pool. ' +
    'Returns stock code, name, price, change%, turnover rate, first/last seal time, ' +
    'open count, consecutive days, and industry. ' +
    'Use when the user asks about which stocks hit the limit today.',
  parameters: {
    type: 'object' as const,
    properties: {
      direction: {
        type: 'string',
        enum: ['up', 'down'],
        description: '"up" for limit-up pool, "down" for limit-down pool (default: "up")',
      },
    },
    required: [],
  },
}

export async function execute(args: Record<string, unknown>): Promise<unknown> {
  const direction = args.direction === 'down' ? 'down' : 'up'
  const res = await fetch(`/api/mcp/ashare/limit-pool?direction=${direction}`)
  if (!res.ok) {
    const text = await res.text()
    return { error: `Failed to fetch limit pool: ${res.status} ${text}` }
  }
  return res.json()
}

export const getLimitPool: ToolModule = { schema, execute }
