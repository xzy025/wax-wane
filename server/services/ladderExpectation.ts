/**
 * Research-only expectation layer for the limit ladder.
 *
 * The module deliberately keeps board classification separate from adjusted
 * technical indicators. A board type is only trusted when the input is raw
 * (or explicitly unadjusted) OHLC. Missing intraday evidence stays missing;
 * it is never inferred from a daily candle.
 */

import { activeTradingCalendar } from './tradingCalendar'
import type { RelayQuantileArtifact } from './relayQuantileStore'

export const RELAY_EXPECTATION_VERSION = 'relay-expectation-shadow-v1'

export type BoardType =
  | 'one-price'
  | 't-board'
  | 'gap-turnover'
  | 'flat-turnover'
  | 'non-limit'
  | 'unknown'

export type VolumeLabel = 'shrink' | 'normal' | 'expand' | 'missing'

export type ExpectationPath =
  | 'tradable-acceleration'
  | 'divergence-reseal'
  | 'one-price-untradeable'
  | 'break-failure'

export type ExpectationMatchStatus = 'met' | 'partial' | 'violated' | 'unavailable'

export interface BoardDayObservationInput {
  date: string
  code: string
  name?: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  previousClose: number | null
  volume: number | null
  amount?: number | null
  turnoverRate?: number | null
  firstSealTime?: string | null
  lastSealTime?: string | null
  reopenCount?: number | null
  sealAmount?: number | null
  limitPrice?: number | null
  isLimitUp?: boolean | null
  adjustment?: 'raw' | 'none' | 'qfq' | 'hfq' | 'unknown' | null
  source?: string
  settled?: boolean
  previousVolume?: number | null
}

export interface BoardDayObservation {
  date: string
  code: string
  name: string
  boardType: BoardType
  isLimitUp: boolean | null
  limitPrice: number | null
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  previousClose: number | null
  volume: number | null
  amount: number | null
  turnoverRate: number | null
  volumeRatio: number | null
  volumeLabel: VolumeLabel
  volumeIsDouble: boolean
  firstSealTime: string | null
  lastSealTime: string | null
  reopenCount: number | null
  sealAmount: number | null
  adjustment: BoardDayObservationInput['adjustment']
  source: string
  settled: boolean
  coverage: number
  dataQuality: 'full' | 'partial' | 'unavailable'
  missingReasons: string[]
}

export interface BoardSequenceEvidence {
  code: string
  name: string
  observations: BoardDayObservation[]
  latestThree: BoardDayObservation[]
  signature: string[]
  volumeRatios: Array<number | null>
  coverage: number
  dataQuality: 'full' | 'partial' | 'unavailable'
  qingshanPattern: boolean
  missingReasons: string[]
  /** Current ending episode fields; optional for legacy archived JSON. */
  episodeDates?: string[]
  boardClass?: 'strict-first-board' | 'rebound-board' | 'n-day-m-board' | 'consecutive' | 'unknown'
  declaredBoards?: number | null
  reconstructedBoards?: number | null
}

export interface RelayExpectation {
  status: 'research-score'
  modelStatus: 'shadow-heuristic' | 'shadow-logistic' | 'unavailable'
  modelVersion: string
  primaryPath: ExpectationPath | null
  probabilities: Record<ExpectationPath, number | null>
  /** Kept separate from calibrated probabilities; these are not probabilities. */
  heuristicScores: Record<ExpectationPath, number | null>
  calibratedProbabilities?: Record<ExpectationPath, number> | null
  probabilityStatus: 'unavailable' | 'research-score' | 'calibrated'
  confidence: number | null
  clearExpectation: boolean
  expectedOpenGapPct: [number, number] | null
  expectedTouchTime: [string, string] | null
  expectedMaxReopenCount: number | null
  allowedPaths: ExpectationPath[]
  prohibitedPaths: ExpectationPath[]
  sequence: BoardSequenceEvidence
  evidence: string[]
  missingReasons: string[]
}

export interface ExpectationMatchInput {
  expectation: RelayExpectation | null | undefined
  openGapPct?: number | null
  preSealAmountRatio?: number | null
  firstTouchMinutes?: number | null
  reopenCount?: number | null
  themeStrength?: number | null
  observedPath?: ExpectationPath | null
  quantileArtifact?: RelayQuantileArtifact | null
  signalDate?: string
  lane?: string
  quantiles?: {
    openGapPct?: { q10: number; q25: number; q75: number; q90: number }
    preSealAmountRatio?: { q10: number; q25: number; q75: number; q90: number }
    firstTouchMinutes?: { q10: number; q25: number; q75: number; q90: number }
    reopenCount?: { q10: number; q25: number; q75: number; q90: number }
    themeStrength?: { q10: number; q25: number; q75: number; q90: number }
  }
}

