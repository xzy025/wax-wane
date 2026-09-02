import type { StockPersonalityEvidence } from './relayPathTypes'

export const STOCK_PERSONALITY_VERSION = 'stock-personality-v1'

export interface StockPersonalityObservation {
  code: string
  signalDate: string
  boardClass: 'strict-first-board' | 'rebound-board' | 'n-day-m-board' | 'consecutive' | 'unknown'
  boardType?: string | null
  positionBucket?: string | null
  lane?: string | null
  ageSessions?: number
  touched?: boolean | null
  sealed?: boolean | null
  nextOpenPositive?: boolean | null
  nextOpenGapPct?: number | null
  nextClosePremiumPct?: number | null
  nextOpenToLowPct?: number | null
  nextDayTouch?: boolean | null
  nextDaySeal?: boolean | null
}

export interface StockPersonalityPrior {
  touchToSealRate: number
  blastRate: number
  nextOpenPositiveRate: number
  nextOpenGapMedian: number
  nextClosePremiumMedian: number
  nextOpenToLowMedian: number
  nextDayTouchRate: number
  nextDaySealRate: number
}

const DEFAULT_PRIOR: StockPersonalityPrior = {
  touchToSealRate: 0.5,
  blastRate: 0.5,
  nextOpenPositiveRate: 0.5,
  nextOpenGapMedian: 0,
  nextClosePremiumMedian: 0,
  nextOpenToLowMedian: -5,
  nextDayTouchRate: 0.5,
  nextDaySealRate: 0.5,
}

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

