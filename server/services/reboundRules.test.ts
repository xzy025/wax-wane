import { describe, it, expect } from 'vitest'
import {
  detectReversalDay,
  buildReversalByDate,
  declineWindow,
  cumRelStrength,
  classifyReboundPioneer,
  classifyReboundResilient,
  type IndexBar,
} from './reboundRules'
import { REBOUND } from '../config/screener'
import type { Bar } from './screenerRules'

/** 共享日期轴:个股/指数用同一 i 索引 → 日期天然对齐。 */
const dt = (i: number) => `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`

/** 由逐日涨跌%序列合成指数日线。spec: chg=当日涨跌%,vol=当日量(默认1000),bearish=收阴(高开低走)。 */
function mkIdx(specs: { chg: number; vol?: number; bearish?: boolean }[], startClose = 3000): IndexBar[] {
  const bars: IndexBar[] = []
  let close = startClose
  specs.forEach((s, i) => {
    const prev = close
    close = prev * (1 + s.chg / 100)
    // 收阳:开在昨收附近略低于收;收阴:开高于收(高开低走)
    const open = s.bearish ? close * 1.005 : Math.min(prev, close * 0.995)
    const high = Math.max(open, close) * 1.003
    const low = Math.min(open, close) * 0.997
    bars.push({ date: dt(i), open, close, high, low, volume: s.vol ?? 1000 })
  })
  return bars
}

/** 由逐日涨跌%序列合成个股日线(Bar)。 */
function mkStock(specs: { chg: number; vol?: number }[], startClose = 10): Bar[] {
  const bars: Bar[] = []
  let close = startClose
  specs.forEach((s, i) => {
    const prev = close
    close = prev * (1 + s.chg / 100)
    const high = Math.max(prev, close) * 1.005
    const low = Math.min(prev, close) * 0.995
    bars.push({ date: dt(i), open: Math.min(prev, close * 0.999), close, high, low, volume: s.vol ?? 1000 })
  })
  return bars
}

/** 基准段(走平) + 尾部注入:10 天平盘足够覆盖 VOL_BASE_WIN(5)/DOWN_WINDOW(5) 的基准需求。 */
const FLAT = Array.from({ length: 10 }, () => ({ chg: 0 }))

describe('detectReversalDay', () => {
  it('命中:连跌3日 + 放量大阳(2026-07-09 原型)', () => {
    const bars = mkIdx([...FLAT, { chg: -1 }, { chg: -0.8 }, { chg: -1.2 }, { chg: 1.65, vol: 1600 }])
    const sig = detectReversalDay(bars, REBOUND)
    expect(sig).not.toBeNull()
    expect(sig!.date).toBe(bars[bars.length - 1].date)
    expect(sig!.downDays).toBe(3)
    expect(sig!.chgPct).toBeCloseTo(1.65, 1)
    expect(sig!.volRatio).toBeGreaterThanOrEqual(REBOUND.VOL_RATIO_MIN)
  })

  it('不中:缩量大阳(量比不过线)', () => {
    const bars = mkIdx([...FLAT, { chg: -1 }, { chg: -0.8 }, { chg: -1.2 }, { chg: 1.65, vol: 1000 }])
    expect(detectReversalDay(bars, REBOUND)).toBeNull()
  })

  it('不中:仅连跌2日且5日累计未到-3%', () => {
    const bars = mkIdx([...FLAT, { chg: -0.5 }, { chg: -0.6 }, { chg: 1.65, vol: 1600 }])
    expect(detectReversalDay(bars, REBOUND)).toBeNull()
  })

  it('命中:非严格连跌但5日累计≤-3%(口径B)', () => {
    // 跌跌-涨-跌跌:中间夹涨日 → 连跌仅2;5日累计约 -3.9%
    const bars = mkIdx([...FLAT, { chg: -1.8 }, { chg: -1.6 }, { chg: 0.2 }, { chg: -0.4 }, { chg: -0.3 }, { chg: 1.8, vol: 1700 }])
    const sig = detectReversalDay(bars, REBOUND)
    expect(sig).not.toBeNull()
    expect(sig!.downDays).toBeLessThan(REBOUND.DOWN_DAYS_MIN)
    expect(sig!.downCumPct).toBeLessThanOrEqual(REBOUND.DOWN_CUM_PCT)
  })

  it('不中:涨幅够但高开低走收阴(弱反抽)', () => {
    const bars = mkIdx([...FLAT, { chg: -1 }, { chg: -0.8 }, { chg: -1.2 }, { chg: 1.65, vol: 1600, bearish: true }])
    expect(detectReversalDay(bars, REBOUND)).toBeNull()
  })

  it('不中:数据不足', () => {
    expect(detectReversalDay(mkIdx([{ chg: -1 }, { chg: 2, vol: 1600 }]), REBOUND)).toBeNull()
  })
})

