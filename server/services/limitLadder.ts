import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { shanghaiClock } from '../lib/cache'
import { todayShanghai } from '../lib/time'
import {
  fetchAShareData,
  fetchStockKline,
  mapLimit,
  type AShareData,
  type KlineBar,
  type LimitStock,
} from './ashare'
import { fetchSentiment, type SentimentData } from './kaipanla'
import {
  clearKplLadderCache,
  fetchKplRealtimeLadder,
  type KplRealtimeLadder,
  type KplRealtimeStock,
} from './kaipanlaLadder'
import { isLimitUpDay } from './divergenceRules'
import { buildLhbIndex, type LhbDay } from './lhbHistory'

export const LIMIT_LADDER_RULE_VERSION = 'limit-ladder-v1'
const CACHE_MS = 120_000
const KLINE_COUNT = 180

const __dirname = dirname(fileURLToPath(import.meta.url))
const LADDER_ROOT = join(__dirname, '..', '..', 'docs', 'ladder')

/** 连板天梯只有收盘后才定盘；15:00 前只允许内存预览，不写快照。 */
export function isLadderSettledWindow(
  clock: { day: number; minutes: number } = shanghaiClock(),
): boolean {
  return clock.day >= 1 && clock.day <= 5 && clock.minutes >= 15 * 60
}

export function isLhbPublicationWindow(
  clock: { day: number; minutes: number } = shanghaiClock(),
): boolean {
  return clock.day >= 1 && clock.day <= 5 && clock.minutes >= 16 * 60 + 30
}

export type LadderState = 'candidate' | 'waiting' | 'observe' | 'exclude'
export type MarketCyclePhase = 'ice' | 'repair' | 'climax' | 'ebb'
export type ThemeGrade = 'A' | 'B' | 'C' | 'D'
export type LadderRole = 'space-leader' | 'theme-leader' | 'first-pioneer' | 'mid-ladder' | 'follower'
export type ShapeArchetype =
  | 'low-platform-breakout'
  | 'platform-breakout'
  | 'trend-platform'
  | 'low-oversold-reversal'
  | 'event-reversal'
  | 'high-new-high'
  | 'non-platform-breakout'
  | 'insufficient'

export interface LadderImportStock {
  code: string
  name?: string
  status?: string
  consecutiveDays?: number
  nDayBoards?: string
  themes?: string[]
  subtheme?: string
  role?: string
  reason?: string
  firstTime?: string
  lastTime?: string
  openCount?: number
  turnoverRate?: number
  amount?: number
  sealAmount?: number
  onePrice?: boolean
}

export interface LadderImportPayload {
  asof: string
  stocks: LadderImportStock[]
}

export interface MarketCycleInput {
  temperature: number
  limitUp: number
  limitDown: number
  breakRate: number
  promotionRate: number
  yestLimitPerf: number
  advance: number
  decline: number
  maxBoards: number
  ladderContinuity: number
}

export interface MarketCycle {
  phase: MarketCyclePhase
  score: number
  directionAvailable: boolean
  reasons: string[]
  current: MarketCycleInput
  previousTemperature?: number
}

export interface ThemeAnalysis {
  name: string
  grade: ThemeGrade
  score: number
  count: number
  firstBoardCount: number
  multiBoardCount: number
  maxBoards: number
  continuity: number
  promotionRate: number
  sealStability: number
  stockCodes: string[]
}

export interface TechnicalEvidence {
  available: boolean
  settled: boolean
  lastDate: string
  barCount: number
  ma20: number | null
  ma60: number | null
  ma120: number | null
  ma120Rising: boolean | null
  atr14Pct: number | null
  breakout20: boolean | null
  breakout60: boolean | null
  breakout120: boolean | null
  breakoutLine20: number | null
  pre20RangePct: number | null
  amountRatio20: number | null
  amountRatioSource: 'amount' | 'volume' | 'missing'
  prePosition120Pct: number | null
  episodeOnsetDate: string | null
  episodeReturnPct: number | null
  sessionsFromOnset: number | null
  recognitionLate: boolean
  onePrice: boolean
  shape: ShapeArchetype
  platformEdge: number | null
  onsetLow: number | null
}

export interface LadderDimension {
  score: number
  note: string
}

export interface LadderFundFlow {
  available: boolean
  score: number
  net: number
  instNet: number
  hotNet: number
  lhasaNet: number
  note: string
  source: 'eastmoney-lhb' | 'missing-neutral'
}

export interface LadderStockAnalysis {
  rank: number
  code: string
  name: string
  price: number
  changePct: number
  boardType: 'main' | 'twenty' | 'beijing'
  consecutiveDays: number
  nDayBoards: string
  themes: string[]
  primaryTheme: string
  subtheme: string
  themeGrade: ThemeGrade
  themeScore: number
  role: LadderRole
  reason: string
  firstTime: string
  lastTime: string
  openCount: number
  turnoverRate: number
  amount: number
  sealAmount: number | null
  onePrice: boolean
  tBoard: boolean
  isMarginEligible: boolean
  reasonSource: 'kaipanla' | 'import' | 'none'
  state: LadderState
  score: number
  technical: TechnicalEvidence
  dimensions: {
    market: LadderDimension
    theme: LadderDimension
    ladder: LadderDimension
    technical: LadderDimension
    fundFlow: LadderDimension
    seal: LadderDimension
  }
  fundFlow: LadderFundFlow
  penalties: string[]
  warnings: string[]
  trigger: string
  invalidation: string
  mainRisk: string
}

export interface LadderLevel {
  boards: number
  stocks: LadderStockAnalysis[]
}

export interface LadderDataQuality {
  source: 'kaipanla' | 'eastmoney' | 'sina' | 'import' | 'mixed'
  sourceDate: string
  sentimentSource: SentimentData['source']
  limitFieldsComplete: boolean
  klineComplete: number
  klineTotal: number
  degraded: boolean
  fundFlowComplete: boolean
  warnings: string[]
}

