import type { Holding } from '../engine/holdings'
import { getStockQuote } from './tools/getStockQuote'
import { getStockKline } from './tools/getStockKline'

/**
 * Holdings-management engine for the daily 持仓复盘 board. Joins live quote +
 * K-line onto each holding, derives unrealized P&L and a transparent,
 * rule-based management action (持有/加仓/减仓/止盈/止损/清仓/观望). All scoring
 * is deterministic and unit-tested; no LLM is involved in the lightweight pass.
 */

export type ActionType = 'hold' | 'add' | 'reduce' | 'takeProfit' | 'stopLoss' | 'sell' | 'watch'
export type SignalDir = 'bullish' | 'bearish' | 'neutral'
export type VolumeSignal = 'high' | 'low' | 'normal'

/** Tunable thresholds — kept together so the rules are easy to audit/adjust. */
export const THRESHOLDS = {
  /** Hard stop: unrealized loss at or below this triggers 止损. */
  stopLossPct: -8,
  /** Profit at or above this opens 止盈 consideration. */
  takeProfitPct: 25,
  /** "Near support/resistance" tolerance (fraction of the level). */
  nearLevel: 0.02,
  /** A holding sitting within this band above support counts as a low-risk dip-buy. */
  dipBuyBand: 0.04,
  /** A sharp down day used to confirm 止盈. */
  sharpDownPct: -3,
} as const

export interface TechnicalView {
  support: number
  resistance: number
  ma5: number
  volumeRatio: number
  volumeSignal: VolumeSignal
  trend: 'up' | 'down' | 'flat'
  signal: SignalDir
  /** Position within the 20-day range, 0 (low) – 100 (high). */
  positionPct: number
  change5d: number
}

export interface HoldingAction {
  action: ActionType
  reason: string
  stopLoss?: number
  target?: number
}

export interface HoldingSignal {
  holding: Holding
  price: number | null
  /** Today's change %, from the live quote. */
  changePct: number | null
  marketValue: number | null
  unrealizedPnl: number | null
  unrealizedPct: number | null
  technical: TechnicalView | null
  action: HoldingAction
  error?: string
}

export interface PlanItem {
  code: string
  name: string
  action: ActionType
  reason: string
}

export interface PortfolioSummary {
  count: number
  totalMarketValue: number
  totalCost: number
  totalUnrealizedPnl: number
  totalUnrealizedPct: number
  /** Market-value-weighted average of today's change %. */
  todayChangePct: number
  worst: { code: string; name: string; unrealizedPct: number } | null
  risks: PlanItem[]
  plan: PlanItem[]
}

type KlineLike = { close: number; high: number; low: number; volume: number; changePct: number }

/** Rank actions by urgency for the "明日操作计划" ordering. */
const ACTION_PRIORITY: Record<ActionType, number> = {
  stopLoss: 0,
  sell: 1,
  reduce: 2,
  takeProfit: 3,
  add: 4,
  watch: 5,
  hold: 6,
}

/**
 * Derive support/resistance, volume and a directional bias from recent K-lines.
 * Mirrors the rule logic in multi-agent/agents/technical.agent.ts, distilled to
 * the numbers the holdings board needs.
 */