describe('buildReversalByDate / declineWindow', () => {
  it('逐日打标只标出反攻日那一天', () => {
    const bars = mkIdx([...FLAT, { chg: -1 }, { chg: -0.8 }, { chg: -1.2 }, { chg: 1.65, vol: 1600 }, { chg: 0.2 }])
    const map = buildReversalByDate(bars, REBOUND)
    expect(map.size).toBe(1)
    expect(map.has(bars[bars.length - 2].date)).toBe(true)
  })

  it('连续口径:窗=[连跌起点前一日(基准) .. 反攻日前一日]', () => {
    const bars = mkIdx([...FLAT, { chg: -1 }, { chg: -0.8 }, { chg: -1.2 }, { chg: 1.65, vol: 1600 }])
    const win = declineWindow(bars, REBOUND)!
    const len = bars.length
    expect(win.fromDate).toBe(bars[len - 5].date) // 3 个下跌日之前的基准日
    expect(win.toDate).toBe(bars[len - 2].date)
  })

  it('累计口径:窗=固定 DOWN_WINDOW 日(基准=downCumPct 同一基准日)', () => {
    const bars = mkIdx([...FLAT, { chg: -1.8 }, { chg: -1.6 }, { chg: 0.2 }, { chg: -0.4 }, { chg: -0.3 }, { chg: 1.8, vol: 1700 }])
    const win = declineWindow(bars, REBOUND)!
    const len = bars.length
    expect(win.fromDate).toBe(bars[len - 2 - REBOUND.DOWN_WINDOW].date)
    expect(win.toDate).toBe(bars[len - 2].date)
  })

  it('非反攻语境返回 null', () => {
    expect(declineWindow(mkIdx([...FLAT, { chg: 0.5 }, { chg: 0.5 }, { chg: 1 }]), REBOUND)).toBeNull()
  })
})

describe('cumRelStrength', () => {
  // 窗口:指数连跌4日各-1%,个股同期走平并有2天逆势收红
  const idx = mkIdx([...FLAT, { chg: -1 }, { chg: -1 }, { chg: -1 }, { chg: -1 }, { chg: 2, vol: 1600 }])
  const win = declineWindow(idx, REBOUND)!

  it('抗跌股:cumRel≈正的pp差 + 逆势红盘天数', () => {
    const stock = mkStock([...FLAT, { chg: 0.2 }, { chg: -0.3 }, { chg: 0.4 }, { chg: -0.1 }, { chg: 6, vol: 2500 }])
    const rel = cumRelStrength(stock, idx, win)!
    expect(rel).not.toBeNull()
    expect(rel.cumRelPct).toBeGreaterThan(0)
    expect(rel.indexChgPct).toBeLessThan(0)
    expect(rel.counterTrendDays).toBe(2) // 指数4个跌日中个股收红2天(+0.2/+0.4)
  })

  it('日期缺口容错:个股窗内停牌1日仍可算', () => {
    const stock = mkStock([...FLAT, { chg: 0.2 }, { chg: -0.3 }, { chg: 0.4 }, { chg: -0.1 }, { chg: 6 }])
    const holed = stock.filter((b) => b.date !== win.toDate) // 挖掉窗内最后一天
    const rel = cumRelStrength(holed, idx, win)
    expect(rel).not.toBeNull()
  })

  it('重叠不足2日返回 null', () => {
    const stock = mkStock([{ chg: 0 }]).map((b) => ({ ...b, date: '2099-01-01' }))
    expect(cumRelStrength(stock, idx, win)).toBeNull()
  })
})

