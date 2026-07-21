import { describe, it, expect } from 'vitest'
import {
  buildHoldingTAFromBars,
  codesKey,
  diffHoldingTA,
  isHoldingsTAResult,
  isSettledClock,
  parseHoldingsTaArchiveName,
  pickPrevArchiveName,
  shouldReplaceHoldingsArchive,
  type HoldingTAItem,
  type HoldingsTAResult,
} from './holdingsTARules'
import type { Bar } from './screenerRules'

const dt = (i: number) =>
  `2025-${String(1 + Math.floor(i / 28) % 12).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`

/** 合成 N 根缓升趋势基底(同 technicalScore.test.ts 的 mkBars 口径)。 */
function mkBars(n: number): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < n; i++) {
    const c = 10 * Math.pow(1.005, i)
    bars.push({ date: dt(i), open: i > 0 ? bars[i - 1].close : c, close: c, high: c * 1.01, low: c * 0.99, volume: 1000 })
  }
  return bars
}

describe('buildHoldingTAFromBars', () => {
  it('300 根上涨趋势:全字段有值、多头排列可判、档位有序', () => {
    const bars = mkBars(300)
    const item = buildHoldingTAFromBars('600176', '中国巨石', bars)
    expect(item).not.toBeNull()
    const it_ = item!
    expect(it_.code).toBe('600176')
    expect(it_.date).toBe(bars[bars.length - 1].date)
    // MA 五值全部为正且缓升序:短均 > 长均
    expect(it_.ma.ma5).toBeGreaterThan(it_.ma.ma20)
    expect(it_.ma.ma20).toBeGreaterThan(it_.ma.ma60)
    expect(it_.ma.ma250).toBeGreaterThan(0)
    expect(it_.aboveMa.ma5).toBe(true)
    expect(it_.aboveMa.ma250).toBe(true)
    // 缓升趋势:多头排列过、贴近 52 周高
    expect(it_.trendTemplateOk).toBe(true)
    expect(it_.dist52Pct).toBeGreaterThanOrEqual(0)
    expect(it_.dist52Pct).toBeLessThan(5)
    expect(it_.rsRaw).toBeGreaterThan(0)
    // 档位:ATR 止损在收盘下方、枢轴有序
    expect(it_.atrStop).toBeLessThan(it_.close)
    expect(it_.pivots.s2).toBeLessThan(it_.pivots.s1)
    expect(it_.pivots.s1).toBeLessThan(it_.pivots.r1)
    expect(it_.pivots.r1).toBeLessThan(it_.pivots.r2)
    expect(it_.volRatio).toBeGreaterThan(0)
    expect(it_.breakoutVolRatio).toBeGreaterThan(0)
    expect(it_.combo.score01).toBeGreaterThanOrEqual(0)
    expect(it_.combo.score01).toBeLessThanOrEqual(1)
    expect(it_.delta).toBeNull()
  })

  it('60 根次新:多头排列不可判 null、MA250 缺值不误报站上、rsRaw 退化不 NaN', () => {
    const item = buildHoldingTAFromBars('301000', '次新股', mkBars(60))!
    expect(item.trendTemplateOk).toBeNull()
    expect(item.ma.ma250).toBe(0)
    expect(item.aboveMa.ma250).toBe(false)
    expect(Number.isFinite(item.rsRaw)).toBe(true)
    expect(item.combo).toBeDefined()
  })

  it('bars < 2 → null(调用方标 error)', () => {
    expect(buildHoldingTAFromBars('000001', 'x', mkBars(1))).toBeNull()
    expect(buildHoldingTAFromBars('000001', 'x', [])).toBeNull()
  })
})

