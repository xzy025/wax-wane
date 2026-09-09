import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ em: vi.fn(), proxy: vi.fn() }))
vi.mock('../lib/emFetch', () => ({ emFetch: mocks.em }))
vi.mock('../lib/llm', () => ({ fetchWithProxy: mocks.proxy }))
beforeEach(() => { vi.resetModules(); mocks.em.mockReset(); mocks.proxy.mockReset() })
it('marks Tencent plain fallback raw and missing amount null', async () => {
  mocks.em.mockRejectedValue(new Error('offline'))
  mocks.proxy.mockResolvedValue(new Response(JSON.stringify({ data: { sz000001: { day: [['2026-09-07', '10', '11', '12', '9', '100']] } } })))
  const { fetchStockKline } = await import('./ashare')
  const result = await fetchStockKline('000001', 101, 1)
  expect(result.adjustment).toBe('raw')
  expect(result.klines[0]).toMatchObject({ adjustment: 'raw', provider: 'tencent', turnover: null })
})
it('never substitutes daily bars for missing minutes', async () => {
  mocks.em.mockRejectedValue(new Error('offline'))
  const { fetchStockKline } = await import('./ashare')
  await expect(fetchStockKline('000001', 15, 40)).rejects.toThrow('intraday')
  expect(mocks.proxy).not.toHaveBeenCalled()
})
it('identifies Tencent evidence and never substitutes quote, HTTP, or bar times for publication time', async () => {
  mocks.em.mockRejectedValue(new Error('offline'))
  const quote = Array.from({ length: 31 }, () => '')
  quote[30] = '20260908150000'
  mocks.proxy.mockResolvedValue(new Response(JSON.stringify({ data: { sz000001: {
    qfqday: [['2026-09-08', '10', '11', '12', '9', '100']], qt: { sz000001: quote },
  } } }), { headers: { Date: 'Tue, 08 Sep 2026 07:30:00 GMT' } }))
  const { fetchStockKline } = await import('./ashare')
  const result = await fetchStockKline('000001', 101, 1)
  expect(result).toMatchObject({ provider: 'tencent', providerAt: null, endpointVersion: 'tencent-fqkline-v1' })
  expect(result.klines[0].providerAt).toBeNull()
  expect(result.evidence).toMatchObject({ providerAt: null, endpointVersion: 'tencent-fqkline-v1' })
  expect(result.evidence?.missingReasons).toContain('provider-time-unavailable:tencent')
  expect(result.receivedAt).toBeTruthy()
})
it('identifies Sina fallback evidence independently of Eastmoney', async () => {
  mocks.em.mockRejectedValue(new Error('offline'))
  mocks.proxy.mockResolvedValueOnce(new Response('{}', { status: 503 }))
  mocks.proxy.mockResolvedValueOnce(new Response(JSON.stringify([
    { day: '2026-09-08', open: '10', close: '11', high: '12', low: '9', volume: '100' },
  ])))
  const { fetchStockKline } = await import('./ashare')
  const result = await fetchStockKline('000001', 101, 1)
  expect(result).toMatchObject({ provider: 'sina', providerAt: null, endpointVersion: 'sina-get-kline-data-v1' })
  expect(result.evidence?.endpointVersion).toBe(result.endpointVersion)
  expect(result.warnings).toContain('provider-time-unavailable:sina')
})
it('research Eastmoney-only requests do not fall through to unrelated providers', async () => {
  mocks.em.mockRejectedValue(new Error('offline'))
  const { fetchStockKline } = await import('./ashare')
  const result = await fetchStockKline('000001', 101, 300, { eastmoneyOnly: true })
  expect(result.klines).toEqual([])
  expect(result.warnings).toContain('eastmoney-unavailable-or-cooldown')
  expect(mocks.proxy).not.toHaveBeenCalled()
})