export function computeTechnical(klines: readonly KlineLike[]): TechnicalView | null {
  if (!klines || klines.length < 6) return null

  const closes = klines.map((k) => Number(k.close) || 0)
  const latestClose = closes[closes.length - 1]

  const recent20 = klines.slice(-20)
  const high20 = Math.max(...recent20.map((k) => Number(k.high) || 0))
  const low20 = Math.min(...recent20.map((k) => Number(k.low) || 0))
  const range = high20 - low20
  const positionPct = range > 0 ? ((latestClose - low20) / range) * 100 : 50

  const last5 = closes.slice(-5)
  const ma5 = last5.reduce((s, c) => s + c, 0) / last5.length

  const prev5 = klines.slice(-6, -1)
  const prev20 = klines.slice(-21, -1)
  const avgVolume5 = prev5.reduce((s, k) => s + (Number(k.volume) || 0), 0) / Math.max(prev5.length, 1)
  const avgVolume20 = prev20.reduce((s, k) => s + (Number(k.volume) || 0), 0) / Math.max(prev20.length, 1)
  const volumeRatio = avgVolume20 > 0 ? avgVolume5 / avgVolume20 : 1
  const volumeSignal: VolumeSignal = volumeRatio > 1.5 ? 'high' : volumeRatio < 0.7 ? 'low' : 'normal'

  const prev20Close = Number(prev20[0]?.close) || latestClose
  const prev5Close = Number(prev5[0]?.close) || latestClose
  const change5d = prev5Close > 0 ? ((latestClose - prev5Close) / prev5Close) * 100 : 0
  const trend: TechnicalView['trend'] =
    latestClose > prev20Close * 1.01 ? 'up' : latestClose < prev20Close * 0.99 ? 'down' : 'flat'

  // Directional bias: trend + volume confirmation
  let bullish = 0
  let bearish = 0
  if (trend === 'up') bullish++
  if (trend === 'down') bearish++
  if (trend === 'up' && volumeRatio > 1.2) bullish++
  if (trend === 'down' && volumeRatio > 1.2) bearish++
  if (latestClose > ma5) bullish++
  else bearish++
  const signal: SignalDir = bullish > bearish + 1 ? 'bullish' : bearish > bullish + 1 ? 'bearish' : 'neutral'

  return { support: low20, resistance: high20, ma5, volumeRatio, volumeSignal, trend, signal, positionPct, change5d }
}

/**
 * The heart of "如何管理持仓": map (unrealized P&L, today's move, price vs
 * key levels, technical bias) to one clear management action. Rules are ordered
 * by severity; the first match wins. Conservative by design.
 */
export function deriveHoldingAction(input: {
  unrealizedPct: number | null
  changePct: number | null
  price: number | null
  technical: TechnicalView | null
}): HoldingAction {
  const { unrealizedPct, changePct, price, technical } = input

  if (price == null || technical == null || unrealizedPct == null) {
    return { action: 'watch', reason: '数据不足，暂观望' }
  }

  const { support, resistance, ma5, signal } = technical
  const nearResistance = price >= resistance * (1 - THRESHOLDS.nearLevel)
  const belowSupport = price < support * (1 - 0.005)
  const today = changePct ?? 0

  // 1) Stop loss: broke key support or breached the hard loss limit.
  if (belowSupport || unrealizedPct <= THRESHOLDS.stopLossPct) {
    return {
      action: 'stopLoss',
      reason: belowSupport
        ? `跌破关键支撑 ${support}，趋势走坏，严格止损`
        : `浮亏 ${unrealizedPct.toFixed(1)}% 触及止损线，离场保护本金`,
      stopLoss: support,
    }
  }

  // 2) Take profit: rich gains losing momentum (at resistance / bearish / sharp down day).
  if (
    unrealizedPct >= THRESHOLDS.takeProfitPct &&
    (signal === 'bearish' || nearResistance || today <= THRESHOLDS.sharpDownPct)
  ) {
    return {
      action: 'takeProfit',
      reason: `浮盈 ${unrealizedPct.toFixed(1)}% 且${nearResistance ? '逼近阻力' : signal === 'bearish' ? '技术转弱' : '放量回落'}，分批止盈锁定利润`,
      stopLoss: ma5,
      target: resistance,
    }
  }

  // 3) Reduce: trend deteriorating (bearish bias + lost the 5-day line).
  if (signal === 'bearish' && price < ma5) {
    return {
      action: 'reduce',
      reason: `技术偏空且跌破5日线(${ma5.toFixed(2)})，先减仓控制风险`,
      stopLoss: support,
    }
  }

  // 4) Add: strong stock pulling back to support — low-risk add.
  if (signal === 'bullish' && price <= support * (1 + THRESHOLDS.dipBuyBand)) {
    return {
      action: 'add',
      reason: `强势回踩支撑 ${support} 且技术偏多，可低吸加仓`,
      stopLoss: support,
      target: resistance,
    }
  }

  // 5) Default: trend healthy, hold.
  return {
    action: 'hold',
    reason: signal === 'bullish' ? '趋势健康，持有为主' : '趋势中性，持有观察',
    stopLoss: support,
    target: resistance,
  }
}

