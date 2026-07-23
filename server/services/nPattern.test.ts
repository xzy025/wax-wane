import { describe, it, expect } from 'vitest'
import { analyzeNPattern, nStrengthLabel, zigzagPivots } from './nPattern'
import type { Bar } from './screenerRules'

const dt = (i: number) =>
  `2025-${String(1 + (Math.floor(i / 28) % 12)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`

/** 顺序拼接波段的合成 K 线:每段 days 根,总涨跌 totalPct%,窄振幅(±0.3%)压低 ATR → zigzag 阈值≈5%。 */
function build(segs: Array<{ days: number; pct: number }>, start = 20): Bar[] {
  const bars: Bar[] = [
    { date: dt(0), open: start, close: start, high: start * 1.003, low: start * 0.997, volume: 1000 },
  ]
  let price = start
  let i = 1
  for (const s of segs) {
    const step = Math.pow(1 + s.pct / 100, 1 / s.days)
    for (let d = 0; d < s.days; d++, i++) {
      const prevClose = price
      price *= step
      bars.push({
        date: dt(i),
        open: prevClose,
        close: price,
        high: Math.max(prevClose, price) * 1.003,
        low: Math.min(prevClose, price) * 0.997,
        volume: 1000,
      })
    }
  }
  return bars
}

// 缓降前缀:让段前最低点收在前缀末尾,波段起点/天数可控
const fallPrefix = { days: 30, pct: -0.6 }
// 缓升前缀:让段前最高点收在前缀末尾
const risePrefix = { days: 30, pct: 0.6 }

describe('zigzagPivots', () => {
  it('升-跌-升交替出枢轴,idx 落在极值处', () => {
    const bars = build([fallPrefix, { days: 10, pct: 20 }, { days: 6, pct: -8 }, { days: 8, pct: 15 }])
    const pivots = zigzagPivots(bars, 5)
    expect(pivots.length).toBeGreaterThanOrEqual(3)
    const kinds = pivots.map((p) => p.kind).join('')
    expect(kinds.includes('LH')).toBe(true)
    for (let i = 1; i < pivots.length; i++) expect(pivots[i].kind).not.toBe(pivots[i - 1].kind)
  })

  it('波动不足阈值 → 无枢轴', () => {
    expect(zigzagPivots(build([{ days: 60, pct: 2 }]), 5)).toEqual([])
  })
})

describe('analyzeNPattern · 角度与分级', () => {
  it('上升N·缓速回挡 → H段·强势回挡·A级·6-8窗·无异动', () => {
    const bars = build([fallPrefix, { days: 10, pct: 20 }, { days: 6, pct: -6.5 }])
    const r = analyzeNPattern(bars)!
    expect(r).not.toBeNull()
    expect(r.role).toBe('H')
    expect(r.strength).toBe('strong')
    expect(r.grade).toBe('A')
    expect(r.inWindow).toBe('6-8')
    expect(r.active.days).toBe(6)
    expect(r.anomaly).toBeNull()
    expect(r.nTarget).toBeNull()
    expect(r.note).toContain('强势回挡')
  })

  it('急坠回挡(跌速>前升速) → 弱势回挡·C级', () => {
    const bars = build([fallPrefix, { days: 12, pct: 12 }, { days: 3, pct: -8 }])
    const r = analyzeNPattern(bars)!
    expect(r.role).toBe('H')
    expect(r.strength).toBe('weak')
    expect(r.grade).toBe('C')
  })

  it('数据不足/波动过小 → null', () => {
    expect(analyzeNPattern(build([{ days: 5, pct: 1 }]))).toBeNull()
    expect(analyzeNPattern(build([{ days: 60, pct: 2 }]))).toBeNull()
  })
})

describe('analyzeNPattern · N字延续与对称投射', () => {
  it('升-回挡守起点-再升过前高 → nBreak + nTarget=回挡低点×(1+前升幅)', () => {
    const bars = build([fallPrefix, { days: 8, pct: 12 }, { days: 4, pct: -6 }, { days: 4, pct: 14 }])
    const r = analyzeNPattern(bars)!
    expect(r.role).toBe('F')
    expect(r.nBreak).toBe(true)
    expect(r.nTarget).not.toBeNull()
    // 投射 = 回挡低点枢轴价 × (1 + 12%±) — 上界宽松断言防浮点/枢轴取 low 的微差
    expect(r.nTarget!).toBeGreaterThan(r.active.fromPrice * 1.1)
    expect(r.nTarget!).toBeLessThan(r.active.fromPrice * 1.15)
  })
})

