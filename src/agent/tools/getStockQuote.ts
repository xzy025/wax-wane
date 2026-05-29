import type { AppState } from '../../store'
import type { ToolModule } from '../types'

export const schema = {
  name: 'getStockQuote',
  description:
    'Get real-time quote for an individual A-share stock by 6-digit code. ' +
    'Returns price, change%, volume, turnover, market cap, P/E ratio. ' +
    'Use when the user asks about a specific stock\'s current price or performance.',
  parameters: {
    type: 'object' as const,
    properties: {
      stockCode: {
        type: 'string',
        description: '6-digit stock code (e.g., "300750" for CATL)',
      },
    },
    required: ['stockCode'],
  },
}

export async function execute(args: Record<string, unknown>): Promise<unknown> {
  const code = typeof args.stockCode === 'string' ? args.stockCode : ''
  if (!code || !/^\d{6}$/.test(code)) {
    return { error: 'Invalid stock code. Provide a 6-digit code like "300750".' }
  }

  const res = await fetch(`/api/mcp/ashare/quote?code=${code}`)
  if (!res.ok) {
    const text = await res.text()
    return { error: `Failed to fetch quote: ${res.status} ${text}` }
  }
  return res.json()
}

export const getStockQuote: ToolModule = { schema, execute }
