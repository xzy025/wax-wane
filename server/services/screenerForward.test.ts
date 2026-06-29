import { describe, it, expect } from 'vitest'
import { pickLevels, classifyForward, neededBars, evaluateTask } from './screenerForward'
import type { Bar } from './screenerRules'

const bar = (date: string, open: number, high: number, low: number, close: number): Bar => ({
  date, open, high, low, close, volume: 1000,
})

describe('pickLevels — 字段名漂移归一化', () => {
  it('Candidate(breakout/trigger):entry/stopLoss/target', () => {
    expect(pickLevels('breakout', { code: 'X', name: 'X', entry: 10, stopLoss: 9, target: 12 })).toEqual({
      entry: 10, stop: 9, target: 12,
    })
  })

  it('新组(volbreak 等):entry/stop/target', () => {
    expect(pickLevels('volbreak', { code: 'X', name: 'X', entry: 10, stop: 9, target: 12 })).toEqual({
      entry: 10, stop: 9, target: 12,
    })
  })

  it('pullback 无 entry → 回退 price', () => {
    expect(pickLevels('pullback', { code: 'X', name: 'X', price: 10, stopLoss: 9, target: 12 })).toEqual({
      entry: 10, stop: 9, target: 12,
    })
  })

  it('非买点组(watch/trendwatch)→ null', () => {
    expect(pickLevels('watch', { code: 'X', name: 'X', entry: 10, stopLoss: 9, target: 12 })).toBeNull()
    expect(pickLevels('trendwatch', { code: 'X', name: 'X', entry: 10, stop: 9, target: 12 })).toBeNull()
  })

  it('缺位价/零值 → null(旧快照容错)', () => {
    expect(pickLevels('breakout', { code: 'X', name: 'X', entry: 10, stopLoss: 9 })).toBeNull() // 无 target
    expect(pickLevels('breakout', { code: 'X', name: 'X', entry: 0, stopLoss: 9, target: 12 })).toBeNull()
  })

  it('非正风险(stop>=entry)→ null', () => {
    expect(pickLevels('breakout', { code: 'X', name: 'X', entry: 10, stopLoss: 10, target: 12 })).toBeNull()
    expect(pickLevels('breakout', { code: 'X', name: 'X', entry: 10, stopLoss: 11, target: 12 })).toBeNull()
  })
})

describe('classifyForward — 开/平仓判定', () => {
  it('已触发 stop/target(含跳空)→ closed', () => {
    expect(classifyForward('stop', 20, 1)).toBe('closed')
    expect(classifyForward('target-gap', 20, 3)).toBe('closed')
  })

  it('time 且走满 hold → closed(真时间止损)', () => {
    expect(classifyForward('time', 20, 20)).toBe('closed')
    expect(classifyForward('time', 20, 25)).toBe('closed')
  })

  it('time 且窗口未走完 → open(盯市)', () => {
    expect(classifyForward('time', 20, 5)).toBe('open')
    expect(classifyForward('time', 20, 0)).toBe('open')
  })
})

describe('neededBars — 取K根数估算', () => {
  const now = Date.parse('2026-06-29T00:00:00Z')
  it('近端封到下限 60', () => {
    expect(neededBars('2026-06-28', now)).toBe(60)
  })
  it('远端封顶 600', () => {
    expect(neededBars('2020-01-01', now)).toBe(600)
  })
  it('随信号日变远而增大', () => {
    const near = neededBars('2026-05-01', now)
    const far = neededBars('2025-01-01', now)
    expect(far).toBeGreaterThan(near)
    expect(near).toBeGreaterThanOrEqual(60)
    expect(far).toBeLessThanOrEqual(600)
  })
})

describe('evaluateTask — 单笔前向评估', () => {
  const task = { asof: '2026-01-05', group: 'breakout' as const, code: 'X', name: '某股', entry: 10, stop: 9, target: 12 }

  it('无 bars / bars 不足 → pending', () => {
    expect(evaluateTask(task, undefined).status).toBe('pending')
    expect(evaluateTask(task, [bar('2026-01-05', 10, 10, 10, 10)]).status).toBe('pending')
  })

  it('信号日未被窗口覆盖(全在 asof 之后)→ pending', () => {
    const bars = [bar('2026-01-06', 10, 11, 9, 10), bar('2026-01-07', 10, 11, 9, 10)]
    expect(evaluateTask(task, bars).status).toBe('pending')
  })

  it('次日触止损 → closed,R=-1,reason=stop,持有1日', () => {
    const bars = [bar('2026-01-05', 10, 10, 10, 10), bar('2026-01-06', 9.5, 10, 8.5, 9)]
    const p = evaluateTask(task, bars)
    expect(p.status).toBe('closed')
    expect(p.reason).toBe('stop')
    expect(p.R).toBe(-1)
    expect(p.barsHeld).toBe(1)
    // 展示位价用前复权基准 → (exit-entry)/(entry-stop)=R 恒等。
    expect((p.exit - p.entry) / (p.entry - p.stop)).toBeCloseTo(p.R, 5)
  })

  it('窗口未走完且未触发 → open,按最新收盘盯市浮动 R', () => {
    const bars = [bar('2026-01-05', 10, 10, 10, 10), bar('2026-01-06', 10, 11, 9.5, 10.5)]
    const p = evaluateTask(task, bars)
    expect(p.status).toBe('open')
    expect(p.reason).toBe('open')
    expect(p.exit).toBe(10.5) // 最新收盘
    expect(p.R).toBe(0.5) // (10.5-10)/(10-9)
    expect(p.barsElapsed).toBe(1)
  })

  it('复权再调整(信号日收盘≠归档entry)→ 按相对比率撮合,R 不变', () => {
    // 归档 entry=20/stop=18/target=24(stopFrac=0.9,targetFrac=1.2);
    // 前复权后信号日收盘=10 → stopRef=9、targetRef=12。次日 low=8.5 触 stopRef。
    const drifted = { ...task, entry: 20, stop: 18, target: 24 }
    const bars = [bar('2026-01-05', 10, 10, 10, 10), bar('2026-01-06', 9.5, 10, 8.5, 9)]
    const p = evaluateTask(drifted, bars)
    expect(p.status).toBe('closed')
    expect(p.reason).toBe('stop')
    expect(p.R).toBe(-1)
    expect(p.entry).toBe(10) // 展示用前复权基准
    expect(p.stop).toBe(9)
  })

  it('asof 落在周末(无当日 bar)→ 用 <=asof 的上一交易日为信号日', () => {
    // asof=周日 2026-01-04,信号 bar=周五 2026-01-02 收盘。
    const wkndTask = { ...task, asof: '2026-01-04' }
    const bars = [
      bar('2026-01-02', 10, 10, 10, 10), // 周五(信号)
      bar('2026-01-05', 9.5, 10, 8.5, 9), // 周一触止损
    ]
    const p = evaluateTask(wkndTask, bars)
    expect(p.status).toBe('closed')
    expect(p.reason).toBe('stop')
    expect(p.exitDate).toBe('2026-01-05')
  })
})
