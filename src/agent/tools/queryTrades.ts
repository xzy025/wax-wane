import type { AppState } from '../../store'
import type { ToolModule } from '../types'

export const schema = {
  name: 'queryTradeHistory',
  description:
    'Query raw trade records filtered by stock code, date range, or side (buy/sell). ' +
    'Use this when the user asks about specific trades, wants to see what they bought or sold, or needs trade-level detail.',
  parameters: {
    type: 'object' as const,
    properties: {
      stockCode: { type: 'string', description: '6-digit stock code to filter by (e.g., "300750")' },
      startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
      endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
      side: { type: 'string', enum: ['buy', 'sell'], description: 'Filter by trade side' },
      limit: { type: 'number', description: 'Max results to return (default 20)' },
    },
    required: [],
  },
}

export function execute(
  args: Record<string, unknown>,
  state: AppState,
): Array<Record<string, unknown>> {
  let trades = [...state.trades]

  const stockCode = args.stockCode as string | undefined
  const startDate = args.startDate as string | undefined
  const endDate = args.endDate as string | undefined
  const side = args.side as 'buy' | 'sell' | undefined
  const limit = (args.limit as number) ?? 20

  if (stockCode) {
    trades = trades.filter((t) => t.stockCode === stockCode)
  }
  if (startDate) {
    trades = trades.filter((t) => t.tradeDate >= startDate)
  }
  if (endDate) {
    trades = trades.filter((t) => t.tradeDate <= endDate)
  }
  if (side) {
    trades = trades.filter((t) => t.side === side)
  }

  return trades.slice(0, limit).map((t) => ({
    date: t.tradeDate,
    code: t.stockCode,
    name: t.stockName,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    amount: t.grossAmount,
    fee: t.commission + t.stampTax + t.transferFee + t.otherFee,
  }))
}

export const queryTrades: ToolModule = { schema, execute }
