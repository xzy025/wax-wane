import type { ParsedTrade } from '../types'

export interface PositionState {
  quantity: number
  avgCost: number
  costBasis: number
  realizedPnl: number
  totalFees: number
}

function createEmptyPosition(): PositionState {
  return { quantity: 0, avgCost: 0, costBasis: 0, realizedPnl: 0, totalFees: 0 }
}

export function validateTrades(
  trades: readonly ParsedTrade[],
  existingPositions?: ReadonlyMap<string, number>,
): ParsedTrade[] {
  const positions = new Map<string, number>(existingPositions ?? [])
  const sorted = [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))

  return sorted.map((trade) => {
    const currentPos = positions.get(trade.stockCode) ?? 0

    if (trade.side === 'buy') {
      positions.set(trade.stockCode, currentPos + trade.quantity)
      return { ...trade, validationStatus: 'valid' as const, validationMessage: undefined }
    }

    // sell
    if (trade.quantity > currentPos) {
      return {
        ...trade,
        validationStatus: 'error' as const,
        validationMessage: `卖出数量(${trade.quantity})超过可用持仓(${currentPos})`,
      }
    }
    positions.set(trade.stockCode, currentPos - trade.quantity)
    return { ...trade, validationStatus: 'valid' as const, validationMessage: undefined }
  })
}

export function getPositionQuantities(trades: readonly ParsedTrade[]): Map<string, number> {
  const positions = new Map<string, number>()
  const sorted = [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
  for (const trade of sorted) {
    const pos = positions.get(trade.stockCode) ?? 0
    positions.set(
      trade.stockCode,
      trade.side === 'buy' ? pos + trade.quantity : pos - trade.quantity,
    )
  }
  return positions
}

export function reconstructPositions(trades: readonly ParsedTrade[]): Map<string, PositionState> {
  const positions = new Map<string, PositionState>()

  const sorted = [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))

  for (const trade of sorted) {
    const pos = positions.get(trade.stockCode) ?? createEmptyPosition()

    const fees = trade.commission + trade.stampTax + trade.transferFee + trade.otherFee

    if (trade.side === 'buy') {
      const newQuantity = pos.quantity + trade.quantity
      const newCostBasis = pos.costBasis + trade.grossAmount + fees
      const newAvgCost = newQuantity > 0 ? newCostBasis / newQuantity : 0

      positions.set(trade.stockCode, {
        quantity: newQuantity,
        avgCost: newAvgCost,
        costBasis: newCostBasis,
        realizedPnl: pos.realizedPnl,
        totalFees: pos.totalFees + fees,
      })
    } else {
      // sell
      const costRemoved = pos.avgCost * trade.quantity
      const sellProceeds = trade.grossAmount - fees
      const realizedPnlDelta = sellProceeds - costRemoved
      const newQuantity = pos.quantity - trade.quantity
      const newCostBasis = newQuantity > 0 ? pos.avgCost * newQuantity : 0

      positions.set(trade.stockCode, {
        quantity: newQuantity,
        avgCost: newQuantity > 0 ? pos.avgCost : 0,
        costBasis: newCostBasis,
        realizedPnl: pos.realizedPnl + realizedPnlDelta,
        totalFees: pos.totalFees + fees,
      })
    }
  }

  return positions
}
