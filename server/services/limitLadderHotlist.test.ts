import { describe, expect, it } from 'vitest'
import { createComponentQuality } from '../market-data/dataQuality'
import type { HotListData } from './hotlist'
import { buildHotRankMap } from './limitLadder'

function hotList(thsStatus: HotListData['sourceStatus']['ths']['status']): HotListData {
  return {
    eastmoney: [{ rank: 1, code: '000001', name: 'east', changePct: 1, tags: [] }],
    ths: [{ rank: 2, code: '600519', name: 'ths', changePct: 2, tags: [] }],
    dragonTiger: [],
    sourceStatus: {
      eastmoney: createComponentQuality('eastmoney', { source: 'eastmoney', status: 'full' }),
      ths: createComponentQuality('ths', { source: 'ths-web-hotlist', status: thsStatus }),
      dragonTiger: createComponentQuality('dragonTiger', { source: 'dragon-tiger', status: 'empty' }),
    },
  }
}

describe('limit ladder hot-list evidence', () => {
  it('keeps normal THS rank evidence unchanged', () => {
    expect(buildHotRankMap(hotList('full')).get('600519')).toMatchObject({ thsRank: 2 })
  })

  it('excludes unavailable THS data without discarding valid EastMoney evidence', () => {
    const ranks = buildHotRankMap(hotList('unavailable'))
    expect(ranks.get('600519')).toBeUndefined()
    expect(ranks.get('000001')).toMatchObject({ eastmoneyRank: 1 })
  })
})
