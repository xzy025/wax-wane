import { hashPayload } from './pointInTime'
import type { AShareData, KlineFetchResult } from '../services/ashare'
import type { KplRealtimeLadder } from '../services/kaipanlaLadder'
import type { DataEnvelope, DataStatus } from './dataQuality'

export const MARKET_DATA_ENVELOPE_SCHEMA_VERSION = 'market-data-envelope-v1'

export type MarketDatasetId =
  | 'quote'
  | 'kline'
  | 'ladder'
  | 'limit-pool'
  | 'flow'
  | 'board'
  | 'calendar'
  | 'research-anomaly'
  | 'research-valuation'
  | 'research-financials'
  | 'research-hotlist'
  | 'research-boards'
  | 'research-constituents'
  | 'research-limit-pool'

export type MarketDataLicense = 'public' | 'authorized' | 'unknown'
export type MarketDataCredentialMode = 'anonymous' | 'configured' | 'unknown'
export type MarketDataPurpose = 'research' | 'display' | 'scoring'

export interface MarketDataProviderDescriptor {
  readonly id: string
  readonly datasets: readonly MarketDatasetId[]
  readonly license: MarketDataLicense
  readonly credentialMode: MarketDataCredentialMode
  /** Explicit permission is required for scoring; listing a provider is not enough. */
  readonly purposes?: readonly MarketDataPurpose[]
}

export interface MarketDataEnvelope<T> extends DataEnvelope<T> {
  datasetId: MarketDatasetId
  schemaVersion: typeof MARKET_DATA_ENVELOPE_SCHEMA_VERSION
  coverage: number | null
  rawHash: string | null
  fallbackChain: string[]
  license: MarketDataLicense
  credentialMode: MarketDataCredentialMode
}

export interface MarketDataEnvelopeInput<T> {
  datasetId: MarketDatasetId
  provider: string
  data: T | null
  receivedAt?: string | null
  providerAt?: string | null
  asOf?: string | null
  tradeDate?: string | null
  expectedTradeDate?: string | null
  status?: DataStatus
  coverage?: number | null
  rawPayload?: unknown
  fallbackChain?: readonly string[]
  license?: MarketDataLicense
  credentialMode?: MarketDataCredentialMode
  stale?: boolean
  warnings?: readonly string[]
  missingReasons?: readonly string[]
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function validDate(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))) return false
  const date = value.slice(0, 10)
  const parsed = new Date(`${date}T00:00:00Z`)
  return parsed.toISOString().slice(0, 10) === date
}

function statusFor<T>(input: MarketDataEnvelopeInput<T>, missingReasons: string[]): DataStatus {
  const emptyArray = Array.isArray(input.data) && input.data.length === 0
  if (input.data == null) return 'unavailable'
  if (emptyArray) return 'empty'
  if (input.expectedTradeDate && validDate(input.expectedTradeDate) && input.asOf && validDate(input.asOf)) {
    if (input.asOf.slice(0, 10) < input.expectedTradeDate.slice(0, 10)) return 'stale'
  }
  if (input.stale) return 'stale'
  if (input.status) return input.status
  return missingReasons.length ? 'partial' : 'full'
}

/** Build the common dataset envelope without changing any legacy provider response shape. */
export function createMarketDataEnvelope<T>(input: MarketDataEnvelopeInput<T>): MarketDataEnvelope<T> {
  const missingReasons = unique(input.missingReasons ?? [])
  const warnings = unique(input.warnings ?? [])
  const status = statusFor(input, missingReasons)
  const provider = input.provider.trim() || 'unknown'
  const rawHash = input.rawPayload === undefined
    ? input.data == null ? null : hashPayload(input.data)
    : hashPayload(input.rawPayload)
  const asOf = input.asOf ?? input.tradeDate ?? null
  return {
    datasetId: input.datasetId,
    schemaVersion: MARKET_DATA_ENVELOPE_SCHEMA_VERSION,
    source: provider,
    providerAt: input.providerAt ?? null,
    receivedAt: input.receivedAt ?? null,
    asOf,
    stale: input.stale ?? status === 'stale',
    status,
    warnings,
    missingReasons,
    data: input.data,
    coverage: input.coverage ?? null,
    rawHash,
    fallbackChain: unique([...(input.fallbackChain ?? []), provider]),
    license: input.license ?? 'unknown',
    credentialMode: input.credentialMode ?? 'unknown',
    components: undefined,
  }
}

function usable<T>(envelope: MarketDataEnvelope<T>): boolean {
  return envelope.data != null && (envelope.status === 'full' || envelope.status === 'partial' || envelope.status === 'degraded')
}

/** Select the first usable non-stale response and retain every attempted provider. */
export function selectMarketDataEnvelope<T>(envelopes: readonly MarketDataEnvelope<T>[]): MarketDataEnvelope<T> | null {
  if (envelopes.length === 0) return null
  const selected = envelopes.find(usable) ?? envelopes.find((envelope) => envelope.data != null) ?? envelopes[envelopes.length - 1]
  const attempted = unique(envelopes.flatMap((envelope) => envelope.fallbackChain.length ? envelope.fallbackChain : [envelope.source]))
  return {
    ...selected,
    fallbackChain: attempted,
    warnings: unique(envelopes.flatMap((envelope) => envelope.warnings)),
    missingReasons: unique(envelopes.flatMap((envelope) => envelope.missingReasons)),
  }
}

