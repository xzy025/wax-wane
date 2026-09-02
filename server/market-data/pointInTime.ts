import { createHash } from 'node:crypto'
import { isTradingDay } from '../services/tradingCalendar'

export type MarketAdjustment = 'raw' | 'qfq' | 'hfq' | 'none' | 'unknown'
export type EvidenceQuality = 'full' | 'partial' | 'degraded' | 'unusable'

export interface PointInTimeEvidence<T> {
  asOfDate: string
  eventAt: string | null
  providerAt: string | null
  requestedAt: string
  receivedAt: string
  decisionAt: string
  provider: string
  endpointVersion: string | null
  adjustment: MarketAdjustment
  quality: EvidenceQuality
  missingReasons: string[]
  payloadHash: string
  payload: T
}

export interface PointInTimeInput {
  asOfDate: string
  eventAt?: string | null
  providerAt?: string | null
  requestedAt: string
  receivedAt: string
  decisionAt: string
  provider: string
  endpointVersion?: string | null
  adjustment: MarketAdjustment
  payload: unknown
  missingReasons?: string[]
}

const validIso = (value: string | null | undefined): boolean =>
  value != null && Number.isFinite(Date.parse(value))

/**
 * Build the common evidence envelope. The hash covers only the source payload;
 * callers can therefore compare immutable source observations independently of
 * derived scores.
 */
export function buildPointInTimeEvidence<T>(input: PointInTimeInput & { payload: T }): PointInTimeEvidence<T> {
  const missingReasons = [...new Set(input.missingReasons ?? [])]
  const quality: EvidenceQuality = missingReasons.length
    ? input.provider === 'unknown' || input.adjustment === 'unknown'
      ? 'unusable'
      : 'degraded'
    : input.providerAt && validIso(input.providerAt)
      ? 'full'
      : 'partial'
  return {
    asOfDate: input.asOfDate,
    eventAt: input.eventAt ?? null,
    providerAt: input.providerAt ?? null,
    requestedAt: input.requestedAt,
    receivedAt: input.receivedAt,
    decisionAt: input.decisionAt,
    provider: input.provider,
    endpointVersion: input.endpointVersion ?? null,
    adjustment: input.adjustment,
    quality,
    missingReasons,
    payloadHash: hashPayload(input.payload),
    payload: input.payload,
  }
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

export function isPointInTimeCausal(evidence: Pick<PointInTimeEvidence<unknown>, 'eventAt' | 'providerAt' | 'receivedAt' | 'decisionAt'>): boolean {
  const decisionMs = Date.parse(evidence.decisionAt)
  if (!Number.isFinite(decisionMs)) return false
  return [evidence.eventAt, evidence.providerAt, evidence.receivedAt]
    .filter((value): value is string => value != null)
    .every((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= decisionMs)
}

export interface BarValidationResult {
  valid: boolean
  reasons: string[]
}

/** Validate order, uniqueness, positive OHLC and the requested adjustment. */
export function validateHistoricalBars(
  bars: ReadonlyArray<{ date: string; open: number; high: number; low: number; close: number; volume: number }>,
  options: { asOfDate?: string; adjustment?: MarketAdjustment } = {},
): BarValidationResult {
  const reasons: string[] = []
  const keys = new Set<string>()
  let previousDate = ''
  for (const bar of bars) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(bar.date)) reasons.push('bar日期格式无效')
    const date = bar.date.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !isTradingDay(date)) reasons.push(`bar日期不是交易日:${date}`)
    if (date <= previousDate) reasons.push('bar未按交易日严格升序或存在重复')
    previousDate = date
    if (keys.has(date)) reasons.push(`bar日期重复:${date}`)
    keys.add(date)
    if (![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) reasons.push(`bar数值无效:${date}`)
    if (!(bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0 && bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close, bar.high))) reasons.push(`bar OHLC范围无效:${date}`)
    if (options.asOfDate && date > options.asOfDate.slice(0, 10)) reasons.push(`bar超出asOfDate:${date}`)
  }
  if (options.adjustment === 'unknown') reasons.push('复权口径未知')
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] }
}