export interface ExpectationMatch {
  status: ExpectationMatchStatus
  fit: number | null
  componentScores: {
    openGap: number | null
    preSealAmount: number | null
    firstTouch: number | null
    reopen: number | null
    theme: number | null
  }
  matched: string[]
  unmet: string[]
  missingReasons: string[]
  observedPath: ExpectationPath | null
}

const PATHS: ExpectationPath[] = [
  'tradable-acceleration',
  'divergence-reseal',
  'one-price-untradeable',
  'break-failure',
]

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const r2 = (value: number) => Math.round(value * 100) / 100
const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function closeEnough(a: number | null, b: number | null): boolean {
  if (!finite(a) || !finite(b)) return false
  return Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.001)
}

function volumeLabel(value: number | null): VolumeLabel {
  if (!finite(value) || value <= 0) return 'missing'
  if (value <= 0.7) return 'shrink'
  if (value < 1.5) return 'normal'
  return 'expand'
}

function classifyBoardType(args: {
  isLimitUp: boolean | null
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  previousClose: number | null
  limitPrice: number | null
  rawBasis: boolean
}): BoardType {
  if (args.isLimitUp === false) return 'non-limit'
  if (args.isLimitUp !== true || !args.rawBasis) return 'unknown'
  if (!finite(args.limitPrice)) return 'unknown'
  const limit = args.limitPrice
  if (
    closeEnough(args.open, limit) &&
    closeEnough(args.high, limit) &&
    closeEnough(args.low, limit) &&
    closeEnough(args.close, limit)
  ) return 'one-price'
  if (closeEnough(args.open, limit) && finite(args.low) && args.low < limit - 0.011 && closeEnough(args.close, limit)) {
    return 't-board'
  }
  if (finite(args.previousClose) && finite(args.open) && args.open > args.previousClose + 0.011 && args.open < limit - 0.011 && closeEnough(args.close, limit)) {
    return 'gap-turnover'
  }
  if (closeEnough(args.close, limit)) return 'flat-turnover'
  return 'unknown'
}

export function buildBoardDayObservation(args: BoardDayObservationInput): BoardDayObservation {
  const rawBasis = args.adjustment === 'raw' || args.adjustment === 'none'
  const baseFields = [args.open, args.high, args.low, args.close, args.volume, args.previousClose]
  const baseCoverage = baseFields.filter(finite).length / baseFields.length
  const isLimitUp = args.isLimitUp ?? null
  const limitPrice = finite(args.limitPrice) ? args.limitPrice : isLimitUp ? args.close : null
  const ratio = finite(args.volume) && args.volume > 0 && finite(args.previousVolume) && args.previousVolume > 0
    ? args.volume / args.previousVolume
    : null
  const missingReasons: string[] = []
  if (!rawBasis) missingReasons.push('涨停板型需要未复权OHLC，当前复权口径不可用')
  if (isLimitUp == null) missingReasons.push('缺少历史涨停判定')
  if (!finite(args.previousVolume) || args.previousVolume <= 0) missingReasons.push('缺少前一交易日成交量，量比不可用')
  if (args.firstSealTime == null) missingReasons.push('缺少首封时间')
  const coverage = r2(baseCoverage * 100)
  const dataQuality = !rawBasis || baseCoverage < 0.8
    ? 'unavailable'
    : coverage >= 90 && missingReasons.length === 0
      ? 'full'
      : 'partial'
  return {
    date: args.date,
    code: args.code,
    name: args.name ?? args.code,
    boardType: classifyBoardType({
      isLimitUp,
      open: args.open,
      high: args.high,
      low: args.low,
      close: args.close,
      previousClose: args.previousClose,
      limitPrice,
      rawBasis,
    }),
    isLimitUp,
    limitPrice: finite(limitPrice) ? limitPrice : null,
    open: args.open,
    high: args.high,
    low: args.low,
    close: args.close,
    previousClose: args.previousClose,
    volume: args.volume,
    amount: finite(args.amount) ? args.amount : null,
    turnoverRate: finite(args.turnoverRate) ? args.turnoverRate : null,
    volumeRatio: finite(ratio) ? r2(ratio) : null,
    volumeLabel: volumeLabel(ratio),
    volumeIsDouble: finite(ratio) && ratio >= 1.8,
    firstSealTime: args.firstSealTime ?? null,
    lastSealTime: args.lastSealTime ?? null,
    reopenCount: finite(args.reopenCount) ? args.reopenCount : null,
    sealAmount: finite(args.sealAmount) ? args.sealAmount : null,
    adjustment: args.adjustment ?? null,
    source: args.source ?? 'unknown',
    settled: args.settled === true,
    coverage,
    dataQuality,
    missingReasons,
  }
}