export class MarketDataProviderRegistry {
  private readonly providers = new Map<string, MarketDataProviderDescriptor>()

  register(provider: MarketDataProviderDescriptor): this {
    if (!provider.id.trim()) throw new Error('provider id 不能为空')
    if (this.providers.has(provider.id)) throw new Error(`provider 已注册：${provider.id}`)
    this.providers.set(provider.id, {
      ...provider,
      id: provider.id.trim(),
      datasets: [...new Set(provider.datasets)],
    })
    return this
  }

  get(id: string): MarketDataProviderDescriptor | null {
    return this.providers.get(id) ?? null
  }

  list(datasetId?: MarketDatasetId): MarketDataProviderDescriptor[] {
    return [...this.providers.values()].filter((provider) => !datasetId || provider.datasets.includes(datasetId))
  }

  resolve(datasetId: MarketDatasetId, preferredIds: readonly string[] = []): MarketDataProviderDescriptor | null {
    const available = this.list(datasetId)
    for (const id of preferredIds) {
      const preferred = available.find((provider) => provider.id === id)
      if (preferred) return preferred
    }
    return available[0] ?? null
  }
}

/**
 * Purpose policy is intentionally independent from availability. A successful
 * research response is still not a scoring input until it is explicitly
 * registered as such.
 */
export function isMarketDataAllowedForPurpose(
  registry: MarketDataProviderRegistry,
  providerId: string,
  datasetId: MarketDatasetId,
  purpose: MarketDataPurpose,
  sourceTier?: 'research-only' | 'shadow' | 'production',
): boolean {
  if (purpose !== 'scoring') return true
  if (sourceTier === 'research-only' || sourceTier === 'shadow' || datasetId.startsWith('research-')) return false
  const provider = registry.get(providerId)
  return Boolean(provider?.datasets.includes(datasetId) && provider.purposes?.includes('scoring'))
}

/** Registry is descriptive only; it never turns a listed capability into a successful fetch. */
export function createDefaultMarketDataProviderRegistry(): MarketDataProviderRegistry {
  return new MarketDataProviderRegistry()
    .register({ id: 'eastmoney', datasets: ['quote', 'kline', 'limit-pool', 'flow', 'board'], license: 'public', credentialMode: 'anonymous', purposes: ['research', 'display', 'scoring'] })
    .register({ id: 'tencent', datasets: ['quote', 'kline'], license: 'public', credentialMode: 'anonymous', purposes: ['research', 'display', 'scoring'] })
    .register({ id: 'sina', datasets: ['quote', 'kline', 'limit-pool'], license: 'public', credentialMode: 'anonymous', purposes: ['research', 'display', 'scoring'] })
    .register({ id: 'kaipanla', datasets: ['ladder', 'limit-pool', 'flow', 'board'], license: 'unknown', credentialMode: 'anonymous', purposes: ['research', 'display', 'scoring'] })
    .register({ id: 'quicktiny', datasets: ['ladder', 'flow', 'board'], license: 'unknown', credentialMode: 'configured', purposes: ['research', 'display', 'scoring'] })
    .register({ id: 'trading-calendar-config', datasets: ['calendar'], license: 'unknown', credentialMode: 'configured', purposes: ['research', 'display'] })
}

export function envelopeForKline(
  result: KlineFetchResult,
  expectedTradeDate?: string,
): MarketDataEnvelope<KlineFetchResult['klines']> {
  const latestDate = result.klines.at(-1)?.date.slice(0, 10) ?? null
  const warnings = [...(result.warnings ?? [])]
  if (!result.providerAt) warnings.push('上游未提供 providerAt')
  return createMarketDataEnvelope({
    datasetId: 'kline',
    provider: result.provider ?? 'unknown',
    data: result.klines.length ? result.klines : [],
    receivedAt: result.receivedAt ?? null,
    providerAt: result.providerAt ?? null,
    asOf: latestDate,
    expectedTradeDate,
    status: result.klines.length === 0
      ? 'empty'
      : result.quality === 'unusable'
        ? 'unavailable'
        : result.quality === 'degraded' || result.quality === 'partial'
          ? 'partial'
          : undefined,
    rawPayload: result,
    warnings,
    missingReasons: result.klines.length === 0 ? ['K线为空'] : [],
  })
}

