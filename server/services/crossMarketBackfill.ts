// 核心 300 美股三年调整日频回填与覆盖率审计。
//
// 目的(应对 2026-08-21 跨市场 handoff §19.4 的「回填并审计核心 300 只美股的三年调整
// 日频」):把免费源逐 ticker 按降级链拉取,写入不可变原始归档,并产出每次运行的覆盖率
// 审计报告。审计通过覆盖不足、拆分/分红异常必须标记,禁止静默修补。未到三年覆盖审计和
// 点上时间检查通过前,归档数据只用于 research,不进入概率模型训练。
//
// 降级链(调整口径优先,与本轮「三年调整日频」目标一致):
//   eastmoney(前复权日线) -> stockanalysis.com(调整日线) -> yahoo(调整日线) -> stooq(未复权,标记 degraded)
//
// 归档结构(遵循 handoff §7):
//   docs/cross-market/raw/<source>/<YYYY-MM-DD>/<ticker>.json   (UsDailyArchiveFile)
//   docs/cross-market/reports/us-daily-backfill-<YYYY-MM-DD>.json (UsDailyBackfillReport)
//
// 幂等:同一 runDate 下已存在归档文件且非 --force 时,跳过抓取直接复用该文件参与审计。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { todayShanghai } from '../lib/time'
import { fetchEastmoneyUsAdjustedDailyBars, fetchStooqDailyBars, fetchStockanalysisAdjustedDailyBars, fetchYahooAdjustedDailyBars, type UsDailyBar } from './crossMarketData'
import { CROSS_MARKET_MODEL_VERSION } from './crossMarketMapping'

export type { UsDailyBar } from './crossMarketData'

export type UsDailySource = 'eastmoney' | 'stockanalysis' | 'yahoo' | 'stooq'
export type UsDailyAdjustment = 'adjusted' | 'raw'

export interface UsDailyArchiveFile {
  ticker: string
  source: UsDailySource
  adjustment: UsDailyAdjustment
  fetchedAt: string
  bars: UsDailyBar[]
}

export interface UsDailyBackfillRow {
  ticker: string
  source: UsDailySource | null
  adjustment: UsDailyAdjustment | null
  sessionCount: number
  referenceSessions: number | null
  coveragePct: number | null
  firstDate: string | null
  latestDate: string | null
  status: 'full' | 'degraded' | 'unavailable'
  anomalies: string[]
  warnings: string[]
}

export interface UsDailyBackfillReport {
  runDate: string
  generatedAt: string
  modelVersion: string
  referenceTicker: string
  startDate: string
  targetYears: number
  requestedTickers: number
  rows: UsDailyBackfillRow[]
  summary: {
    archived: number
    reused: number
    fullCount: number
    degradedCount: number
    unavailableCount: number
    adjustedOnlyCount: number
    rawOnlyCount: number
    sources: Partial<Record<UsDailySource, number>>
    warnings: string[]
  }
}

export interface UsDailyBackfillOptions {
  tickers: string[]
  referenceTicker?: string
  force?: boolean
  skipEastmoney?: boolean
  years?: number
  concurrency?: number
  archiveRoot?: string
  reportRoot?: string
  now?: number
  signal?: AbortSignal
  onReferenceDone?: (referenceTicker: string, barCount: number) => void
  onTickerDone?: (ticker: string, row: Pick<UsDailyBackfillRow, 'source' | 'sessionCount' | 'coveragePct' | 'warnings'>) => void
}

export interface UsDailyBackfillDeps {
  fetchEastmoney?: (ticker: string) => Promise<UsDailyBar[]>
  fetchStockanalysis?: (ticker: string) => Promise<UsDailyBar[]>
  fetchStooq?: (ticker: string) => Promise<UsDailyBar[]>
  fetchYahoo?: (ticker: string) => Promise<UsDailyBar[]>
}

const ADJUSTMENT_BY_SOURCE: Record<UsDailySource, UsDailyAdjustment> = {
  eastmoney: 'adjusted',
  stockanalysis: 'adjusted',
  stooq: 'raw',
  yahoo: 'adjusted',
}