export interface LimitLadderAnalysis {
  asof: string
  generatedAt: string
  ruleVersion: string
  archived: boolean
  market: {
    cycle: MarketCycle
    limitUp: number
    limitDown: number
    breakRate: number
    promotionRate: number
    advance: number
    decline: number
    maxBoards: number
  }
  themes: ThemeAnalysis[]
  levels: LadderLevel[]
  firstBoards: LadderStockAnalysis[]
  stocks: LadderStockAnalysis[]
  quality: LadderDataQuality
  warnings: string[]
}

export interface NormalizedStock {
  code: string
  name: string
  price: number
  changePct: number
  turnoverRate: number
  amount: number
  firstTime: string
  lastTime: string
  openCount: number
  consecutiveDays: number
  industry: string
  nDayBoards: string
  themes: string[]
  subtheme: string
  importedRole: string
  reason: string
  reasonSource: LadderStockAnalysis['reasonSource']
  sealAmount: number | null
  importedOnePrice: boolean | null
  patternHintAvailable: boolean
  onePriceHint: boolean
  tBoardHint: boolean
  isMarginEligible: boolean
  warnings: string[]
}

interface TechnicalResult {
  evidence: TechnicalEvidence
  bars: KlineBar[]
}

interface EvidenceArchive {
  asof: string
  generatedAt: string
  ruleVersion: string
  qualityRank: number
  ashare: Pick<
    AShareData,
    | 'limitUpCount'
    | 'limitDownCount'
    | 'advance'
    | 'decline'
    | 'flat'
    | 'promotionRate'
    | 'promotedCount'
    | 'promotionTotal'
  >
  sentiment: SentimentData
  kplLadder: KplRealtimeLadder | null
  limitUpStocks: LimitStock[]
  imported: LadderImportPayload | null
  klines: Record<string, KlineBar[]>
}

const importsByDate = new Map<string, LadderImportPayload>()
const analysisCache = new Map<string, { at: number; value: LimitLadderAnalysis }>()

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n))
const r2 = (n: number) => Math.round(n * 100) / 100
const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

function safeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function normalizeCode(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.slice(-6).padStart(6, '0')
}

function normalizeTime(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits || digits === '0') return ''
  return digits.padStart(6, '0').slice(-6)
}

function boardType(code: string): LadderStockAnalysis['boardType'] {
  if (/^(4|8|920|43|83|87)/.test(code)) return 'beijing'
  if (code.startsWith('300') || code.startsWith('301') || code.startsWith('688')) return 'twenty'
  return 'main'
}

function archiveDir(asof: string): string {
  const [year, month, day] = asof.split('-')
  return join(LADDER_ROOT, year, month, day)
}

function evidencePath(asof: string): string {
  return join(archiveDir(asof), 'evidence.json')
}

function analysisPath(asof: string): string {
  return join(archiveDir(asof), `analysis-${LIMIT_LADDER_RULE_VERSION}.json`)
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(temp, path)
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function previousArchivedAnalysis(asof: string): LimitLadderAnalysis | null {
  if (!existsSync(LADDER_ROOT)) return null
  const dates: string[] = []
  for (const year of readdirSync(LADDER_ROOT)) {
    const yearPath = join(LADDER_ROOT, year)
    if (!/^\d{4}$/.test(year)) continue
    for (const month of readdirSync(yearPath)) {
      const monthPath = join(yearPath, month)
      if (!/^\d{2}$/.test(month)) continue
      for (const day of readdirSync(monthPath)) {
        const date = `${year}-${month}-${day}`
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < asof && existsSync(analysisPath(date))) dates.push(date)
      }
    }
  }
  const previous = dates.sort().at(-1)
  return previous ? readJson<LimitLadderAnalysis>(analysisPath(previous)) : null
}

export function normalizeLadderImport(input: unknown): LadderImportPayload {
  if (typeof input !== 'object' || input === null) throw new Error('导入内容必须是 JSON 对象')
  const raw = input as Record<string, unknown>
  const asof = String(raw.asof ?? '')
  if (!safeDate(asof)) throw new Error('asof 必须是 YYYY-MM-DD')
  if (!Array.isArray(raw.stocks)) throw new Error('stocks 必须是数组')

  const byCode = new Map<string, LadderImportStock>()
  for (const item of raw.stocks) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const code = normalizeCode(row.code)
    if (!/^\d{6}$/.test(code) || code === '000000') continue
    const themes = Array.isArray(row.themes)
      ? row.themes.map(String).map((x) => x.trim()).filter(Boolean)
      : String(row.themes ?? '')
          .split('|')
          .map((x) => x.trim())
          .filter(Boolean)
    const current = byCode.get(code)
    const next: LadderImportStock = {
      code,
      name: String(row.name ?? current?.name ?? '').trim() || undefined,
      status: String(row.status ?? current?.status ?? '').trim() || undefined,
      consecutiveDays: Number.isFinite(Number(row.consecutiveDays))
        ? Math.max(0, Number(row.consecutiveDays))
        : current?.consecutiveDays,
      nDayBoards: String(row.nDayBoards ?? current?.nDayBoards ?? '').trim() || undefined,
      themes: Array.from(new Set([...(current?.themes ?? []), ...themes])),
      subtheme: String(row.subtheme ?? current?.subtheme ?? '').trim() || undefined,
      role: String(row.role ?? current?.role ?? '').trim() || undefined,
      reason: String(row.reason ?? current?.reason ?? '').trim() || undefined,
      firstTime: normalizeTime(row.firstTime ?? current?.firstTime),
      lastTime: normalizeTime(row.lastTime ?? current?.lastTime),
      openCount: Number.isFinite(Number(row.openCount)) ? Math.max(0, Number(row.openCount)) : current?.openCount,
      turnoverRate: Number.isFinite(Number(row.turnoverRate)) ? Number(row.turnoverRate) : current?.turnoverRate,
      amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : current?.amount,
      sealAmount: Number.isFinite(Number(row.sealAmount)) ? Number(row.sealAmount) : current?.sealAmount,
      onePrice: typeof row.onePrice === 'boolean' ? row.onePrice : current?.onePrice,
    }
    byCode.set(code, next)
  }
  if (byCode.size === 0) throw new Error('导入内容没有有效股票代码')
  return { asof, stocks: Array.from(byCode.values()) }
}

