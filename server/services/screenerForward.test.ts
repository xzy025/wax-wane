import { describe, it, expect } from 'vitest'
import { pickLevels, classifyForward, neededBars, evaluateTask, sampleConfidenceFor, segmentClosedPicks, isBarStale } from './screenerForward'
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

  it('非买点组(watch/trendwatch)→ null;trigger 仍评估(观察口径,只是不进 overall)', () => {
    expect(pickLevels('watch', { code: 'X', name: 'X', entry: 10, stopLoss: 9, target: 12 })).toBeNull()
    expect(pickLevels('trendwatch', { code: 'X', name: 'X', entry: 10, stop: 9, target: 12 })).toBeNull()
    expect(pickLevels('trigger', { code: 'X', name: 'X', entry: 10, stopLoss: 9, target: 12 })).not.toBeNull()
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

  it('time 且窗口未走完但末根陈旧(停牌/退市)→ stale(mark-to-last 计入 closed)', () => {
    expect(classifyForward('time', 20, 5, true)).toBe('stale')
    expect(classifyForward('stop', 20, 5, true)).toBe('closed') // 已触发出场不受 stale 影响
    expect(classifyForward('time', 20, 20, true)).toBe('closed') // 走满 hold 是真时间止损
  })
})

describe('isBarStale — 停牌/退市陈旧判定', () => {
  it('末根距今 >15 日历日 → 陈旧', () => {
    expect(isBarStale('2026-01-05', '2026-01-21')).toBe(true)
  })
  it('恰 15 日/以内 → 不陈旧', () => {
    expect(isBarStale('2026-01-05', '2026-01-20')).toBe(false)
    expect(isBarStale('2026-01-05', '2026-01-06')).toBe(false)
  })
  it('非法日期 → 不陈旧(容错)', () => {
    expect(isBarStale('', '2026-01-20')).toBe(false)
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

// 评估基准日:距测试用 bars(2026-01-05~07)不足 STALE_CAL_DAYS(15 日历日),不触发停牌陈旧判定。
const TODAY = '2026-01-10'

describe('evaluateTask — 单笔前向评估', () => {
  const task = { asof: '2026-01-05', group: 'breakout' as const, code: 'X', name: '某股', entry: 10, stop: 9, target: 12 }

  it('无 bars / bars 不足 → pending', () => {
    expect(evaluateTask(task, undefined, TODAY).status).toBe('pending')
    expect(evaluateTask(task, [bar('2026-01-05', 10, 10, 10, 10)], TODAY).status).toBe('pending')
  })

  it('信号日未被窗口覆盖(全在 asof 之后)→ pending', () => {
    const bars = [bar('2026-01-06', 10, 11, 9, 10), bar('2026-01-07', 10, 11, 9, 10)]
    expect(evaluateTask(task, bars, TODAY).status).toBe('pending')
  })

  it('次日触止损 → closed,R=-1,reason=stop,持有1日', () => {
    const bars = [bar('2026-01-05', 10, 10, 10, 10), bar('2026-01-06', 9.5, 10, 8.5, 9)]
    const p = evaluateTask(task, bars, TODAY)
    expect(p.status).toBe('closed')
    expect(p.reason).toBe('stop')
    expect(p.R).toBe(-1)
    expect(p.barsHeld).toBe(1)
    // 展示位价用前复权基准 → (exit-entry)/(entry-stop)=R 恒等。
    expect((p.exit - p.entry) / (p.entry - p.stop)).toBeCloseTo(p.R, 5)
  })

  it('窗口未走完且未触发 → open,按最新收盘盯市浮动 R', () => {
    const bars = [bar('2026-01-05', 10, 10, 10, 10), bar('2026-01-06', 10, 11, 9.5, 10.5)]
    const p = evaluateTask(task, bars, TODAY)
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
    const p = evaluateTask(drifted, bars, TODAY)
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
    const p = evaluateTask(wkndTask, bars, TODAY)
    expect(p.status).toBe('closed')
    expect(p.reason).toBe('stop')
    expect(p.exitDate).toBe('2026-01-05')
  })
})

describe('evaluateTask — 停牌陈旧(stale)终态', () => {
  const task = { asof: '2026-01-05', group: 'breakout' as const, code: 'X', name: '某股', entry: 10, stop: 9, target: 12 }

  it('末根距今超 15 日历日且窗口未走完 → closed/stale,按最后可得收盘 mark-to-last', () => {
    // 信号后仅 1 根(未触发),末根 2026-01-06,今天 2026-02-01 → 停牌陈旧。
    const bars = [bar('2026-01-05', 10, 10, 10, 10), bar('2026-01-06', 10, 11, 9.5, 10.5)]
    const p = evaluateTask(task, bars, '2026-02-01')
    expect(p.status).toBe('closed') // 不再永久 open(幸存者偏差修复)
    expect(p.reason).toBe('stale')
    expect(p.exit).toBe(10.5) // mark-to-last=末根收盘
    expect(p.R).toBe(0.5)
  })

  it('同样 bars、今天在 15 日内 → 仍 open(正常盯市不受影响)', () => {
    const bars = [bar('2026-01-05', 10, 10, 10, 10), bar('2026-01-06', 10, 11, 9.5, 10.5)]
    const p = evaluateTask(task, bars, '2026-01-10')
    expect(p.status).toBe('open')
    expect(p.reason).toBe('open')
  })
})

describe('evaluateTask — bhold 确认口径(次日突破 trigger 入场,与回测 0.45R 基线同口径)', () => {
  // 快照:整理日收盘 entry=10,trigger=10.6(整理段高),consolLow=9.5,stop/target 为收盘口径旧字段。
  const bh = {
    asof: '2026-01-05', group: 'bhold' as const, code: 'X', name: '某股',
    entry: 10, stop: 9.3, target: 11.4, trigger: 10.6, consolLow: 9.5,
  }
  const sig = bar('2026-01-05', 10, 10.2, 9.8, 10)

  it('确认窗内 high≥trigger → 以 max(trigger,当日开) 入场,入场日参与撮合', () => {
    // d1 high=10.8 ≥ 10.6 触发,open=10.3 < trigger → entry=10.6;
    // stop=max(9.5*0.997, 10.6*0.93)=9.858;target=10.6+2*(10.6-9.858)=12.084;d2 high 12.2 → target。
    const bars = [sig, bar('2026-01-06', 10.3, 10.8, 10.1, 10.7), bar('2026-01-07', 10.8, 12.2, 10.7, 12)]
    const p = evaluateTask(bh, bars, TODAY)
    expect(p.status).toBe('closed')
    expect(p.reason).toBe('target')
    expect(p.entry).toBeCloseTo(10.6, 2)
    expect(p.R).toBe(2)
  })

  it('跳空高开越过 trigger → 按开盘价入场', () => {
    const bars = [sig, bar('2026-01-06', 10.9, 11.2, 10.7, 11)]
    const p = evaluateTask(bh, bars, TODAY)
    expect(p.entry).toBeCloseTo(10.9, 2) // max(trigger 10.6, open 10.9)
  })

  it('先破整理低点 → skipped(废弃,不进指标)', () => {
    const bars = [sig, bar('2026-01-06', 9.8, 10, 9.4, 9.6), bar('2026-01-07', 10.7, 12, 10.6, 11.9)]
    const p = evaluateTask(bh, bars, TODAY)
    expect(p.status).toBe('skipped') // 破位在先,后续暴涨也不算(与回测口径一致)
    expect(p.reason).toBe('skipped')
  })

  it('确认窗(3根)走完未触发 → skipped;窗未走完 → pending', () => {
    const quiet = (d: string) => bar(d, 10, 10.3, 9.9, 10.1)
    const walked = [sig, quiet('2026-01-06'), quiet('2026-01-07'), quiet('2026-01-08'), quiet('2026-01-09')]
    expect(evaluateTask(bh, walked, TODAY).status).toBe('skipped')
    const young = [sig, quiet('2026-01-06')]
    expect(evaluateTask(bh, young, '2026-01-07').status).toBe('pending')
  })

  it('复权缩放(全部价格 ×0.5)→ 按比率重锚,R 不变', () => {
    const half = (b: ReturnType<typeof bar>) => ({ ...b, open: b.open / 2, high: b.high / 2, low: b.low / 2, close: b.close / 2 })
    const bars = [sig, bar('2026-01-06', 10.3, 10.8, 10.1, 10.7), bar('2026-01-07', 10.8, 12.2, 10.7, 12)].map(half)
    const p = evaluateTask(bh, bars, TODAY) // 快照 entry/trigger 仍是未缩放值 → 比率映射
    expect(p.status).toBe('closed')
    expect(p.R).toBe(2)
  })

  it('旧快照缺 trigger 字段 → 回退整理日收盘口径(legacy)', () => {
    const legacy = { asof: '2026-01-05', group: 'bhold' as const, code: 'X', name: '某股', entry: 10, stop: 9.3, target: 11.4 }
    const bars = [sig, bar('2026-01-06', 9.5, 10, 9.2, 9.25)] // 收盘口径下 d1 low 9.2 ≤ stop 9.3 → stop
    const p = evaluateTask(legacy, bars, TODAY)
    expect(p.status).toBe('closed')
    expect(p.reason).toBe('stop')
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
