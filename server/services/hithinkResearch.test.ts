import { describe, expect, it } from 'vitest'
import { createHithinkFinanceClient } from '../market-data/hithinkFinanceClient'
import { createHithinkResearchService } from './hithinkResearch'

describe('Hithink research isolation', () => {
  it('preserves null and negative values, dates and source metadata; caches identical requests', async () => {
    let calls = 0
    const client = createHithinkFinanceClient({ apiKey: 'test', fetchImpl: async () => {
      calls++
      return new Response(JSON.stringify({ code: 0, request_id: 'r', data: { timestamp: 123, item: [{ thscode: '600519.SH', pe_ttm: -2, pb_mrq: null, report_date_ms: 100 }] } }))
    } })
    const get = createHithinkResearchService(client, 0)
    const [a, b] = await Promise.all([get('600519.sh'), get('600519.SH')])
    expect(a).toEqual(b)
    expect(await get('600519.SH')).toEqual(a)
    expect(calls).toBe(5)
    expect(a.eligibleAsTradeGate).toBe(false)
    expect(a.datasets[1]).toMatchObject({ status: 'unverified', asOf: null, data: { item: [{ pe_ttm: -2, pb_mrq: null, report_date_ms: 100 }] } })
  })

  it('does not turn business failures or wrong securities into empty success', async () => {
    let calls = 0
    const get = createHithinkResearchService(createHithinkFinanceClient({ apiKey: 'test', fetchImpl: async () => {
      calls++
      return new Response(JSON.stringify(calls === 1 ? { code: 1002, data: null } : { code: 0, data: { item: [{ thscode: '000001.SZ' }] } }))
    } }), 0)
    const result = await get('600519.SH')
    expect(result.datasets.every((row) => row.status === 'unavailable' && row.data === null)).toBe(true)
  })

  it('rejects ambiguous symbols and handles missing credentials without fetching', async () => {
    const get = createHithinkResearchService(createHithinkFinanceClient(), 0)
    await expect(get('600519')).rejects.toThrow('complete')
    expect((await get('600519.SH')).datasets.every((row) => row.reason === 'not-configured')).toBe(true)
  })
})
