import { describe, it, expect } from 'vitest'
import { pickLevels, classifyForward, neededBars, evaluateTask, sampleConfidenceFor, segmentClosedPicks } from './screenerForward'
import type { Bar } from './screenerRules'
import type { ForwardPick } from './screenerForward'

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

describe('sampleConfidenceFor — 样本量可信度(仿 optimize.ts MIN_N=30 门槛)', () => {
  it('n<10 → low', () => {
    expect(sampleConfidenceFor(0)).toBe('low')
    expect(sampleConfidenceFor(2)).toBe('low')
    expect(sampleConfidenceFor(9)).toBe('low')
  })
  it('10<=n<30 → medium', () => {
    expect(sampleConfidenceFor(10)).toBe('medium')
    expect(sampleConfidenceFor(15)).toBe('medium')
    expect(sampleConfidenceFor(29)).toBe('medium')
  })
  it('n>=30 → high', () => {
    expect(sampleConfidenceFor(30)).toBe('high')
    expect(sampleConfidenceFor(43)).toBe('high')
    expect(sampleConfidenceFor(92)).toBe('high')
  })
})

describe('segmentClosedPicks — 通用切片归因', () => {
  const mkPick = (over: Partial<ForwardPick> = {}): ForwardPick => ({
    asof: '2026-06-24', group: 'breakout', code: '000001', name: '测试',
    entry: 10, stop: 9, target: 12, status: 'closed',
    exit: 11, exitDate: '2026-06-25', reason: 'target', R: 1, retPct: 10, barsHeld: 1, barsElapsed: 1,
    ...over,
  })

  it('按 taBias 分桶:demand 组高 R、supply 组低 R,互不混入', () => {
    const picks = [
      mkPick({ code: 'a', taBias: 'demand', R: 2 }),
      mkPick({ code: 'b', taBias: 'demand', R: 1 }),
      mkPick({ code: 'c', taBias: 'supply', R: -1 }),
      mkPick({ code: 'd', taBias: 'supply', R: -2 }),
    ]
    const buckets = segmentClosedPicks(picks, (p) => p.taBias ?? null)
    const demand = buckets.find((b) => b.label === 'demand')
    const supply = buckets.find((b) => b.label === 'supply')
    expect(demand).toBeDefined()
    expect(supply).toBeDefined()
    expect(demand?.metrics.n).toBe(2)
    expect(demand?.metrics.expectancyR).toBeCloseTo(1.5, 5)
    expect(supply?.metrics.n).toBe(2)
    expect(supply?.metrics.expectancyR).toBeCloseTo(-1.5, 5)
  })

  it('缺失该因子(keyFn 返回 null)的 pick 不进任何桶', () => {
    const picks = [mkPick({ taBias: 'demand' }), mkPick({ taBias: undefined })]
    const buckets = segmentClosedPicks(picks, (p) => p.taBias ?? null)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].metrics.n).toBe(1)
  })

  it('未平仓(open/pending)的 pick 不参与分桶', () => {
    const picks = [mkPick({ taBias: 'demand', status: 'open' }), mkPick({ taBias: 'demand', status: 'pending' })]
    expect(segmentClosedPicks(picks, (p) => p.taBias ?? null)).toHaveLength(0)
  })

  it('每桶按内部样本量算 sampleConfidence(仿 sampleConfidenceFor)', () => {
    const picks = Array.from({ length: 12 }, (_, i) => mkPick({ code: `c${i}`, taBias: 'demand' }))
    const buckets = segmentClosedPicks(picks, (p) => p.taBias ?? null)
    expect(buckets[0].metrics.n).toBe(12)
    expect(buckets[0].sampleConfidence).toBe('medium') // 10<=12<30
  })
})
