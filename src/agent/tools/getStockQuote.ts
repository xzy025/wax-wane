import type { ToolModule } from '../types'
import { normalizeSecurityCode } from '../../utils/securityCode'

export const schema = {
  name: 'getStockQuote',
  description:
    'Get a real-time quote for an A-share or HK stock. ' +
    'Returns price, change%, volume, turnover, market cap, P/E ratio. ' +
    "Use when the user asks about a specific stock's current price or performance.",
  parameters: {
    type: 'object' as const,
    properties: {
      stockCode: {
        type: 'string',
        description: 'A-share code (300750) or HK code (HK2476 / 02476)',
      },
    },
    required: ['stockCode'],
  },
}

export async function execute(args: Record<string, unknown>): Promise<unknown> {
  const code = typeof args.stockCode === 'string' ? args.stockCode : ''
  const security = normalizeSecurityCode(code)
  if (!security) {
    return {
      error: 'Invalid stock code. Use an A-share code like 300750 or an HK code like HK2476.',
    }
  }

  const res =
    security.market === 'HK'
      ? await fetch(`/api/hk/quote?codes=${encodeURIComponent(security.symbol)}`)
      : await fetch(`/api/mcp/ashare/quote?code=${encodeURIComponent(security.symbol)}`)
  if (!res.ok) {
    const text = await res.text()
    return { error: `Failed to fetch quote: ${res.status} ${text}` }
  }
  const data = await res.json()
  if (security.market === 'HK') {
    const quote = (data as { quotes?: unknown[] })?.quotes?.[0]
    return quote ?? { error: `HK stock ${security.symbol} not found.` }
  }
  return data
}

export const getStockQuote: ToolModule = { schema, execute }
