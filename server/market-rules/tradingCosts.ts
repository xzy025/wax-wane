export interface TradingCostConfig {
  buyCommissionBps: number
  sellCommissionBps: number
  stampDutyBps: number
  transferFeeBps: number
  minCommissionCny: number
}

export interface TradingOrder {
  side: 'buy' | 'sell'
  price: number
  shares: number
}

export const TRADING_COST_RULE_VERSION = 'cn-a-share-costs-2023-08-28'

/** Market fees with date-effective statutory components and strategy-owned commission. */
export function tradingCostsForDate(
  tradeDate: string,
  strategy: Partial<Pick<TradingCostConfig, 'buyCommissionBps' | 'sellCommissionBps' | 'minCommissionCny'>> = {},
): TradingCostConfig & { ruleVersion: string } {
  return {
    buyCommissionBps: strategy.buyCommissionBps ?? 3,
    sellCommissionBps: strategy.sellCommissionBps ?? 3,
    stampDutyBps: tradeDate >= '2023-08-28' ? 5 : 10,
    transferFeeBps: tradeDate >= '2022-07-01' ? 0.1 : 0.2,
    minCommissionCny: strategy.minCommissionCny ?? 5,
    ruleVersion: TRADING_COST_RULE_VERSION,
  }
}

export function orderSharesForCash(price: number, cashCny: number, lot = 100): number {
  if (!(price > 0) || !(cashCny > 0) || !(lot > 0)) return 0
  return Math.floor(cashCny / price / lot) * lot
}

export function transactionCostCny(order: TradingOrder, costs: TradingCostConfig): number {
  if (!(order.price > 0) || !(order.shares > 0)) return 0
  const notional = order.price * order.shares
  const commissionRate = order.side === 'buy' ? costs.buyCommissionBps : costs.sellCommissionBps
  const commission = Math.max(costs.minCommissionCny, notional * commissionRate / 10_000)
  const transfer = notional * costs.transferFeeBps / 10_000
  const stamp = order.side === 'sell' ? notional * costs.stampDutyBps / 10_000 : 0
  return commission + transfer + stamp
}
