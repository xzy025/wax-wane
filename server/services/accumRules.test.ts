import { describe, it, expect } from 'vitest'
import { classifyAccum } from './accumRules'
import { ACCUM } from '../config/screener'
import type { Bar } from './screenerRules'

// 合成日线:前段平盘低量(基准),最近 surgeWin 天放量(surgeVol)。
// risePct=0 → 放量横盘吸筹(均线走平+长横盘,理想高分);risePct>0 → 放量拉升(走平/横盘加分都低)。
function mkBars(o: {
  N?: number
  baseVol?: number
  surgeVol?: number
  surgeWin?: number // 最近多少天放量(默认 ACCUM.VOL_WIN)
  nBurst?: number // 放量窗内"高量"的天数(从最新往回),其余给基准量
  risePct?: number // 放量窗内逐日上行%(0=横盘,>0=拉升)
} = {}): Bar[] {
  const N = o.N ?? 200
  const base = 10
  const baseVol = o.baseVol ?? 1000
  const surgeVol = o.surgeVol ?? 3000
  const surgeWin = o.surgeWin ?? ACCUM.VOL_WIN
  const nBurst = o.nBurst ?? surgeWin
  const risePct = o.risePct ?? 0
  const winStart = N - surgeWin
  const bars: Bar[] = []
  for (let i = 0; i < N; i++) {
    const inWin = i >= winStart
    const close = inWin ? base * Math.pow(1 + risePct / 100, i - winStart) : base
    const high = close * 1.01
    const low = close * 0.99
    const open = low + (high - low) * 0.5
    const isBurst = inWin && i >= N - nBurst
    const volume = isBurst ? surgeVol : baseVol
    bars.push({
      date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      open,
      close,
      high,
      low,
      volume,
    })
  }
  return bars
}

describe('classifyAccum', () => {
  it('命中:放量横盘吸筹(均线走平+长横盘)→ 高分 tier3', () => {
    const c = classifyAccum(mkBars(), '600000', ACCUM)
    expect(c).not.toBeNull()
    expect(c!.group).toBe('accum')
    expect(c!.avgVolRatio).toBeGreaterThanOrEqual(ACCUM.VOL_MULT)
    expect(c!.burstDays).toBe(ACCUM.VOL_WIN) // 全窗放量
    // 横盘吸筹:均线走平 + 长横盘,两个加分因子都接近满分
    expect(c!.flat01).toBeGreaterThan(0.8)
    expect(c!.consol01).toBeGreaterThan(0.8)
    expect(c!.tier).toBe(3)
    expect(c!.score).toBeGreaterThanOrEqual(60)
    // 观察触发位 = 箱体上沿,且 ≥ 现价(放量站上才算突破吸筹)
    expect(c!.breakLevel).toBe(c!.boxHigh)
    expect(c!.boxHigh).toBeGreaterThanOrEqual(c!.price)
    // 确认买点交易计划自洽:止损 < 进场(箱体上沿) < 目标
    expect(c!.entryTrigger).toBe(c!.boxHigh)
    expect(c!.stopRef).toBeLessThan(c!.entryTrigger)
    expect(c!.targetRef).toBeGreaterThan(c!.entryTrigger)
  })

  it('用户加分诉求:同样放量下,横盘吸筹的分数显著高于放量拉升', () => {
    const flat = classifyAccum(mkBars({ risePct: 0 }), '600000', ACCUM)
    const rally = classifyAccum(mkBars({ risePct: 2 }), '600000', ACCUM)
    expect(flat).not.toBeNull()
    expect(rally).not.toBeNull() // 放量拉升仍命中核心放量门槛
    // 均线走平加分 + 横盘越久越加分 → 两因子都更高 → 总分更高
    expect(flat!.flat01).toBeGreaterThan(rally!.flat01)
    expect(flat!.consol01).toBeGreaterThan(rally!.consol01)
    expect(flat!.score).toBeGreaterThan(rally!.score)
  })

  it('放量拉升:命中但走平/横盘因子低 + 高位出货提示', () => {
    const c = classifyAccum(mkBars({ risePct: 2 }), '600000', ACCUM)
    expect(c).not.toBeNull()
    expect(c!.flat01).toBeLessThan(0.5)
    expect(c!.consol01).toBeLessThan(0.5)
    expect(c!.riskNote).toBeTruthy() // 高位放量/出货嫌疑
  })

  it('放量不足(全程 2.0×<2.5×)→ null', () => {
    expect(classifyAccum(mkBars({ surgeVol: 2000 }), '600000', ACCUM)).toBeNull()
  })

  it('放量天数不够(窗内仅 10 日达标,均量却够)→ null', () => {
    // 10 日巨量 + 10 日基准:均量倍数过线,但 burstDays=10 < MIN_BURST_DAYS=12
    const c = classifyAccum(mkBars({ nBurst: 10, surgeVol: 10000 }), '600000', ACCUM)
    expect(c).toBeNull()
  })

  it('K线不足 MIN_BARS → null', () => {
    expect(classifyAccum(mkBars().slice(-50), '600000', ACCUM)).toBeNull()
  })
})
