import { emFetch } from '../lib/emFetch'
import { EM_HEADERS } from '../lib/emHeaders'

export interface UsDailyBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  dollarVolume: number
}

export interface DailyDataAudit {
  source: string
  adjustment: 'raw' | 'adjusted'
  requestedBars: number
  actualBars: number
  coveragePct: number
  latestDate: string | null
  status: 'full' | 'degraded' | 'unavailable'
  warnings: string[]
}

export interface SourceShockInput {
  ticker: string
  sessionDate: string
  bars: UsDailyBar[]
  marketReturns: Array<{ date: string; returnPct: number }>
  sectorReturns: Array<{ date: string; returnPct: number }>
  eventFlag?: boolean
}

export interface SourceShockOutput {
  ticker: string
  sessionDate: string
  returnPct: number | null
  abnormalReturnPct: number | null
  returnZ: number | null
  volumeZ: number | null
  eventFlag: boolean
  sourceAvailable: boolean
  warnings: string[]
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function robustZ(value: number, history: number[], floor = 0.0001): number | null {
  const clean = history.filter(finite)
  if (!finite(value) || clean.length < 20) return null
  const center = median(clean)
  const mad = median(clean.map((item) => Math.abs(item - center)))
  return (value - center) / Math.max(1.4826 * mad, floor)
}

export function parseStooqDailyCsv(text: string): UsDailyBar[] {
  const rows = text.trim().split(/\r?\n/)
  if (rows.length < 2 || rows[0].trim().toLowerCase() !== 'date,open,high,low,close,volume') return []
  return rows.slice(1).flatMap((line) => {
    const [date, open, high, low, close, volume] = line.split(',').map((item) => item.trim())
    const values = [open, high, low, close, volume].map(Number)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || values.some((value) => !finite(value))) return []
    return [{ date, open: values[0], high: values[1], low: values[2], close: values[3], volume: values[4], dollarVolume: values[4] * values[3] }]
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchStooqDailyBars(ticker: string, signal?: AbortSignal): Promise<UsDailyBar[]> {
  if (!/^[A-Z.]{1,8}$/.test(ticker)) throw new Error('ticker 必须是美股代码')
  const response = await fetch(`https://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&i=d`, { signal, headers: { accept: 'text/csv' } })
  if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`)
  return parseStooqDailyCsv(await response.text())
}

export function parseEastmoneyAdjustedDailyKlines(rows: unknown): UsDailyBar[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((value) => {
    if (typeof value !== 'string') return []
    const [date, open, close, high, low, volume, amount] = value.split(',')
    const numbers = [open, close, high, low, volume, amount].map(Number)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      numbers.slice(0, 5).some((number) => !finite(number)) ||
      numbers[1] <= 0
    ) {
      return []
    }
    return [{
      date,
      open: numbers[0],
      close: numbers[1],
      high: numbers[2],
      low: numbers[3],
      volume: numbers[4],
      dollarVolume: finite(numbers[5]) && numbers[5] > 0 ? numbers[5] : numbers[1] * numbers[4],
    }]
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchEastmoneyUsAdjustedDailyBars(ticker: string): Promise<UsDailyBar[]> {
  if (!/^[A-Z.]{1,8}$/.test(ticker)) throw new Error('ticker 必须是美股代码')
  let lastError = '东方财富美股日线失败'
  for (const secid of [`105.${ticker}`, `106.${ticker}`, `107.${ticker}`]) {
    for (const host of ['push2his.eastmoney.com', '33.push2his.eastmoney.com']) {
      try {
        const response = await emFetch(
          `https://${host}/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=760`,
          { headers: EM_HEADERS, timeoutMs: 12_000 },
        )
        if (!response.ok) {
          lastError = `东方财富美股日线 HTTP ${response.status}`
          continue
        }
        const json = await response.json() as { data?: { klines?: string[] } }
        const bars = parseEastmoneyAdjustedDailyKlines(json.data?.klines)
        if (bars.length) return bars
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError
      }
    }
  }
  throw new Error(lastError)
}

