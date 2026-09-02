import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { LimitLadderNextDay, NextDayCandidateConfirmation } from './limitLadder'

export const NEXT_DAY_MANUAL_REVIEW_VERSION = 'next-day-manual-review-v1'

export type ManualReviewStatus = 'unreviewed' | 'partial' | 'reviewed'

export interface NextDayManualPersonalityEvidence {
  historySampleCount1y?: number | null
  limitUpSuccessCount1y?: number | null
  limitUpSuccessRateNonOnePct1y?: number | null
  blastedCount1y?: number | null
  sealSuccessRateNonOnePct1y?: number | null
  nextDayOpenHighRate1y?: number | null
  nextDayAvgOpenGapPct1y?: number | null
  nextDayPositiveCloseRate1y?: number | null
  nextDayAvgOpenClosePct1y?: number | null
  lastLimitTouchDate?: string | null
  lastLimitTouchStatus?: 'sealed' | 'blasted' | 'unknown' | null
}

export interface NextDayManualCurrentEvidence {
  currentSingleOrderAmountWan?: number | null
  maxSingleOrderAmountWan?: number | null
  sealToVolumePct?: number | null
  sealToFloatPct?: number | null
  limitUpTurnoverAmountYi?: number | null
}

export interface NextDayManualCapitalEvidence {
  mainNetInflowWan?: number | null
  mainNetInflowPct?: number | null
  inflowRank?: number | null
  retailNetInflowWan?: number | null
}

export interface NextDayManualDivergenceEvidence {
  themePositiveRatePct?: number | null
  sameLevelPositiveRatePct?: number | null
  coreVwapHold?: boolean | null
  assistantCount?: number | null
}

/**
 * Human-entered evidence transcribed from a screenshot or another provider.
 * It is stored separately from the automatic ladder snapshot and never mutates
 * the original candidate score.
 */
export interface NextDayManualReviewInput {
  signalDate: string
  code: string
  name?: string
  source?: string
  sourceRef?: string
  capturedAt?: string
  evidenceAt?: string
  signalCutoffAt?: string
  decisionSnapshotRef?: string
  /** Frozen automatic inputs captured when the review was first saved. */
  automaticScoreSnapshot?: number | null
  themeLadderScoreSnapshot?: number | null
  inputHash?: string
  personality?: NextDayManualPersonalityEvidence
  current?: NextDayManualCurrentEvidence
  capital?: NextDayManualCapitalEvidence
  divergence?: NextDayManualDivergenceEvidence
  note?: string
}

export interface NextDayManualReviewPayload {
  signalDate: string
  reviews: NextDayManualReviewInput[]
}

export interface ManualReviewComponent {
  score: number | null
  weight: number
  coveragePct: number
  evidence: string[]
}

export interface NextDayManualReviewAssessment {
  version: typeof NEXT_DAY_MANUAL_REVIEW_VERSION
  status: ManualReviewStatus
  finalScore: number | null
  provisionalScore: number | null
  coveragePct: number
  source: string
  sourceRef?: string
  capturedAt?: string
  evidenceAt?: string
  decisionSnapshotRef?: string
  inputHash: string
  pointInTimeCausal: boolean
  updatedAt: string
  missingReasons: string[]
  components: {
    automatic: ManualReviewComponent
    personality: ManualReviewComponent
    sealAndTurnover: ManualReviewComponent
    capital: ManualReviewComponent
    divergence: ManualReviewComponent
    themeLadder: ManualReviewComponent
  }
  evidence: NextDayManualReviewInput
}

interface ManualReviewRevision {
  revision: number
  savedAt: string
  reviews: NextDayManualReviewInput[]
}