export function classifyMarketCycle(
  current: MarketCycleInput,
  previous?: Pick<MarketCycle, 'phase' | 'current'>,
): MarketCycle {
  const delta = previous ? current.temperature - previous.current.temperature : 0
  const reasons: string[] = []
  let phase: MarketCyclePhase

  const ebb =
    !!previous &&
    (previous.phase === 'repair' || previous.phase === 'climax') &&
    (delta <= -8 || current.breakRate >= 35 || current.yestLimitPerf < 0)
  const ice =
    current.temperature <= 35 ||
    (current.limitDown >= current.limitUp && current.yestLimitPerf < 0) ||
    (current.maxBoards <= 2 && current.promotionRate < 15)
  const climax =
    current.temperature >= 70 &&
    current.promotionRate >= 35 &&
    current.breakRate <= 25 &&
    current.maxBoards >= 4

  if (ebb) {
    phase = 'ebb'
    reasons.push('情绪较前日明显转弱')
  } else if (ice) {
    phase = 'ice'
    reasons.push('涨停宽度、晋级或赚钱效应处于低位')
  } else if (climax) {
    phase = 'climax'
    reasons.push('高温度、高晋级、低破板且空间高度打开')
  } else {
    phase = 'repair'
    reasons.push('情绪未达高潮，梯队处于修复或发酵')
  }
  if (!previous) reasons.push('缺少前日归档，周期方向仅按当日水平判断')

  const scoreByPhase: Record<MarketCyclePhase, number> = {
    ice: 30,
    repair: 75,
    climax: 65,
    ebb: 35,
  }
  return {
    phase,
    score: scoreByPhase[phase],
    directionAvailable: !!previous,
    reasons,
    current,
    previousTemperature: previous?.current.temperature,
  }
}

function levelContinuity(stocks: Array<{ consecutiveDays: number }>): number {
  const levels = new Set(stocks.map((stock) => stock.consecutiveDays).filter((n) => n > 0))
  const max = Math.max(0, ...levels)
  if (max === 0) return 0
  let present = 0
  for (let level = 1; level <= max; level++) if (levels.has(level)) present++
  return present / max
}

export function scoreThemes(
  stocks: NormalizedStock[],
  globalPromotionRate: number,
): ThemeAnalysis[] {
  const grouped = new Map<string, NormalizedStock[]>()
  for (const stock of stocks) {
    const names = stock.themes.length ? stock.themes : [stock.industry || '其他']
    for (const name of names) {
      const group = grouped.get(name) ?? []
      group.push(stock)
      grouped.set(name, group)
    }
  }

  return Array.from(grouped.entries())
    .map(([name, group]) => {
      const count = group.length
      const maxBoards = Math.max(...group.map((stock) => stock.consecutiveDays))
      const continuity = levelContinuity(group)
      const sealStability = mean(group.map((stock) => clamp(100 - stock.openCount * 25)))
      const breadthScore = clamp(((count - 1) / 4) * 100)
      const heightScore = clamp(((maxBoards - 1) / 3) * 100)
      const score = r2(
        breadthScore * 0.3 +
          heightScore * 0.25 +
          continuity * 100 * 0.2 +
          clamp(globalPromotionRate) * 0.15 +
          sealStability * 0.1,
      )
      const grade: ThemeGrade = score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D'
      return {
        name,
        grade,
        score,
        count,
        firstBoardCount: group.filter((stock) => stock.consecutiveDays === 1).length,
        multiBoardCount: group.filter((stock) => stock.consecutiveDays >= 2).length,
        maxBoards,
        continuity: r2(continuity * 100),
        promotionRate: globalPromotionRate,
        sealStability: r2(sealStability),
        stockCodes: group.map((stock) => stock.code),
      }
    })
    .sort((a, b) => b.score - a.score || b.maxBoards - a.maxBoards || b.count - a.count)
}

function rollingMean(values: number[], endExclusive: number, window: number): number | null {
  const start = endExclusive - window
  if (start < 0) return null
  const slice = values.slice(start, endExclusive)
  return slice.length === window ? mean(slice) : null
}

function rollingHigh(bars: KlineBar[], endExclusive: number, window: number): number | null {
  const start = endExclusive - window
  if (start < 0) return null
  return Math.max(...bars.slice(start, endExclusive).map((bar) => bar.high))
}

function rollingLow(bars: KlineBar[], endExclusive: number, window: number): number | null {
  const start = endExclusive - window
  if (start < 0) return null
  return Math.min(...bars.slice(start, endExclusive).map((bar) => bar.low))
}

function trueRange(bars: KlineBar[], index: number): number {
  const bar = bars[index]
  if (index === 0) return bar.high - bar.low
  const prevClose = bars[index - 1].close
  return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose))
}

function amountRatioAt(bars: KlineBar[], index: number): { value: number | null; source: TechnicalEvidence['amountRatioSource'] } {
  const amountBase = rollingMean(
    bars.map((bar) => bar.turnover),
    index,
    20,
  )
  if (amountBase && amountBase > 0 && bars[index].turnover > 0) {
    return { value: bars[index].turnover / amountBase, source: 'amount' }
  }
  const volumeBase = rollingMean(
    bars.map((bar) => bar.volume),
    index,
    20,
  )
  if (volumeBase && volumeBase > 0 && bars[index].volume > 0) {
    return { value: bars[index].volume / volumeBase, source: 'volume' }
  }
  return { value: null, source: 'missing' }
}

function breakoutAt(bars: KlineBar[], index: number, window: number): boolean | null {
  const high = rollingHigh(bars, index, window)
  return high == null ? null : bars[index].close > high
}

