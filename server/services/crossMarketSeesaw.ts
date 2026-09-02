import type {
  CapitalLaneId,
  CapitalSeesawLane,
  CapitalSeesawMatrix,
  CapitalTransfer,
  CrossMarketPhase,
  LiquidityRegimeSnapshot,
} from './crossMarketMapping'

export interface BasketSourceInput {
  ticker: string
  changePct: number | null
  returnZ?: number | null
  kind: 'etf' | 'anchor'
}

export interface ExternalBasketShock {
  id: 'cpo' | 'innovative-drug'
  score: number
  confidence: number
  coveragePct: number
  positiveRatePct: number
  split: boolean
  maxSingleContributionPct: number
  contributions: Array<{ ticker: string; value: number; weight: number }>
  reasons: string[]
  warnings: string[]
}

export interface ThemeCycleEvidence {
  returnZ: number | null
  limitUpCount: number | null
  firstBoardCount: number | null
  positiveBreadthPct: number | null
  amountRatio20: number | null
  strongCoreCount: number | null
}

export interface ThemeCycleAssessment {
  state: 'climax' | 'normal' | 'adjustment' | 'unavailable'
  climaxScore: number
  cycleComponent: number
  metCriteria: string[]
  availableCriteria: number
  warnings: string[]
}

export interface NextThemeOutcomeInput {
  priorClimax: boolean
  excessReturnPct: number | null
  positiveBreadthPct: number | null
  limitUpCount: number | null
  strongCoreCount: number | null
}

export type NextThemeOutcome = 'continuation' | 'differentiation' | 'collapse' | 'unavailable'

export interface LiquidityRegimeInput {
  phase: CrossMarketPhase
  cutoffAt: string
  source: 'full-market-clist' | 'unavailable'
  totalAmount: number | null
  baselineAmounts: number[]
  advance: number | null
  decline: number | null
  top50AmountSharePct: number | null
  baselineTop50Shares: number[]
  largeSmallSpreadPct: number | null
  warnings?: string[]
}

export interface SeesawBuildInput {
  phase: CrossMarketPhase
  external: Partial<Record<'cpo' | 'innovative-drug', ExternalBasketShock>>
  cycles: Partial<Record<CapitalLaneId, ThemeCycleAssessment>>
  auctionConfirmation: Partial<Record<CapitalLaneId, number>>
  openConfirmation: Partial<Record<CapitalLaneId, number>>
  liquidity: LiquidityRegimeSnapshot
}

function clamp(value: number, lower = -1, upper = 1): number {
  return Math.max(lower, Math.min(upper, value))
}