function clampCoverage(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function windowStartDate(nowMs: number, years: number): string {
  const day = 86_400_000
  return new Date(nowMs + 8 * 3_600_000 - years * 366 * day).toISOString().slice(0, 10)
}

function r2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 单日对数收益;前收无效或非正时跳过。 */
export function dailyLogReturns(bars: UsDailyBar[]): Array<{ date: string; value: number }> {
  const out: Array<{ date: string; value: number }> = []
  for (let index = 1; index < bars.length; index++) {
    const prev = bars[index - 1].close
    if (!Number.isFinite(prev) || prev <= 0) continue
    const current = bars[index].close
    if (!Number.isFinite(current) || current <= 0) continue
    out.push({ date: bars[index].date, value: Math.log(current / prev) })
  }
  return out
}

/**
 * 拆分/分红类异常检测(标记,不静默修补)。
 * 规则:单日对数收益 |r| >= 0.2,且前后各 5 日窗口内其它日的平均 |r| < 0.08,
 * 提示该日跳变远高于该标的日常波动——疑似拆分、分红除权或数据断点。
 */
export function detectSplitAnomalies(bars: UsDailyBar[]): string[] {
  const returns = dailyLogReturns(bars)
  if (returns.length < 6) return []
  const anomalies: string[] = []
  for (let index = 0; index < returns.length; index++) {
    const current = returns[index]
    if (Math.abs(current.value) < 0.2) continue
    const from = Math.max(0, index - 5)
    const to = Math.min(returns.length, index + 6)
    const others = returns.slice(from, to).filter((row, offset) => from + offset !== index)
    const avgAbs = others.length
      ? others.reduce((sum, row) => sum + Math.abs(row.value), 0) / others.length
      : 0
    if (avgAbs < 0.08 && avgAbs > 0) {
      anomalies.push(`${current.date} 单日 ${r2(current.value * 100)}%，疑似拆分/除权或数据断点`)
    }
  }
  return anomalies
}

/** 计算单 ticker 相对参考日历(通常 SPY)的三年窗口覆盖率。 */
export function assessBackfillCoverage(args: {
  tickerBars: UsDailyBar[]
  referenceBars: UsDailyBar[]
  startDate: string
}): Pick<UsDailyBackfillRow, 'sessionCount' | 'referenceSessions' | 'coveragePct' | 'firstDate' | 'latestDate' | 'status' | 'warnings'> {
  const referenceWindow = args.referenceBars.filter((bar) => bar.date >= args.startDate)
  const referenceSessions = referenceWindow.length
  const inWindow = args.tickerBars.filter((bar) => bar.date >= args.startDate)
  const firstDate = inWindow.at(0)?.date ?? null
  const latestDate = inWindow.at(-1)?.date ?? null
  const warnings: string[] = []
  if (!referenceSessions) warnings.push('参考日历窗口为空，覆盖率无法计算')
  const coveragePct = referenceSessions ? clampCoverage(r2((inWindow.length / referenceSessions) * 100)) : null
  let status: UsDailyBackfillRow['status'] = 'unavailable'
  if (inWindow.length > 0) {
    if (coveragePct == null) status = 'degraded'
    else status = coveragePct >= 95 ? 'full' : 'degraded'
  }
  if (status === 'degraded' && coveragePct != null) warnings.push(`三年窗口覆盖率 ${coveragePct}% 低于 95%`)
  return { sessionCount: inWindow.length, referenceSessions: referenceSessions || null, coveragePct, firstDate, latestDate, status, warnings }
}

function defaultArchiveRoot(): string {
  return resolve(process.env.CROSS_MARKET_RAW_ROOT ?? join(import.meta.dirname ?? process.cwd(), '../../docs/cross-market/raw'))
}

function defaultReportRoot(): string {
  return resolve(process.env.CROSS_MARKET_REPORT_ROOT ?? join(import.meta.dirname ?? process.cwd(), '../../docs/cross-market/reports'))
}

function rawFilePath(archiveRoot: string, source: UsDailySource, runDate: string, ticker: string): string {
  return join(archiveRoot, source, runDate, `${ticker}.json`)
}

function reportFilePath(reportRoot: string, runDate: string): string {
  return join(reportRoot, `us-daily-backfill-${runDate}.json`)
}

const MAX_WRITE_ATTEMPTS = 3

function syncSleep(ms: number): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buffer, 0, 0, ms)
}

function atomicWrite(target: string, content: string): void {
  const temp = `${target}.${process.pid}.tmp`
  // Windows EPERM can come from transient file locks (AV / indexing / explorer).
  // Retry the rename, and as a last resort fall back to a direct write so one
  // locked file never aborts a 300-ticker backfill batch.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      writeFileSync(temp, content, 'utf8')
      renameSync(temp, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EBUSY') {
        if (attempt < MAX_WRITE_ATTEMPTS - 1) {
          syncSleep(60 * (attempt + 1))
          continue
        }
        try { writeFileSync(target, content, 'utf8'); return } catch { /* fall through */ }
      }
      throw error
    }
  }
}