describe('diffHoldingTA', () => {
  const base = buildHoldingTAFromBars('600176', '中国巨石', mkBars(300))!

  it('失守 MA5 + 评分下滑 + 新增派发 → 全部进 delta', () => {
    const prev: HoldingTAItem = {
      ...base,
      combo: { ...base.combo, score01: 0.62, bias: 'demand', distribution: false, wyckoffPhase: '标记上涨' },
      aboveMa: { ...base.aboveMa, ma5: true },
      relStrength: 1.5,
    }
    const cur: HoldingTAItem = {
      ...base,
      combo: { ...base.combo, score01: 0.41, bias: 'supply', distribution: true, wyckoffPhase: '派发' },
      aboveMa: { ...base.aboveMa, ma5: false },
      relStrength: -0.5,
      volRatio: base.volRatio + 0.3,
    }
    const d = diffHoldingTA(prev, cur, '2026-07-18')
    expect(d.prevDate).toBe('2026-07-18')
    expect(d.score01).toBeCloseTo(-0.21, 5)
    expect(d.biasChanged).toEqual({ from: 'demand', to: 'supply' })
    expect(d.wyckoffChanged).toEqual({ from: '标记上涨', to: '派发' })
    expect(d.distributionNew).toBe(true)
    expect(d.maCrossings).toContain('lost:ma5')
    expect(d.relStrengthDelta).toBeCloseTo(-2, 5)
    expect(d.volRatioDelta).toBeCloseTo(0.3, 5)
  })

  it('重新站上 → regain;缺 MA 值不算穿越;relStrength 缺失 → null', () => {
    const prev: HoldingTAItem = { ...base, aboveMa: { ...base.aboveMa, ma20: false }, ma: { ...base.ma, ma250: 0 } }
    const cur: HoldingTAItem = { ...base, aboveMa: { ...base.aboveMa, ma20: true, ma250: false } }
    const d = diffHoldingTA(prev, cur, '2026-07-18')
    expect(d.maCrossings).toContain('regain:ma20')
    expect(d.maCrossings.some((c) => c.endsWith('ma250'))).toBe(false) // prev 缺值
    expect(d.relStrengthDelta).toBeNull()
    expect(d.distributionNew).toBe(false)
  })
})

describe('isSettledClock', () => {
  it('周末恒定盘;工作日盘前定盘、[09:15,15:10) live、15:10 起定盘', () => {
    expect(isSettledClock({ day: 0, minutes: 600 })).toBe(true)
    expect(isSettledClock({ day: 6, minutes: 600 })).toBe(true)
    expect(isSettledClock({ day: 1, minutes: 9 * 60 + 14 })).toBe(true) // 盘前=昨日定盘
    expect(isSettledClock({ day: 1, minutes: 9 * 60 + 15 })).toBe(false) // 集合竞价起 live
    expect(isSettledClock({ day: 5, minutes: 15 * 60 + 9 })).toBe(false)
    expect(isSettledClock({ day: 5, minutes: 15 * 60 + 10 })).toBe(true)
  })
})

describe('存档名解析与选取', () => {
  it('严格前缀:不捡走 screener 快照/review 档', () => {
    expect(parseHoldingsTaArchiveName('holdings-ta-2026-07-21.json')).toEqual({
      filename: 'holdings-ta-2026-07-21.json',
      date: '2026-07-21',
    })
    expect(parseHoldingsTaArchiveName('2026-07-21.json')).toBeNull()
    expect(parseHoldingsTaArchiveName('review-2026-07-21.json')).toBeNull()
    expect(parseHoldingsTaArchiveName('holdings-ta-2026-7-1.json')).toBeNull()
  })

  it('pickPrevArchiveName:最近一份早于信号日', () => {
    const files = [
      'holdings-ta-2026-07-16.json',
      'holdings-ta-2026-07-18.json',
      'holdings-ta-2026-07-21.json',
      'review-2026-07-20.json',
      '2026-07-19.json',
    ]
    expect(pickPrevArchiveName(files, '2026-07-21')?.date).toBe('2026-07-18')
    expect(pickPrevArchiveName(files, '2026-07-16')).toBeNull()
  })
})

describe('codesKey / 覆盖守卫 / 形状守卫', () => {
  const mkResult = (codes: string[], errs = 0): HoldingsTAResult => ({
    date: '2026-07-21',
    generatedAt: '2026-07-21T15:20:00.000Z',
    settled: true,
    prevDate: null,
    benchmarks: { hs300: 0, chinext: 0, star50: 0 },
    items: codes.map((code, i) => {
      const base = buildHoldingTAFromBars(code, code, mkBars(60))!
      return i < errs ? { ...base, error: '取数失败' } : base
    }),
    narrative: null,
  })

  it('codesKey 排序去重', () => {
    expect(codesKey(['600176', '000981', '600176'])).toBe('000981,600176')
  })

  it('覆盖守卫:无旧档/持仓变化放行;成功票数倒退拒绝', () => {
    const full = mkResult(['000981', '600176'])
    const degraded = mkResult(['000981', '600176'], 1)
    expect(shouldReplaceHoldingsArchive(null, degraded)).toBe(true)
    expect(shouldReplaceHoldingsArchive(full, degraded)).toBe(false) // 降级不覆盖
    expect(shouldReplaceHoldingsArchive(degraded, full)).toBe(true)
    expect(shouldReplaceHoldingsArchive(full, mkResult(['000981']))).toBe(true) // 减仓 → codes 变化放行
  })

  it('isHoldingsTAResult 守卫', () => {
    expect(isHoldingsTAResult(mkResult(['600176']))).toBe(true)
    expect(isHoldingsTAResult({ date: '2026-07-21' })).toBe(false)
    expect(isHoldingsTAResult(null)).toBe(false)
  })
})
