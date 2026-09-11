import { describe, expect, it } from 'vitest'
import { dateToShanghaiMs, type HithinkClient, type HithinkParams } from '../market-data/hithinkFinanceClient'
import { compareLadderThsBars, inspectLadderThsPayload, validateLadderThs, type LadderValidationBar } from './ladderThsValidation'

const request = { code: '600121', adjustment: 'qfq' as const, startDate: '2026-09-08', tradeDate: '2026-09-09' }
const row = { date_ms: dateToShanghaiMs(request.tradeDate), open_price: 5.2, high_price: 5.7, low_price: 5.08, close_price: 5.7, volume: 214930710, turnover: 1200000000 }
const payload = () => ({ thscode: '600121.SH', interval: '1d', adjust: 'forward', timestamp: row.date_ms, item: [{ ...row }] })
const peer = (): LadderValidationBar => ({ date: request.tradeDate, open: 5.2, high: 5.7, low: 5.08, close: 5.7, volume: 2149307, turnover: null, provider: 'tencent', adjustment: 'qfq' })

describe('THS daily contract inspection', () => {
  it('captures midnight timestamp without promoting it into providerAt', () => {
    const result = inspectLadderThsPayload(payload(), request)
    expect(result.errors).toEqual([])
    expect(result.echoed).toEqual(['thscode', 'interval', 'adjust'])
    expect(result.timestampShanghai).toBe('2026-09-09T00:00:00.000+08:00')
    expect(result.timestampEqualsLatestBarDate).toBe(true)
  })
  it.each([['thscode', '000019.SZ'], ['interval', '1w'], ['adjust', 'none']])('rejects mismatched %s echoes', (field, value) => {
    expect(inspectLadderThsPayload({ ...payload(), [field]: value }, request).errors).toContain(`response-${field}-mismatch`)
  })
  it('allows the documented minimal payload but reports no verified echoes', () => {
    expect(inspectLadderThsPayload({ timestamp: row.date_ms, item: [row] }, request).echoed).toEqual([])
  })
  it.each([null, NaN, '214930710'])('rejects missing or invalid volume %s', (volume) => {
    expect(inspectLadderThsPayload({ ...payload(), item: [{ ...row, volume }] }, request).errors).toContain('missing-or-nonfinite-ohlcv-turnover')
  })
  it('rejects duplicate bars and dates after the requested cutoff', () => {
    expect(inspectLadderThsPayload({ ...payload(), item: [row, row] }, request).errors).toContain('duplicate-or-unsorted-date')
    expect(inspectLadderThsPayload({ ...payload(), item: [{ ...row, date_ms: row.date_ms + 86400000 }] }, request).errors).toContain('bar-outside-request-window')
  })
  it('rejects invalid OHLC and absent target close', () => {
    expect(inspectLadderThsPayload({ ...payload(), item: [{ ...row, low_price: 6 }] }, request).errors).toContain('invalid-ohlcv-range')
    expect(inspectLadderThsPayload({ ...payload(), item: [] }, request).errors).toContain('target-close-missing')
  })
})

describe('THS against native frozen daily bars', () => {
  const bars = () => inspectLadderThsPayload(payload(), request).bars
  it('converts Tencent lots to shares, allowing one-lot rounding but marking missing turnover', () => {
    const result = compareLadderThsBars(bars(), [peer()], 'qfq')
    expect(result.ohlcvPass).toBe(true)
    expect(result.turnoverUncomparable).toBe(1)
    expect(result.fullParityPass).toBe(false)
  })
  it('does not infer units for unknown providers', () => {
    const result = compareLadderThsBars(bars(), [{ ...peer(), provider: 'unknown', volume: row.volume }], 'qfq')
    expect(result.ohlcvPass).toBe(false)
    expect(result.volumeUncomparable).toBe(1)
  })
  it('does not call legacy zero turnover a comparable zero trade', () => {
    expect(compareLadderThsBars(bars(), [{ ...peer(), turnover: 0 }], 'qfq').turnoverUncomparable).toBe(1)
  })
  it('reports price/volume mismatches and wrong adjustment independently', () => {
    const result = compareLadderThsBars(bars(), [{ ...peer(), close: 5.5, volume: 100, adjustment: 'raw' }], 'qfq')
    expect(result.errors).toContain('peer-adjustment-mismatch')
    expect(result.mismatches[0].fields).toEqual(['close', 'volume'])
    expect(result.ohlcvPass).toBe(false)
  })
  it('requires the same date coverage', () => {
    expect(compareLadderThsBars(bars(), [], 'qfq').ohlcvPass).toBe(false)
  })
})

describe('bounded research validation', () => {
  const evidence = { asof: request.tradeDate, klines: { '600121': [peer()] }, rawKlines: { '600121': [{ ...peer(), adjustment: 'raw' }] } }
  it('isolates failures and does not upgrade midpoint timestamps into formal evidence', async () => {
    let calls = 0
    const client: HithinkClient = { isConfigured: true, get: async <T>(_endpoint: string, params?: HithinkParams) => {
      calls++
      if (params?.adjust === 'none') throw new Error('sensitive upstream error')
      return { ok: true, data: payload() as T, rawBytes: new Uint8Array([1]), receivedAt: '2026-09-09T09:00:00Z', httpStatus: 200, code: 0, attempts: 1,
        message: null, requestId: null, body: payload(), rawText: JSON.stringify(payload()), jsonParsed: true, durationMs: 1 }
    } }
    const result = await validateLadderThs({ evidence, tradeDate: request.tradeDate, client })
    expect(calls).toBe(2)
    expect(result.summary).toMatchObject({ ohlcvAgrees: 1, unavailable: 1 })
    expect(result.providerAt).toBeNull()
    expect(result.eligibleAsTradeGate).toBe(false)
    expect(JSON.stringify(result)).not.toContain('sensitive')
  })
  it('does not request when key missing and rejects wrong evidence date', async () => {
    const client: HithinkClient = { isConfigured: false, get: async () => { throw new Error('should not request') } }
    expect((await validateLadderThs({ evidence, tradeDate: request.tradeDate, client })).summary.unavailable).toBe(2)
    await expect(validateLadderThs({ evidence, tradeDate: '2026-09-08', client })).rejects.toThrow('Evidence date mismatch')
  })
  it('keeps worker concurrency within the configured bound', async () => {
    let active = 0, maxActive = 0
    const client: HithinkClient = { isConfigured: true, get: async () => {
      active++; maxActive = Math.max(maxActive, active)
      await new Promise((done) => setTimeout(done, 1))
      active--
      throw new Error('unavailable')
    } }
    await validateLadderThs({ evidence: { ...evidence, klines: { ...evidence.klines, '000019': [peer()] } }, tradeDate: request.tradeDate, client, concurrency: 1 })
    expect(maxActive).toBe(1)
  })
})
