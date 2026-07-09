import { describe, it, expect } from 'vitest'
import { buildPioneers, pickBrokerageBoard } from './reboundReview'
import { REBOUND } from '../config/screener'
import type { LimitStock } from './ashare'
import type { BoardMeta } from './rotation'

const mkStock = (o: Partial<LimitStock>): LimitStock => ({
  code: '600000',
  name: '样例',
  price: 10,
  changePct: 10,
  turnoverRate: 5,
  amount: 1e9,
  firstTime: '',
  lastTime: '',
  openCount: 0,
  consecutiveDays: 1,
  industry: '行业',
  ...o,
})

describe('buildPioneers', () => {
  it('EM 池:按首次封板时间升序(时间轴),fbtAvailable=true', () => {
    const { pioneers, fbtAvailable } = buildPioneers(
      [
        mkStock({ code: 'B', firstTime: '133000' }),
        mkStock({ code: 'A', firstTime: '93500' }), // 9:35(HHMMSS 不足6位补零后最早)
        mkStock({ code: 'C', firstTime: '101500' }),
      ],
      REBOUND,
    )
    expect(fbtAvailable).toBe(true)
    expect(pioneers.map((p) => p.code)).toEqual(['A', 'C', 'B'])
  })

  it('剔除高位连板(> PIONEER_LB_MAX);首/二板保留', () => {
    const { pioneers } = buildPioneers(
      [
        mkStock({ code: 'LB1', consecutiveDays: 1, firstTime: '93000' }),
        mkStock({ code: 'LB2', consecutiveDays: 2, firstTime: '93100' }),
        mkStock({ code: 'LB5', consecutiveDays: 5, firstTime: '92500' }), // 妖股,封最早也不进
      ],
      REBOUND,
    )
    expect(pioneers.map((p) => p.code)).toEqual(['LB1', 'LB2'])
  })

  it('Sina 兜底池(fbt 全空,lbc 全0):fbtAvailable=false,按成交额降序', () => {
    const { pioneers, fbtAvailable } = buildPioneers(
      [
        mkStock({ code: 'S1', consecutiveDays: 0, amount: 1e8 }),
        mkStock({ code: 'S2', consecutiveDays: 0, amount: 5e8 }),
      ],
      REBOUND,
    )
    expect(fbtAvailable).toBe(false)
    expect(pioneers.map((p) => p.code)).toEqual(['S2', 'S1'])
  })

  it('容量截断 PIONEER_MAX', () => {
    const many = Array.from({ length: 30 }, (_, i) => mkStock({ code: `C${i}`, firstTime: String(93000 + i) }))
    expect(buildPioneers(many, REBOUND).pioneers.length).toBe(REBOUND.PIONEER_MAX)
  })

  it('空池:空数组 + fbtAvailable=false', () => {
    const { pioneers, fbtAvailable } = buildPioneers([], REBOUND)
    expect(pioneers).toEqual([])
    expect(fbtAvailable).toBe(false)
  })
})

describe('pickBrokerageBoard', () => {
  const mk = (name: string): BoardMeta => ({ code: 'BK0473', name, todayChg: 3.2, amount: 1e10 })

  it('按名字命中「证券」', () => {
    expect(pickBrokerageBoard([mk('黄金'), mk('证券'), mk('银行')])?.name).toBe('证券')
  })

  it('无券商板块 → null', () => {
    expect(pickBrokerageBoard([mk('黄金'), mk('银行')])).toBeNull()
  })
})