export function parseYahooAdjustedDailyChart(payload: unknown): UsDailyBar[] {
  const result = (payload as {
    chart?: {
      result?: Array<{
        timestamp?: number[]
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>
            high?: Array<number | null>
            low?: Array<number | null>
            close?: Array<number | null>
            volume?: Array<number | null>
          }>
          adjclose?: Array<{ adjclose?: Array<number | null> }>
        }
      }>
    }
  })?.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const quote = result?.indicators?.quote?.[0]
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose ?? []
  if (!quote) return []
  return timestamps.flatMap((timestamp, index) => {
    const rawClose = Number(quote.close?.[index])
    const adjustedClose = Number(adjusted[index])
    const rawOpen = Number(quote.open?.[index])
    const rawHigh = Number(quote.high?.[index])
    const rawLow = Number(quote.low?.[index])
    const volume = Number(quote.volume?.[index])
    if (
      !Number.isFinite(timestamp) ||
      !finite(rawClose) ||
      rawClose <= 0 ||
      !finite(adjustedClose) ||
      adjustedClose <= 0 ||
      !finite(rawOpen) ||
      !finite(rawHigh) ||
      !finite(rawLow) ||
      !finite(volume)
    ) {
      return []
    }
    const ratio = adjustedClose / rawClose
    return [{
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open: rawOpen * ratio,
      high: rawHigh * ratio,
      low: rawLow * ratio,
      close: adjustedClose,
      volume,
      dollarVolume: adjustedClose * volume,
    }]
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchYahooAdjustedDailyBars(
  ticker: string,
  signal?: AbortSignal,
): Promise<UsDailyBar[]> {
  if (!/^[A-Z.]{1,8}$/.test(ticker)) throw new Error('ticker 必须是美股代码')
  const period2 = Math.floor(Date.now() / 1000) + 86_400
  const period1 = period2 - 4 * 366 * 86_400
  let lastError = 'Yahoo Finance日线失败'
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const response = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`,
        {
          signal,
          headers: {
            accept: 'application/json',
            'user-agent': 'Mozilla/5.0',
          },
        },
      )
      if (!response.ok) {
        lastError = `Yahoo Finance HTTP ${response.status}`
        continue
      }
      const bars = parseYahooAdjustedDailyChart(await response.json())
      if (bars.length) return bars
      lastError = 'Yahoo Finance返回空日线'
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError
    }
  }
  throw new Error(lastError)
}

export function parseStockanalysisDailyHistory(payload: unknown): UsDailyBar[] {
  const rows = (payload as { data?: Array<Record<string, unknown>> })?.data
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    const date = String(row.t ?? '')
    const rawClose = Number(row.c)
    const adjusted = Number(row.a)
    const rawOpen = Number(row.o)
    const rawHigh = Number(row.h)
    const rawLow = Number(row.l)
    const volume = Number(row.v)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !finite(adjusted) || adjusted <= 0 || !finite(rawClose) || rawClose <= 0 || !finite(rawOpen) || !finite(rawHigh) || !finite(rawLow) || !finite(volume)) {
      return []
    }
    const ratio = adjusted / rawClose
    return [{
      date,
      open: rawOpen * ratio,
      high: rawHigh * ratio,
      low: rawLow * ratio,
      close: adjusted,
      volume,
      dollarVolume: adjusted * volume,
    }]
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchStockanalysisAdjustedDailyBars(
  ticker: string,
  signal?: AbortSignal,
): Promise<UsDailyBar[]> {
  if (!/^[A-Z.]{1,8}$/.test(ticker)) throw new Error('ticker 必须是美股代码')
  let lastError = 'stockanalysis.com日线失败'
  for (const range of ['5Y', '1Y']) {
    try {
      const response = await fetch(
        `https://stockanalysis.com/api/symbol/s/${encodeURIComponent(ticker)}/history?range=${range}&period=Daily`,
        {
          signal,
          headers: {
            accept: 'application/json',
            'user-agent': 'Mozilla/5.0',
          },
        },
      )
      if (!response.ok) {
        lastError = `stockanalysis.com HTTP ${response.status}`
        continue
      }
      const bars = parseStockanalysisDailyHistory(await response.json())
      if (bars.length) return bars
      lastError = 'stockanalysis.com返回空日线'
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError
    }
  }
  throw new Error(lastError)
}

export function auditDailyBars(args: { source: string; bars: UsDailyBar[]; requestedBars: number; adjustment?: 'raw' | 'adjusted'; latestExpectedDate?: string }): DailyDataAudit {
  const adjustment = args.adjustment ?? 'raw'
  const warnings: string[] = []
  const actualBars = args.bars.length
  const coveragePct = args.requestedBars > 0 ? Math.round((actualBars / args.requestedBars) * 10000) / 100 : 0
  if (adjustment === 'raw') warnings.push('数据为未复权口径，暂不可进入正式概率模型')
  if (actualBars === 0) warnings.push('未获取到有效日线')
  if (args.latestExpectedDate && args.bars.at(-1)?.date !== args.latestExpectedDate) warnings.push('最新交易日与预期不一致')
  return {
    source: args.source,
    adjustment,
    requestedBars: args.requestedBars,
    actualBars,
    coveragePct,
    latestDate: args.bars.at(-1)?.date ?? null,
    status: actualBars === 0 ? 'unavailable' : coveragePct < 95 || adjustment === 'raw' || warnings.length > 0 ? 'degraded' : 'full',
    warnings,
  }
}

