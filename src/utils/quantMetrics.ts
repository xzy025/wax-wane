// Quantitative trading metrics

import type { TradeGroup } from '../types'

export interface QuantMetrics {
  sharpeRatio: number
  maxDrawdown: number
  maxDrawdownPercent: number
  annualizedReturn: number
  volatility: number
  winRate: number
  payoffRatio: number
  profitFactor: number
  expectancy: number
}

/**
 * Calculate Sharpe Ratio
 * Formula: (mean_return - risk_free_rate) / std_dev_returns
 * Using risk_free_rate = 0 for simplicity
 */
export function computeSharpeRatio(returns: number[]): number {
  if (returns.length < 2) return 0

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
  const stdDev = Math.sqrt(variance)

  if (stdDev === 0) return 0
  return mean / stdDev
}

/**
 * Calculate Maximum Drawdown
 * Returns the largest peak-to-trough decline in cumulative returns
 */
export function computeMaxDrawdown(cumulativeReturns: number[]): {
  maxDrawdown: number
  maxDrawdownPercent: number
} {
  if (cumulativeReturns.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPercent: 0 }
  }

  let peak = cumulativeReturns[0]
  let maxDrawdown = 0
  let maxDrawdownPercent = 0

  for (const value of cumulativeReturns) {
    if (value > peak) {
      peak = value
    }
    const drawdown = peak - value
    const drawdownPercent = peak !== 0 ? (drawdown / Math.abs(peak)) * 100 : 0

    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      maxDrawdownPercent = drawdownPercent
    }
  }

  return { maxDrawdown, maxDrawdownPercent }
}

/**
 * Calculate Profit Factor
 * Formula: gross_profit / gross_loss
 */
export function computeProfitFactor(tradeGroups: TradeGroup[]): number {
  const grossProfit = tradeGroups
    .filter((g) => g.pnl > 0)
    .reduce((s, g) => s + g.pnl, 0)

  const grossLoss = Math.abs(
    tradeGroups
      .filter((g) => g.pnl < 0)
      .reduce((s, g) => s + g.pnl, 0),
  )

  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0
  return grossProfit / grossLoss
}

/**
 * Calculate Expectancy
 * Formula: (win_rate * avg_win) - (loss_rate * avg_loss)
 */
export function computeExpectancy(tradeGroups: TradeGroup[]): number {
  const winners = tradeGroups.filter((g) => g.pnl > 0)
  const losers = tradeGroups.filter((g) => g.pnl < 0)

  if (tradeGroups.length === 0) return 0

  const winRate = winners.length / tradeGroups.length
  const lossRate = losers.length / tradeGroups.length

  const avgWin = winners.length > 0
    ? winners.reduce((s, g) => s + g.pnl, 0) / winners.length
    : 0

  const avgLoss = losers.length > 0
    ? Math.abs(losers.reduce((s, g) => s + g.pnl, 0) / losers.length)
    : 0

  return winRate * avgWin - lossRate * avgLoss
}

/**
 * Calculate annualized return from total return and holding days
 */
export function computeAnnualizedReturn(totalReturn: number, totalDays: number): number {
  if (totalDays <= 0) return 0
  const years = totalDays / 365
  return ((1 + totalReturn / 100) ** (1 / years) - 1) * 100
}

/**
 * Calculate all quantitative metrics for a set of trade groups
 */
export function computeQuantMetrics(tradeGroups: TradeGroup[]): QuantMetrics {
  const closedGroups = tradeGroups.filter((g) => g.closed)

  if (closedGroups.length === 0) {
    return {
      sharpeRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      annualizedReturn: 0,
      volatility: 0,
      winRate: 0,
      payoffRatio: 0,
      profitFactor: 0,
      expectancy: 0,
    }
  }

  // Sort by close date
  const sorted = [...closedGroups].sort((a, b) =>
    (a.closed ?? '').localeCompare(b.closed ?? ''),
  )

  // Calculate returns (as percentages)
  const returns = sorted.map((g) => g.returnRate)

  // Calculate cumulative returns for drawdown
  const cumulativeReturns: number[] = []
  let cumulative = 100
  for (const r of returns) {
    cumulative *= 1 + r / 100
    cumulativeReturns.push(cumulative)
  }

  // Win rate
  const winners = sorted.filter((g) => g.pnl > 0)
  const losers = sorted.filter((g) => g.pnl < 0)
  const winRate = (winners.length / sorted.length) * 100

  // Payoff ratio
  const avgWin = winners.length > 0
    ? winners.reduce((s, g) => s + g.returnRate, 0) / winners.length
    : 0
  const avgLoss = losers.length > 0
    ? Math.abs(losers.reduce((s, g) => s + g.returnRate, 0) / losers.length)
    : 0
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0

  // Total holding days
  const totalDays = sorted.reduce((s, g) => s + g.days, 0)

  // Total return
  const totalReturn = cumulative - 100

  // Sharpe Ratio (annualized)
  const dailyReturns = returns.map((r) => r / 100)
  const sharpeRatio = computeSharpeRatio(dailyReturns) * Math.sqrt(252)

  // Max Drawdown
  const { maxDrawdown, maxDrawdownPercent } = computeMaxDrawdown(cumulativeReturns)

  // Volatility (annualized)
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length
  const volatility = Math.sqrt(variance) * Math.sqrt(252)

  // Profit Factor
  const profitFactor = computeProfitFactor(sorted)

  // Expectancy
  const expectancy = computeExpectancy(sorted)

  // Annualized Return
  const annualizedReturn = computeAnnualizedReturn(totalReturn, totalDays)

  return {
    sharpeRatio,
    maxDrawdown,
    maxDrawdownPercent,
    annualizedReturn,
    volatility,
    winRate,
    payoffRatio,
    profitFactor,
    expectancy,
  }
}
