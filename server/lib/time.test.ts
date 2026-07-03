import { describe, it, expect } from 'vitest'
import { todayShanghai } from './time'

describe('todayShanghai', () => {
  it('UTC 15:59 仍是上海当日 23:59', () => {
    expect(todayShanghai(Date.parse('2026-07-03T15:59:00Z'))).toBe('2026-07-03')
  })

  it('UTC 16:00 起跨入上海次日', () => {
    expect(todayShanghai(Date.parse('2026-07-03T16:00:00Z'))).toBe('2026-07-04')
  })

  it('上海凌晨(UTC 前一日 16:00 后)不回退到前一天', () => {
    // 上海 2026-07-04 07:00 = UTC 2026-07-03 23:00,旧的双算实现在中国机器上会错报 07-03
    expect(todayShanghai(Date.parse('2026-07-03T23:00:00Z'))).toBe('2026-07-04')
  })

  it('跨年边界', () => {
    expect(todayShanghai(Date.parse('2025-12-31T16:00:00Z'))).toBe('2026-01-01')
  })

  it('缺省参数返回合法日期格式', () => {
    expect(todayShanghai()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