function regressionResiduals(y: number[], market: number[], sector: number[]): number[] | null {
  const rows = y.map((value, index) => [value, market[index], sector[index]]).filter((row) => row.every(finite))
  if (rows.length < 40) return null
  const x = rows.map((row) => [1, row[1], row[2]])
  const target = rows.map((row) => row[0])
  const matrix = (a: number[][], b: number[][]): number[][] => a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)))
  const transpose = (a: number[][]): number[][] => a[0].map((_, column) => a.map((row) => row[column]))
  const xt = transpose(x)
  const xtx = matrix(xt, x)
  const determinant = xtx[0][0] * (xtx[1][1] * xtx[2][2] - xtx[1][2] * xtx[2][1]) - xtx[0][1] * (xtx[1][0] * xtx[2][2] - xtx[1][2] * xtx[2][0]) + xtx[0][2] * (xtx[1][0] * xtx[2][1] - xtx[1][1] * xtx[2][0])
  if (Math.abs(determinant) < 1e-10) return null
  const inverse = [
    [xtx[1][1] * xtx[2][2] - xtx[1][2] * xtx[2][1], xtx[0][2] * xtx[2][1] - xtx[0][1] * xtx[2][2], xtx[0][1] * xtx[1][2] - xtx[0][2] * xtx[1][1]],
    [xtx[1][2] * xtx[2][0] - xtx[1][0] * xtx[2][2], xtx[0][0] * xtx[2][2] - xtx[0][2] * xtx[2][0], xtx[0][2] * xtx[1][0] - xtx[0][0] * xtx[1][2]],
    [xtx[1][0] * xtx[2][1] - xtx[1][1] * xtx[2][0], xtx[0][1] * xtx[2][0] - xtx[0][0] * xtx[2][1], xtx[0][0] * xtx[1][1] - xtx[0][1] * xtx[1][0]],
  ].map((row) => row.map((value) => value / determinant))
  const xtY = xt.map((row) => [row.reduce((sum, value, index) => sum + value * target[index], 0)])
  const beta = matrix(inverse, xtY).map((row) => row[0])
  return rows.map((row) => row[0] - (beta[0] + beta[1] * row[1] + beta[2] * row[2]))
}

export function computeSourceShock(args: SourceShockInput): SourceShockOutput {
  const warnings: string[] = []
  const current = args.bars.at(-1)
  if (!current || args.bars.length < 21) {
    return { ticker: args.ticker, sessionDate: args.sessionDate, returnPct: null, abnormalReturnPct: null, returnZ: null, volumeZ: null, eventFlag: !!args.eventFlag, sourceAvailable: false, warnings: ['日线不足 21 根，拒绝生成冲击特征'] }
  }
  const returns = args.bars.slice(1).map((bar, index) => ({ date: bar.date, value: Math.log(bar.close / args.bars[index].close) }))
  const market = new Map(args.marketReturns.map((row) => [row.date, row.returnPct / 100]))
  const sector = new Map(args.sectorReturns.map((row) => [row.date, row.returnPct / 100]))
  const aligned = returns.filter((row) => market.has(row.date) && sector.has(row.date)).slice(-60)
  const residuals = regressionResiduals(aligned.map((row) => row.value), aligned.map((row) => market.get(row.date) ?? 0), aligned.map((row) => sector.get(row.date) ?? 0))
  const residual = residuals?.at(-1) ?? null
  if (residual === null) warnings.push('市场/行业基准有效重叠样本不足 40 根')
  const dollarVolumeHistory = args.bars.slice(-252).map((bar) => Math.log(Math.max(bar.dollarVolume, 1)))
  const latestReturn = returns.at(-1)
  if (!latestReturn) {
    return { ticker: args.ticker, sessionDate: args.sessionDate, returnPct: null, abnormalReturnPct: null, returnZ: null, volumeZ: null, eventFlag: !!args.eventFlag, sourceAvailable: false, warnings: ['无法生成最新收益率'] }
  }
  return {
    ticker: args.ticker,
    sessionDate: args.sessionDate,
    returnPct: latestReturn.value * 100,
    abnormalReturnPct: residual === null ? null : residual * 100,
    returnZ: residual === null ? null : robustZ(residual, residuals ?? []),
    volumeZ: robustZ(Math.log(Math.max(current.dollarVolume, 1)), dollarVolumeHistory),
    eventFlag: !!args.eventFlag,
    sourceAvailable: true,
    warnings,
  }
}