function previousTradingSession(date: string): string {
  const cursor = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  for (let index = 0; index < 370; index += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    const candidate = cursor.toISOString().slice(0, 10)
    if (activeTradingCalendar().isTradingDay(candidate)) return candidate
  }
  return ''
}

export function buildBoardSequenceEvidence(args: {
  code: string
  name?: string
  observations: BoardDayObservation[]
  signalDate?: string
  declaredBoards?: number | null
}): BoardSequenceEvidence {
  const observations = args.observations.slice().sort((a, b) => a.date.localeCompare(b.date))
  const signalDate = args.signalDate?.slice(0, 10)
  const visible = signalDate ? observations.filter((item) => item.date.slice(0, 10) <= signalDate) : observations
  const byDate = new Map(visible.map((item) => [item.date.slice(0, 10), item]))
  const boards = visible.filter((item) => item.isLimitUp === true)
  const current = signalDate ? byDate.get(signalDate) : visible.at(-1)
  const episodeDates: string[] = []
  if (!signalDate) {
    episodeDates.push(...boards.slice(-3).map((item) => item.date.slice(0, 10)))
  } else if (current?.isLimitUp === true) {
    let cursor = signalDate
    while (cursor) {
      const item = byDate.get(cursor)
      if (item?.isLimitUp !== true) break
      episodeDates.unshift(cursor)
      const previous = previousTradingSession(cursor)
      if (!previous || !byDate.has(previous)) break
      cursor = previous
    }
  }
  const latestThree = signalDate
    ? episodeDates.map((date) => byDate.get(date)).filter((item): item is BoardDayObservation => !!item).slice(-3)
    : boards.slice(-3)
  const missingReasons: string[] = []
  if (!signalDate && latestThree.length < 3) missingReasons.push(`最近三板证据不足：仅有${latestThree.length}板`)
  if (signalDate && current == null) missingReasons.push('缺少信号日路径观察')
  if (signalDate && current?.isLimitUp !== true) missingReasons.push('信号日不是可验证收盘封板')
  if (signalDate && args.declaredBoards != null && episodeDates.length !== args.declaredBoards) {
    missingReasons.push(`provider连续板数${args.declaredBoards}与当前episode${episodeDates.length}不一致`)
  }
  if (latestThree.some((item) => item.dataQuality === 'unavailable' || item.boardType === 'unknown')) {
    missingReasons.push('至少一板缺少可验证的未复权板型')
  }
  if (latestThree.some((item) => item.volumeRatio == null)) missingReasons.push('至少一板缺少相邻日量比')
  const coverage = latestThree.length
    ? r2(latestThree.reduce((sum, item) => sum + item.coverage, 0) / latestThree.length)
    : 0
  const qingshanPattern = latestThree.length === 3 &&
    latestThree[0].volumeRatio != null && latestThree[0].volumeRatio >= 1.8 &&
    latestThree[1].boardType !== 'one-price' && latestThree[1].volumeRatio != null && latestThree[1].volumeRatio >= 1.1 &&
    latestThree[2].volumeRatio != null && latestThree[2].volumeRatio <= 0.75
  const reconstructedBoards = signalDate ? episodeDates.length : null
  const priorBoards = signalDate
    ? boards.filter((item) => !episodeDates.includes(item.date.slice(0, 10))).length
    : 0
  const previous = signalDate ? byDate.get(previousTradingSession(signalDate)) : null
  let boardClass: BoardSequenceEvidence['boardClass'] = 'unknown'
  if (signalDate && reconstructedBoards === 1 && priorBoards > 0) boardClass = 'rebound-board'
  else if (signalDate && reconstructedBoards === 1 && previous?.isLimitUp === false) boardClass = 'strict-first-board'
  else if (signalDate && reconstructedBoards != null && reconstructedBoards > 1 && args.declaredBoards === reconstructedBoards) boardClass = 'consecutive'
  else if (signalDate && reconstructedBoards != null) boardClass = 'n-day-m-board'
  const dataQuality = !latestThree.length || missingReasons.length >= 2
    ? 'unavailable'
    : missingReasons.length === 0 && coverage >= 90
      ? 'full'
      : 'partial'
  return {
    code: args.code,
    name: args.name ?? args.code,
    observations,
    latestThree,
    signature: latestThree.map((item) => `${item.boardType}:${item.volumeLabel}`),
    volumeRatios: latestThree.map((item) => item.volumeRatio),
    coverage,
    dataQuality,
    qingshanPattern,
    missingReasons: Array.from(new Set(missingReasons)),
    episodeDates: signalDate ? episodeDates : undefined,
    boardClass,
    declaredBoards: args.declaredBoards ?? null,
    reconstructedBoards,
  }
}

