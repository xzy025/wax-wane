import { describe, expect, it } from 'vitest'
import { createHithinkFinanceClient } from '../market-data/hithinkFinanceClient'
import { createHithinkMarketResearch, parseMarketResearchRequest } from './hithinkResearchMarket'

function service(responses: unknown[]) {
  let calls = 0
  const get = createHithinkMarketResearch(createHithinkFinanceClient({ apiKey: 'test', fetchImpl: async () => {
    const data = responses[calls++]
    return new Response(JSON.stringify({ code: 0, data }))
  } }), 0)
  return { get, calls: () => calls }
}
const row = (index: number) => ({ thscode: `${String(index).padStart(6, '0')}.SZ`, name: 'fixture' })
describe('Hithink market research', () => {
  it('assembles every page and coalesces repeated requests without promoting eligibility', async () => {
    const s = service([{ item: Array.from({ length: 200 }, (_, i) => row(i)), pagination: { total: 201, pages: 2, page: 1, size: 200 } },
      { item: [row(200)], pagination: { total: 201, pages: 2, page: 2, size: 200 } }])
    const q = { dataset: 'limit-up-pool', date: '2026-09-04' }
    const [a, b] = await Promise.all([s.get(q), s.get(q)])
    expect(a).toEqual(b)
    expect(a).toMatchObject({ status: 'unverified', paginationComplete: true, eligibleAsTradeGate: false, coverage: null })
    expect(a.data?.item).toHaveLength(201)
    await s.get(q)
    expect(s.calls()).toBe(2)
  })
  it('rejects duplicate records and truncated or changing pagination', async () => {
    for (const second of [
      { item: [row(0)], pagination: { total: 201, pages: 2, page: 2, size: 200 } },
      { item: [], pagination: { total: 201, pages: 2, page: 2, size: 200 } },
      { item: [row(200)], pagination: { total: 202, pages: 2, page: 2, size: 200 } },
    ]) {
      const s = service([{ item: Array.from({ length: 200 }, (_, i) => row(i)), pagination: { total: 201, pages: 2, page: 1, size: 200 } }, second])
      expect(await s.get({ dataset: 'limit-up-pool', date: '2026-09-04' })).toMatchObject({ status: 'unavailable', data: null, paginationComplete: false })
    }
  })
  it('rejects historical arguments for current-only datasets and impossible dates', () => {
    for (const q of [{ dataset: 'hotlist', period: 'day', date: '2026-09-04' }, { dataset: 'limit-up-pool', date: '2026-02-30' }, { dataset: 'constituents', thscode: '886042' }]) {
      expect(() => parseMarketResearchRequest(q)).toThrow()
    }
  })
  it('preserves empty success but rejects invalid rankings', async () => {
    expect(await service([{ item: [] }]).get({ dataset: 'hotlist', period: 'day' })).toMatchObject({ status: 'empty', data: { item: [] } })
    expect(await service([{ item: [{ ...row(1), rank: null }] }]).get({ dataset: 'hotlist', period: 'day' })).toMatchObject({ status: 'unavailable', data: null })
  })
})
