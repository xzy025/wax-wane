import { createHash } from 'node:crypto'
import { dateToShanghaiMs, validateDate, type HithinkClient } from '../market-data/hithinkFinanceClient'
import { getHithinkProvider } from '../market-data/providers/ths/hithink'

export const THS_DAILY_CONTRACT = 'https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/endpoints-prices.md'
const endpoint = '/api/a-share/prices/historical'
type Adjustment = 'qfq' | 'raw'
type Row = Record<string, unknown>
export interface LadderValidationBar {
  date: string; open: number; high: number; low: number; close: number; volume: number
  turnover?: number | null; provider?: string; adjustment?: string
}
export interface LadderValidationEvidence {
  asof: string
  klines: Record<string, LadderValidationBar[]>
  rawKlines?: Record<string, LadderValidationBar[]>
}
function record(value: unknown): value is Row { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function shanghaiDate(ms: number): string | null {
  const date = new Date(ms + 8 * 3600_000)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null
}
export function ladderThsCode(code: string): string {
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid evidence stock code')
  return `${code}.${/^(4|8|92)/.test(code) ? 'BJ' : code.startsWith('6') ? 'SH' : 'SZ'}`
}

/** Daily dates and ready timestamps never become a historical publication time. */
export function inspectLadderThsPayload(payload: unknown, request: {
  code: string; adjustment: Adjustment; startDate: string; tradeDate: string
}) {
  const errors: string[] = []
  const bars: LadderValidationBar[] = []
  const adjust = request.adjustment === 'qfq' ? 'forward' : 'none'
  const expectedCode = ladderThsCode(request.code)
  if (!record(payload) || !Array.isArray(payload.item)) {
    return { errors: ['missing-item-array'], bars, timestamp: null, timestampDate: null, timestampUtc: null, timestampShanghai: null, latestBarDateMs: null, timestampEqualsLatestBarDate: false, echoed: [] as string[] }
  }
  const echoed: string[] = []
  for (const [field, expected] of [['thscode', expectedCode], ['interval', '1d'], ['adjust', adjust]]) {
    if (payload[field] !== undefined) {
      echoed.push(field)
      if (payload[field] !== expected) errors.push(`response-${field}-mismatch`)
    }
  }
  let previous = ''
  for (const item of payload.item) {
    if (!record(item) || !finite(item.date_ms)) { errors.push('invalid-bar-date'); continue }
    const date = shanghaiDate(item.date_ms)
    if (!date) { errors.push('invalid-bar-date'); continue }
    if (item.thscode !== undefined && item.thscode !== expectedCode) errors.push('bar-code-mismatch')
    if (date < request.startDate || date > request.tradeDate) errors.push('bar-outside-request-window')
    if (date <= previous) errors.push('duplicate-or-unsorted-date')
    previous = date
    if (!['open_price', 'high_price', 'low_price', 'close_price', 'volume', 'turnover'].every((field) => finite(item[field]))) {
      errors.push('missing-or-nonfinite-ohlcv-turnover'); continue
    }
    const open = item.open_price as number, high = item.high_price as number
    const low = item.low_price as number, close = item.close_price as number
    const volume = item.volume as number, turnover = item.turnover as number
    if (Math.min(open, high, low, close) <= 0 || low > Math.min(open, close) || high < Math.max(open, close) || volume < 0 || turnover < 0) errors.push('invalid-ohlcv-range')
    bars.push({ date, open, high, low, close, volume, turnover })
  }
  if (bars.at(-1)?.date !== request.tradeDate) errors.push('target-close-missing')
  const timestamp = finite(payload.timestamp) ? payload.timestamp : null
  const timestampDate = timestamp === null ? null : shanghaiDate(timestamp)
  const latest = payload.item.at(-1) as unknown
  const latestBarDateMs = record(latest) && finite(latest.date_ms) ? latest.date_ms : null
  return { errors: [...new Set(errors)], bars, timestamp, timestampDate,
    timestampUtc: timestamp !== null && timestampDate ? new Date(timestamp).toISOString() : null,
    timestampShanghai: timestamp !== null && timestampDate ? `${new Date(timestamp + 8 * 3600_000).toISOString().slice(0, -1)}+08:00` : null,
    latestBarDateMs, timestampEqualsLatestBarDate: timestamp !== null && timestamp === latestBarDateMs, echoed }
}

export function compareLadderThsBars(ths: LadderValidationBar[], peer: LadderValidationBar[], adjustment: Adjustment) {
  const errors: string[] = []
  const mismatches: Array<{ date: string; fields: string[] }> = []
  const missingInThs = peer.filter((bar) => !ths.some((other) => other.date === bar.date)).map((bar) => bar.date)
  const missingInPeer = ths.filter((bar) => !peer.some((other) => other.date === bar.date)).map((bar) => bar.date)
  let compared = 0, turnoverUncomparable = 0, volumeUncomparable = 0
  if (new Set(peer.map((bar) => bar.date)).size !== peer.length) errors.push('duplicate-peer-date')
  for (const bar of peer) {
    if (bar.adjustment !== adjustment) errors.push('peer-adjustment-mismatch')
    const other = ths.find((item) => item.date === bar.date)
    if (!other) continue
    compared++
    const fields: string[] = []
    for (const field of ['open', 'high', 'low', 'close'] as const) {
      if (!finite(bar[field]) || Math.abs(other[field] - bar[field]) > 0.011) fields.push(field)
    }
    // These adapters preserve native lots (100 shares); Sina uses shares. Unknown sources are not guessed.
    const multiplier = bar.provider === 'tencent' || bar.provider === 'eastmoney' ? 100 : bar.provider === 'sina' ? 1 : null
    if (multiplier === null || !finite(bar.volume) || bar.volume < 0) volumeUncomparable++
    else if (Math.abs(other.volume - bar.volume * multiplier) > (multiplier === 100 ? 100 : 0)) fields.push('volume')
    // Tencent null and legacy zero turnover are missing observations, not zero trades.
    if (!finite(bar.turnover) || !finite(other.turnover) || (bar.turnover === 0 && bar.volume > 0)) turnoverUncomparable++
    else if (Math.abs(other.turnover - bar.turnover) > 1) fields.push('turnover')
    if (fields.length) mismatches.push({ date: bar.date, fields })
  }
  if (!compared) errors.push('no-comparable-bars')
  if (volumeUncomparable) errors.push('peer-volume-unit-or-value-unknown')
  if (missingInThs.length || missingInPeer.length) errors.push('date-coverage-mismatch')
  return { compared, missingInThs, missingInPeer, mismatches, errors: [...new Set(errors)], turnoverUncomparable, volumeUncomparable,
    ohlcvPass: compared > 0 && !errors.length && !mismatches.some((row) => row.fields.some((field) => field !== 'turnover')),
    fullParityPass: compared > 0 && !errors.length && !mismatches.length && !turnoverUncomparable }
}

export async function validateLadderThs(options: {
  evidence: LadderValidationEvidence; tradeDate: string; startDate?: string; limit?: number; concurrency?: number; client?: HithinkClient
}) {
  validateDate(options.tradeDate, 'tradeDate')
  if (options.evidence.asof !== options.tradeDate) throw new Error('Evidence date mismatch')
  const requestedStart = options.startDate ?? shanghaiDate(dateToShanghaiMs(options.tradeDate) - 9 * 86400_000)
  if (!requestedStart) throw new Error('Invalid request start date')
  const startDate: string = requestedStart
  validateDate(startDate, 'startDate')
  if (startDate > options.tradeDate) throw new Error('Invalid request window')
  const concurrency = options.concurrency ?? 2
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('Concurrency must be 1..3')
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error('Invalid stock limit')
  const client = options.client ?? getHithinkProvider().client
  const allCodes = Object.keys(options.evidence.klines).sort()
  allCodes.forEach(ladderThsCode)
  const codes = allCodes.slice(0, options.limit ?? allCodes.length)
  const jobs = codes.flatMap((code) => (['qfq', 'raw'] as const).map((adjustment) => ({ code, adjustment })))
  async function collect(job: typeof jobs[number]) {
    const params = { thscode: ladderThsCode(job.code), interval: '1d', adjust: job.adjustment === 'qfq' ? 'forward' : 'none', start: dateToShanghaiMs(startDate), end: dateToShanghaiMs(options.tradeDate) }
    const base = { ...job, endpoint, params, providerAt: null, eligibleAsTradeGate: false }
    if (!client.isConfigured) return { ...base, status: 'unavailable', reason: 'not-configured' }
    try {
      const response = await client.get(endpoint, params)
      const capture = { receivedAt: response.receivedAt, rawSha256: createHash('sha256').update(response.rawBytes).digest('hex'), httpStatus: response.httpStatus, apiCode: response.code, attempts: response.attempts }
      if (!response.ok) return { ...base, ...capture, status: 'unavailable', reason: 'upstream-error' }
      const inspected = inspectLadderThsPayload(response.data, { ...job, startDate, tradeDate: options.tradeDate })
      const peer = (job.adjustment === 'qfq' ? options.evidence.klines : options.evidence.rawKlines)?.[job.code] ?? []
      const peerWindow = peer.filter((bar) => bar.date >= startDate && bar.date <= options.tradeDate)
      const parity = compareLadderThsBars(inspected.bars, peerWindow, job.adjustment)
      return { ...base, ...capture, status: inspected.errors.length ? 'invalid-response' : parity.ohlcvPass ? 'ohlcv-agrees' : 'mismatch', ...inspected, parity,
        timestampInterpretation: inspected.timestamp === null ? 'missing' : inspected.timestamp === dateToShanghaiMs(options.tradeDate) ? 'target-trading-day-midnight-not-close-publication' : 'upstream-effective-time-publication-semantics-unverified',
        requestBinding: 'Single-symbol daily endpoint; code/interval/adjustment without response echoes are request-bound only.' }
    } catch {
      return { ...base, status: 'unavailable', reason: 'request-or-payload-error' }
    }
  }
  const rows: Awaited<ReturnType<typeof collect>>[] = new Array(jobs.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) { const index = next++; rows[index] = await collect(jobs[index]) }
  }))
  return { generatedAt: new Date().toISOString(), tradeDate: options.tradeDate, startDate, source: 'hithink-finance-api', status: 'research-only', eligibleAsTradeGate: false,
    providerAt: null, contract: THS_DAILY_CONTRACT, contractTimestampQuote: '数据就绪时间（毫秒），为序列中最新一根 K 线的上游有效时间。', totalEvidenceStocks: allCodes.length, requestedStocks: codes.length,
    summary: { requests: rows.length, ohlcvAgrees: rows.filter((row) => row.status === 'ohlcv-agrees').length, invalid: rows.filter((row) => row.status === 'invalid-response').length, mismatches: rows.filter((row) => row.status === 'mismatch').length, unavailable: rows.filter((row) => row.status === 'unavailable').length },
    notes: ['Window parity only; does not certify the full archived history or historical point-in-time availability.', 'Contract timestamp means latest bar upstream effective/ready time, not explicitly publication time; never copied to providerAt.', 'Price tolerance 0.011 CNY; known native lots converted to shares with one-lot (100 shares) quantization tolerance; turnover tolerance 1 CNY.', 'Missing peer turnover remains uncomparable; OHLCV agreement is not full parity or production eligibility.', 'Raw SHA256 identifies the upstream response; report retains normalized bars only, not a byte-replay capture.'], rows }
}
