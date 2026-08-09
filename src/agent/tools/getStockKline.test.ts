import { afterEach, describe, expect, it, vi } from 'vitest'
import { execute } from './getStockKline'

afterEach(() => vi.unstubAllGlobals())

describe('getStockKline HK', () => {
  it('routes HK aliases through the mixed-market kline endpoint', async () => {
    const payload = { name: '胜宏科技', klines: [{ date: '2026-08-07', close: 256.2 }] }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(execute({ stockCode: '02476', period: 101, count: 75 })).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('/api/stock/kline?code=HK2476&period=101&count=75')
  })
})
