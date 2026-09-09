import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fetchMock = vi.hoisted(() => vi.fn(async (_url: string, _options?: unknown) => new Response('{}')))
vi.mock('node-fetch', () => ({ default: fetchMock }))
beforeEach(() => { fetchMock.mockClear(); vi.stubEnv('SOCKS_PROXY', ''); vi.stubEnv('MARKET_DATA_HTTP_PROXY', 'http://127.0.0.1:10809') })
afterEach(() => vi.unstubAllEnvs())
import { fetchWithProxy } from './llm'

it('routes only market hosts through the explicit HTTP proxy', async () => {
  const signal = AbortSignal.timeout(1000)
  await fetchWithProxy('https://push2his.eastmoney.com/api/qt/stock/kline/get', { signal })
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ agent: expect.anything(), signal })
  await fetchWithProxy('https://api.openai.com/v1/responses')
  expect(fetchMock.mock.calls[1]?.[1]).not.toHaveProperty('agent')
  await fetchWithProxy('https://example.com/?url=eastmoney.com')
  expect(fetchMock.mock.calls[2]?.[1]).not.toHaveProperty('agent')
})
it('preserves direct fetching with no market proxy configured', async () => {
  vi.stubEnv('MARKET_DATA_HTTP_PROXY', '')
  await fetchWithProxy('https://push2his.eastmoney.com/api/qt/stock/kline/get')
  expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('agent')
})
