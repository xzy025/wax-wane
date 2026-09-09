import { describe, expect, it, vi } from 'vitest'
import {
  type HithinkConfig,
  type HithinkFetch,
  compareHithinkDailyBars,
  createHithinkFinanceClient,
  normalizeHithinkDailyBars,
  probeHithinkCapabilities,
  readHithinkConfigFromEnv,
  renderHithinkCapabilityMatrix,
} from './hithinkFinanceClient'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response
}

function config(overrides: Partial<HithinkConfig> = {}): HithinkConfig {
  return {
    baseUrl: 'https://fuyao.aicubes.cn',
    apiKey: undefined,
    codes: ['000001.SZ', '600519.SH'],
    indexCode: '886042.TI',
    startDate: '2025-01-01',
    endDate: '2026-09-07',
    timeoutMs: 1000,
    requestGapMs: 0,
    maxRetries: 1,
    ...overrides,
  }
}

describe('Financial-API client and research probe', () => {
  it('reads safe defaults and validates stock/index configuration', () => {
    const read = readHithinkConfigFromEnv({
      HITHINK_FINANCE_CODES: '000001.sz, 600519.SH',
      HITHINK_FINANCE_INDEX_CODE: '886042.ti',
      HITHINK_FINANCE_START_DATE: '2025-01-01',
      HITHINK_FINANCE_END_DATE: '2026-09-07',
      HITHINK_FINANCE_REQUEST_GAP_MS: '0',
    })
    expect(read.codes).toEqual(['000001.SZ', '600519.SH'])
    expect(read.indexCode).toBe('886042.TI')
    expect(read.apiKey).toBeUndefined()
    expect(read.requestGapMs).toBe(0)
  })

  it('does not call the network without an API key', async () => {
    const fetchImpl = vi.fn() as unknown as HithinkFetch
    const matrix = await probeHithinkCapabilities({ config: config(), fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(matrix.configured).toBe(false)
    expect(matrix.eligibleAsTradeGate).toBe(false)
    expect(matrix.results.length).toBe(16)
    expect(new Set(matrix.results.map((item) => item.status))).toEqual(new Set(['not-configured']))
  })

  it('requires code=0 in addition to HTTP 200 and builds a GET request safely', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = []
    const fetchImpl: HithinkFetch = async (input, init) => {
      calls.push({ input, init })
      return response({ code: 0, message: 'ok', request_id: 'req-1', data: { item: [{ value: 1 }] } })
    }
    const client = createHithinkFinanceClient({
      baseUrl: 'https://fuyao.aicubes.cn',
      apiKey: 'secret-key',
      fetchImpl,
      maxRetries: 0,
    })
    const result = await client.get('/api/a-share/prices/snapshot', { thscodes: '600519.SH', limit: 1 })
    expect(result.ok).toBe(true)
    expect(result.code).toBe(0)
    expect(result.requestId).toBe('req-1')
    expect(calls[0].input).toContain('/api/a-share/prices/snapshot?')
    expect(calls[0].input).toContain('thscodes=600519.SH')
    expect(calls[0].input).toContain('limit=1')
    expect(calls[0].init?.method).toBe('GET')
    expect((calls[0].init?.headers as Record<string, string>)['X-api-key']).toBe('secret-key')
  })

  it('retries bounded rate limits and classifies not-ready separately from empty', async () => {
    let calls = 0
    const slept: number[] = []
    const fetchImpl: HithinkFetch = async () => {
      calls += 1
      if (calls === 1) return response({ code: 4001, message: 'rate limited', data: null })
      return response({ code: 0, message: 'ok', data: { item: [] } })
    }
    const matrix = await probeHithinkCapabilities({
      config: config({ apiKey: 'secret-key', maxRetries: 1 }),
      fetchImpl,
      sleepImpl: async (ms) => { slept.push(ms) },
    })
    expect(calls).toBeGreaterThan(1)
    expect(slept.length).toBeGreaterThan(0)
    expect(matrix.results[0].status).toBe('empty')

    const notReadyClient = createHithinkFinanceClient({
      baseUrl: 'https://fuyao.aicubes.cn',
      apiKey: 'secret-key',
      fetchImpl: async () => response({ code: 3002, message: 'not ready', data: null }),
      maxRetries: 0,
    })
    const notReady = await notReadyClient.get('/api/a-share/prices/historical')
    expect(notReady.ok).toBe(false)
    expect(notReady.code).toBe(3002)
  })

  it('normalizes daily bars and reports field-level parity without manufacturing units', () => {
    const hithink = normalizeHithinkDailyBars({
      item: [
        { date_ms: Date.parse('2026-09-01T00:00:00.000Z'), open_price: 10, high_price: 11, low_price: 9, close_price: 10.5, volume: 1000, turnover: 10500 },
        { date_ms: Date.parse('2026-09-02T00:00:00.000Z'), open_price: 10.5, high_price: 12, low_price: 10, close_price: 11.5, volume: 1200, turnover: 13800 },
      ],
    })
    const peer = hithink.map((bar) => ({ ...bar }))
    const pass = compareHithinkDailyBars(hithink, peer, { adjustment: 'none' })
    expect(pass.pass).toBe(true)
    expect(pass.comparedCount).toBe(2)
    expect(pass.volumeUnit).toBe('unknown')

    const mismatch = compareHithinkDailyBars(hithink, [{ ...peer[0], close: 10.4 }], { adjustment: 'none' })
    expect(mismatch.pass).toBe(false)
    expect(mismatch.mismatchCounts.close).toBe(1)
    expect(mismatch.missingInPeer).toEqual(['2026-09-02'])
  })

  it('redacts signed URLs from the rendered probe report', async () => {
    const matrix = await probeHithinkCapabilities({
      config: config({ apiKey: 'secret-key', maxRetries: 0 }),
      fetchImpl: async () => response({ code: 0, data: { presigned_url: 'https://s3.example.test/signed-secret', expires_at: '2026-09-07T00:00:00Z' } }),
    })
    const markdown = renderHithinkCapabilityMatrix(matrix)
    expect(markdown).toContain('Research-only')
    expect(markdown).not.toContain('signed-secret')
    expect(markdown).not.toContain('secret-key')
  })
})