describe('classifyReboundPioneer', () => {
  /** 高位滑落→低位企稳→反攻日涨停:60+根,52周分位低。dropDays 控制下跌深度。 */
  function mkPioneerBars(o: { boards?: number; highPos?: boolean } = {}): Bar[] {
    const boards = o.boards ?? 1
    const specs: { chg: number; vol?: number }[] = []
    if (o.highPos) {
      // 一路上行到新高再涨停 → 52周分位≈100
      for (let i = 0; i < 70; i++) specs.push({ chg: 0.8 })
    } else {
      // 前段高位(20)→阴跌至~10(低位)→走平
      for (let i = 0; i < 40; i++) specs.push({ chg: -1.7 })
      for (let i = 0; i < 25; i++) specs.push({ chg: 0 })
    }
    for (let i = 0; i < boards; i++) specs.push({ chg: 10, vol: 3000 }) // 主板涨停(600xxx=10%)
    return mkStock(specs, o.highPos ? 10 : 20)
  }

  it('命中:低位首板 → lbc=1、posPct低', () => {
    const hit = classifyReboundPioneer(mkPioneerBars(), '600584', REBOUND)
    expect(hit).not.toBeNull()
    expect(hit!.lbc).toBe(1)
    expect(hit!.posPct).toBeLessThanOrEqual(REBOUND.PIONEER_POS_MAX)
  })

  it('不中:三连板(> PIONEER_LB_MAX,妖股剔除)', () => {
    expect(classifyReboundPioneer(mkPioneerBars({ boards: 3 }), '600584', REBOUND)).toBeNull()
  })

  it('不中:高位涨停(52周分位过高)', () => {
    expect(classifyReboundPioneer(mkPioneerBars({ highPos: true }), '600584', REBOUND)).toBeNull()
  })

  it('不中:未涨停', () => {
    const specs = [...Array.from({ length: 65 }, () => ({ chg: 0 })), { chg: 5, vol: 3000 }]
    expect(classifyReboundPioneer(mkStock(specs), '600584', REBOUND)).toBeNull()
  })

  it('不中:K线不足 MIN_BARS', () => {
    const specs = [...Array.from({ length: 20 }, () => ({ chg: 0 })), { chg: 10, vol: 3000 }]
    expect(classifyReboundPioneer(mkStock(specs), '600584', REBOUND)).toBeNull()
  })
})

describe('classifyReboundResilient', () => {
  const idx = mkIdx([...FLAT, { chg: -1 }, { chg: -1 }, { chg: -1 }, { chg: -1 }, { chg: 2, vol: 1600 }])
  const win = declineWindow(idx, REBOUND)!

  it('命中:连跌窗抗跌 + 反攻日放量+6%', () => {
    const stock = mkStock([...FLAT, { chg: 0.2 }, { chg: -0.3 }, { chg: 0.4 }, { chg: -0.1 }, { chg: 6, vol: 2500 }])
    const hit = classifyReboundResilient(stock, '002384', idx, win, REBOUND)
    expect(hit).not.toBeNull()
    expect(hit!.chgPct).toBeCloseTo(6, 0)
    expect(hit!.volRatio).toBeGreaterThanOrEqual(REBOUND.LEAD_VOL_MIN)
    expect(hit!.cumRelPct).toBeGreaterThanOrEqual(REBOUND.LEAD_CUMREL_MIN)
  })

  it('不中:涨停股归先锋组(两组不重叠)', () => {
    const stock = mkStock([...FLAT, { chg: 0.2 }, { chg: -0.3 }, { chg: 0.4 }, { chg: -0.1 }, { chg: 10, vol: 2500 }])
    expect(classifyReboundResilient(stock, '002384', idx, win, REBOUND)).toBeNull()
  })

  it('不中:涨幅不足 LEAD_CHG_MIN', () => {
    const stock = mkStock([...FLAT, { chg: 0.2 }, { chg: -0.3 }, { chg: 0.4 }, { chg: -0.1 }, { chg: 4, vol: 2500 }])
    expect(classifyReboundResilient(stock, '002384', idx, win, REBOUND)).toBeNull()
  })

  it('不中:连跌窗内比指数还弱(cumRel<0)', () => {
    const stock = mkStock([...FLAT, { chg: -2 }, { chg: -2 }, { chg: -2 }, { chg: -2 }, { chg: 6, vol: 2500 }])
    expect(classifyReboundResilient(stock, '002384', idx, win, REBOUND)).toBeNull()
  })

  it('不中:缩量领涨(量比不足)', () => {
    const stock = mkStock([...FLAT, { chg: 0.2 }, { chg: -0.3 }, { chg: 0.4 }, { chg: -0.1 }, { chg: 6, vol: 1200 }])
    expect(classifyReboundResilient(stock, '002384', idx, win, REBOUND)).toBeNull()
  })
})