function normalize(values: Record<ExpectationPath, number>): Record<ExpectationPath, number> {
  const total = Object.values(values).reduce((sum, value) => sum + Math.max(value, 0.001), 0)
  return Object.fromEntries(PATHS.map((path) => [path, r2(Math.max(values[path], 0.001) / total)])) as Record<ExpectationPath, number>
}

export function buildRelayExpectation(sequence: BoardSequenceEvidence): RelayExpectation {
  const episodeMismatch = sequence.episodeDates != null &&
    sequence.declaredBoards != null &&
    sequence.reconstructedBoards !== sequence.declaredBoards
  const unavailable = sequence.dataQuality === 'unavailable' ||
    sequence.latestThree.length < 3 ||
    episodeMismatch ||
    (sequence.episodeDates != null && sequence.boardClass === 'unknown')
  if (unavailable) {
    return {
      status: 'research-score',
      modelStatus: 'unavailable',
      modelVersion: RELAY_EXPECTATION_VERSION,
      primaryPath: null,
      probabilities: Object.fromEntries(PATHS.map((path) => [path, null])) as Record<ExpectationPath, null>,
      heuristicScores: Object.fromEntries(PATHS.map((path) => [path, null])) as Record<ExpectationPath, null>,
      calibratedProbabilities: null,
      probabilityStatus: 'unavailable',
      confidence: null,
      clearExpectation: false,
      expectedOpenGapPct: null,
      expectedTouchTime: null,
      expectedMaxReopenCount: null,
      allowedPaths: [],
      prohibitedPaths: [],
      sequence,
      evidence: [],
      missingReasons: sequence.missingReasons,
    }
  }
  const latest = sequence.latestThree.at(-1) as BoardDayObservation
  const values: Record<ExpectationPath, number> = {
    'tradable-acceleration': 1,
    'divergence-reseal': 1,
    'one-price-untradeable': 1,
    'break-failure': 1,
  }
  const evidence: string[] = []
  if (sequence.qingshanPattern) {
    values['tradable-acceleration'] += 4
    values['break-failure'] -= 0.5
    evidence.push('命中“倍量启动→换手→缩量上板”研究签名')
  }
  if (latest.boardType === 'one-price') {
    values['one-price-untradeable'] += 5
    values['tradable-acceleration'] -= 0.4
    evidence.push('最近一板为一字，次日一字路径仅作情绪锚不可交易')
  } else if (latest.boardType === 't-board' || latest.boardType === 'gap-turnover') {
    values['divergence-reseal'] += 1.5
    evidence.push('最近一板保留真实换手，允许观察分歧回封')
  }
  if (latest.volumeLabel === 'shrink') {
    values['divergence-reseal'] += 1
    evidence.push('最近一板缩量，次日优先观察加速但拒绝锁死一字')
  } else if (latest.volumeLabel === 'expand') {
    values['break-failure'] += 0.8
    evidence.push('最近一板继续放量，分歧/兑现压力上升')
  }
  const probabilities = normalize(values)
  const ranked = PATHS.slice().sort((a, b) => probabilities[b] - probabilities[a])
  const primaryPath = ranked[0]
  const lead = probabilities[primaryPath] - probabilities[ranked[1]]
  const clearExpectation = probabilities[primaryPath] >= 0.45 && lead >= 0.1
  const onePrice = primaryPath === 'one-price-untradeable'
  return {
    status: 'research-score',
    modelStatus: 'shadow-heuristic',
    modelVersion: RELAY_EXPECTATION_VERSION,
    primaryPath,
    probabilities,
    heuristicScores: probabilities,
    calibratedProbabilities: null,
    probabilityStatus: 'research-score',
    confidence: r2(probabilities[primaryPath] * 100),
    clearExpectation,
    expectedOpenGapPct: onePrice ? [8, 10] : primaryPath === 'tradable-acceleration' ? [4, 8] : [0, 5],
    expectedTouchTime: onePrice ? null : ['09:35', '10:30'],
    expectedMaxReopenCount: onePrice ? 0 : 1,
    allowedPaths: onePrice ? ['one-price-untradeable'] : [primaryPath, 'divergence-reseal'],
    prohibitedPaths: onePrice ? ['tradable-acceleration', 'divergence-reseal'] : ['one-price-untradeable'],
    sequence,
    evidence,
    missingReasons: [],
  }
}

