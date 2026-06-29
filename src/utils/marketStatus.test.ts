import { describe, it, expect } from 'vitest'
import { getMarketStatus, isPostCloseReview } from './marketStatus'

// 本地时间构造(getMarketStatus 用 getDay/getHours/getMinutes 均本地)。
// 2026-06-29=周一,06-27=周六,06-28=周日(月份索引 5=六月)。
const status = (y: number, mo: number, d: number, h: number, mi: number) =>
  getMarketStatus(new Date(y, mo, d, h, mi))

describe('getMarketStatus phases', () => {
  it('工作日各时段相位正确', () => {
    expect(status(2026, 5, 29, 10, 0).phase).toBe('open') // 周一 10:00
    expect(status(2026, 5, 29, 12, 0).phase).not.toBe('open') // 午休非盘中
    expect(status(2026, 5, 29, 16, 0).phase).toBe('afterMarket') // 周一 16:00
    expect(status(2026, 5, 29, 9, 20).phase).toBe('preMarket')
    expect(status(2026, 5, 27, 11, 0).phase).toBe('weekend') // 周六
  })
})

describe('isPostCloseReview — 日终复盘门控', () => {
  it('工作日 15:00 后 → true', () => {
    expect(isPostCloseReview(status(2026, 5, 29, 16, 0))).toBe(true) // 周一盘后
  })
  it('周末任意时刻 → true', () => {
    expect(isPostCloseReview(status(2026, 5, 27, 11, 0))).toBe(true) // 周六
    expect(isPostCloseReview(status(2026, 5, 28, 16, 0))).toBe(true) // 周日
  })
  it('盘中 → false', () => {
    expect(isPostCloseReview(status(2026, 5, 29, 10, 0))).toBe(false) // 周一 10:00
  })
  it('午休 11:30-13:00 → false(全天未收盘)', () => {
    expect(isPostCloseReview(status(2026, 5, 29, 12, 0))).toBe(false) // 周一 12:00
  })
  it('盘前/早盘 → false', () => {
    expect(isPostCloseReview(status(2026, 5, 29, 9, 20))).toBe(false) // preMarket
    expect(isPostCloseReview(status(2026, 5, 29, 8, 0))).toBe(false) // beforeOpen
  })
})
