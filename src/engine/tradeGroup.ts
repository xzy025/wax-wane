import type { ParsedTrade, TradeGroup, TradeStatus } from '../types'

export function buildTradeGroups(trades: readonly ParsedTrade[]): TradeGroup[] {
  if (trades.length === 0) return []

  const sorted = [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))

  const stockPositions = new Map<string, number>()
  const activeGroupId = new Map<string, string>()

  interface GroupData {
    id: string
    stockCode: string
    stockName: string
    opened: string
    closed: string | null
    buyCount: number
    sellCount: number
    totalBuyAmount: number
    totalSellAmount: number
    totalFee: number
    realizedPnl: number
    totalBuyQuantity: number
  }

  const groups: GroupData[] = []
  let groupCounter = 0

  for (const trade of sorted) {
    const currentPos = stockPositions.get(trade.stockCode) ?? 0
    const fees = trade.commission + trade.stampTax + trade.transferFee + trade.otherFee

    if (trade.side === 'buy') {
      const newPos = currentPos + trade.quantity

      if (currentPos === 0) {
        groupCounter++
        const newGroup: GroupData = {
          id: `tg-${String(groupCounter).padStart(3, '0')}`,
          stockCode: trade.stockCode,
          stockName: trade.stockName,
          opened: trade.tradeDate,
          closed: null,
          buyCount: 0,
          sellCount: 0,
          totalBuyAmount: 0,
          totalSellAmount: 0,
          totalFee: 0,
          realizedPnl: 0,
          totalBuyQuantity: 0,
        }
        groups.push(newGroup)
        activeGroupId.set(trade.stockCode, newGroup.id)
      }

      const groupId = activeGroupId.get(trade.stockCode)
      if (groupId === undefined) continue
      const group = groups.find((g) => g.id === groupId)
      if (!group) continue
      group.buyCount++
      group.totalBuyAmount += trade.grossAmount
      group.totalBuyQuantity += trade.quantity
      group.totalFee += fees

      stockPositions.set(trade.stockCode, newPos)
    } else {
      const newPos = Math.max(0, currentPos - trade.quantity)

      const groupId = activeGroupId.get(trade.stockCode)
      const group = groups.find((g) => g.id === groupId)
      if (group) {
        const avgCost =
          group.totalBuyQuantity > 0 ? group.totalBuyAmount / group.totalBuyQuantity : 0
        const costRemoved = avgCost * trade.quantity
        const sellProceeds = trade.grossAmount - fees
        const pnlDelta = sellProceeds - costRemoved

        group.sellCount++
        group.totalSellAmount += trade.grossAmount
        group.totalFee += fees
        group.realizedPnl += pnlDelta

        if (newPos === 0) {
          group.closed = trade.tradeDate
          activeGroupId.delete(trade.stockCode)
        }
      }

      stockPositions.set(trade.stockCode, newPos)
    }
  }

  return groups.map((g) => {
    const holdingDays = g.closed
      ? Math.max(
          1,
          Math.ceil((new Date(g.closed).getTime() - new Date(g.opened).getTime()) / 86400000),
        )
      : Math.max(1, Math.ceil((Date.now() - new Date(g.opened).getTime()) / 86400000))

    const investedAmount = g.totalBuyAmount || 1
    const returnRate = (g.realizedPnl / investedAmount) * 100

    return {
      id: g.id,
      code: g.stockCode,
      name: g.stockName,
      opened: g.opened,
      closed: g.closed,
      pnl: Math.round(g.realizedPnl * 100) / 100,
      returnRate: Math.round(returnRate * 10) / 10,
      days: holdingDays,
      totalFee: Math.round(g.totalFee * 100) / 100,
      strategy: '' as const,
      mistakes: [],
      status: 'Not reviewed' as TradeStatus,
    }
  })
}