function bandFit(value: number | null | undefined, band: { q10: number; q25: number; q75: number; q90: number } | undefined, direction: 'band' | 'lower-better' | 'higher-better' = 'band'): number | null {
  if (!finite(value) || !band) return null
  if (direction === 'lower-better') {
    if (value <= band.q75) return 100
    if (value >= band.q90) return 0
    return clamp(((band.q90 - value) / Math.max(band.q90 - band.q75, 0.0001)) * 100)
  }
  if (direction === 'higher-better') {
    // Higher-priority features are monotonic: a value above q90 is not a
    // failure merely because a symmetric band-fit would clip it to zero.
    if (value >= band.q25) return 100
    if (value <= band.q10) return 0
    return clamp(((value - band.q10) / Math.max(band.q25 - band.q10, 0.0001)) * 100)
  }
  if (value >= band.q25 && value <= band.q75) return 100
  if (value <= band.q10 || value >= band.q90) return 0
  if (value < band.q25) return clamp(((value - band.q10) / Math.max(band.q25 - band.q10, 0.0001)) * 100)
  return clamp(((band.q90 - value) / Math.max(band.q90 - band.q75, 0.0001)) * 100)
}

/** Classify the path actually observed the next day; never use primaryPath as an observation. */
export function classifyObservedRelayPath(args: {
  onePrice?: boolean
  openGapPct?: number | null
  firstTouchMinutes?: number | null
  reopenCount?: number | null
  closedLimit?: boolean | null
}): ExpectationPath | null {
  if (args.onePrice === true) return 'one-price-untradeable'
  if (args.closedLimit === false) return 'break-failure'
  if ((args.reopenCount ?? 0) >= 3 || (args.firstTouchMinutes != null && args.firstTouchMinutes > 60)) return 'break-failure'
  if ((args.reopenCount ?? 0) > 0) return 'divergence-reseal'
  if (args.openGapPct != null || args.firstTouchMinutes != null || args.closedLimit === true) return 'tradable-acceleration'
  return null
}

export function matchRelayExpectation(args: ExpectationMatchInput): ExpectationMatch {
  const expectation = args.expectation
  if (!expectation || expectation.modelStatus === 'unavailable') {
    return {
      status: 'unavailable', fit: null,
      componentScores: { openGap: null, preSealAmount: null, firstTouch: null, reopen: null, theme: null },
      matched: [], unmet: [], missingReasons: ['预期模型或三板序列不可用'], observedPath: null,
    }
  }
  const artifactCausal = !!args.quantileArtifact &&
    !!args.signalDate &&
    args.quantileArtifact.trainEnd < args.signalDate &&
    (args.lane == null || args.quantileArtifact.lane === args.lane)
  const quantiles = args.quantiles ?? (artifactCausal ? args.quantileArtifact?.quantiles : undefined)
  const scores = {
    openGap: bandFit(args.openGapPct, quantiles?.openGapPct),
    preSealAmount: bandFit(args.preSealAmountRatio, quantiles?.preSealAmountRatio),
    firstTouch: bandFit(args.firstTouchMinutes, quantiles?.firstTouchMinutes, 'lower-better'),
    reopen: bandFit(args.reopenCount, quantiles?.reopenCount, 'lower-better'),
    theme: bandFit(args.themeStrength, quantiles?.themeStrength, 'higher-better'),
  }
  const weights = { openGap: 0.3, preSealAmount: 0.25, firstTouch: 0.2, reopen: 0.15, theme: 0.1 }
  const available = Object.entries(scores).filter(([, value]) => value != null) as Array<[keyof typeof scores, number]>
  const coverage = available.reduce((sum, [key]) => sum + weights[key], 0)
  const missingReasons = Object.entries(scores).filter(([, value]) => value == null).map(([key]) => `缺少${key}兑现证据`)
  if (args.quantileArtifact && !artifactCausal && !args.quantiles) missingReasons.push('量化分位artifact未通过signalDate因果校验')
  if (coverage < 0.7) {
    return { status: 'unavailable', fit: null, componentScores: scores, matched: [], unmet: [], missingReasons, observedPath: null }
  }
  const fit = r2(available.reduce((sum, [key, value]) => sum + value * weights[key], 0) / coverage)
  const observedPath = args.observedPath ?? classifyObservedRelayPath({
    openGapPct: args.openGapPct,
    firstTouchMinutes: args.firstTouchMinutes,
    reopenCount: args.reopenCount,
  })
  const prohibited = observedPath != null && expectation.prohibitedPaths.includes(observedPath)
  const unmet = available.filter(([, value]) => value < 50).map(([key]) => `${key}未达到预期`)
  const matched = available.filter(([, value]) => value >= 70).map(([key]) => `${key}符合预期`)
  const status: ExpectationMatchStatus = prohibited || fit < 50 ? 'violated' : fit >= 70 ? 'met' : 'partial'
  return { status, fit, componentScores: scores, matched, unmet, missingReasons, observedPath }
}