function findEpisodeOnset(bars: KlineBar[], eventIndex: number, code: string): number {
  const start = Math.max(1, eventIndex - 40)
  let anchor = start
  for (let i = start + 1; i <= eventIndex; i++) {
    if (bars[i].low < bars[anchor].low) anchor = i
  }
  for (let i = Math.min(anchor + 1, eventIndex); i <= eventIndex; i++) {
    const prevClose = bars[i - 1]?.close ?? 0
    const ret = prevClose > 0 ? bars[i].close / prevClose - 1 : 0
    const volume = amountRatioAt(bars, i).value
    if (isLimitUpDay(bars[i], prevClose, code) || (breakoutAt(bars, i, 20) && ret >= 0.03 && (volume ?? 0) >= 1.15)) {
      return i
    }
  }
  return eventIndex
}

function emptyTechnical(lastDate = '', barCount = 0): TechnicalEvidence {
  return {
    available: false,
    settled: false,
    lastDate,
    barCount,
    ma20: null,
    ma60: null,
    ma120: null,
    ma120Rising: null,
    atr14Pct: null,
    breakout20: null,
    breakout60: null,
    breakout120: null,
    breakoutLine20: null,
    pre20RangePct: null,
    amountRatio20: null,
    amountRatioSource: 'missing',
    prePosition120Pct: null,
    episodeOnsetDate: null,
    episodeReturnPct: null,
    sessionsFromOnset: null,
    recognitionLate: false,
    onePrice: false,
    shape: 'insufficient',
    platformEdge: null,
    onsetLow: null,
  }
}

export function analyzeTechnical(
  barsInput: KlineBar[],
  code: string,
  asof: string,
  sessionSettled = true,
): TechnicalEvidence {
  const bars = barsInput.filter((bar) => bar.date <= asof).sort((a, b) => a.date.localeCompare(b.date))
  if (bars.length < 21) return emptyTechnical(bars.at(-1)?.date ?? '', bars.length)
  const index = bars.length - 1
  const today = bars[index]
  const settled = today.date === asof && sessionSettled
  const closes = bars.map((bar) => bar.close)
  const ma20 = rollingMean(closes, bars.length, 20)
  const ma60 = rollingMean(closes, bars.length, 60)
  const ma120 = rollingMean(closes, bars.length, 120)
  const ma120Past = bars.length >= 130 ? rollingMean(closes, bars.length - 10, 120) : null
  const prior20High = rollingHigh(bars, index, 20)
  const prior20Low = rollingLow(bars, index, 20)
  const prior60High = rollingHigh(bars, index, 60)
  const prior120High = rollingHigh(bars, index, 120)
  const prior120Low = rollingLow(bars, index, 120)
  const pre20RangePct = prior20High != null && prior20Low != null && prior20Low > 0 ? (prior20High / prior20Low - 1) * 100 : null
  const prePosition120Pct =
    prior120High != null && prior120Low != null && prior120High > prior120Low
      ? ((bars[index - 1].close - prior120Low) / (prior120High - prior120Low)) * 100
      : null
  const amountRatio = amountRatioAt(bars, index)
  const atrValues = Array.from({ length: Math.min(14, bars.length - 1) }, (_, offset) => trueRange(bars, index - offset))
  const atr14Pct = today.close > 0 ? (mean(atrValues) / today.close) * 100 : null
  const breakout20 = prior20High == null ? null : today.close > prior20High
  const breakout60 = prior60High == null ? null : today.close > prior60High
  const breakout120 = prior120High == null ? null : today.close > prior120High
  const prevClose = bars[index - 1].close
  const strongDay = isLimitUpDay(today, prevClose, code) || today.changePct >= 7
  const platform = (pre20RangePct ?? Infinity) <= 25
  const lowPosition = (prePosition120Pct ?? Infinity) <= 35
  const highPosition = (prePosition120Pct ?? -Infinity) >= 80
  const bullishMa = ma20 != null && ma60 != null && ma20 > ma60
  const fallingMa = ma20 != null && ma60 != null && ma20 < ma60
  let shape: ShapeArchetype
  if (breakout60 && platform && lowPosition) shape = 'low-platform-breakout'
  else if (breakout20 && platform && bullishMa && !highPosition) shape = 'trend-platform'
  else if (breakout60 && highPosition && bullishMa) shape = 'high-new-high'
  else if (strongDay && lowPosition && fallingMa) shape = 'low-oversold-reversal'
  else if (breakout20 && platform) shape = 'platform-breakout'
  else if (breakout20) shape = 'non-platform-breakout'
  else if (strongDay) shape = 'event-reversal'
  else shape = 'insufficient'

  const onsetIndex = findEpisodeOnset(bars, index, code)
  const onsetBase = bars[Math.max(0, onsetIndex - 1)].close
  const episodeReturnPct = onsetBase > 0 ? (today.close / onsetBase - 1) * 100 : null
  const recognitionLate = (episodeReturnPct ?? 0) > 50 && !platform

  return {
    available: true,
    settled,
    lastDate: today.date,
    barCount: bars.length,
    ma20: ma20 == null ? null : r2(ma20),
    ma60: ma60 == null ? null : r2(ma60),
    ma120: ma120 == null ? null : r2(ma120),
    ma120Rising: ma120 == null || ma120Past == null ? null : ma120 > ma120Past,
    atr14Pct: atr14Pct == null ? null : r2(atr14Pct),
    breakout20,
    breakout60,
    breakout120,
    breakoutLine20: prior20High == null ? null : r2(prior20High),
    pre20RangePct: pre20RangePct == null ? null : r2(pre20RangePct),
    amountRatio20: amountRatio.value == null ? null : r2(amountRatio.value),
    amountRatioSource: amountRatio.source,
    prePosition120Pct: prePosition120Pct == null ? null : r2(prePosition120Pct),
    episodeOnsetDate: bars[onsetIndex]?.date ?? null,
    episodeReturnPct: episodeReturnPct == null ? null : r2(episodeReturnPct),
    sessionsFromOnset: index - onsetIndex,
    recognitionLate,
    onePrice: Math.abs(today.high - today.low) < 0.005 && isLimitUpDay(today, prevClose, code),
    shape,
    platformEdge: prior20High == null ? null : r2(prior20High),
    onsetLow: bars[onsetIndex]?.low == null ? null : r2(bars[onsetIndex].low),
  }
}