/** Fetch live quote + K-line for one holding and produce its signal. */
export async function analyzeHolding(holding: Holding): Promise<HoldingSignal> {
  const base: HoldingSignal = {
    holding,
    price: null,
    changePct: null,
    marketValue: null,
    unrealizedPnl: null,
    unrealizedPct: null,
    technical: null,
    action: { action: 'watch', reason: '数据不足，暂观望' },
  }

  try {
    const [quoteRaw, klineRaw] = await Promise.all([
      getStockQuote.execute({ stockCode: holding.code }),
      getStockKline.execute({ stockCode: holding.code, period: 101, count: 60 }),
    ])

    const quote = quoteRaw as { price?: number; changePct?: number; error?: string } | null
    const kline = klineRaw as { klines?: KlineLike[]; error?: string } | null

    if (!quote || quote.error || typeof quote.price !== 'number') {
      return { ...base, error: quote?.error ?? '行情获取失败' }
    }

    const price = quote.price
    const changePct = typeof quote.changePct === 'number' ? quote.changePct : null
    const marketValue = price * holding.quantity
    const unrealizedPnl = (price - holding.avgCost) * holding.quantity
    const unrealizedPct = holding.avgCost > 0 ? (price / holding.avgCost - 1) * 100 : 0

    const technical = kline && !kline.error ? computeTechnical(kline.klines ?? []) : null
    const action = deriveHoldingAction({ unrealizedPct, changePct, price, technical })

    return { holding, price, changePct, marketValue, unrealizedPnl, unrealizedPct, technical, action }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : '分析失败' }
  }
}

/** Aggregate per-holding signals into a portfolio overview + action plan. */
export function buildPortfolioSummary(signals: readonly HoldingSignal[]): PortfolioSummary {
  let totalMarketValue = 0
  let totalCost = 0
  let totalUnrealizedPnl = 0
  let weightedTodaySum = 0
  let weightedBase = 0
  let worst: PortfolioSummary['worst'] = null

  for (const s of signals) {
    totalCost += s.holding.costBasis
    if (s.marketValue != null) totalMarketValue += s.marketValue
    if (s.unrealizedPnl != null) totalUnrealizedPnl += s.unrealizedPnl
    if (s.marketValue != null && s.changePct != null) {
      weightedTodaySum += s.marketValue * s.changePct
      weightedBase += s.marketValue
    }
    if (s.unrealizedPct != null && (worst == null || s.unrealizedPct < worst.unrealizedPct)) {
      worst = { code: s.holding.code, name: s.holding.name, unrealizedPct: s.unrealizedPct }
    }
  }

  const totalUnrealizedPct = totalCost > 0 ? (totalUnrealizedPnl / totalCost) * 100 : 0
  const todayChangePct = weightedBase > 0 ? weightedTodaySum / weightedBase : 0

  const items: PlanItem[] = signals
    .filter((s) => s.action.action !== 'hold')
    .map((s) => ({
      code: s.holding.code,
      name: s.holding.name,
      action: s.action.action,
      reason: s.action.reason,
    }))
    .sort((a, b) => ACTION_PRIORITY[a.action] - ACTION_PRIORITY[b.action])

  const risks = items.filter((i) => i.action === 'stopLoss' || i.action === 'reduce' || i.action === 'sell')

  return {
    count: signals.length,
    totalMarketValue,
    totalCost,
    totalUnrealizedPnl,
    totalUnrealizedPct,
    todayChangePct,
    worst,
    risks,
    plan: items,
  }
}
