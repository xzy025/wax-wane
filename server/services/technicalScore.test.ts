import { describe, it, expect } from 'vitest'
import { technicalCombo, techMult } from './technicalScore'
import { TECH } from '../config/screener'
import type { Bar } from './screenerRules'

const dt = (i: number) => `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`

// 合成 60 根上涨趋势基底,today 由 flag 决定形态。
function mkBars(o: {
  today?: 'distribution' | 'sos' | 'pullback' | 'quiet'
} = {}): Bar[] {
  const N = 60
  const bars: Bar[] = []
  for (let i = 0; i < N - 1; i++) {
    const c = 10 * Math.pow(1.005, i) // 缓慢上行
    bars.push({ date: dt(i), open: i > 0 ? bars[i - 1].close : c, close: c, high: c * 1.01, low: c * 0.99, volume: 1000 })
  }
  const last = N - 1
  const P = bars[last - 1].close
  let bar: Bar
  switch (o.today) {
    case 'distribution': // 大族式:一字高开 → 放量阴线收阴于前高(出货)
      bar = { date: dt(last), open: P * 1.03, close: P * 0.985, high: P * 1.035, low: P * 0.98, volume: 2600 }
      break
    case 'sos': // 放量收强阳线(SOS 需求)
      bar = { date: dt(last), open: P * 1.0, close: P * 1.04, high: P * 1.045, low: P * 0.998, volume: 2600 }
      break
    case 'pullback': // 缩量回调健康(no supply)
      bar = { date: dt(last), open: P * 1.005, close: P * 0.995, high: P * 1.008, low: P * 0.99, volume: 600 }
      break
    default: // quiet:小幅平淡
      bar = { date: dt(last), open: P, close: P * 1.002, high: P * 1.006, low: P * 0.997, volume: 1000 }
  }
  bars.push(bar)
  return bars
}

describe('technicalCombo', () => {
  it('大族式放量阴线收阴于前高 → distribution + 供给 + 压低分', () => {
    const ta = technicalCombo(mkBars({ today: 'distribution' }), '300567', TECH)
    expect(ta.distribution).toBe(true)
    expect(ta.bias).toBe('supply')
    expect(ta.score01).toBeLessThan(0.5)
    expect(ta.tags.some((t) => t.includes('放量阴线') || t.includes('高开低走'))).toBe(true)
  })

  it('放量收强阳线(SOS)→ 需求 + 抬高分,无派发', () => {
    const ta = technicalCombo(mkBars({ today: 'sos' }), '300567', TECH)
    expect(ta.bias).toBe('demand')
    expect(ta.score01).toBeGreaterThan(0.5)
    expect(ta.distribution).toBe(false)
    expect(ta.tags).toContain('SOS·放量收强')
  })

  it('缩量回调健康 → 非派发', () => {
    const ta = technicalCombo(mkBars({ today: 'pullback' }), '300567', TECH)
    expect(ta.distribution).toBe(false)
  })

  it('数据不足 → 中性 0.5', () => {
    const ta = technicalCombo(mkBars().slice(-20), '300567', TECH)
    expect(ta.score01).toBe(0.5)
    expect(ta.bias).toBe('neutral')
  })

  it('techMult:供给压低、需求抬高', () => {
    expect(techMult(0, TECH)).toBeCloseTo(TECH.MULT_MIN, 5) // 0 → MULT_MIN
    expect(techMult(1, TECH)).toBeCloseTo(TECH.MULT_MAX, 5) // 1 → MULT_MAX
    expect(techMult(0.5, TECH)).toBeCloseTo((TECH.MULT_MIN + TECH.MULT_MAX) / 2, 5) // 中性 → 1.0
  })
})