describe('analyzeNPattern · 时间', () => {
  it('连续收涨 ≥6 天 → holdRisk(持股黄金法则)', () => {
    const bars = build([fallPrefix, { days: 10, pct: 12 }, { days: 5, pct: -6 }, { days: 7, pct: 10.5 }])
    const r = analyzeNPattern(bars)!
    expect(r).not.toBeNull()
    expect(r.holdRisk).toBe(true)
  })

  it('调整段第12天 → 11-13 延伸窗', () => {
    const bars = build([risePrefix, { days: 10, pct: -14 }, { days: 12, pct: 7 }])
    const r = analyzeNPattern(bars)!
    expect(r.role).toBe('F')
    expect(r.inWindow).toBe('11-13')
  })
})

describe('analyzeNPattern · 异动', () => {
  it('V形反转:单根阳包阴反转且速度大于前跌段', () => {
    const bars = build([risePrefix, { days: 5, pct: -10 }])
    // 恐慌长下影阴线(段内最低点落在此根,避免次日吞没线自身成为末根枢轴被丢弃)
    const p = bars[bars.length - 1].close
    bars.push({
      date: dt(bars.length),
      open: p,
      close: p * 0.99,
      high: p * 1.003,
      low: p * 0.975,
      volume: 1000,
    })
    // 次日阳包阴大反转
    const y = bars[bars.length - 1]
    const c = y.close * 1.06
    bars.push({
      date: dt(bars.length),
      open: y.close * 0.995,
      close: c,
      high: c * 1.003,
      low: y.close * 0.994,
      volume: 1000,
    })
    const r = analyzeNPattern(bars)!
    expect(r).not.toBeNull()
    expect(r.role).toBe('F')
    expect(r.anomaly?.type).toBe('V形反转')
  })

  it('反弹力竭(皮球见顶法):反弹时间超过前跌段而幅度未收复 → 6-8窗内转弱', () => {
    const bars = build([risePrefix, { days: 4, pct: -10 }, { days: 6, pct: 6 }])
    const r = analyzeNPattern(bars)!
    expect(r.role).toBe('F')
    expect(r.strength).toBe('weak')
    expect(r.anomaly?.type).toBe('反弹力竭')
  })

  it('抗跌转强(当跌不跌):急坠回挡后横盘不创新低', () => {
    const bars = build([fallPrefix, { days: 10, pct: 20 }, { days: 4, pct: -11 }, { days: 4, pct: 0.2 }])
    const r = analyzeNPattern(bars)!
    expect(r.role).toBe('H')
    expect(r.anomaly?.type).toBe('抗跌转强')
  })

  it('滞涨转弱(当涨不涨):强势反弹到时间窗后滞涨不创新高', () => {
    const bars = build([risePrefix, { days: 8, pct: -12 }, { days: 4, pct: 16 }, { days: 3, pct: -0.3 }])
    const r = analyzeNPattern(bars)!
    expect(r.role).toBe('F')
    expect(r.strength).toBe('strong')
    expect(r.anomaly?.type).toBe('滞涨转弱')
  })

  it('加速异动:活动升段速度 ≥2× 前同向段均速', () => {
    const bars = build([fallPrefix, { days: 8, pct: 12 }, { days: 4, pct: -6 }, { days: 3, pct: 11 }])
    const r = analyzeNPattern(bars)!
    expect(r.role).toBe('F')
    expect(r.anomaly?.type).toBe('加速异动')
  })
})

describe('nStrengthLabel', () => {
  it('六类命名 + 缺省退化', () => {
    expect(nStrengthLabel('F', 'strong')).toBe('强势反弹')
    expect(nStrengthLabel('H', 'strong')).toBe('强势回挡')
    expect(nStrengthLabel('H', 'weak')).toBe('弱势回挡')
    expect(nStrengthLabel('F', 'sym')).toBe('对称反弹')
    expect(nStrengthLabel('F', null)).toBe('反弹')
  })
})
