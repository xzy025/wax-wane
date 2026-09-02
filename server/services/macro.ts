// Macroeconomic data fetching from Twelve Data + ExchangeRate-API.
// Missing quotes are represented explicitly; this module never substitutes a
// plausible-looking static market value for an unavailable source.

import { createCache } from '../lib/cache'
import type { DataStatus } from '../market-data/dataQuality'

const TWELVEDATA_BASE = 'https://api.twelvedata.com'
const EXCHANGERATE_BASE = 'https://open.er-api.com/v6/latest/USD'

export type MacroSource = 'twelve-data' | 'exchange-rate-api' | 'unavailable'

export interface MacroIndicator {
  id: string
  value: number | null
  previousClose: number | null
  unit: string
  source: MacroSource
  status: DataStatus
  providerAt: string | null
  receivedAt: string
  asOf: string | null
  warnings: string[]
  missingReasons: string[]
}

interface MacroSpec {
  id: string
  unit: string
  twelveDataSymbol?: string
}

const MACRO_SPECS: readonly MacroSpec[] = [
  { id: 'us10y', unit: '%', twelveDataSymbol: 'TNX' },
  { id: 'us5y', unit: '%', twelveDataSymbol: 'FVX' },
  { id: 'gold', unit: 'USD/oz', twelveDataSymbol: 'XAU/USD' },
  { id: 'dxy', unit: '', twelveDataSymbol: 'DXY' },
  { id: 'usdcny', unit: '' },
  { id: 'crude', unit: 'USD/桶', twelveDataSymbol: 'CL' },
  { id: 'vix', unit: '', twelveDataSymbol: 'VIX' },
]

interface TwelveDataQuote {
  readonly symbol: string
  readonly close: string
  readonly previous_close?: string
  readonly datetime?: string
}

interface TwelveDataResponse {
  readonly data?: readonly TwelveDataQuote[]
}

interface ExchangeRateResponse {
  readonly time_last_update_utc?: string
  readonly rates?: { readonly CNY?: number }
}

interface SourceResult<T> {
  data: T
  receivedAt: string
}

function unavailableIndicator(spec: MacroSpec, source: MacroSource, receivedAt: string, reason: string): MacroIndicator {
  return {
    id: spec.id,
    value: null,
    previousClose: null,
    unit: spec.unit,
    source,
    status: 'unavailable',
    providerAt: null,
    receivedAt,
    asOf: null,
    warnings: [reason],
    missingReasons: [reason],
  }
}

function asOfFrom(providerAt: string | null, receivedAt: string): string {
  const value = providerAt && Number.isFinite(Date.parse(providerAt)) ? providerAt : receivedAt
  return value.slice(0, 10)
}

