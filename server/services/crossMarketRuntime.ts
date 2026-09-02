import { SCREENER } from '../config/screener'
import { isTradingDayAt } from './tradingCalendar'
import { emFetch } from '../lib/emFetch'
import { EM_HEADERS } from '../lib/emHeaders'
import { todayShanghai } from '../lib/time'
import { fetchTradingDates } from './moneyflow'
import { fetchUSStockQuotes } from './us'
import {
  computeSourceShock,
  fetchEastmoneyUsAdjustedDailyBars,
  fetchStooqDailyBars,
  fetchStockanalysisAdjustedDailyBars,
  fetchYahooAdjustedDailyBars,
  robustZ,
  type SourceShockOutput,
  type UsDailyBar,
} from './crossMarketData'
import { fetchDomesticMarketSnapshot, type DomesticMarketSnapshot } from './ladderMarketGate'
import { fetchLimitLadderAnalysis, type LimitLadderAnalysis, type ThemeAnalysis } from './limitLadder'
import {
  CROSS_MARKET_GRAPH_VERSION,
  CROSS_MARKET_MODEL_VERSION,
  assessCrossMarketDataQuality,
  createUnavailableSnapshot,
  listCrossMarketSettlements,
  listCrossMarketSnapshots,
  phaseCutoffAt,
  phaseStartMinute,
  readCrossMarketSettlement,
  readCrossMarketSnapshot,
  writeCrossMarketSettlement,
  writeCrossMarketSnapshot,
  type CapitalLaneId,
  type CaptureStatus,
  type CrossMarketPhase,
  type CrossMarketSettledTheme,
  type CrossMarketSettlement,
  type CrossMarketSnapshot,
  type LiquidityRegimeSnapshot,
  type SourceShock,
  type ThemePrediction,
} from './crossMarketMapping'
import {
  assessThemeCycle,
  buildCapitalSeesaw,
  buildExternalBasketShock,
  buildLiquidityRegime,
  classifyNextThemeOutcome,
  type BasketSourceInput,
  type ThemeCycleAssessment,
} from './crossMarketSeesaw'

const CPO_CODES = ['LITE', 'MRVL', 'COHR', 'CIEN', 'AVGO'] as const
const DRUG_ETFS = ['XBI', 'IBB'] as const
const DRUG_ANCHORS = ['MRNA', 'BNTX', 'LLY', 'NVO'] as const
const ALL_US_CODES = [...CPO_CODES, ...DRUG_ETFS, ...DRUG_ANCHORS]
const RESIDUAL_CONTROL_CODES = ['SPY', 'SOXX', 'XLV'] as const

const HARD_TECH_RE = /CPO|MPO|光模块|光通信|通信|光芯片|芯片|半导体|算力/i
const DRUG_RE = /创新药|mRNA|生物科技|疫苗|医药|生物制品/i

interface FullMarketRow {
  code: string
  name: string
  industry: string
  changePct: number
  amount: number
  marketCap: number | null
}

