import { describe, expect, it } from 'vitest'
import { fetchThsWebHotList, parseThsWebHotList, ThsWebResponseError } from './web'

describe('THS web hot-list adapter', () => {
  it('preserves the hourly top-ten rank, tags and change semantics', async () => {
    const result = await fetchThsWebHotList({
      now: () => new Date('2026-09-07T10:00:00.000Z'),
      fetchImpl: async () => new Response(JSON.stringify({ data: { stock_list: [
        { code: '600519', name: 'fixture', rise_and_fall: '-2.3', tag: { concept_tag: ['消费'], popularity_tag: '热' } },
      ] } })),
    })
    expect(result).toMatchObject({ status: 'full', providerAt: null, data: [{ rank: 1, changePct: -2.3, tags: ['消费'], popularityTag: '热' }] })
  })

  it('distinguishes a confirmed empty list from malformed rows and responses', async () => {
    expect(parseThsWebHotList({ data: { stock_list: [] } })).toEqual([])
    expect(() => parseThsWebHotList({ data: { stock_list: [{ code: 'bad' }] } })).toThrow(ThsWebResponseError)
    await expect(fetchThsWebHotList({ fetchImpl: async () => new Response('broken-json') })).rejects.toThrow('valid JSON')
  })
})