function technicalScore(shape: ShapeArchetype): number {
  const scores: Record<ShapeArchetype, number> = {
    'low-platform-breakout': 95,
    'trend-platform': 90,
    'platform-breakout': 85,
    'low-oversold-reversal': 80,
    'non-platform-breakout': 70,
    'event-reversal': 65,
    'high-new-high': 55,
    insufficient: 35,
  }
  return scores[shape]
}

function ladderRoleScore(role: LadderRole): number {
  return {
    'space-leader': 100,
    'theme-leader': 85,
    'first-pioneer': 80,
    'mid-ladder': 60,
    follower: 40,
  }[role]
}

export function scoreLadderFundFlow(day?: LhbDay): LadderFundFlow {
  const moneyMagnitude = (value: number, cap: number) =>
    clamp(Math.log10(1 + Math.abs(value) / 1e6) / Math.log10(301) * cap, 0, cap)
  let score = 50
  if (day) {
    score += Math.sign(day.instNet) * moneyMagnitude(day.instNet, 25)
    score += Math.sign(day.hotNet) * moneyMagnitude(day.hotNet, 15)
    score -= Math.max(0, moneyMagnitude(day.lhasaNet ?? 0, 20))
    score += Math.sign(day.net) * moneyMagnitude(day.net, 10)
  }
  score = clamp(r2(score))
  return {
    available: !!day,
    score,
    net: day?.net ?? 0,
    instNet: day?.instNet ?? 0,
    hotNet: day?.hotNet ?? 0,
    lhasaNet: day?.lhasaNet ?? 0,
    note: day
      ? `机构${r2(day.instNet / 1e4)}万·游资${r2(day.hotNet / 1e4)}万·拉萨${r2((day.lhasaNet ?? 0) / 1e4)}万`
      : '未上龙虎榜或数据尚未发布，中性分',
    source: day ? 'eastmoney-lhb' : 'missing-neutral',
  }
}

function timeMinutes(value: string): number | null {
  if (!value) return null
  const digits = value.padStart(6, '0')
  const hour = Number(digits.slice(0, 2))
  const minute = Number(digits.slice(2, 4))
  return Number.isFinite(hour + minute) ? hour * 60 + minute : null
}

function sealScore(stock: NormalizedStock, onePrice: boolean): number {
  let score = 70
  const minutes = timeMinutes(stock.firstTime)
  if (minutes == null) score -= 10
  else if (minutes <= 9 * 60 + 45) score += 20
  else if (minutes <= 10 * 60 + 30) score += 10
  score -= stock.openCount * 15
  if (onePrice) score -= 5
  return clamp(score)
}

function importedRole(value: string): LadderRole | null {
  const lower = value.toLowerCase()
  if (lower.includes('空间') || lower.includes('space')) return 'space-leader'
  if (lower.includes('题材龙') || lower.includes('theme')) return 'theme-leader'
  if (lower.includes('先锋') || lower.includes('pioneer')) return 'first-pioneer'
  if (lower.includes('中位') || lower.includes('mid')) return 'mid-ladder'
  if (lower.includes('后排') || lower.includes('follower')) return 'follower'
  return null
}

function determineRole(
  stock: NormalizedStock,
  maxBoards: number,
  theme: ThemeAnalysis,
): LadderRole {
  const imported = importedRole(stock.importedRole)
  if (imported) return imported
  if (stock.consecutiveDays === maxBoards && maxBoards >= 2) return 'space-leader'
  if (stock.consecutiveDays === theme.maxBoards && theme.maxBoards >= 2) return 'theme-leader'
  if (stock.consecutiveDays === 1 && (timeMinutes(stock.firstTime) ?? Infinity) <= 10 * 60) return 'first-pioneer'
  if (stock.consecutiveDays >= 2) return 'mid-ladder'
  return 'follower'
}

function statePriority(state: LadderState): number {
  return { candidate: 0, waiting: 1, observe: 2, exclude: 3 }[state]
}

function buildTrigger(stock: NormalizedStock, technical: TechnicalEvidence): string {
  const atr = technical.atr14Pct == null ? '1 ATR' : `${technical.atr14Pct.toFixed(1)}%`
  if (stock.consecutiveDays >= 4) return '只观察首次有效分歧：不崩、重新站回均价或突破分歧日高点'
  if (boardType(stock.code) === 'twenty') return '缩量回踩20日突破线不破，随后重新突破信号日高点'
  return `次日跳空不超过${atr}，守住涨停价或平台边缘后重新转强`
}

function buildInvalidation(technical: TechnicalEvidence): string {
  const levels = [technical.platformEdge, technical.onsetLow].filter((n): n is number => n != null)
  if (!levels.length) return '跌破启动日结构低点，或题材梯队明显退潮'
  return `收盘跌破${Math.max(...levels).toFixed(2)}附近结构位，或题材梯队明显退潮`
}