export function writeUsDailyArchiveFile(args: {
  archiveRoot: string
  runDate: string | null
  file: UsDailyArchiveFile
}): string {
  const source = args.file.source
  const runDate = args.runDate ?? args.file.fetchedAt.slice(0, 10)
  const target = rawFilePath(args.archiveRoot, source, runDate, args.file.ticker)
  mkdirSync(dirname(target), { recursive: true })
  atomicWrite(target, `${JSON.stringify(args.file, null, 2)}\n`)
  return target
}

export function readUsDailyArchiveFile(archiveRoot: string, source: UsDailySource, runDate: string, ticker: string): UsDailyArchiveFile | null {
  const path = rawFilePath(archiveRoot, source, runDate, ticker)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as UsDailyArchiveFile
  } catch {
    return null
  }
}

export function writeUsDailyBackfillReport(report: UsDailyBackfillReport, reportRoot: string): string {
  const target = reportFilePath(reportRoot, report.runDate)
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  renameSync(temp, target)
  return target
}

function syncPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const run = async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }
  return Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run)).then(() => results)
}

/**
 * 对一组 ticker 执行三年调整日频回填并输出审计报告。
 * - 每个 ticker 按 eastmoney -> yahoo -> stooq 降级链抓取(至少 21 根)。
 * - 先抓 referenceTicker(默认 SPY)锚定三年窗口的参考交易日集合。
 * - 已存在归档且非 force 时直接复用参与审计,实现断点续跑。
 */
