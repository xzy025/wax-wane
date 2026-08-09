import { afterEach, describe, expect, it, vi } from 'vitest'
import { execute } from './getStockQuote'

afterEach(() => vi.unstubAllGlobals())

describe('getStockQuote HK', () => {
  it('routes HK aliases to the HK quote API and unwraps the quote', async () => {
    const quote = { code: '02476', name: '胜宏科技', price: 256.2 }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ quotes: [quote] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(execute({ stockCode: 'HK2476' })).resolves.toEqual(quote)
    expect(fetchMock).toHaveBeenCalledWith('/api/hk/quote?codes=02476')
  })
})