export function envelopeForAShare(
  data: AShareData | null,
  expectedTradeDate?: string,
): MarketDataEnvelope<AShareData> {
  if (!data) {
    return createMarketDataEnvelope<AShareData>({
      datasetId: 'quote',
      provider: 'eastmoney+sina',
      data: null,
      expectedTradeDate,
      missingReasons: ['A股综合行情响应为空'],
    })
  }
  const components = data.quality ? Object.values(data.quality) : []
  const componentReasons = components.flatMap((component) => [
    ...component.missingReasons,
    ...component.warnings,
  ])
  const asOf = components.map((component) => component.asOf).filter((value): value is string => !!value).sort().at(-1) ?? null
  const status: DataStatus = data.indices.length === 0
    ? 'empty'
    : expectedTradeDate && asOf && asOf < expectedTradeDate
      ? 'stale'
      : components.some((component) => component.status === 'unavailable')
        ? 'partial'
        : components.some((component) => component.status !== 'full')
          ? 'partial'
          : 'full'
  return createMarketDataEnvelope({
    datasetId: 'quote',
    provider: components.length ? Array.from(new Set(components.map((component) => component.source))).join('+') : 'unknown',
    data,
    asOf,
    expectedTradeDate,
    status,
    rawPayload: data,
    warnings: componentReasons,
    missingReasons: componentReasons,
  })
}

export interface MarketQuotePoint {
  tradeDate?: string
  capturedAt?: string
  source?: string
}

export function envelopeForQuoteBatch<T extends MarketQuotePoint>(
  quotes: readonly T[],
  expectedTradeDate?: string,
  expectedCount?: number,
): MarketDataEnvelope<readonly T[]> {
  const dates = quotes.map((quote) => quote.tradeDate).filter((value): value is string => !!value).sort()
  const asOf = dates.at(-1) ?? null
  const missingReasons: string[] = []
  if (expectedCount != null && quotes.length < expectedCount) missingReasons.push(`报价覆盖不足：${quotes.length}/${expectedCount}`)
  const status: DataStatus = quotes.length === 0
    ? 'empty'
    : expectedTradeDate && asOf && asOf < expectedTradeDate
      ? 'stale'
      : missingReasons.length
        ? 'partial'
        : 'full'
  return createMarketDataEnvelope({
    datasetId: 'quote',
    provider: Array.from(new Set(quotes.map((quote) => quote.source).filter((value): value is string => !!value))).join('+') || 'unknown',
    data: quotes,
    asOf,
    expectedTradeDate,
    status,
    rawPayload: quotes,
    missingReasons,
  })
}

export function envelopeForTradingCalendar(
  dates: readonly string[],
  source: string,
  version: string | null = null,
): MarketDataEnvelope<readonly string[]> {
  const orderedDates = [...dates].sort()
  return createMarketDataEnvelope({
    datasetId: 'calendar',
    provider: source,
    data: orderedDates,
    asOf: orderedDates.at(-1) ?? null,
    rawPayload: { dates: orderedDates, version },
    coverage: orderedDates.length ? 1 : 0,
    missingReasons: orderedDates.length ? [] : ['交易日历为空'],
    license: 'unknown',
    credentialMode: 'configured',
  })
}

export function envelopeForKplLadder(
  ladder: KplRealtimeLadder | null,
  expectedTradeDate?: string,
): MarketDataEnvelope<KplRealtimeLadder> {
  if (!ladder) {
    return createMarketDataEnvelope<KplRealtimeLadder>({
      datasetId: 'ladder',
      provider: 'kaipanla',
      data: null,
      expectedTradeDate,
      missingReasons: ['连板梯队响应为空'],
      license: 'unknown',
      credentialMode: 'anonymous',
    })
  }
  const missingReasons = [
    ...(ladder.complete ? [] : ['梯队 complete=false']),
    ...(ladder.missingTiers.length ? [`缺少层级：${ladder.missingTiers.join(',')}`] : []),
    ...(ladder.warnings ?? []),
  ]
  const staleByDate = !!(
    ladder.date
    && expectedTradeDate
    && ladder.date < expectedTradeDate
  )
  // An adapter can distinguish an unverified empty payload from a confirmed
  // empty market. Preserve that signal instead of reclassifying by array size.
  const status: DataStatus = staleByDate
    ? 'stale'
    : ladder.dataStatus === 'unavailable'
      ? 'unavailable'
      : ladder.dataStatus === 'stale'
        ? 'stale'
        : ladder.dataStatus === 'degraded'
          ? 'degraded'
          : ladder.dataStatus === 'partial'
            ? 'partial'
            : ladder.dataStatus === 'empty' && ladder.stocks.length === 0
              ? 'empty'
              : ladder.stocks.length === 0
                ? 'empty'
                : missingReasons.length || !ladder.providerAt
                  ? 'partial'
                  : 'full'
  return createMarketDataEnvelope({
    datasetId: 'ladder',
    provider: ladder.source ?? 'kaipanla',
    data: ladder,
    receivedAt: ladder.capturedAt ?? null,
    providerAt: ladder.providerAt ?? null,
    asOf: ladder.date || null,
    expectedTradeDate,
    status,
    rawPayload: ladder,
    missingReasons: [
      ...missingReasons,
      ...(!ladder.providerAt ? ['上游未提供 providerAt'] : []),
    ],
    license: ladder.source === 'kaipanla' ? 'unknown' : 'public',
    credentialMode: 'anonymous',
  })
}