function mergeStocks(
  auto: LimitStock[],
  kplStocks: KplRealtimeStock[],
  imported: LadderImportPayload | null,
): NormalizedStock[] {
  const importedMap = new Map((imported?.stocks ?? []).map((stock) => [normalizeCode(stock.code), stock]))
  const autoMap = new Map(auto.map((stock) => [normalizeCode(stock.code), stock]))
  const kplMap = new Map(kplStocks.map((stock) => [normalizeCode(stock.code), stock]))
  const codes = new Set([
    ...(kplStocks.length > 0 ? kplMap.keys() : autoMap.keys()),
    ...importedMap.keys(),
  ])
  const merged: NormalizedStock[] = []

  for (const code of codes) {
    const market = autoMap.get(code)
    const kpl = kplMap.get(code)
    const extra = importedMap.get(code)
    const importedSealed = ['sealed', 'limit-up', '涨停'].includes(extra?.status?.trim() ?? '')
    if (!market && !kpl && (auto.length > 0 || kplStocks.length > 0) && !importedSealed) continue
    const warnings: string[] = []
    if (
      market &&
      market.consecutiveDays > 0 &&
      kpl &&
      market.consecutiveDays !== kpl.consecutiveDays
    ) {
      warnings.push(`东财板数${market.consecutiveDays}与开盘啦板数${kpl.consecutiveDays}冲突，采用开盘啦实时值`)
    }
    const sourceBoards = kpl?.consecutiveDays || market?.consecutiveDays || 0
    if (extra?.consecutiveDays != null && sourceBoards > 0 && extra.consecutiveDays !== sourceBoards) {
      warnings.push(`导入板数${extra.consecutiveDays}与实时板数${sourceBoards}冲突，采用实时值`)
    }
    const consecutiveDays = Math.max(1, sourceBoards || extra?.consecutiveDays || 1)
    const industry = market?.industry || kpl?.primaryTheme || ''
    const themes = Array.from(
      new Set([
        ...(kpl?.themes ?? []),
        ...(extra?.themes ?? []),
        ...(industry ? [industry] : []),
      ]),
    )
    if (themes.length === 0) themes.push('其他')
    const reason = extra?.reason || kpl?.primaryTheme || ''
    merged.push({
      code,
      name: kpl?.name || market?.name || extra?.name || code,
      price: market?.price || kpl?.price || 0,
      changePct: market?.changePct || kpl?.changePct || 0,
      turnoverRate: market?.turnoverRate || kpl?.turnoverRate || extra?.turnoverRate || 0,
      amount: market?.amount || kpl?.amount || extra?.amount || 0,
      firstTime: kpl?.firstTime || market?.firstTime || normalizeTime(extra?.firstTime),
      lastTime: market?.lastTime || normalizeTime(extra?.lastTime),
      openCount: market?.openCount ?? extra?.openCount ?? 0,
      consecutiveDays,
      industry,
      nDayBoards: kpl?.nDayBoards || extra?.nDayBoards || `${consecutiveDays}板`,
      themes,
      subtheme: extra?.subtheme || kpl?.primaryTheme || '',
      importedRole: extra?.role || '',
      reason,
      reasonSource: extra?.reason ? 'import' : kpl ? 'kaipanla' : 'none',
      sealAmount: extra?.sealAmount ?? kpl?.sealAmount ?? null,
      importedOnePrice: extra?.onePrice ?? null,
      patternHintAvailable: !!kpl,
      onePriceHint: kpl?.onePriceHint ?? false,
      tBoardHint: kpl?.tBoardHint ?? false,
      isMarginEligible: kpl?.isMarginEligible ?? false,
      warnings,
    })
  }
  return merged
}