interface FullMarketCapture {
  source: 'full-market-clist' | 'unavailable'
  totalAmount: number | null
  top50AmountSharePct: number | null
  rows: FullMarketRow[]
  warnings: string[]
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

function clamp(value: number, lower = -1, upper = 1): number {
  return Math.max(lower, Math.min(upper, value))
}

/** Deterministic Asia/Shanghai clock for a given epoch ms; mirrors lib/cache shanghaiClock. */
function shanghaiClockAt(nowMs: number): { day: number; minutes: number } {
  const sh = new Date(nowMs + 8 * 3_600_000)
  return { day: sh.getUTCDay(), minutes: sh.getUTCHours() * 60 + sh.getUTCMinutes() }
}

/** Grace minutes after the scheduled cutoff within which a snapshot is considered on-time. */
const PHASE_GRACE_MINUTES = 2

function epochTradeDate(value: unknown): string {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  return new Date(seconds * 1000 + 8 * 3_600_000).toISOString().slice(0, 10)
}

function parseFullMarketRow(row: Record<string, unknown>, tradeDate: string): FullMarketRow | null {
  const code = String(row.f12 ?? '').replace(/\D/g, '').padStart(6, '0')
  const name = String(row.f14 ?? '').trim()
  const amount = Number(row.f6)
  if (!/^\d{6}$/.test(code) || !name || !Number.isFinite(amount) || amount < 0) return null
  const rowDate = epochTradeDate(row.f124)
  if (rowDate && rowDate !== tradeDate) return null
  const marketCapValue = Number(row.f20)
  return {
    code,
    name,
    industry: String(row.f100 ?? '').trim(),
    changePct: Number(row.f3) || 0,
    amount,
    marketCap: Number.isFinite(marketCapValue) && marketCapValue > 0 ? marketCapValue : null,
  }
}

async function fetchFullMarketLiquidity(tradeDate: string): Promise<FullMarketCapture> {
  const hosts = ['push2.eastmoney.com', '82.push2.eastmoney.com', 'push2delay.eastmoney.com']
  const pageSize = 100
  const warnings: string[] = []
  const fetchPage = async (page: number): Promise<{ rows: Record<string, unknown>[]; total: number }> => {
    for (let offset = 0; offset < hosts.length; offset++) {
      const host = hosts[(page + offset) % hosts.length]
      try {
        const url = `https://${host}/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f6&fs=${encodeURIComponent(SCREENER.CLIST_FS)}&fields=f3,f6,f12,f14,f20,f100,f124`
        const response = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 12_000 })
        if (!response.ok) continue
        const json = await response.json() as {
          data?: { total?: number; diff?: Record<string, unknown>[] }
        }
        return { rows: json.data?.diff ?? [], total: Number(json.data?.total) || 0 }
      } catch {
        // Try the next quote mirror. The global Eastmoney limiter handles pacing.
      }
    }
    throw new Error(`全市场行情第${page}页全部镜像失败`)
  }

  try {
    const first = await fetchPage(1)
    const expected = first.total || first.rows.length
    const pageCount = Math.min(60, Math.ceil(expected / pageSize))
    const rawRows = [...first.rows]
    for (let page = 2; page <= pageCount; page++) {
      try {
        const result = await fetchPage(page)
        if (!result.rows.length) break
        rawRows.push(...result.rows)
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : `全市场行情第${page}页失败`)
        break
      }
    }
    const parsed = rawRows
      .map((row) => parseFullMarketRow(row, tradeDate))
      .filter((row): row is FullMarketRow => !!row)
    const rows = [...new Map(parsed.map((row) => [row.code, row])).values()]
    const coveragePct = expected ? (rows.length / expected) * 100 : 0
    if (rows.length < 1000 || coveragePct < 90) {
      warnings.push(`全市场行情覆盖不足：${rows.length}/${expected}`)
    } else {
      if (rows.length < expected) {
        warnings.push(`全市场停牌或过时行情已剔除：${rows.length}/${expected}`)
      }
      const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0)
      if (totalAmount > 0) {
        const top50 = [...rows]
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 50)
          .reduce((sum, row) => sum + row.amount, 0)
        return {
          source: 'full-market-clist',
          totalAmount,
          top50AmountSharePct: r2((top50 / totalAmount) * 100),
          rows,
          warnings,
        }
      }
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : '全市场行情源失败')
  }
  return { source: 'unavailable', totalAmount: null, top50AmountSharePct: null, rows: [], warnings: [...new Set(warnings), '无法获取无重叠全市场成交额'] }
}