function r2(value: number): number {
  return Math.round(value * 100) / 100
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function robustZ(value: number, values: number[]): number | null {
  if (values.length < 20) return null
  const center = median(values)
  const mad = median(values.map((item) => Math.abs(item - center)))
  return (value - center) / Math.max(1.4826 * mad, 0.0001)
}

function sourceValue(source: BasketSourceInput): number | null {
  if (source.returnZ != null && Number.isFinite(source.returnZ)) return clamp(source.returnZ / 3)
  if (source.changePct != null && Number.isFinite(source.changePct)) return clamp(source.changePct / 8)
  return null
}

export function buildExternalBasketShock(args: {
  id: ExternalBasketShock['id']
  sources: BasketSourceInput[]
}): ExternalBasketShock {
  const valid = args.sources.flatMap((source) => {
    const value = sourceValue(source)
    return value == null ? [] : [{ ...source, value }]
  })
  const etfs = valid.filter((source) => source.kind === 'etf')
  const anchors = valid.filter((source) => source.kind === 'anchor')
  const coveragePct = args.sources.length ? (valid.length / args.sources.length) * 100 : 0
  const positiveRatePct = valid.length ? (valid.filter((source) => source.value > 0).length / valid.length) * 100 : 0
  const negativeRatePct = valid.length ? (valid.filter((source) => source.value < 0).length / valid.length) * 100 : 0
  const split = positiveRatePct >= 20 && negativeRatePct >= 20
  const contributions: ExternalBasketShock['contributions'] = []
  let score: number
  if (args.id === 'innovative-drug' && etfs.length > 0) {
    const etfWeight = Math.min(0.35, 0.6 / etfs.length)
    const anchorWeight = anchors.length ? Math.min(0.35, 0.4 / anchors.length) : 0
    for (const row of etfs) contributions.push({ ticker: row.ticker, value: row.value, weight: etfWeight })
    for (const row of anchors) contributions.push({ ticker: row.ticker, value: row.value, weight: anchorWeight })
    const weight = contributions.reduce((sum, row) => sum + row.weight, 0)
    score = weight ? contributions.reduce((sum, row) => sum + row.value * row.weight, 0) / weight : 0
  } else {
    const anchorMedian = median(anchors.map((source) => source.value))
    const breadth = valid.length ? clamp((positiveRatePct / 100) * 2 - 1) : 0
    score = anchorMedian * 0.7 + breadth * 0.3
    const perAnchor = anchors.length ? Math.min(0.35, 0.7 / anchors.length) : 0
    for (const row of anchors) contributions.push({ ticker: row.ticker, value: row.value, weight: perAnchor })
  }
  const confidence = clamp(coveragePct / 100, 0, 1) * (split ? 70 : 100)
  const warnings: string[] = []
  if (valid.some((source) => source.returnZ == null)) warnings.push('部分美股源缺少残差z分数，暂用涨跌幅代理')
  if (split) warnings.push('美股篮子方向分裂，已降低置信度')
  if (coveragePct < 70) warnings.push('美股篮子覆盖不足70%')
  return {
    id: args.id,
    score: r2(clamp(score)),
    confidence: r2(confidence),
    coveragePct: r2(coveragePct),
    positiveRatePct: r2(positiveRatePct),
    split,
    maxSingleContributionPct: r2(Math.max(0, ...contributions.map((row) => row.weight)) * 100),
    contributions,
    reasons: valid.map((source) => `${source.ticker}${source.value >= 0 ? '+' : ''}${r2(source.value)}`),
    warnings,
  }
}

export function assessThemeCycle(input: ThemeCycleEvidence): ThemeCycleAssessment {
  const criteria: Array<[string, boolean | null]> = [
    ['60日收益z≥2', input.returnZ == null ? null : input.returnZ >= 2],
    ['涨停≥3且首板≥2', input.limitUpCount == null || input.firstBoardCount == null ? null : input.limitUpCount >= 3 && input.firstBoardCount >= 2],
    ['上涨宽度≥70%', input.positiveBreadthPct == null ? null : input.positiveBreadthPct >= 70],
    ['成交额比≥1.2', input.amountRatio20 == null ? null : input.amountRatio20 >= 1.2],
  ]
  const available = criteria.filter(([, value]) => value != null)
  const met = criteria.filter(([, value]) => value === true).map(([label]) => label)
  if (available.length < 3) {
    return { state: 'unavailable', climaxScore: r2(met.length / 4), cycleComponent: 0, metCriteria: met, availableCriteria: available.length, warnings: ['题材高潮四项证据不足三项'] }
  }
  const climaxScore = met.length / 4
  if (met.length >= 3) return { state: 'climax', climaxScore: r2(climaxScore), cycleComponent: -0.6, metCriteria: met, availableCriteria: available.length, warnings: [] }
  const adjusting = (input.returnZ ?? 0) < 0 || (input.positiveBreadthPct ?? 100) < 45
  return { state: adjusting ? 'adjustment' : 'normal', climaxScore: r2(climaxScore), cycleComponent: adjusting ? 0.3 : 0, metCriteria: met, availableCriteria: available.length, warnings: [] }
}

export function classifyNextThemeOutcome(input: NextThemeOutcomeInput): NextThemeOutcome {
  if (input.excessReturnPct == null || input.positiveBreadthPct == null) return 'unavailable'
  if (input.excessReturnPct >= 1.5 && input.positiveBreadthPct >= 60) return 'continuation'
  const hasCore = (input.limitUpCount ?? 0) > 0 || (input.strongCoreCount ?? 0) > 0
  if (input.priorClimax && (input.positiveBreadthPct < 50 || input.excessReturnPct <= 0) && hasCore) return 'differentiation'
  if (input.excessReturnPct <= -1.5 && !hasCore) return 'collapse'
  return input.priorClimax ? 'differentiation' : 'unavailable'
}

export function buildLiquidityRegime(input: LiquidityRegimeInput): LiquidityRegimeSnapshot {
  const warnings = [...(input.warnings ?? [])]
  const breadthTotal = (input.advance ?? 0) + (input.decline ?? 0)
  const advanceRatePct = breadthTotal > 0 ? ((input.advance ?? 0) / breadthTotal) * 100 : null
  const baselineSessions = Math.min(input.baselineAmounts.length, input.baselineTop50Shares.length)
  const baselineReady = baselineSessions >= 20
  const sameTimeTurnoverRatio = baselineReady && input.totalAmount != null ? input.totalAmount / median(input.baselineAmounts.slice(-20)) : null
  const turnoverZ = baselineReady && input.totalAmount != null ? robustZ(input.totalAmount, input.baselineAmounts.slice(-60)) : null
  const concentrationDeltaPct = baselineReady && input.top50AmountSharePct != null ? input.top50AmountSharePct - median(input.baselineTop50Shares.slice(-20)) : null
  const criticalReady = input.source === 'full-market-clist' && input.totalAmount != null && input.totalAmount > 0 && advanceRatePct != null && input.top50AmountSharePct != null && input.largeSmallSpreadPct != null
  if (!baselineReady) warnings.push(`同刻历史基线仅${baselineSessions}日，至少需要20日`)
  if (!criticalReady) warnings.push('存量判断缺少全市场成交额、宽度、集中度或大小盘价差')
  let state: LiquidityRegimeSnapshot['state'] = 'unavailable'
  if (baselineReady && criticalReady && sameTimeTurnoverRatio != null && concentrationDeltaPct != null && advanceRatePct != null) {
    if (sameTimeTurnoverRatio <= 1.05 && advanceRatePct < 45 && (concentrationDeltaPct >= 5 || Math.abs(input.largeSmallSpreadPct ?? 0) >= 0.5)) state = 'stock-crowding'
    else if (sameTimeTurnoverRatio >= 1.15 && advanceRatePct >= 50 && concentrationDeltaPct <= 3) state = 'incremental-broad'
    else state = 'balanced'
  }
  const coverage = [input.totalAmount != null, advanceRatePct != null, input.top50AmountSharePct != null, input.largeSmallSpreadPct != null, baselineReady].filter(Boolean).length / 5
  return {
    phase: input.phase,
    cutoffAt: input.cutoffAt,
    source: input.source,
    totalAmount: input.totalAmount,
    baselineSessions,
    sameTimeTurnoverRatio: sameTimeTurnoverRatio == null ? null : r2(sameTimeTurnoverRatio),
    turnoverZ: turnoverZ == null ? null : r2(turnoverZ),
    advanceRatePct: advanceRatePct == null ? null : r2(advanceRatePct),
    top50AmountSharePct: input.top50AmountSharePct == null ? null : r2(input.top50AmountSharePct),
    concentrationDeltaPct: concentrationDeltaPct == null ? null : r2(concentrationDeltaPct),
    largeSmallSpreadPct: input.largeSmallSpreadPct == null ? null : r2(input.largeSmallSpreadPct),
    state,
    confidence: r2(coverage * 100),
    warnings,
  }
}

const LANE_LABELS: Record<CapitalLaneId, string> = {
  'hard-tech': '大科技/CPO',
  'innovative-drug': '创新药',
  'small-theme': '题材小票',
  'index-weight': '指数权重',
}

function laneExternal(id: CapitalLaneId, external: SeesawBuildInput['external']): ExternalBasketShock | undefined {
  if (id === 'hard-tech') return external.cpo
  if (id === 'innovative-drug') return external['innovative-drug']
  return undefined
}

export function buildCapitalSeesaw(input: SeesawBuildInput): CapitalSeesawMatrix {
  const ids: CapitalLaneId[] = ['hard-tech', 'innovative-drug', 'small-theme', 'index-weight']
  const confirmations = (id: CapitalLaneId) => input.phase === 'open' ? input.openConfirmation[id] ?? 0 : input.auctionConfirmation[id] ?? 0
  const leader = [...ids].sort((a, b) => confirmations(b) - confirmations(a))[0]
  const lanes: CapitalSeesawLane[] = ids.map((id) => {
    const external = laneExternal(id, input.external)
    const externalShock = external?.score ?? 0
    const cycle = input.cycles[id]
    const domesticCycle = cycle?.cycleComponent ?? 0
    const auctionConfirmation = clamp(input.auctionConfirmation[id] ?? 0)
    const openConfirmation = clamp(input.openConfirmation[id] ?? 0)
    let liquidityAdjustment = 0
    if (input.liquidity.state === 'stock-crowding') {
      liquidityAdjustment = id === leader ? 0.5 : id === 'small-theme' ? -1 : confirmations(id) < 0 ? -0.5 : -0.25
    } else if (input.liquidity.state === 'incremental-broad') {
      liquidityAdjustment = confirmations(id) >= 0 ? 0.5 : 0
    }
    const climax = cycle?.climaxScore ?? 0
    const interactionAdjustment = externalShock * climax
    const score = Math.max(0, Math.min(100, 50 + 10 * externalShock + 8 * domesticCycle + 10 * auctionConfirmation + 8 * openConfirmation + 8 * liquidityAdjustment + 6 * interactionAdjustment))
    const domesticConfirmation = input.phase === 'open' ? openConfirmation : auctionConfirmation
    let state: CapitalSeesawLane['state'] = score >= 65 ? '强化' : score <= 35 ? '背离' : '观察'
    if (cycle?.state === 'climax' && score < 55 && domesticConfirmation > -0.5) state = '分化'
    if (external && Math.sign(externalShock) !== 0 && Math.sign(domesticConfirmation) !== 0 && Math.sign(externalShock) !== Math.sign(domesticConfirmation)) state = '背离'
    const reasons = [
      external ? `海外冲击${externalShock >= 0 ? '+' : ''}${r2(externalShock)}` : '无直接海外篮子',
      cycle ? `昨日节律${cycle.state}` : '昨日节律缺失',
      `竞价确认${auctionConfirmation >= 0 ? '+' : ''}${r2(auctionConfirmation)}`,
      input.phase === 'open' ? `开盘确认${openConfirmation >= 0 ? '+' : ''}${r2(openConfirmation)}` : '',
      `流动性修正${liquidityAdjustment >= 0 ? '+' : ''}${r2(liquidityAdjustment)}`,
    ].filter(Boolean)
    return {
      id,
      label: LANE_LABELS[id],
      externalShock: r2(externalShock),
      domesticCycle: r2(domesticCycle),
      auctionConfirmation: r2(auctionConfirmation),
      openConfirmation: r2(openConfirmation),
      liquidityAdjustment: r2(liquidityAdjustment),
      interactionAdjustment: r2(interactionAdjustment),
      netResearchScore: r2(score),
      state,
      reasons,
      warnings: [...(external?.warnings ?? []), ...(cycle?.warnings ?? [])],
    }
  })
  const transfers: CapitalTransfer[] = []
  if (input.liquidity.state === 'stock-crowding') {
    const target = lanes.reduce((best, row) => row.netResearchScore > best.netResearchScore ? row : best, lanes[0])
    for (const row of lanes.filter((item) => item.id !== target.id && item.netResearchScore + 10 < target.netResearchScore)) {
      transfers.push({ from: row.id, to: target.id, strength: r2(Math.min(100, target.netResearchScore - row.netResearchScore)), label: '资金偏移', reasons: ['存量集中', `${target.label}相对研究分领先`] })
    }
  }
  const warnings = input.liquidity.state === 'unavailable' ? ['流动性基线不足，资金迁移只作展示不参与概率'] : []
  return { phase: input.phase, generatedAt: new Date().toISOString(), status: 'research-score', lanes, transfers, warnings }
}
