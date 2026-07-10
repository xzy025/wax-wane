import { describe, it, expect } from 'vitest'
import {
  changeOverWindow,
  classifyQuadrant,
  dailyChanges,
  volRatios,
  computeTempoSeries,
  tempoHeat,
  hasStrongLaunch,
  TEMPO,
  type TempoDayInput,
} from './rotationRules'

describe('changeOverWindow', () => {
  it('computes pct change over n bars (ascending closes)', () => {
    expect(changeOverWindow([10, 11, 12], 2)).toBeCloseTo(20, 6) // 12/10-1
    expect(changeOverWindow([10, 11, 12], 1)).toBeCloseTo((12 / 11 - 1) * 100, 6)
  })
  it('returns NaN when history is insufficient or base non-positive', () => {
    expect(Number.isNaN(changeOverWindow([10, 11], 5))).toBe(true)
    expect(Number.isNaN(changeOverWindow([0, 11], 1))).toBe(true)
    expect(Number.isNaN(changeOverWindow([12], 1))).toBe(true)
  })
})

describe('classifyQuadrant', () => {
  it('maps long×short to the four quadrants (≥0 = up/high/strong)', () => {
    expect(classifyQuadrant(5, 2)).toBe('hs') // 高强 强势延续
    expect(classifyQuadrant(-5, 2)).toBe('ls') // 低强 底部反转
    expect(classifyQuadrant(5, -2)).toBe('hw') // 高弱 高位回调
    expect(classifyQuadrant(-5, -2)).toBe('lw') // 低弱 持续走弱
  })
  it('treats exactly 0 as up/strong (boundary)', () => {
    expect(classifyQuadrant(0, 0)).toBe('hs')
    expect(classifyQuadrant(-0.01, 0)).toBe('ls')
  })
})

// ── 板块轮动节奏(tempo)状态机 ──────────────────────────────────────────

/** 简写:一天输入。 */
const day = (date: string, boardChg: number, indexChg: number, volRatio?: number): TempoDayInput => ({
  date,
  boardChg,
  indexChg,
  volRatio,
})

describe('dailyChanges', () => {
  it('bars 升序→逐日涨跌幅,首根无前收', () => {
    const out = dailyChanges([
      { date: 'd1', close: 10 },
      { date: 'd2', close: 11 },
      { date: 'd3', close: 9.9 },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].date).toBe('d2')
    expect(out[0].chg).toBeCloseTo(10, 6)
    expect(out[1].chg).toBeCloseTo(-10, 6)
  })
  it('单根返回空;前收非正跳过', () => {
    expect(dailyChanges([{ date: 'd1', close: 10 }])).toEqual([])
    expect(dailyChanges([{ date: 'd1', close: 0 }, { date: 'd2', close: 10 }])).toEqual([])
  })
})

describe('volRatios', () => {
  it('当日量/前N日均量;历史不足→NaN 占位', () => {
    const out = volRatios([100, 100, 100, 100, 100, 120], 5)
    expect(out.slice(0, 5).every(Number.isNaN)).toBe(true)
    expect(out[5]).toBeCloseTo(1.2, 6)
  })
  it('均量为 0 → NaN', () => {
    expect(Number.isNaN(volRatios([0, 0, 100], 2)[2])).toBe(true)
  })
})

describe('computeTempoSeries · state/dayN', () => {
  it('state 边界:平盘非收红;≥指数含等号;收红但弱于指数=调整且非抗跌;逆势抗跌', () => {
    const cells = computeTempoSeries([
      day('d1', 0, -1), // 平盘 → adjust(平盘不算收红)
      day('d2', 0.5, 0.5), // 恰等于指数 → launch
      day('d3', 0.5, 0.6), // 收红但弱于指数 → adjust,且 0.5<0.6 无 resilient
      day('d4', -0.2, -1.0), // 跌但强于指数 → adjust + resilient
    ])
    expect(cells.map((c) => c.state)).toEqual(['adjust', 'launch', 'adjust', 'adjust'])
    expect(cells[2].qualifiers).not.toContain('resilient')
    expect(cells[3].qualifiers).toContain('resilient')
  })

  it('dayN 连续计数跨展示窗:10天 L×6,A,L×2 → 末5格 dayN=6,7,1,1,2', () => {
    const days: TempoDayInput[] = []
    for (let i = 1; i <= 7; i++) days.push(day(`d${i}`, 1, 0)) // 7 个 launch(d1..d7)
    days.push(day('d8', -1, 0)) // adjust
    days.push(day('d9', 1, 0), day('d10', 1, 0)) // 2 个 launch
    const tail5 = computeTempoSeries(days).slice(-5)
    expect(tail5.map((c) => `${c.state[0]}${c.dayN}`)).toEqual(['l6', 'l7', 'a1', 'l1', 'l2'])
  })
})