function averageStyle(domestic: DomesticMarketSnapshot, codes: string[]): number | null {
  const values = domestic.styleIndices.filter((row) => codes.includes(row.code)).map((row) => row.changePct)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function sizeSpread(domestic: DomesticMarketSnapshot): number | null {
  const large = averageStyle(domestic, ['SSE50', 'CSI300'])
  const small = averageStyle(domestic, ['CSI1000', 'CSI2000'])
  return large == null || small == null ? null : r2(large - small)
}

function matchingThemes(analysis: LimitLadderAnalysis | null, pattern: RegExp): ThemeAnalysis[] {
  return analysis?.themes.filter((theme) => pattern.test(theme.name)) ?? []
}

function cycleFromAnalysis(analysis: LimitLadderAnalysis | null, pattern: RegExp): ThemeCycleAssessment {
  const themes = matchingThemes(analysis, pattern)
  const limitUpCount = themes.reduce((sum, theme) => sum + theme.count, 0)
  const firstBoardCount = themes.reduce((sum, theme) => sum + theme.firstBoardCount, 0)
  const assessment = assessThemeCycle({
    returnZ: null,
    limitUpCount: themes.length ? limitUpCount : null,
    firstBoardCount: themes.length ? firstBoardCount : null,
    positiveBreadthPct: null,
    amountRatio20: null,
    strongCoreCount: themes.reduce((sum, theme) => sum + theme.multiBoardCount, 0),
  })
  if (themes.length) assessment.warnings.push('历史题材收益z、全成分宽度与成交额比尚未归档，高潮判断不参与概率')
  return assessment
}

function settledThemeCycle(
  settlement: CrossMarketSettlement | null,
  id: CrossMarketSettledTheme['id'],
): ThemeCycleAssessment | null {
  return settlement?.themes.find((theme) => theme.id === id)?.cycle ?? null
}

function themeConfirmation(analysis: LimitLadderAnalysis | null, pattern: RegExp): number {
  const themes = matchingThemes(analysis, pattern)
  if (!themes.length) return -0.3
  const firstBoards = themes.reduce((sum, theme) => sum + theme.firstBoardCount, 0)
  const multiBoards = themes.reduce((sum, theme) => sum + theme.multiBoardCount, 0)
  return clamp((firstBoards + multiBoards * 1.5) / 6)
}

function marketConfirmation(domestic: DomesticMarketSnapshot | null): Partial<Record<CapitalLaneId, number>> {
  if (!domestic) return {}
  const result: Partial<Record<CapitalLaneId, number>> = {}
  const total =
    domestic.advance != null && domestic.decline != null
      ? domestic.advance + domestic.decline
      : null
  const breadth =
    total != null && total > 0 && domestic.advance != null
      ? clamp(((domestic.advance / total) * 100 - 50) / 30)
      : null
  const spread = sizeSpread(domestic)
  if (breadth != null) {
    result['small-theme'] = clamp(
      breadth - (spread == null ? 0 : Math.max(0, Math.abs(spread) / 2)),
    )
  }
  if (spread != null) result['index-weight'] = clamp(spread / 1.5)
  return result
}

function dailyReturns(bars: UsDailyBar[]): Array<{ date: string; returnPct: number }> {
  return bars.slice(1).map((bar, index) => ({
    date: bar.date,
    returnPct: Math.log(bar.close / bars[index].close) * 100,
  }))
}

let residualCache: { tradeDate: string; values: Map<string, SourceShockOutput> } | null = null

async function fetchResidualShocks(tradeDate: string): Promise<Map<string, SourceShockOutput>> {
  if (residualCache?.tradeDate === tradeDate) return residualCache.values
  const codes = [...new Set([...ALL_US_CODES, ...RESIDUAL_CONTROL_CODES])]
  const settled = await Promise.allSettled(
    codes.map(async (ticker) => {
      let bars = await fetchEastmoneyUsAdjustedDailyBars(ticker).catch(() => [])
      if (bars.length < 21) {
        bars = await fetchStockanalysisAdjustedDailyBars(ticker, AbortSignal.timeout(20_000)).catch(() => [])
      }
      if (bars.length < 21) {
        bars = await fetchStooqDailyBars(ticker, AbortSignal.timeout(20_000)).catch(() => [])
      }
      if (bars.length < 21) {
        bars = await fetchYahooAdjustedDailyBars(ticker, AbortSignal.timeout(20_000))
      }
      return [ticker, bars.slice(-760)] as const
    }),
  )
  const barsByCode = new Map<string, UsDailyBar[]>()
  settled.forEach((result) => {
    if (result.status === 'fulfilled' && result.value[1].length) barsByCode.set(...result.value)
  })
  const spy = dailyReturns(barsByCode.get('SPY') ?? [])
  const values = new Map<string, SourceShockOutput>()
  for (const ticker of ALL_US_CODES) {
    const bars = barsByCode.get(ticker) ?? []
    const sectorCode = CPO_CODES.includes(ticker as (typeof CPO_CODES)[number])
      ? 'SOXX'
      : DRUG_ANCHORS.includes(ticker as (typeof DRUG_ANCHORS)[number])
        ? 'XBI'
        : 'XLV'
    const sector = dailyReturns(barsByCode.get(sectorCode) ?? [])
    const latestDate = bars.at(-1)?.date ?? ''
    const shock = computeSourceShock({
      ticker,
      sessionDate: latestDate,
      bars,
      marketReturns: spy,
      sectorReturns: sector,
    })
    if (shock.sourceAvailable) shock.warnings.push('免费调整日线残差特征仅用于research，尚未通过三年覆盖审计')
    values.set(ticker, shock)
  }
  residualCache = { tradeDate, values }
  return values
}

function sourceInputs(
  quotes: Map<string, { changePct: number }>,
  residuals: Map<string, SourceShockOutput>,
  codes: readonly string[],
  kind: BasketSourceInput['kind'],
): BasketSourceInput[] {
  return codes.map((ticker) => ({
    ticker,
    kind,
    changePct: quotes.get(ticker)?.changePct ?? null,
    returnZ: residuals.get(ticker)?.returnZ ?? null,
  }))
}

function sourceShocks(
  quotes: Map<string, { changePct: number }>,
  residuals: Map<string, SourceShockOutput>,
  sessionDate: string,
): SourceShock[] {
  return ALL_US_CODES.map((ticker) => {
    const quote = quotes.get(ticker)
    const residual = residuals.get(ticker)
    if (residual?.sourceAvailable) return residual
    return {
      ticker,
      sessionDate,
      returnPct: quote?.changePct ?? null,
      abnormalReturnPct: null,
      returnZ: null,
      volumeZ: null,
      eventFlag: false,
      sourceAvailable: !!quote,
      warnings: quote
        ? [...(residual?.warnings ?? []), '历史残差特征不可用，当前回退到收盘涨跌幅']
        : [...(residual?.warnings ?? []), '美股报价缺失'],
    }
  })
}

function baselineLiquidity(phase: CrossMarketPhase, tradeDate: string): { amounts: number[]; shares: number[] } {
  const history = listCrossMarketSnapshots(phase, tradeDate, 60).map((snapshot) => snapshot.liquidityRegime).filter((row): row is LiquidityRegimeSnapshot => !!row && row.source === 'full-market-clist' && row.totalAmount != null && row.top50AmountSharePct != null)
  return { amounts: history.map((row) => row.totalAmount as number), shares: history.map((row) => row.top50AmountSharePct as number) }
}

function lanePredictions(matrix: NonNullable<CrossMarketSnapshot['capitalSeesaw']>): ThemePrediction[] {
  const themes: Record<CapitalLaneId, string> = { 'hard-tech': 'CPO/大科技', 'innovative-drug': '创新药', 'small-theme': '题材小票', 'index-weight': '指数权重' }
  return matrix.lanes.map((lane) => ({
    theme: themes[lane.id],
    baseScore: 50,
    externalAdjustment: r2(10 * lane.externalShock),
    cycleAdjustment: r2(8 * lane.domesticCycle),
    liquidityAdjustment: r2(8 * lane.liquidityAdjustment),
    burstProbability: null,
    tradableProbability: null,
    burstScore: lane.netResearchScore,
    tradableScore: lane.netResearchScore,
    status: 'research-score',
    evidenceGrade: lane.id === 'hard-tech' || lane.id === 'innovative-drug' ? 'B' : 'none',
    drivers: lane.reasons,
    auctionConfirmation: lane.auctionConfirmation > 0.4 ? '强化' : lane.auctionConfirmation < -0.4 ? '背离' : '未确认',
    openConfirmation: lane.openConfirmation > 0.4 ? '强化' : lane.openConfirmation < -0.4 ? '背离' : '未确认',
    warnings: lane.warnings,
  }))
}

function buildSettledTheme(args: {
  id: CrossMarketSettledTheme['id']
  label: string
  pattern: RegExp
  capture: FullMarketCapture
  analysis: LimitLadderAnalysis | null
  benchmarkReturnPct: number | null
  history: CrossMarketSettlement[]
}): CrossMarketSettledTheme {
  const rows = args.capture.rows.filter((row) => args.pattern.test(`${row.industry} ${row.name}`))
  const valid = args.capture.source === 'full-market-clist' && rows.length >= 5
  const themeReturnPct = valid
    ? rows.reduce((sum, row) => sum + row.changePct, 0) / rows.length
    : null
  const positiveBreadthPct = valid
    ? (rows.filter((row) => row.changePct > 0).length / rows.length) * 100
    : null
  const amount = valid ? rows.reduce((sum, row) => sum + row.amount, 0) : null
  const themes = matchingThemes(args.analysis, args.pattern)
  const limitUpCount = themes.length
    ? themes.reduce((sum, theme) => sum + theme.count, 0)
    : null
  const firstBoardCount = themes.length
    ? themes.reduce((sum, theme) => sum + theme.firstBoardCount, 0)
    : null
  const strongCoreCount = themes.length
    ? themes.reduce((sum, theme) => sum + theme.multiBoardCount, 0)
    : null
  const historicalThemes = args.history.flatMap((settlement) => {
    const theme = settlement.themes.find((row) => row.id === args.id)
    return theme ? [theme] : []
  })
  const historicalReturns = historicalThemes.flatMap((theme) =>
    theme.themeReturnPct == null ? [] : [theme.themeReturnPct],
  )
  const historicalAmounts = historicalThemes.flatMap((theme) =>
    theme.amount == null ? [] : [theme.amount],
  )
  const amountBaseline = historicalAmounts.slice(-20)
  const amountRatio20 =
    amount != null && amountBaseline.length >= 20 && median(amountBaseline) > 0
      ? amount / median(amountBaseline)
      : null
  const returnZ =
    themeReturnPct == null ? null : robustZ(themeReturnPct, historicalReturns.slice(-60))
  const cycle = assessThemeCycle({
    returnZ,
    limitUpCount,
    firstBoardCount,
    positiveBreadthPct,
    amountRatio20,
    strongCoreCount: strongCoreCount ?? 0,
  })
  const priorTheme = historicalThemes.at(-1)
  const excessReturnPct =
    themeReturnPct == null || args.benchmarkReturnPct == null
      ? null
      : themeReturnPct - args.benchmarkReturnPct
  const outcome = classifyNextThemeOutcome({
    priorClimax: priorTheme?.cycle.state === 'climax',
    excessReturnPct,
    positiveBreadthPct,
    limitUpCount,
    strongCoreCount,
  })
  const warnings = [
    '题材成分暂用东财行业字段代理，正式概率化前需固化成分历史',
    ...(valid ? [] : ['题材行业代理成分不足5只']),
    ...(historicalReturns.length >= 20 ? [] : [`题材收益历史仅${historicalReturns.length}日`]),
    ...(amountBaseline.length >= 20 ? [] : [`题材成交额历史仅${amountBaseline.length}日`]),
    ...cycle.warnings,
  ]
  return {
    id: args.id,
    label: args.label,
    source: valid ? 'eastmoney-industry-proxy' : 'unavailable',
    constituentCount: rows.length,
    themeReturnPct: themeReturnPct == null ? null : r2(themeReturnPct),
    benchmarkReturnPct:
      args.benchmarkReturnPct == null ? null : r2(args.benchmarkReturnPct),
    excessReturnPct: excessReturnPct == null ? null : r2(excessReturnPct),
    positiveBreadthPct: positiveBreadthPct == null ? null : r2(positiveBreadthPct),
    amount,
    amountRatio20: amountRatio20 == null ? null : r2(amountRatio20),
    returnZ: returnZ == null ? null : r2(returnZ),
    limitUpCount,
    firstBoardCount,
    strongCoreCount,
    cycle,
    outcome,
    warnings,
  }
}

export async function buildCrossMarketSettlement(tradeDate: string): Promise<CrossMarketSettlement> {
  const history = listCrossMarketSettlements(tradeDate, 60)
  const [analysisResult, domesticResult, liquidityResult] = await Promise.allSettled([
    fetchLimitLadderAnalysis(tradeDate),
    fetchDomesticMarketSnapshot(),
    fetchFullMarketLiquidity(tradeDate),
  ])
  const analysis = analysisResult.status === 'fulfilled' ? analysisResult.value : null
  const domestic = domesticResult.status === 'fulfilled' ? domesticResult.value : null
  const capture =
    liquidityResult.status === 'fulfilled'
      ? liquidityResult.value
      : {
          source: 'unavailable' as const,
          totalAmount: null,
          top50AmountSharePct: null,
          rows: [],
          warnings: ['收盘全市场行情抓取失败'],
        }
  const benchmarkReturnPct = domestic ? averageStyle(domestic, ['CSI300']) : null
  const themes = [
    buildSettledTheme({
      id: 'cpo',
      label: 'CPO/大科技',
      pattern: HARD_TECH_RE,
      capture,
      analysis,
      benchmarkReturnPct,
      history,
    }),
    buildSettledTheme({
      id: 'innovative-drug',
      label: '创新药',
      pattern: DRUG_RE,
      capture,
      analysis,
      benchmarkReturnPct,
      history,
    }),
  ]
  const warnings = [
    ...capture.warnings,
    ...(analysis ? [] : ['收盘连板题材归档缺失']),
    ...(domestic ? [] : ['收盘基准行情缺失']),
    ...themes.flatMap((theme) => theme.warnings),
  ]
  return writeCrossMarketSettlement({
    tradeDate,
    generatedAt: new Date().toISOString(),
    modelVersion: CROSS_MARKET_MODEL_VERSION,
    status:
      capture.source === 'unavailable'
        ? 'unavailable'
        : themes.every((theme) => theme.outcome !== 'unavailable')
          ? 'settled'
          : 'degraded',
    themes,
    warnings: [...new Set(warnings)],
  })
}

const inFlightSnapshotBuilds = new Map<string, Promise<CrossMarketSnapshot>>()

/** Test hook: clears in-flight build dedup state between cases. */
export function resetCrossMarketInFlight(): void {
  inFlightSnapshotBuilds.clear()
}

/**
 * Builds a research snapshot for a bidding-stage window. Only scheduler
 * executions inside the scheduled window (`captureStatus=on-time`) persist to
 * the formal archive; any other invocation produces a non-persisted
 * `late-live` result so a miss-cutoff call can never rewrite history.
 */
export async function buildCrossMarketResearchSnapshot(args: { tradeDate: string; phase: CrossMarketPhase; nowMs?: number }): Promise<CrossMarketSnapshot> {
  const key = `${args.tradeDate}:${args.phase}`
  const existing = inFlightSnapshotBuilds.get(key)
  if (existing) return existing
  const task = (async () => {
    const tradeDate = args.tradeDate
    const nowMs = args.nowMs ?? Date.now()
    const now = shanghaiClockAt(nowMs)
    const scheduledCutoffAt = phaseCutoffAt(tradeDate, args.phase)
    const inWindow =
      tradeDate === todayShanghai(nowMs) &&
      now.minutes >= phaseStartMinute(args.phase) &&
      now.minutes < phaseStartMinute(args.phase) + PHASE_GRACE_MINUTES
    const captureStatus: CaptureStatus = inWindow ? 'on-time' : 'late-live'

    const dates = await fetchTradingDates(tradeDate).catch(() => [])
    const signalDate = dates.find((date) => date < tradeDate) ?? ''
    const [usResult, residualResult, priorResult, currentResult, domesticResult, liquidityResult] = await Promise.allSettled([
      fetchUSStockQuotes(ALL_US_CODES),
      fetchResidualShocks(tradeDate),
      signalDate ? fetchLimitLadderAnalysis(signalDate) : Promise.resolve(null),
      args.phase === 'premarket' ? Promise.resolve(null) : fetchLimitLadderAnalysis(tradeDate),
      args.phase === 'premarket' ? Promise.resolve(null) : fetchDomesticMarketSnapshot(),
      args.phase === 'premarket' ? Promise.resolve<FullMarketCapture>({ source: 'unavailable', totalAmount: null, top50AmountSharePct: null, rows: [], warnings: ['盘前阶段不计算A股同刻成交额'] }) : fetchFullMarketLiquidity(tradeDate),
    ])
    const usRows = usResult.status === 'fulfilled' ? usResult.value : []
    const quotes = new Map(usRows.map((row) => [row.code, row]))
    const residuals = residualResult.status === 'fulfilled' ? residualResult.value : new Map<string, SourceShockOutput>()
    const prior = priorResult.status === 'fulfilled' ? priorResult.value : null
    const current = currentResult.status === 'fulfilled' ? currentResult.value : null
    const domestic = domesticResult.status === 'fulfilled' ? domesticResult.value : null
    const capture = liquidityResult.status === 'fulfilled' ? liquidityResult.value : { source: 'unavailable' as const, totalAmount: null, top50AmountSharePct: null, rows: [], warnings: ['全市场成交额抓取失败'] }
    const priorSettlement = signalDate ? readCrossMarketSettlement(signalDate) : null
    const cpo = buildExternalBasketShock({
      id: 'cpo',
      sources: sourceInputs(quotes, residuals, CPO_CODES, 'anchor'),
    })
    const drug = buildExternalBasketShock({
      id: 'innovative-drug',
      sources: [
        ...sourceInputs(quotes, residuals, DRUG_ETFS, 'etf'),
        ...sourceInputs(quotes, residuals, DRUG_ANCHORS, 'anchor'),
      ],
    })
    const baselines = baselineLiquidity(args.phase, tradeDate)
    const liquidity = buildLiquidityRegime({
      phase: args.phase,
      cutoffAt: new Date().toISOString(),
      source: capture.source,
      totalAmount: capture.totalAmount,
      baselineAmounts: baselines.amounts,
      advance: domestic?.advance ?? null,
      decline: domestic?.decline ?? null,
      top50AmountSharePct: capture.top50AmountSharePct,
      baselineTop50Shares: baselines.shares,
      largeSmallSpreadPct: domestic ? sizeSpread(domestic) : null,
      warnings: capture.warnings,
    })
    const cycles: Partial<Record<CapitalLaneId, ThemeCycleAssessment>> = {
      'hard-tech': settledThemeCycle(priorSettlement, 'cpo') ?? cycleFromAnalysis(prior, HARD_TECH_RE),
      'innovative-drug':
        settledThemeCycle(priorSettlement, 'innovative-drug') ??
        cycleFromAnalysis(prior, DRUG_RE),
    }
    const phaseConfirm: Partial<Record<CapitalLaneId, number>> = {
      'hard-tech': themeConfirmation(current, HARD_TECH_RE),
      'innovative-drug': themeConfirmation(current, DRUG_RE),
      ...marketConfirmation(domestic),
    }
    const matrix = buildCapitalSeesaw({
      phase: args.phase,
      external: { cpo, 'innovative-drug': drug },
      cycles,
      auctionConfirmation: args.phase === 'auction' ? phaseConfirm : {},
      openConfirmation: args.phase === 'open' ? phaseConfirm : {},
      liquidity,
    })
    const warnings = [
      ...(captureStatus === 'late-live' ? [`${args.phase}快照晚于规定截点生成，仅作live研究展示，未写入正式归档`] : []),
      ...cpo.warnings,
      ...drug.warnings,
      ...liquidity.warnings,
      ...(prior ? [] : ['前一交易日连板归档缺失']),
      ...(args.phase !== 'premarket' && !current ? ['当日A股题材确认数据缺失'] : []),
    ]
    const sourceCoveragePct = ALL_US_CODES.length ? r2((usRows.length / ALL_US_CODES.length) * 100) : 0
    const dataQuality = assessCrossMarketDataQuality({
      sourceCoveragePct,
      missingSources: [
        ...(usRows.length < ALL_US_CODES.length ? ['us-basket'] : []),
        ...(liquidity.state === 'unavailable' ? ['liquidity-baseline'] : []),
      ],
      warnings,
      criticalReady: usRows.length > 0,
    })
    const capturedAt = new Date().toISOString()
    const snapshot: CrossMarketSnapshot = {
      tradeDate,
      scheduledCutoffAt,
      capturedAt,
      captureStatus,
      cutoffAt: scheduledCutoffAt,
      generatedAt: capturedAt,
      phase: args.phase,
      modelVersion: CROSS_MARKET_MODEL_VERSION,
      graphVersion: CROSS_MARKET_GRAPH_VERSION,
      probabilityStatus: 'research-score',
      researchStatus: 'research',
      dataQuality,
      liquidityRegime: liquidity,
      capitalSeesaw: matrix,
      sourceShocks: sourceShocks(quotes, residuals, signalDate || tradeDate),
      themePredictions: lanePredictions(matrix),
      stockPredictions: [],
      rejectedMappings: [],
      warnings: [...new Set(warnings)],
    }
    if (captureStatus !== 'on-time') return snapshot
    return writeCrossMarketSnapshot(snapshot)
  })()
  inFlightSnapshotBuilds.set(key, task)
  try {
    return await task
  } finally {
    if (inFlightSnapshotBuilds.get(key) === task) inFlightSnapshotBuilds.delete(key)
  }
}

export async function resolveCrossMarketSnapshot(tradeDate: string, phase: CrossMarketPhase): Promise<CrossMarketSnapshot> {
  const archived = readCrossMarketSnapshot(tradeDate, phase)
  if (archived) return archived
  // 只读已存在归档：错过截点宁可明确不可用，也不能用请求时的实时数据事后补建，
  // 否则会把「现在」的行情写进「过去」的阶段快照，污染历史基线与回测。
  return createUnavailableSnapshot({
    tradeDate,
    phase,
    warning: `${phase}冻结时点尚未到达、归档缺失或错过截点；不再补建历史阶段快照`,
  })
}

let scheduler: ReturnType<typeof setInterval> | null = null
let schedulerBusy = false

export async function runCrossMarketSchedulerTick(nowMs = Date.now()): Promise<void> {
  if (schedulerBusy) return
  const clock = shanghaiClockAt(nowMs)
  if (!isTradingDayAt(nowMs)) return
  const tradeDate = todayShanghai(nowMs)
  if (clock.minutes >= 15 * 60 + 10 && clock.minutes < 15 * 60 + 12) {
    if (readCrossMarketSettlement(tradeDate)) return
    schedulerBusy = true
    try {
      await buildCrossMarketSettlement(tradeDate)
    } catch {
      // A later coordinator tick retries transient free-source failures.
    } finally {
      schedulerBusy = false
    }
    return
  }
  const phase: CrossMarketPhase | null = clock.minutes >= 9 * 60 + 15 && clock.minutes < 9 * 60 + 17
    ? 'premarket'
    : clock.minutes >= 9 * 60 + 25 && clock.minutes < 9 * 60 + 27
      ? 'auction'
      : clock.minutes >= 9 * 60 + 35 && clock.minutes < 9 * 60 + 37
        ? 'open'
        : null
  if (!phase) return
  if (readCrossMarketSnapshot(tradeDate, phase)) return
  schedulerBusy = true
  try {
    await buildCrossMarketResearchSnapshot({ tradeDate, phase })
  } catch {
    // A later coordinator tick retries transient free-source failures.
  } finally {
    schedulerBusy = false
  }
}

export function startCrossMarketScheduler(): boolean {
  if (scheduler) return false
  scheduler = setInterval(() => void runCrossMarketSchedulerTick(), 15_000)
  scheduler.unref?.()
  void runCrossMarketSchedulerTick()
  return true
}