export async function runUsDailyBackfill(
  options: UsDailyBackfillOptions,
  deps: UsDailyBackfillDeps = {},
): Promise<UsDailyBackfillReport> {
  const now = options.now ?? Date.now()
  const runDate = todayShanghai(now)
  const years = options.years ?? 3
  const startDate = windowStartDate(now, years)
  const referenceTicker = options.referenceTicker ?? 'SPY'
  const archiveRoot = options.archiveRoot ?? defaultArchiveRoot()
  const reportRoot = options.reportRoot ?? defaultReportRoot()
  const concurrency = options.concurrency ?? 6
  const force = options.force ?? false

  const fetchEast = deps.fetchEastmoney ?? realUsDailyFetchParts().eastmoney
  const fetchStockanalysis = deps.fetchStockanalysis ?? realUsDailyFetchParts().stockanalysis
  const fetchStooq = deps.fetchStooq ?? realUsDailyFetchParts().stooq
  const fetchYahoo = deps.fetchYahoo ?? realUsDailyFetchParts().yahoo

  async function fetchTicker(ticker: string): Promise<{ source: UsDailySource | null; bars: UsDailyBar[]; warnings: string[] }> {
    if (!force) {
      for (const source of ['eastmoney', 'stockanalysis', 'yahoo', 'stooq'] as UsDailySource[]) {
        const archived = readUsDailyArchiveFile(archiveRoot, source, runDate, ticker)
        if (archived?.bars.length) {
          return { source: archived.source, bars: archived.bars, warnings: ['复用当日已归档数据'] }
        }
      }
    }

    const warnings: string[] = []
    if (!options.skipEastmoney) {
      const eastmoney = await fetchEast(ticker).catch((error) => {
        warnings.push(`eastmoney 失败:${error instanceof Error ? error.message : String(error)}`)
        return [] as UsDailyBar[]
      })
      if (eastmoney.length >= 21) return { source: 'eastmoney', bars: eastmoney, warnings }
    }
    const stockanalysis = await fetchStockanalysis(ticker).catch((error) => {
      warnings.push(`stockanalysis 失败:${error instanceof Error ? error.message : String(error)}`)
      return [] as UsDailyBar[]
    })
    if (stockanalysis.length >= 21) return { source: 'stockanalysis', bars: stockanalysis, warnings }
    const yahoo = await fetchYahoo(ticker).catch((error) => {
      warnings.push(`yahoo 失败:${error instanceof Error ? error.message : String(error)}`)
      return [] as UsDailyBar[]
    })
    if (yahoo.length >= 21) return { source: 'yahoo', bars: yahoo, warnings }
    const stooq = await fetchStooq(ticker).catch((error) => {
      warnings.push(`stooq 失败:${error instanceof Error ? error.message : String(error)}`)
      return [] as UsDailyBar[]
    })
    if (stooq.length >= 21) return { source: 'stooq', bars: stooq, warnings }
    return { source: null, bars: [], warnings }
  }

  const reference = await fetchTicker(referenceTicker)
  const referenceBars = reference.source ? reference.bars : []
  options.onReferenceDone?.(referenceTicker, referenceBars.length)

  const requested = [...new Set([referenceTicker, ...options.tickers])]
  const rows = await syncPool(requested, concurrency, async (ticker) => {
    if (options.signal?.aborted) throw new DOMException('backfill aborted', 'AbortError')
    try {
      const result = await fetchTicker(ticker)
      const anomalies = detectSplitAnomalies(result.bars)
      const coverage = assessBackfillCoverage({ tickerBars: result.bars, referenceBars, startDate })
      const status = result.source ? coverage.status : 'unavailable'
      const warnings = [...result.warnings, ...coverage.warnings, ...anomalies.map((anomaly) => `异常标记:${anomaly}`)]
      if (result.source && result.bars.length) {
        writeUsDailyArchiveFile({
          archiveRoot,
          runDate,
          file: {
            ticker,
            source: result.source,
            adjustment: ADJUSTMENT_BY_SOURCE[result.source],
            fetchedAt: new Date().toISOString(),
            bars: result.bars,
          },
        })
      }
      const rowView = { source: result.source, sessionCount: coverage.sessionCount, coveragePct: coverage.coveragePct, warnings: warnings.slice(0, 2) }
      options.onTickerDone?.(ticker, rowView)
      return {
        ticker,
        source: result.source,
        adjustment: result.source ? ADJUSTMENT_BY_SOURCE[result.source] : null,
        sessionCount: coverage.sessionCount,
        referenceSessions: coverage.referenceSessions,
        coveragePct: coverage.coveragePct,
        firstDate: coverage.firstDate,
        latestDate: coverage.latestDate,
        status,
        anomalies,
        warnings,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const row: UsDailyBackfillRow = {
        ticker,
        source: null,
        adjustment: null,
        sessionCount: 0,
        referenceSessions: null,
        coveragePct: null,
        firstDate: null,
        latestDate: null,
        status: 'unavailable',
        anomalies: [],
        warnings: [`${ticker} 处理失败:${message}`],
      }
      options.onTickerDone?.(ticker, { source: null, sessionCount: 0, coveragePct: null, warnings: row.warnings })
      return row
    }
  })

  const fullROWS = rows.filter((row) => row.status === 'full').length
  const degradedCount = rows.filter((row) => row.status === 'degraded').length
  const unavailableCount = rows.filter((row) => row.status === 'unavailable').length

  const report: UsDailyBackfillReport = {
    runDate,
    generatedAt: new Date().toISOString(),
    modelVersion: CROSS_MARKET_MODEL_VERSION,
    referenceTicker,
    startDate,
    targetYears: years,
    requestedTickers: rows.length,
    rows: rows.map((row) => ({
      ticker: row.ticker,
      source: row.source,
      adjustment: row.adjustment,
      sessionCount: row.sessionCount,
      referenceSessions: row.referenceSessions,
      coveragePct: row.coveragePct == null ? null : r2(row.coveragePct),
      firstDate: row.firstDate,
      latestDate: row.latestDate,
      status: row.status,
      anomalies: row.anomalies,
      warnings: row.warnings,
    })),
    summary: {
      archived: rows.filter((row) => row.status !== 'unavailable').length,
      reused: rows.filter((row) => row.warnings.some((warning) => warning.includes('复用当日已归档'))).length,
      fullCount: fullROWS,
      degradedCount,
      unavailableCount,
      adjustedOnlyCount: rows.filter((row) => row.adjustment === 'adjusted').length,
      rawOnlyCount: rows.filter((row) => row.adjustment === 'raw').length,
      sources: rows.reduce<Partial<Record<UsDailySource, number>>>((acc, row) => {
        if (row.source) acc[row.source] = (acc[row.source] ?? 0) + 1
        return acc
      }, {}),
      warnings: [
        ...(referenceBars.length ? [] : [`参考日历 ${referenceTicker} 不可用，覆盖率降级`]),
        ...(rows.some((row) => row.source === 'stooq') ? ['存在 stooq 未复权数据，不会进入正式概率模型'] : []),
      ],
    },
  }

  writeUsDailyBackfillReport(report, reportRoot)
  return report
}

function realUsDailyFetchParts() {
  return {
    eastmoney: (ticker: string) => fetchEastmoneyUsAdjustedDailyBars(ticker).catch(() => [] as UsDailyBar[]),
    stockanalysis: (ticker: string) => fetchStockanalysisAdjustedDailyBars(ticker, AbortSignal.timeout(20_000)).catch(() => [] as UsDailyBar[]),
    yahoo: (ticker: string) => fetchYahooAdjustedDailyBars(ticker, AbortSignal.timeout(20_000)).catch(() => [] as UsDailyBar[]),
    stooq: (ticker: string) => fetchStooqDailyBars(ticker, AbortSignal.timeout(20_000)).catch(() => [] as UsDailyBar[]),
  }
}