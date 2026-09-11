import { createCache, sessionTtl } from '../lib/cache'
import { fetchWithProxy } from '../lib/llm'
import { fetchQuickTinyRealtimeLadder } from './quicktinyLadder'

const KPL_DEVICE_ID = '00000000-025d-1ffd-fa71-8fd5272bb997'
const KPL_LADDER_URL = 'https://apphwhq.longhuvip.com/w1/api/index.php'
const KPL_REASON_URL = 'https://apphq.longhuvip.com/w1/api/index.php'
const KPL_HEADERS = {
  'User-Agent': 'lhb/5.18.0 (iPhone; iOS 16.0)',
}
const REASON_CACHE_MS = 10 * 60_000
const KPL_LADDER_TIERS = [1, 2, 3, 4, 5] as const
const KPL_TIER_REQUEST_TIMEOUT_MS = 8_000
const KPL_TIER_TOTAL_TIMEOUT_MS = 12_000
const KPL_TIER_RETRY_DELAY_MS = 150

type KplLadderTier = (typeof KPL_LADDER_TIERS)[number]

export interface KplRealtimeStock {
  code: string
  name: string
  price: number
  changePct: number
  firstTime: string
  lastTime?: string
  consecutiveDays: number
  nDayBoards: string
  primaryTheme: string
  themes: string[]
  sealAmount: number
  amount: number
  turnoverRate: number
  openCount?: number
  amplitudePct: number
  isMarginEligible: boolean
  onePriceHint: boolean
  tBoardHint: boolean
  /** Optional point-in-time security master fields supplied by an authorized feed. */
  isSt?: boolean
  isDelisting?: boolean
  isSuspended?: boolean
  listingStatus?: string
  statusEvidence?: 'historical-master' | 'provider-field'
  /** Optional fields retained when the authorized QuickTiny ladder supplies them. */
  reasonType?: string
  reasonInfo?: string
  industry?: string
  limitUpType?: string
  actualTurnoverRate?: number
  currencyValue?: number
  totalMarketCap?: number
  actualCurrencyValue?: number
}

export interface KplRealtimeLadder {
  date: string
  stocks: KplRealtimeStock[]
  complete: boolean
  missingTiers: number[]
  /** Provider-level availability classification; empty is not proof of no market data. */
  dataStatus?: 'full' | 'degraded' | 'partial' | 'empty' | 'stale' | 'unavailable'
  /** Provider-declared row coverage when a trustworthy denominator exists. */
  coverage?: number | null
  /** Per-tier request failures retained when a partial ladder is returned. */
  tierFailures?: Array<{ tier: number; message: string }>
  source?: string
  providerAt?: string | null
  capturedAt?: string
  fromCache?: boolean
  cacheAgeMs?: number | null
  /** Non-primary-provider notes, such as a degraded fallback snapshot. */
  warnings?: string[]
}

/**
 * The configured provider remains the default. Callers that need a resilient
 * fallback may explicitly request the public Kaipanla adapter without sharing
 * the configured provider's cache entry.
 */
export type KplRealtimeLadderProvider = 'quicktiny' | 'kaipanla'

export interface KplRealtimeLadderFetchOptions {
  provider?: KplRealtimeLadderProvider
}

export interface KplLimitReasonDetail {
  code: string
  date: string
  reason: string
  explanation: string
  marketRole: string
  hotReason: string
  source: 'kaipanla'
}

interface KplTierPayload {
  info?: [unknown[], string]
  errcode?: string | number
}

interface KplReasonRecord {
  Date?: unknown
  Reason?: unknown
  GNSM?: unknown
  SCLT?: unknown
  Boom_ZS?: unknown
}

interface KplReasonPayload {
  StockID?: unknown
  List?: KplReasonRecord[]
  errcode?: string | number
}

const reasonCache = new Map<string, { at: number; payload: KplReasonPayload }>()

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const number = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeCode(value: unknown): string {
  const digits = text(value).replace(/\D/g, '')
  return digits.slice(-6).padStart(6, '0')
}