async function fetchTwelveData(apiKey: string): Promise<SourceResult<readonly TwelveDataQuote[]>> {
  const symbols = MACRO_SPECS.flatMap((spec) => spec.twelveDataSymbol ? [spec.twelveDataSymbol] : []).join(',')
  const res = await fetch(`${TWELVEDATA_BASE}/quotes?symbol=${symbols}&apikey=${apiKey}`)
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`)
  const json = (await res.json()) as TwelveDataResponse
  if (!Array.isArray(json.data)) throw new Error('Twelve Data payload missing quote array')
  return { data: json.data, receivedAt: new Date().toISOString() }
}

async function fetchUSDCNY(): Promise<SourceResult<ExchangeRateResponse>> {
  const res = await fetch(EXCHANGERATE_BASE)
  if (!res.ok) throw new Error(`ExchangeRate-API HTTP ${res.status}`)
  return { data: (await res.json()) as ExchangeRateResponse, receivedAt: new Date().toISOString() }
}

function twelveIndicator(spec: MacroSpec, quote: TwelveDataQuote | undefined, receivedAt: string): MacroIndicator {
  if (!quote) return unavailableIndicator(spec, 'twelve-data', receivedAt, 'Twelve Data response missing indicator')
  const value = Number(quote.close)
  if (!Number.isFinite(value)) return unavailableIndicator(spec, 'twelve-data', receivedAt, 'Twelve Data close is not numeric')
  const previousClose = Number(quote.previous_close)
  const hasPreviousClose = Number.isFinite(previousClose)
  const providerAt = quote.datetime && Number.isFinite(Date.parse(quote.datetime)) ? quote.datetime : null
  return {
    id: spec.id,
    value,
    previousClose: hasPreviousClose ? previousClose : null,
    unit: spec.unit,
    source: 'twelve-data',
    status: hasPreviousClose ? 'full' : 'degraded',
    providerAt,
    receivedAt,
    asOf: asOfFrom(providerAt, receivedAt),
    warnings: hasPreviousClose ? [] : ['Twelve Data previous close unavailable'],
    missingReasons: hasPreviousClose ? [] : ['previousClose unavailable'],
  }
}

function usdCnyIndicator(result: SourceResult<ExchangeRateResponse>): MacroIndicator {
  const spec = MACRO_SPECS.find((item) => item.id === 'usdcny')!
  const value = result.data.rates?.CNY
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return unavailableIndicator(spec, 'exchange-rate-api', result.receivedAt, 'ExchangeRate-API CNY quote unavailable')
  }
  const providerAt = result.data.time_last_update_utc && Number.isFinite(Date.parse(result.data.time_last_update_utc))
    ? result.data.time_last_update_utc
    : null
  return {
    id: spec.id,
    value,
    previousClose: null,
    unit: spec.unit,
    source: 'exchange-rate-api',
    status: 'degraded',
    providerAt,
    receivedAt: result.receivedAt,
    asOf: asOfFrom(providerAt, result.receivedAt),
    warnings: ['ExchangeRate-API does not provide previous close'],
    missingReasons: ['previousClose unavailable'],
  }
}

/** Exported for focused unit coverage without network/cache coupling. */
export function buildMacroIndicators(args: {
  twelve?: SourceResult<readonly TwelveDataQuote[]>
  twelveError?: string
  usdCny?: SourceResult<ExchangeRateResponse>
  usdCnyError?: string
  receivedAt?: string
}): MacroIndicator[] {
  const receivedAt = args.receivedAt ?? new Date().toISOString()
  const twelveBySymbol = new Map(args.twelve?.data.map((quote) => [quote.symbol, quote]))
  return MACRO_SPECS.map((spec) => {
    if (spec.id === 'usdcny') {
      return args.usdCny
        ? usdCnyIndicator(args.usdCny)
        : unavailableIndicator(spec, 'exchange-rate-api', receivedAt, args.usdCnyError ?? 'ExchangeRate-API unavailable')
    }
    return args.twelve
      ? twelveIndicator(spec, twelveBySymbol.get(spec.twelveDataSymbol!), args.twelve.receivedAt)
      : unavailableIndicator(spec, 'twelve-data', receivedAt, args.twelveError ?? 'Twelve Data unavailable')
  })
}

async function fetchAllData(apiKey: string): Promise<MacroIndicator[]> {
  const [twelveResult, usdCnyResult] = await Promise.allSettled([
    apiKey ? fetchTwelveData(apiKey) : Promise.reject(new Error('Twelve Data API key not configured')),
    fetchUSDCNY(),
  ])
  return buildMacroIndicators({
    twelve: twelveResult.status === 'fulfilled' ? twelveResult.value : undefined,
    twelveError: twelveResult.status === 'rejected'
      ? twelveResult.reason instanceof Error ? twelveResult.reason.message : 'Twelve Data unavailable'
      : undefined,
    usdCny: usdCnyResult.status === 'fulfilled' ? usdCnyResult.value : undefined,
    usdCnyError: usdCnyResult.status === 'rejected'
      ? usdCnyResult.reason instanceof Error ? usdCnyResult.reason.message : 'ExchangeRate-API unavailable'
      : undefined,
  })
}

// ── Cache (30s) ──────────────────────────────────────────

// Twelve Data's free tier is tightly rate-limited (≈8 calls/min, 800/day),
// so cache for 5 minutes regardless of session.
const macroCache = createCache<MacroIndicator[]>({
  name: 'Macro',
  ttl: 5 * 60_000,
  fetcher: () => fetchAllData(process.env.TWELVE_DATA_API_KEY ?? ''),
})

export function clearMacroCache() {
  macroCache.clear()
}

export async function fetchMacroData(): Promise<MacroIndicator[]> {
  return macroCache.get()
}