describe('computeTempoSeries · tier/qualifiers', () => {
  it('tier 三分支:涨幅达标强/量比达标强/都不达标弱;kpl 无量能不误判强', () => {
    const [a, b, c, d] = computeTempoSeries([
      day('d1', 1.6, 0, 1.0), // 涨幅≥1.5 → strong
      day('d2', 0.8, 0, 1.25), // 量比≥1.2 → strong
      day('d3', 0.8, 0, 1.0), // 都不达标 → weak
      day('d4', 0.8, 0), // volRatio undefined(kpl) → 只按涨幅 → weak
    ])
    expect([a.tier, b.tier, c.tier, d.tier]).toEqual(['strong', 'strong', 'weak', 'weak'])
  })
  it('qualifier 阈值边界:量比恰1.2→volUp、恰0.7→volDown、超额恰1pp→aboveIndex', () => {
    const [a, b] = computeTempoSeries([
      day('d1', 1.2, 0.2, 1.2), // 超额恰 1.0pp + 量比恰 1.2
      day('d2', -0.5, 0, 0.7), // 调整日缩量
    ])
    expect(a.qualifiers).toContain('aboveIndex')
    expect(a.qualifiers).toContain('volUp')
    expect(b.qualifiers).toContain('volDown')
  })

  it('合成截图序列验收(07-03~07-09 半导体设备语义,前置2个调整日warmup)', () => {
    const cells = computeTempoSeries([
      day('07-01', -1.0, -0.5),
      day('07-02', -0.6, -0.3),
      day('07-03', 0.9, -0.3, 0.95), // 启动1·弱·比指数强
      day('07-04', 2.35, 0.48, 1.31), // 启动2·强·[aboveIndex,volUp]
      day('07-07', -0.42, -1.24, 0.62), // 调整1·[resilient,volDown]
      day('07-08', 1.82, 0.66, 1.05), // 启动1·强·[aboveIndex]
      day('07-09', 0.45, 0.8, 0.88), // 收红但弱于指数→调整1,0.45<0.8 非抗跌
    ])
    const tail = cells.slice(-5)
    expect(tail.map((c) => `${c.state}:${c.dayN}:${c.tier}`)).toEqual([
      'launch:1:weak',
      'launch:2:strong',
      'adjust:1:adjust',
      'launch:1:strong',
      'adjust:1:adjust',
    ])
    expect(tail[0].qualifiers).toEqual(['aboveIndex'])
    expect(tail[1].qualifiers).toEqual(expect.arrayContaining(['aboveIndex', 'volUp']))
    expect(tail[2].qualifiers).toEqual(expect.arrayContaining(['resilient', 'volDown']))
    expect(tail[3].qualifiers).toContain('aboveIndex')
    expect(tail[4].qualifiers).toEqual([])
  })
})

describe('tempoHeat / hasStrongLaunch', () => {
  it('有强启动的行 heat 更高;无 strong 的行 hasStrongLaunch=false', () => {
    const weakRow = computeTempoSeries(Array.from({ length: 5 }, (_, i) => day(`d${i}`, 0.5, 0, 1.0)))
    const strongRow = computeTempoSeries(Array.from({ length: 5 }, (_, i) => day(`d${i}`, 2.0, 0, 1.3)))
    expect(tempoHeat(strongRow)).toBeGreaterThan(tempoHeat(weakRow))
    expect(hasStrongLaunch(weakRow)).toBe(false)
    expect(hasStrongLaunch(strongRow)).toBe(true)
  })
  it('近日权重更大:同样一个 strong,越近 heat 越高', () => {
    const early = computeTempoSeries([day('d1', 2, 0), ...Array.from({ length: 4 }, (_, i) => day(`e${i}`, -1, 0))])
    const late = computeTempoSeries([...Array.from({ length: 4 }, (_, i) => day(`e${i}`, -1, 0)), day('d5', 2, 0)])
    expect(tempoHeat(late)).toBeGreaterThan(tempoHeat(early))
    expect(hasStrongLaunch(early, TEMPO.WINDOW)).toBe(true)
  })
})