function epochToShanghaiTime(value: unknown): string {
  const timestamp = number(value)
  if (timestamp <= 0) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(timestamp * 1000))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.hour}${values.minute}${values.second}`
}

function splitThemes(value: unknown): string[] {
  return text(value)
    .split(/[、,，|/]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function tierFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, 160) || 'unknown error'
}

function isRetryableTierFailure(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  const message = tierFailureMessage(error)
  return error instanceof TypeError || name === 'AbortError' || name === 'TimeoutError' ||
    /^(HTTP (408|425|429|5\d\d)|unexpected payload shape)/.test(message)
}

function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseKplRealtimeRow(row: unknown, tier: number): KplRealtimeStock | null {
  if (!Array.isArray(row)) return null
  const code = normalizeCode(row[0])
  const name = text(row[1])
  if (!/^\d{6}$/.test(code) || code === '000000' || !name) return null

  const firstTime = epochToShanghaiTime(row[4])
  const primaryTheme = text(row[5]) || '其他'
  const consecutiveDays = Math.max(1, number(row[15]) || tier)
  const amplitudePct = Math.max(0, number(row[17]))
  const openedAtAuction = !!firstTime && firstTime <= '092600'

  return {
    code,
    name,
    price: number(row[21]),
    changePct: number(row[22]),
    firstTime,
    consecutiveDays,
    nDayBoards: text(row[18]) || (consecutiveDays === 1 ? '首板' : `${consecutiveDays}连板`),
    primaryTheme,
    themes: unique([primaryTheme, ...splitThemes(row[12])]),
    sealAmount: number(row[6]),
    amount: number(row[11]),
    turnoverRate: number(row[14]),
    amplitudePct,
    isMarginEligible: number(row[2]) === 1,
    onePriceHint: openedAtAuction && amplitudePct <= 0.01,
    tBoardHint: openedAtAuction && amplitudePct > 0.01,
  }
}

async function fetchTierOnce(
  tier: KplLadderTier,
  timeoutMs: number,
): Promise<{ date: string; tier: number; stocks: KplRealtimeStock[] }> {
  const params = new URLSearchParams({
    Order: '0',
    a: 'DailyLimitPerformance',
    st: '2000',
    c: 'HomeDingPan',
    PhoneOSNew: '1',
    DeviceID: KPL_DEVICE_ID,
    VerSion: '5.18.0.2',
    Index: '0',
    PidType: String(tier),
    apiv: 'w39',
    Type: '4',
  })
  const response = await fetchWithProxy(`${KPL_LADDER_URL}?${params}`, {
    headers: KPL_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = (await response.json()) as KplTierPayload
  if (String(payload.errcode ?? '0') !== '0' || !Array.isArray(payload.info)) {
    throw new Error('unexpected payload shape')
  }
  const rows = Array.isArray(payload.info[0]) ? payload.info[0] : []
  return {
    date: text(payload.info[1]),
    tier,
    stocks: rows
      .map((row) => parseKplRealtimeRow(row, tier))
      .filter((stock): stock is KplRealtimeStock => !!stock),
  }
}

async function fetchTier(tier: KplLadderTier): Promise<{ date: string; tier: number; stocks: KplRealtimeStock[] }> {
  const deadline = Date.now() + KPL_TIER_TOTAL_TIMEOUT_MS
  let lastFailure: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    try {
      return await fetchTierOnce(tier, Math.min(KPL_TIER_REQUEST_TIMEOUT_MS, remainingMs))
    } catch (error) {
      lastFailure = error
      if (
        attempt === 1 ||
        !isRetryableTierFailure(error) ||
        deadline - Date.now() <= KPL_TIER_RETRY_DELAY_MS
      ) break
      await waitForRetry(KPL_TIER_RETRY_DELAY_MS)
    }
  }
  throw lastFailure ?? new Error('tier request timed out before it could start')
}

function configuredRealtimeLadderProvider(): KplRealtimeLadderProvider {
  return (process.env.QUICKTINY_LADDER_PROVIDER || '').trim().toLowerCase() === 'quicktiny'
    ? 'quicktiny'
    : 'kaipanla'
}

async function fetchKplRealtimeLadderFresh(provider: KplRealtimeLadderProvider): Promise<KplRealtimeLadder> {
  if (provider === 'quicktiny') {
    return fetchQuickTinyRealtimeLadder()
  }
  const settled = await Promise.allSettled(KPL_LADDER_TIERS.map(fetchTier))
  const fulfilled = settled
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchTier>>> => result.status === 'fulfilled')
    .map((result) => result.value)
  const tierFailures = settled.flatMap((result, index) => result.status === 'rejected'
    ? [{ tier: KPL_LADDER_TIERS[index] ?? index + 1, message: tierFailureMessage(result.reason) }]
    : [])
  if (fulfilled.length === 0) {
    const details = tierFailures.map((failure) => `${failure.tier}板：${failure.message}`).join('；') || '未返回可用层级'
    throw new Error(`开盘啦实时梯队接口不可用（${details}）`)
  }

  const dates = fulfilled.map((result) => result.date).filter(Boolean)
  const date = dates.sort().at(-1) ?? ''
  const stocks = Array.from(
    new Map(
      fulfilled
        .flatMap((result) => result.stocks)
        .map((stock) => [stock.code, stock] as const),
    ).values(),
  )
  const presentTiers = new Set(fulfilled.map((result) => result.tier))
  const missingTiers = KPL_LADDER_TIERS.filter((tier) => !presentTiers.has(tier))
  return {
    date,
    stocks,
    complete: missingTiers.length === 0,
    missingTiers,
    tierFailures,
    source: 'kaipanla',
    providerAt: null,
    capturedAt: new Date().toISOString(),
    fromCache: false,
    cacheAgeMs: 0,
  }
}

const kaipanlaLadderCache = createCache<KplRealtimeLadder>({
  name: 'KplRealtimeLadder',
  ttl: sessionTtl(60_000, 15 * 60_000),
  fetcher: () => fetchKplRealtimeLadderFresh('kaipanla'),
})

const quickTinyLadderCache = createCache<KplRealtimeLadder>({
  name: 'QuickTinyRealtimeLadder',
  ttl: sessionTtl(60_000, 15 * 60_000),
  fetcher: () => fetchKplRealtimeLadderFresh('quicktiny'),
})

function ladderCacheFor(provider: KplRealtimeLadderProvider) {
  return provider === 'quicktiny' ? quickTinyLadderCache : kaipanlaLadderCache
}

export async function fetchKplRealtimeLadder(
  options: KplRealtimeLadderFetchOptions = {},
): Promise<KplRealtimeLadder> {
  const provider = options.provider ?? configuredRealtimeLadderProvider()
  const ladderCache = ladderCacheFor(provider)
  const before = ladderCache.peek()
  const value = await ladderCache.get()
  const ageMs = ladderCache.ageMs()
  const fromCache = before === value && ageMs != null && ageMs > 0
  return {
    ...value,
    source: value.source ?? provider,
    capturedAt: value.capturedAt ?? new Date().toISOString(),
    fromCache,
    cacheAgeMs: ageMs,
  }
}

export function parseKplReasonPayload(
  payload: unknown,
  requestedCode: string,
  asof?: string,
): KplLimitReasonDetail | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as KplReasonPayload
  const records = Array.isArray(raw.List) ? raw.List : []
  const matching = asof
    ? records.find((record) => text(record.Date) === asof)
    : records
        .filter((record) => text(record.Date))
        .sort((a, b) => text(b.Date).localeCompare(text(a.Date)))[0]
  if (!matching) return null
  const reason = text(matching.Reason)
  const explanation = text(matching.GNSM)
  if (!reason && !explanation) return null
  return {
    code: normalizeCode(raw.StockID || requestedCode),
    date: text(matching.Date),
    reason,
    explanation,
    marketRole: text(matching.SCLT),
    hotReason: text(matching.Boom_ZS),
    source: 'kaipanla',
  }
}

export async function fetchKplLimitReason(
  code: string,
  asof?: string,
): Promise<KplLimitReasonDetail | null> {
  const normalizedCode = normalizeCode(code)
  if (!/^\d{6}$/.test(normalizedCode) || normalizedCode === '000000') {
    throw new Error('code 必须是6位股票代码')
  }

  const cached = reasonCache.get(normalizedCode)
  let payload: KplReasonPayload
  if (cached && Date.now() - cached.at < REASON_CACHE_MS) {
    payload = cached.payload
  } else {
    const params = new URLSearchParams({
      a: 'GetKLineZhangTing',
      apiv: 'w24',
      c: 'StockLineData',
      StockID: normalizedCode,
    })
    const response = await fetchWithProxy(`${KPL_REASON_URL}?${params}`, {
      headers: KPL_HEADERS,
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error(`开盘啦涨停原因: HTTP ${response.status}`)
    payload = (await response.json()) as KplReasonPayload
    if (String(payload.errcode ?? '0') !== '0') throw new Error('开盘啦涨停原因返回异常')
    reasonCache.set(normalizedCode, { at: Date.now(), payload })
  }
  return parseKplReasonPayload(payload, normalizedCode, asof)
}

export function clearKplLadderCache(): void {
  kaipanlaLadderCache.clear()
  quickTinyLadderCache.clear()
  reasonCache.clear()
}