export interface MultinomialLogisticModel {
  modelStatus: 'shadow-logistic'
  modelVersion: string
  labels: ExpectationPath[]
  featureNames: string[]
  intercepts: number[]
  coefficients: number[][]
  sampleCount: number
  l2: number
}

/** Small deterministic trainer for later walk-forward calibration. */
export function fitMultinomialLogisticModel(args: {
  samples: Array<{ features: number[]; label: ExpectationPath }>
  featureNames?: string[]
  l2?: number
  epochs?: number
  learningRate?: number
}): MultinomialLogisticModel | null {
  if (!args.samples.length) return null
  const featureCount = args.samples[0].features.length
  if (!featureCount || args.samples.some((sample) => sample.features.length !== featureCount || !PATHS.includes(sample.label))) return null
  const labels = PATHS.slice()
  const labelIndex = new Map(labels.map((label, index) => [label, index]))
  const intercepts = Array<number>(labels.length).fill(0)
  const coefficients = labels.map(() => Array<number>(featureCount).fill(0))
  const l2 = args.l2 ?? 0.01
  const epochs = args.epochs ?? 250
  const learningRate = args.learningRate ?? 0.05
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const sample of args.samples) {
      const logits = labels.map((_, index) => intercepts[index] + coefficients[index].reduce((sum, coefficient, feature) => sum + coefficient * sample.features[feature], 0))
      const maxLogit = Math.max(...logits)
      const exp = logits.map((logit) => Math.exp(logit - maxLogit))
      const total = exp.reduce((sum, value) => sum + value, 0)
      const actual = labelIndex.get(sample.label) as number
      for (let index = 0; index < labels.length; index += 1) {
        const gradient = exp[index] / total - (index === actual ? 1 : 0)
        intercepts[index] -= learningRate * gradient
        for (let feature = 0; feature < featureCount; feature += 1) {
          coefficients[index][feature] -= learningRate * (gradient * sample.features[feature] + l2 * coefficients[index][feature])
        }
      }
    }
  }
  return {
    modelStatus: 'shadow-logistic',
    modelVersion: `${RELAY_EXPECTATION_VERSION}-logistic`,
    labels,
    featureNames: args.featureNames ?? Array.from({ length: featureCount }, (_, index) => `f${index + 1}`),
    intercepts,
    coefficients,
    sampleCount: args.samples.length,
    l2,
  }
}

export function predictMultinomialLogisticModel(model: MultinomialLogisticModel, features: number[]): Record<ExpectationPath, number> | null {
  if (features.length !== model.featureNames.length) return null
  const logits = model.labels.map((_, index) => model.intercepts[index] + model.coefficients[index].reduce((sum, coefficient, feature) => sum + coefficient * features[feature], 0))
  const maxLogit = Math.max(...logits)
  const exp = logits.map((logit) => Math.exp(logit - maxLogit))
  const total = exp.reduce((sum, value) => sum + value, 0)
  return Object.fromEntries(model.labels.map((label, index) => [label, r2(exp[index] / total)])) as Record<ExpectationPath, number>
}