export function rankAndClassifyStocks(args: {
  stocks: NormalizedStock[]
  themes: ThemeAnalysis[]
  technical: Map<string, TechnicalEvidence>
  market: MarketCycle
  degraded: boolean
  lhb?: Map<string, LhbDay>
}): LadderStockAnalysis[] {
  const { stocks, themes, technical, market, degraded, lhb = new Map() } = args
  const themeMap = new Map(themes.map((theme) => [theme.name, theme]))
  const maxBoards = Math.max(1, ...stocks.map((stock) => stock.consecutiveDays))
  const rows = stocks.map((stock) => {
    const primaryTheme =
      stock.themes
        .map((name) => themeMap.get(name))
        .filter((theme): theme is ThemeAnalysis => !!theme)
        .sort((a, b) => b.score - a.score)[0] ?? {
        name: stock.industry || '其他',
        grade: 'D' as ThemeGrade,
        score: 0,
        maxBoards: 1,
      }
    const evidence = technical.get(stock.code) ?? emptyTechnical()
    const role = determineRole(stock, maxBoards, primaryTheme as ThemeAnalysis)
    const onePrice =
      stock.importedOnePrice ??
      (stock.patternHintAvailable ? stock.onePriceHint : evidence.onePrice)
    const tBoard = !onePrice && stock.patternHintAvailable && stock.tBoardHint
    const fundFlow = scoreLadderFundFlow(lhb.get(stock.code))
    const dimensions = {
      market: { score: market.score, note: market.reasons.join('；') },
      theme: { score: primaryTheme.score, note: `${primaryTheme.grade}级 ${primaryTheme.name}` },
      ladder: { score: ladderRoleScore(role), note: `${stock.consecutiveDays}板 · ${role}` },
      technical: { score: technicalScore(evidence.shape), note: evidence.shape },
      fundFlow: { score: fundFlow.score, note: fundFlow.note },
      seal: { score: sealScore(stock, onePrice), note: stock.firstTime ? `首封${stock.firstTime}` : '封板时间缺失' },
    }
    let score = r2(
      dimensions.market.score * 0.15 +
        dimensions.theme.score * 0.25 +
        dimensions.ladder.score * 0.2 +
        dimensions.technical.score * 0.2 +
        dimensions.fundFlow.score * 0.1 +
        dimensions.seal.score * 0.1,
    )
    const penalties: string[] = []
    if (evidence.recognitionLate) {
      score -= 15
      penalties.push('识别过晚 -15')
    }
    if (evidence.shape === 'high-new-high') {
      score -= 10
      penalties.push('高位加速 -10')
    }
    if (stock.consecutiveDays >= 4 && (evidence.pre20RangePct ?? Infinity) > 25) {
      score -= 10
      penalties.push('四板以上且无新平台 -10')
    }
    if (stock.openCount >= 3) {
      score -= 10
      penalties.push('炸板三次以上 -10')
    }
    if (primaryTheme.grade === 'D') {
      score -= 15
      penalties.push('孤立题材 -15')
    }
    score = clamp(r2(score))

    const hardFailure =
      /ST|\*ST/i.test(stock.name) ||
      /^(N|C)/i.test(stock.name) ||
      (evidence.available && !evidence.settled)
    let state: LadderState
    if (hardFailure || score < 40) state = 'exclude'
    else if (degraded || !evidence.available || primaryTheme.grade === 'C' || primaryTheme.grade === 'D') state = 'observe'
    else if (score >= 70 && !onePrice && stock.consecutiveDays < 4 && (primaryTheme.grade === 'A' || primaryTheme.grade === 'B')) {
      state = 'candidate'
    } else if (score >= 55) state = 'waiting'
    else state = 'observe'

    const warnings = [...stock.warnings]
    if (!stock.firstTime) warnings.push('封板时间缺失')
    if (!evidence.available) warnings.push('K线不足')
    if (evidence.available && !evidence.settled) warnings.push(`K线截止${evidence.lastDate}，与分析日不一致`)
    if (onePrice) warnings.push('一字涨停，当日不可执行')
    if (degraded) warnings.push('数据源降级，状态最高为观察')

    const mainRisk =
      warnings[0] ??
      penalties[0] ??
      (market.phase === 'ebb' ? '市场处于退潮阶段' : evidence.shape === 'high-new-high' ? '高位加速回撤风险' : '次日不确认')

    return {
      rank: 0,
      code: stock.code,
      name: stock.name,
      price: stock.price,
      changePct: stock.changePct,
      boardType: boardType(stock.code),
      consecutiveDays: stock.consecutiveDays,
      nDayBoards: stock.nDayBoards,
      themes: stock.themes,
      primaryTheme: primaryTheme.name,
      subtheme: stock.subtheme,
      themeGrade: primaryTheme.grade,
      themeScore: primaryTheme.score,
      role,
      reason: stock.reason,
      firstTime: stock.firstTime,
      lastTime: stock.lastTime,
      openCount: stock.openCount,
      turnoverRate: stock.turnoverRate,
      amount: stock.amount,
      sealAmount: stock.sealAmount,
      onePrice,
      tBoard,
      isMarginEligible: stock.isMarginEligible,
      reasonSource: stock.reasonSource,
      state,
      score,
      technical: evidence,
      dimensions,
      fundFlow,
      penalties,
      warnings,
      trigger: buildTrigger(stock, evidence),
      invalidation: buildInvalidation(evidence),
      mainRisk,
    } satisfies LadderStockAnalysis
  })

  return rows
    .sort(
      (a, b) =>
        statePriority(a.state) - statePriority(b.state) ||
        b.score - a.score ||
        b.consecutiveDays - a.consecutiveDays ||
        (a.firstTime || '999999').localeCompare(b.firstTime || '999999'),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

function qualityRank(quality: LadderDataQuality): number {
  if (quality.sentimentSource === 'mock' || quality.klineTotal === 0) return 0
  if (!quality.degraded && (quality.source === 'kaipanla' || quality.source === 'eastmoney' || quality.source === 'mixed')) return 2
  return 1
}

function maybeArchive(
  analysis: LimitLadderAnalysis,
  evidence: EvidenceArchive,
): boolean {
  if (!isLadderSettledWindow() || analysis.asof !== todayShanghai()) return false
  if (analysis.stocks.length === 0 || analysis.quality.sentimentSource === 'mock') return false
  const path = evidencePath(analysis.asof)
  const existing = readJson<EvidenceArchive>(path)
  if (existing && existing.qualityRank > evidence.qualityRank) return false
  writeJsonAtomic(path, evidence)
  writeJsonAtomic(analysisPath(analysis.asof), { ...analysis, archived: true })
  return true
}

async function computeCurrentAnalysis(asof: string): Promise<LimitLadderAnalysis> {
  const sessionSettled = isLadderSettledWindow()
  const imported = importsByDate.get(asof) ?? null
  const [ashare, sentiment, kplResult] = await Promise.all([
    fetchAShareData(),
    fetchSentiment(),
    fetchKplRealtimeLadder()
      .then((value) => ({ value, error: '' }))
      .catch((error: unknown) => ({
        value: null,
        error: error instanceof Error ? error.message : String(error),
      })),
  ])
  const kplLadder = kplResult.value
  const merged = mergeStocks(ashare.limitUpStocks, kplLadder?.stocks ?? [], imported)
  if (merged.length === 0) throw new Error('涨停池为空，拒绝生成连板天梯')

  const limitFieldsComplete = merged.every((stock) => stock.firstTime && stock.consecutiveDays > 0)
  const source: LadderDataQuality['source'] = imported
    ? ashare.limitUpStocks.length || kplLadder?.stocks.length
      ? 'mixed'
      : 'import'
    : kplLadder?.stocks.length
      ? 'kaipanla'
    : limitFieldsComplete
      ? 'eastmoney'
      : 'sina'
  const maxBoards = Math.max(1, ...merged.map((stock) => stock.consecutiveDays))
  const continuity = levelContinuity(merged)
  const previous = previousArchivedAnalysis(asof)
  const marketInput: MarketCycleInput = {
    temperature: sentiment.temperature,
    limitUp: ashare.limitUpCount,
    limitDown: ashare.limitDownCount,
    breakRate: sentiment.breakRate,
    promotionRate: ashare.promotionRate,
    yestLimitPerf: sentiment.yestLimitPerf,
    advance: ashare.advance,
    decline: ashare.decline,
    maxBoards,
    ladderContinuity: r2(continuity * 100),
  }
  const cycle = classifyMarketCycle(
    marketInput,
    previous ? { phase: previous.market.cycle.phase, current: previous.market.cycle.current } : undefined,
  )
  const themes = scoreThemes(merged, ashare.promotionRate)

  const technicalResults = await mapLimit(merged, 10, async (stock): Promise<[string, TechnicalResult]> => {
    try {
      const { klines } = await fetchStockKline(stock.code, 101, KLINE_COUNT)
      return [
        stock.code,
        {
          evidence: analyzeTechnical(klines, stock.code, asof, sessionSettled),
          bars: klines.filter((bar) => bar.date <= asof),
        },
      ]
    } catch {
      return [stock.code, { evidence: emptyTechnical(), bars: [] }]
    }
  })
  const technicalMap = new Map(technicalResults.map(([code, result]) => [code, result.evidence]))
  const lhbIndex = await buildLhbIndex([asof], { institutional: true, concurrency: 1 })
  const lhbForDay = lhbIndex.get(asof) ?? new Map<string, LhbDay>()
  const fundFlowComplete = lhbForDay.size > 0
  const klineComplete = technicalResults.filter(([, result]) => result.evidence.available && result.evidence.settled).length
  const qualityWarnings: string[] = []
  if (kplResult.error) qualityWarnings.push(`开盘啦实时梯队不可用：${kplResult.error}`)
  if (kplLadder && !kplLadder.complete) {
    qualityWarnings.push(`开盘啦缺少${kplLadder.missingTiers.join('、')}板梯队`)
  }
  if (kplLadder?.date && kplLadder.date !== asof) {
    qualityWarnings.push(`开盘啦梯队日期为${kplLadder.date}，与分析日${asof}不一致`)
  }
  if (!limitFieldsComplete) qualityWarnings.push('涨停池缺少完整板数或封板时间，已降级')
  if (sentiment.source === 'mock') qualityWarnings.push('情绪数据为mock，拒绝高置信结论和归档')
  if (klineComplete < merged.length) qualityWarnings.push(`${merged.length - klineComplete}只股票K线不完整`)
  if (!sessionSettled) qualityWarnings.push('交易时段内仅供预览，未完成K线不得生成次日候选')
  if (!fundFlowComplete) qualityWarnings.push('当日龙虎榜席位尚未发布，资金流维度暂取中性分')
  const quality: LadderDataQuality = {
    source,
    sourceDate: kplLadder?.date || asof,
    sentimentSource: sentiment.source,
    limitFieldsComplete,
    klineComplete,
    klineTotal: merged.length,
    degraded:
      !limitFieldsComplete ||
      sentiment.source === 'mock' ||
      !sessionSettled ||
      (!!kplLadder && !kplLadder.complete) ||
      (!!kplLadder?.date && kplLadder.date !== asof),
    fundFlowComplete,
    warnings: qualityWarnings,
  }
  const stocks = rankAndClassifyStocks({
    stocks: merged,
    themes,
    technical: technicalMap,
    market: cycle,
    degraded: quality.degraded,
    lhb: lhbForDay,
  })
  const levels = Array.from(new Set(stocks.filter((stock) => stock.consecutiveDays >= 2).map((stock) => stock.consecutiveDays)))
    .sort((a, b) => b - a)
    .map((boards) => ({ boards, stocks: stocks.filter((stock) => stock.consecutiveDays === boards) }))
  const warnings = [...qualityWarnings]
  if (!cycle.directionAvailable) warnings.push('缺少前日归档，周期方向不可计算')

  const analysis: LimitLadderAnalysis = {
    asof,
    generatedAt: new Date().toISOString(),
    ruleVersion: LIMIT_LADDER_RULE_VERSION,
    archived: false,
    market: {
      cycle,
      limitUp: ashare.limitUpCount,
      limitDown: ashare.limitDownCount,
      breakRate: sentiment.breakRate,
      promotionRate: ashare.promotionRate,
      advance: ashare.advance,
      decline: ashare.decline,
      maxBoards,
    },
    themes,
    levels,
    firstBoards: stocks.filter((stock) => stock.consecutiveDays === 1),
    stocks,
    quality,
    warnings,
  }
  const evidence: EvidenceArchive = {
    asof,
    generatedAt: analysis.generatedAt,
    ruleVersion: LIMIT_LADDER_RULE_VERSION,
    qualityRank: qualityRank(quality),
    ashare: {
      limitUpCount: ashare.limitUpCount,
      limitDownCount: ashare.limitDownCount,
      advance: ashare.advance,
      decline: ashare.decline,
      flat: ashare.flat,
      promotionRate: ashare.promotionRate,
      promotedCount: ashare.promotedCount,
      promotionTotal: ashare.promotionTotal,
    },
    sentiment,
    kplLadder,
    limitUpStocks: ashare.limitUpStocks,
    imported,
    klines: Object.fromEntries(technicalResults.map(([code, result]) => [code, result.bars])),
  }
  const archived = maybeArchive(analysis, evidence)
  return { ...analysis, archived }
}

export async function fetchLimitLadderAnalysis(asof = todayShanghai()): Promise<LimitLadderAnalysis> {
  if (!safeDate(asof)) throw new Error('date 必须是 YYYY-MM-DD')
  const today = todayShanghai()
  if (asof !== today) {
    const archived = readJson<LimitLadderAnalysis>(analysisPath(asof))
    if (!archived) throw new Error(`未找到${asof}的连板天梯归档`)
    return { ...archived, archived: true }
  }
  // 收盘后的同日快照是定盘数据。服务重启或页面再次打开时直接读盘，零上游 API 请求。
  // 当日有手工导入时允许重算并覆盖快照。
  if (isLadderSettledWindow() && !importsByDate.has(asof)) {
    const archived = readJson<LimitLadderAnalysis>(analysisPath(asof))
    // 15:00先保存行情定盘；16:30后若龙虎榜此前未发布，允许自动补算一次资金流并覆盖快照。
    if (archived && (archived.quality.fundFlowComplete !== false || !isLhbPublicationWindow())) {
      return { ...archived, archived: true }
    }
  }
  const cached = analysisCache.get(asof)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  const value = await computeCurrentAnalysis(asof)
  analysisCache.set(asof, { at: Date.now(), value })
  return value
}

export async function importLimitLadder(input: unknown): Promise<LimitLadderAnalysis> {
  const normalized = normalizeLadderImport(input)
  if (normalized.asof !== todayShanghai()) {
    throw new Error('第一版只允许导入当前交易日天梯')
  }
  importsByDate.set(normalized.asof, normalized)
  analysisCache.delete(normalized.asof)
  return fetchLimitLadderAnalysis(normalized.asof)
}

export function clearLimitLadderCache(): void {
  analysisCache.clear()
  clearKplLadderCache()
}