export function sessionAge(signalDate: string, eventDate: string): number {
  const a = Date.parse(`${eventDate.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${signalDate.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 9999
  let age = 0
  for (let cursor = a; cursor < b; cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay()
    if (day !== 0 && day !== 6) age += 1
  }
  return age
}

function weightedRate(values: Array<boolean | null | undefined>, weights: number[], prior: number, kappa: number): number | null {
  const usable = values.map((value, index) => ({ value, weight: weights[index] })).filter((item): item is { value: boolean; weight: number } => typeof item.value === 'boolean')
  if (!usable.length) return null
  const total = usable.reduce((sum, item) => sum + item.weight, 0)
  return (usable.reduce((sum, item) => sum + (item.value ? item.weight : 0), 0) + kappa * prior) / (total + kappa)
}

function weightedMedian(values: Array<number | null | undefined>, weights: number[], prior: number, kappa: number): number | null {
  const usable = values.map((value, index) => ({ value, weight: weights[index] })).filter((item): item is { value: number; weight: number } => finite(item.value))
  if (!usable.length) return null
  const sorted = usable.sort((a, b) => a.value - b.value)
  const total = sorted.reduce((sum, item) => sum + item.weight, 0) + kappa
  let cursor = kappa * 0.5
  for (const item of sorted) {
    cursor += item.weight
    if (cursor >= total / 2) return item.value
  }
  return sorted.at(-1)?.value ?? prior
}

function sampleWeights(events: readonly StockPersonalityObservation[], signalDate: string): number[] {
  return events.map((event) => Math.exp(-Math.log(2) * (event.ageSessions ?? sessionAge(signalDate, event.signalDate)) / 120))
}

function effectiveSampleSize(weights: readonly number[]): number {
  const total = weights.reduce((sum, value) => sum + value, 0)
  const squared = weights.reduce((sum, value) => sum + value * value, 0)
  return squared > 0 ? (total * total) / squared : 0
}

function candidateEvents(args: {
  code: string
  signalDate: string
  events: readonly StockPersonalityObservation[]
  boardType?: string | null
  positionBucket?: string | null
  lane?: string | null
  historyComplete: boolean
}): { events: StockPersonalityObservation[]; fallbackLevel: number } {
  const before = args.events.filter((event) => event.code === args.code && event.signalDate < args.signalDate)
  const same = before.filter((event) => event.boardClass === 'strict-first-board' &&
    (args.boardType == null || event.boardType === args.boardType) &&
    (args.positionBucket == null || event.positionBucket === args.positionBucket) &&
    (args.lane == null || event.lane === args.lane))
  if (same.length) return { events: same, fallbackLevel: 0 }
  const stockFirst = before.filter((event) => event.boardClass === 'strict-first-board')
  if (stockFirst.length) return { events: stockFirst, fallbackLevel: 1 }
  const stockLimit = before.filter((event) => event.boardClass !== 'unknown')
  if (stockLimit.length) return { events: stockLimit, fallbackLevel: 2 }
  return { events: [], fallbackLevel: args.historyComplete ? 3 : 4 }
}

export function buildStockPersonalityEvidence(args: {
  code: string
  signalDate: string
  events: readonly StockPersonalityObservation[]
  boardType?: string | null
  positionBucket?: string | null
  lane?: string | null
  lanePrior?: Partial<StockPersonalityPrior>
  historyComplete?: boolean
  kappa?: number
}): StockPersonalityEvidence {
  const prior = { ...DEFAULT_PRIOR, ...args.lanePrior }
  const kappa = args.kappa ?? 8
  const selected = candidateEvents({ ...args, historyComplete: args.historyComplete !== false })
  const events = selected.events
  const weights = sampleWeights(events, args.signalDate)
  const eligibleFirst = args.events.filter((event) => event.code === args.code && event.boardClass === 'strict-first-board' && event.signalDate < args.signalDate)
  const byAge = eligibleFirst.filter((event) => (event.ageSessions ?? sessionAge(args.signalDate, event.signalDate)) <= 250).length
  const byAge500 = eligibleFirst.filter((event) => (event.ageSessions ?? sessionAge(args.signalDate, event.signalDate)) <= 500).length
  const missingReasons: string[] = []
  if (selected.fallbackLevel === 3) missingReasons.push('该股票历史严格首板事件为0，使用lane×板型先验')
  if (selected.fallbackLevel === 4) missingReasons.push('历史事件池未完成，不能确认股票股性为0事件')
  if (selected.fallbackLevel <= 2 && selected.fallbackLevel > 0) missingReasons.push(`条件匹配不足，已回退第${selected.fallbackLevel}层先验`)
  const lastEvent = eligibleFirst.map((event) => event.signalDate).sort().at(-1)
  return {
    priorFirstBoardCount250: byAge,
    priorFirstBoardCount500: byAge500,
    sameTypeEventCount: events.length,
    effectiveSampleSize: Number(effectiveSampleSize(weights).toFixed(2)),
    lastLimitEventAge: lastEvent == null ? null : sessionAge(args.signalDate, lastEvent),
    touchToSealRate: weightedRate(events.map((event) => event.sealed), weights, prior.touchToSealRate, kappa),
    blastRate: weightedRate(events.map((event) => event.touched == null || event.sealed == null ? null : event.touched && !event.sealed), weights, prior.blastRate, kappa),
    nextOpenPositiveRate: weightedRate(events.map((event) => event.nextOpenPositive), weights, prior.nextOpenPositiveRate, kappa),
    nextOpenGapMedian: weightedMedian(events.map((event) => event.nextOpenGapPct), weights, prior.nextOpenGapMedian, kappa),
    nextClosePremiumMedian: weightedMedian(events.map((event) => event.nextClosePremiumPct), weights, prior.nextClosePremiumMedian, kappa),
    nextOpenToLowMedian: weightedMedian(events.map((event) => event.nextOpenToLowPct), weights, prior.nextOpenToLowMedian, kappa),
    nextDayTouchRate: weightedRate(events.map((event) => event.nextDayTouch), weights, prior.nextDayTouchRate, kappa),
    nextDaySealRate: weightedRate(events.map((event) => event.nextDaySeal), weights, prior.nextDaySealRate, kappa),
    missingReasons,
  }
}