interface ManualReviewArchive {
  version: typeof NEXT_DAY_MANUAL_REVIEW_VERSION
  signalDate: string
  updatedAt: string
  revisions: ManualReviewRevision[]
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const LADDER_ROOT = join(__dirname, '..', '..', 'docs', 'ladder')

function safeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function normalizeCode(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.slice(-6).padStart(6, '0')
}

function reviewPath(signalDate: string): string {
  const [year, month, day] = signalDate.split('-')
  return join(LADDER_ROOT, year, month, day, `${NEXT_DAY_MANUAL_REVIEW_VERSION}.json`)
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

function readArchive(signalDate: string): ManualReviewArchive | null {
  const path = reviewPath(signalDate)
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as ManualReviewArchive
    if (
      value.version !== NEXT_DAY_MANUAL_REVIEW_VERSION ||
      value.signalDate !== signalDate ||
      !Array.isArray(value.revisions)
    ) {
      return null
    }
    return value
  } catch {
    return null
  }
}

function latestReviews(signalDate: string): Map<string, NextDayManualReviewInput> {
  const archive = readArchive(signalDate)
  const latest = archive?.revisions.at(-1)?.reviews ?? []
  return new Map(latest.map((review) => [review.code, review]))
}

function optionalNumber(value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} 必须是数字`)
  return parsed
}

function optionalPct(value: unknown, label: string): number | null | undefined {
  const parsed = optionalNumber(value, label)
  if (parsed != null && (parsed < 0 || parsed > 100)) {
    throw new Error(`${label} 必须在0到100之间`)
  }
  return parsed
}

function optionalNonNegative(value: unknown, label: string): number | null | undefined {
  const parsed = optionalNumber(value, label)
  if (parsed != null && parsed < 0) throw new Error(`${label} 不能为负数`)
  return parsed
}

function normalizePersonality(value: unknown): NextDayManualPersonalityEvidence | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object') throw new Error('personality 必须是对象')
  const row = value as Record<string, unknown>
  return {
    historySampleCount1y: optionalNonNegative(row.historySampleCount1y, '近一年样本数'),
    limitUpSuccessCount1y: optionalNonNegative(row.limitUpSuccessCount1y, '近一年涨停成功次数'),
    limitUpSuccessRateNonOnePct1y: optionalPct(row.limitUpSuccessRateNonOnePct1y, '非一字涨停成功率'),
    blastedCount1y: optionalNonNegative(row.blastedCount1y, '近一年炸板次数'),
    sealSuccessRateNonOnePct1y: optionalPct(row.sealSuccessRateNonOnePct1y, '非一字封板成功率'),
    nextDayOpenHighRate1y: optionalPct(row.nextDayOpenHighRate1y, '次日高开率'),
    nextDayAvgOpenGapPct1y: optionalNumber(row.nextDayAvgOpenGapPct1y, '次日平均高开幅度'),
    nextDayPositiveCloseRate1y: optionalPct(row.nextDayPositiveCloseRate1y, '次日收盘上涨率'),
    nextDayAvgOpenClosePct1y: optionalNumber(row.nextDayAvgOpenClosePct1y, '次日平均开收幅度'),
    lastLimitTouchDate: row.lastLimitTouchDate == null ? null : String(row.lastLimitTouchDate),
    lastLimitTouchStatus:
      row.lastLimitTouchStatus === 'sealed' ||
      row.lastLimitTouchStatus === 'blasted' ||
      row.lastLimitTouchStatus === 'unknown'
        ? row.lastLimitTouchStatus
        : row.lastLimitTouchStatus == null
          ? null
          : 'unknown',
  }
}

function normalizeCurrent(value: unknown): NextDayManualCurrentEvidence | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object') throw new Error('current 必须是对象')
  const row = value as Record<string, unknown>
  return {
    currentSingleOrderAmountWan: optionalNonNegative(row.currentSingleOrderAmountWan, '当前单笔金额'),
    maxSingleOrderAmountWan: optionalNonNegative(row.maxSingleOrderAmountWan, '最高单笔金额'),
    sealToVolumePct: optionalPct(row.sealToVolumePct, '封单占成交量'),
    sealToFloatPct: optionalPct(row.sealToFloatPct, '封单占流通盘'),
    limitUpTurnoverAmountYi: optionalNonNegative(row.limitUpTurnoverAmountYi, '涨停板成交金额'),
  }
}

function normalizeCapital(value: unknown): NextDayManualCapitalEvidence | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object') throw new Error('capital 必须是对象')
  const row = value as Record<string, unknown>
  return {
    mainNetInflowWan: optionalNumber(row.mainNetInflowWan, '主力净流入'),
    mainNetInflowPct: optionalNumber(row.mainNetInflowPct, '主力净流入率'),
    inflowRank: optionalNonNegative(row.inflowRank, '主力净流入排名'),
    retailNetInflowWan: optionalNumber(row.retailNetInflowWan, '散户净流入'),
  }
}

function normalizeDivergence(value: unknown): NextDayManualDivergenceEvidence | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object') throw new Error('divergence 必须是对象')
  const row = value as Record<string, unknown>
  return {
    themePositiveRatePct: optionalPct(row.themePositiveRatePct, '板块正反馈率'),
    sameLevelPositiveRatePct: optionalPct(row.sameLevelPositiveRatePct, '同身位正反馈率'),
    coreVwapHold: typeof row.coreVwapHold === 'boolean' ? row.coreVwapHold : null,
    assistantCount: optionalNonNegative(row.assistantCount, '同步走强助攻数量'),
  }
}

function normalizeReview(value: unknown, signalDate: string): NextDayManualReviewInput {
  if (typeof value !== 'object' || value === null) throw new Error('reviews 中每项必须是对象')
  const row = value as Record<string, unknown>
  const code = normalizeCode(row.code)
  if (!/^\d{6}$/.test(code) || code === '000000') throw new Error('人工复核 code 必须是6位股票代码')
  const capturedAt = row.capturedAt == null ? undefined : String(row.capturedAt)
  const evidenceAt = row.evidenceAt == null ? capturedAt : String(row.evidenceAt)
  for (const [label, timestamp] of [['capturedAt', capturedAt], ['evidenceAt', evidenceAt]]) {
    if (timestamp != null && !Number.isFinite(Date.parse(timestamp))) throw new Error(`${label} 必须是有效时间戳`)
  }
  return {
    signalDate,
    code,
    name: row.name == null ? undefined : String(row.name).trim() || undefined,
    source: row.source == null ? 'manual-screenshot' : String(row.source),
    sourceRef: row.sourceRef == null ? undefined : String(row.sourceRef),
    capturedAt,
    evidenceAt,
    signalCutoffAt: row.signalCutoffAt == null ? undefined : String(row.signalCutoffAt),
    decisionSnapshotRef: row.decisionSnapshotRef == null ? undefined : String(row.decisionSnapshotRef),
    automaticScoreSnapshot: optionalNumber(row.automaticScoreSnapshot, '自动分冻结值'),
    themeLadderScoreSnapshot: optionalNumber(row.themeLadderScoreSnapshot, '题材梯队分冻结值'),
    inputHash: row.inputHash == null ? undefined : String(row.inputHash),
    personality: normalizePersonality(row.personality),
    current: normalizeCurrent(row.current),
    capital: normalizeCapital(row.capital),
    divergence: normalizeDivergence(row.divergence),
    note: row.note == null ? undefined : String(row.note),
  }
}

export function normalizeManualReviewPayload(value: unknown): NextDayManualReviewPayload {
  if (typeof value !== 'object' || value === null) throw new Error('人工复核内容必须是JSON对象')
  const raw = value as Record<string, unknown>
  const signalDate = String(raw.signalDate ?? '')
  if (!safeDate(signalDate)) throw new Error('signalDate 必须是 YYYY-MM-DD')
  if (!Array.isArray(raw.reviews) || raw.reviews.length === 0) {
    throw new Error('reviews 必须是非空数组')
  }
  const reviews = raw.reviews.map((item) => normalizeReview(item, signalDate))
  return {
    signalDate,
    reviews: Array.from(new Map(reviews.map((review) => [review.code, review])).values()),
  }
}

export function saveManualReviewPayload(payload: NextDayManualReviewPayload): ManualReviewArchive {
  const previous = readArchive(payload.signalDate)
  const merged = new Map(latestReviews(payload.signalDate))
  for (const review of payload.reviews) merged.set(review.code, review)
  const savedAt = new Date().toISOString()
  const archive: ManualReviewArchive = {
    version: NEXT_DAY_MANUAL_REVIEW_VERSION,
    signalDate: payload.signalDate,
    updatedAt: savedAt,
    revisions: [
      ...(previous?.revisions ?? []),
      {
        revision: (previous?.revisions.at(-1)?.revision ?? 0) + 1,
        savedAt,
        reviews: [...merged.values()],
      },
    ],
  }
  writeJsonAtomic(reviewPath(payload.signalDate), archive)
  return archive
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function directPct(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : clamp(value)
}

function centered(value: number | null | undefined, scale: number): number | null {
  return value == null || !Number.isFinite(value) || scale <= 0
    ? null
    : clamp(50 + Math.tanh(value / scale) * 50)
}

function ratioScore(value: number | null | undefined, max: number): number | null {
  return value == null || !Number.isFinite(value) || max <= 0 ? null : clamp((value / max) * 100)
}

function rankScore(value: number | null | undefined, topN = 200): number | null {
  return value == null || !Number.isFinite(value) || value <= 0
    ? null
    : clamp(100 - ((value - 1) / Math.max(topN - 1, 1)) * 100)
}

function logAmountScore(value: number | null | undefined, low: number, high: number): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0 || low <= 0 || high <= low) return null
  return clamp(((Math.log(value) - Math.log(low)) / (Math.log(high) - Math.log(low))) * 100)
}

function makeComponent(
  weight: number,
  parts: Array<{ score: number | null; weight: number; evidence: string }>,
): ManualReviewComponent {
  const available = parts.filter((part) => part.score != null)
  if (!available.length) return { score: null, weight, coveragePct: 0, evidence: [] }
  const availableWeight = available.reduce((sum, part) => sum + part.weight, 0)
  const score = available.reduce((sum, part) => sum + (part.score as number) * part.weight, 0) / availableWeight
  return {
    score: round(score),
    weight,
    coveragePct: round((availableWeight / parts.reduce((sum, part) => sum + part.weight, 0)) * 100),
    evidence: available.map((part) => part.evidence),
  }
}

function reviewInputHash(input: NextDayManualReviewInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function pointInTimeCausal(input: NextDayManualReviewInput): boolean {
  const cutoff = input.signalCutoffAt ?? `${input.signalDate}T23:59:59+08:00`
  const cutoffMs = Date.parse(cutoff)
  if (!Number.isFinite(cutoffMs)) return false
  return [input.capturedAt, input.evidenceAt]
    .filter((value): value is string => value != null)
    .every((value) => Date.parse(value) <= cutoffMs)
}

export interface ManualReviewCandidateContext {
  code: string
  name: string
  automaticScore: number | null
  themeLadderScore?: number | null
  themeLadderNote?: string
}

export function scoreNextDayManualReview(
  candidate: ManualReviewCandidateContext,
  input: NextDayManualReviewInput,
  updatedAt = new Date().toISOString(),
): NextDayManualReviewAssessment {
  const personality = input.personality ?? {}
  const current = input.current ?? {}
  const capital = input.capital ?? {}
  const divergence = input.divergence ?? {}
  const frozenAutomaticScore = input.automaticScoreSnapshot !== undefined
    ? input.automaticScoreSnapshot
    : candidate.automaticScore
  const frozenThemeLadderScore = input.themeLadderScoreSnapshot !== undefined
    ? input.themeLadderScoreSnapshot
    : candidate.themeLadderScore
  const sampleCount = personality.historySampleCount1y ??
    ((personality.limitUpSuccessCount1y ?? 0) + (personality.blastedCount1y ?? 0))
  const sampleConfidence = sampleCount > 0 ? clamp((sampleCount / 10) * 100) : null
  const personalityComponent = makeComponent(25, [
    {
      score: directPct(personality.sealSuccessRateNonOnePct1y ?? personality.limitUpSuccessRateNonOnePct1y),
      weight: 6,
      evidence: `近一年非一字封板成功率${personality.sealSuccessRateNonOnePct1y ?? personality.limitUpSuccessRateNonOnePct1y ?? '--'}%`,
    },
    {
      score: directPct(personality.nextDayOpenHighRate1y),
      weight: 4,
      evidence: `次日高开率${personality.nextDayOpenHighRate1y ?? '--'}%`,
    },
    {
      score: directPct(personality.nextDayPositiveCloseRate1y),
      weight: 5,
      evidence: `次日收盘上涨率${personality.nextDayPositiveCloseRate1y ?? '--'}%`,
    },
    {
      score: centered(personality.nextDayAvgOpenClosePct1y, 5),
      weight: 5,
      evidence: `次日平均开收${personality.nextDayAvgOpenClosePct1y ?? '--'}%`,
    },
    {
      score: sampleConfidence,
      weight: 5,
      evidence: `近一年股性样本${sampleCount || '--'}次`,
    },
  ])
  const singleOrderRatio =
    current.currentSingleOrderAmountWan != null && current.maxSingleOrderAmountWan != null && current.maxSingleOrderAmountWan > 0
      ? (current.currentSingleOrderAmountWan / current.maxSingleOrderAmountWan) * 100
      : null
  const sealComponent = makeComponent(25, [
    {
      score: ratioScore(current.sealToVolumePct, 10),
      weight: 7,
      evidence: `封单占成交量${current.sealToVolumePct ?? '--'}%`,
    },
    {
      score: ratioScore(current.sealToFloatPct, 1),
      weight: 7,
      evidence: `封单占流通盘${current.sealToFloatPct ?? '--'}%`,
    },
    {
      score: logAmountScore(current.limitUpTurnoverAmountYi, 0.5, 10),
      weight: 6,
      evidence: `涨停板成交额${current.limitUpTurnoverAmountYi ?? '--'}亿`,
    },
    {
      score: singleOrderRatio == null ? logAmountScore(current.currentSingleOrderAmountWan, 100, 20_000) : ratioScore(singleOrderRatio, 100),
      weight: 5,
      evidence: `当前/最高单笔金额${singleOrderRatio == null ? '--' : singleOrderRatio.toFixed(1) + '%'}`,
    },
  ])
  const capitalComponent = makeComponent(10, [
    {
      score: capital.mainNetInflowPct != null ? centered(capital.mainNetInflowPct, 5) : centered(capital.mainNetInflowWan, 500),
      weight: 5,
      evidence: `主力净流入${capital.mainNetInflowPct != null ? capital.mainNetInflowPct + '%' : capital.mainNetInflowWan == null ? '--' : capital.mainNetInflowWan + '万'}`,
    },
    {
      score: rankScore(capital.inflowRank),
      weight: 3,
      evidence: `主力净流入排名${capital.inflowRank ?? '--'}`,
    },
    {
      score: capital.retailNetInflowWan == null ? null : centered(-capital.retailNetInflowWan, 500),
      weight: 2,
      evidence: `散户净流入${capital.retailNetInflowWan ?? '--'}万`,
    },
  ])
  const divergenceComponent = makeComponent(5, [
    {
      score: directPct(divergence.themePositiveRatePct),
      weight: 2,
      evidence: `板块正反馈${divergence.themePositiveRatePct ?? '--'}%`,
    },
    {
      score: directPct(divergence.sameLevelPositiveRatePct),
      weight: 1.5,
      evidence: `同身位正反馈${divergence.sameLevelPositiveRatePct ?? '--'}%`,
    },
    {
      score: divergence.coreVwapHold == null ? null : divergence.coreVwapHold ? 100 : 0,
      weight: 1,
      evidence: `核心${divergence.coreVwapHold == null ? 'VWAP未知' : divergence.coreVwapHold ? '站上VWAP' : '跌破VWAP'}`,
    },
    {
      score: ratioScore(divergence.assistantCount, 3),
      weight: 0.5,
      evidence: `同步走强助攻${divergence.assistantCount ?? '--'}只`,
    },
  ])
  const themeLadderComponent = makeComponent(5, [
    {
      score: frozenThemeLadderScore ?? null,
      weight: 1,
      evidence: candidate.themeLadderNote ?? `题材梯队关系分${frozenThemeLadderScore ?? '--'}`,
    },
  ])
  const automaticComponent = makeComponent(30, [
    {
      score: frozenAutomaticScore ?? null,
      weight: 1,
      evidence: `自动候选分${frozenAutomaticScore == null ? '--' : frozenAutomaticScore.toFixed(1)}`,
    },
  ])
  const components = {
    automatic: automaticComponent,
    personality: personalityComponent,
    sealAndTurnover: sealComponent,
    capital: capitalComponent,
    divergence: divergenceComponent,
    themeLadder: themeLadderComponent,
  }
  const all = Object.values(components)
  const available = all.filter((component) => component.score != null)
  // Component score availability is not enough: a component contributes only
  // the fields that actually have evidence. This prevents one screenshot
  // field from unlocking the whole 25% historical-personality block.
  const availableWeight = all.reduce((sum, component) =>
    sum + component.weight * component.coveragePct / 100, 0)
  const provisionalScore = availableWeight
    ? round(all.reduce((sum, component) => sum + (component.score ?? 0) * component.weight * component.coveragePct / 100, 0) / availableWeight)
    : null
  const manualWeight = personalityComponent.weight + sealComponent.weight + capitalComponent.weight + divergenceComponent.weight + themeLadderComponent.weight
  const manualAvailableWeight = [personalityComponent, sealComponent, capitalComponent, divergenceComponent, themeLadderComponent]
    .reduce((sum, component) => sum + component.weight * component.coveragePct / 100, 0)
  const coveragePct = round((availableWeight / 100) * 100)
  const manualCoveragePct = manualWeight > 0 ? (manualAvailableWeight / manualWeight) * 100 : 0
  const coreManualComplete = personalityComponent.score != null && sealComponent.score != null &&
    personalityComponent.coveragePct >= 70 && sealComponent.coveragePct >= 70
  const causal = pointInTimeCausal(input)
  const hash = reviewInputHash(input)
  const finalScore = frozenAutomaticScore != null && coreManualComplete && manualCoveragePct >= 70 && causal
    ? provisionalScore
    : null
  const missingReasons = [
    frozenAutomaticScore == null ? '自动候选分缺失' : '',
    personalityComponent.score == null ? '缺少近一年股性截图字段' : '',
    sealComponent.score == null ? '缺少当日封单/成交截图字段' : '',
    capitalComponent.score == null ? '缺少主力净流入或资金排名字段' : '',
    divergenceComponent.score == null ? '缺少板块/同身位分歧字段' : '',
    themeLadderComponent.score == null ? '缺少上方龙头/下方梯队结构证据' : '',
    manualCoveragePct < 70 ? '人工证据覆盖率低于70%' : '',
    !causal ? '人工证据晚于信号截止时间，仅用于事后解释' : '',
  ].filter(Boolean)
  const status: ManualReviewStatus = finalScore != null
    ? 'reviewed'
    : available.length > 0
      ? 'partial'
      : 'unreviewed'
  return {
    version: NEXT_DAY_MANUAL_REVIEW_VERSION,
    status,
    finalScore,
    provisionalScore,
    coveragePct,
    source: input.source ?? 'manual-screenshot',
    sourceRef: input.sourceRef,
    capturedAt: input.capturedAt,
    evidenceAt: input.evidenceAt,
    decisionSnapshotRef: input.decisionSnapshotRef,
    inputHash: hash,
    pointInTimeCausal: causal,
    updatedAt,
    missingReasons,
    components,
    evidence: input,
  }
}

function candidateContext(candidate: NextDayCandidateConfirmation): ManualReviewCandidateContext {
  return {
    code: candidate.code,
    name: candidate.name,
    automaticScore: candidate.decisionScore ?? candidate.liveScore ?? candidate.baseScore ?? null,
    themeLadderScore: candidate.themeLadder?.score ?? null,
    themeLadderNote: candidate.themeLadder?.note,
  }
}

export function applyManualReviews(nextDay: LimitLadderNextDay): LimitLadderNextDay {
  const reviews = latestReviews(nextDay.signalDate)
  if (!reviews.size) return nextDay
  return {
    ...nextDay,
    candidates: nextDay.candidates.map((candidate) => {
      const input = reviews.get(candidate.code)
      if (!input) return candidate
      return {
        ...candidate,
        manualReview: scoreNextDayManualReview(candidateContext(candidate), input),
      }
    }),
  }
}

export function validateManualReviewCodes(
  payload: NextDayManualReviewPayload,
  candidates: NextDayCandidateConfirmation[],
): void {
  const candidateCodes = new Set(candidates.map((candidate) => candidate.code))
  const unknown = payload.reviews.map((review) => review.code).filter((code) => !candidateCodes.has(code))
  if (unknown.length) throw new Error(`人工复核股票不在次日候选中：${unknown.join('、')}`)
}
