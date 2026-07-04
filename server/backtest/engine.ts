// 回测/实盘评估共享内核:向后撮合(simForward)、Trade 组装(makeTrade)、指标聚合(aggregate)。
//
// 抽自 backtestScreener.ts —— 让 CLI 走查回测与线上 forward-test(实盘战绩,
// screenerForward.ts)共用同一套撮合/指标口径,避免两处实现漂移。
// 纯函数,无网络、无 IO,可单测。
import type { Bar, MarketRegime } from '../services/screenerRules'
import type { DivergenceGroup } from '../services/divergenceRules'

// 内核私有的小工具(勿导出——`mean` 与 screenerRules.ts 同名,避免符号冲突)。
const r2 = (n: number) => Math.round(n * 100) / 100
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

// ── 一笔成交记录 ──────────────────────────────────────────────────────
export interface Trade {
  code: string
  date: string // 信号日(进场日)
  entry: number
  stop: number
  target: number
  exit: number
  exitDate: string
  reason: 'target' | 'target-gap' | 'stop' | 'stop-gap' | 'time' | 'trail'
  retPct: number
  R: number
  bars: number // 持有交易日数
  regime?: MarketRegime // 信号日的大盘环境(动态目标位用)
  divGroup?: DivergenceGroup // 打板分歧组(lianban/pullback2),供分组聚合
  hdConsolDays?: number // 连续新高分歧:整理持续天数,供因子分桶验证
  vbBurstDays?: number // 放量突破:近窗口放量达标天数,供因子分桶验证
  frSurveyOrgs?: number // 资金流共振:信号日前 SURVEY_LOOKBACK 日内调研机构家数,供因子分桶验证
  bhConsolDays?: number // 突破整理:整理小K线根数,供因子分桶验证
  tnNhDays?: number // 趋势新高:近窗口创新高天数,供因子分桶验证
  bpDaysSinceBreak?: number // 突破次日回踩:突破日距回踩日的交易日数,供因子分桶验证
  acConsolDays?: number // 放量吸筹:横盘箱体维持天数,供"横盘越久越加分"因子分桶验证
  taBias?: 'demand' | 'supply' | 'neutral' // 技术分析组合:信号日 TA bias,供因子分桶
  taDist?: boolean // 技术分析组合:信号日是否强派发(distribution)
}

/** 向后撮合内核:从信号日 i 进场,逐日判止损/目标,跳空开盘成交、同日止损优先、HOLD 末日时间止损。
 *
 *  checkEntryBar:入场发生在 bar i 盘中/开盘(confirm 触发价、次日开盘)时必须传 true——
 *  入场当日剩余走势也要参与撮合(low≤stop→止损、high≥target→止盈,同日止损优先;
 *  不做 open 跳空判断,因入场价即当日成交价)。默认 false 保持「信号日收盘进场」语义
 *  (收盘进场后当日已无走势)。漏掉入场日曾让所有 confirm/nextOpen 变体系统性偏乐观。 */
export function simForward(
  bars: Bar[],
  i: number,
  stop: number,
  target: number,
  hold: number,
  checkEntryBar = false,
): { exit: number; reason: Trade['reason']; exitIdx: number } {
  const len = bars.length
  const end = Math.min(i + hold, len - 1)
  let exit = bars[end].close // 默认时间止损
  let reason: Trade['reason'] = 'time'
  let exitIdx = end
  if (checkEntryBar) {
    const b = bars[i]
    // 日线无法分辨盘中先后,按引擎「保守:同日止损优先」约定处理入场日。
    if (b.low <= stop) return { exit: stop, reason: 'stop', exitIdx: i }
    if (b.high >= target) return { exit: target, reason: 'target', exitIdx: i }
  }
  for (let j = i + 1; j <= end; j++) {
    const b = bars[j]
    if (b.open <= stop) { exit = b.open; reason = 'stop-gap'; exitIdx = j; break }
    if (b.open >= target) { exit = b.open; reason = 'target-gap'; exitIdx = j; break }
    if (b.low <= stop) { exit = stop; reason = 'stop'; exitIdx = j; break } // 保守:同日止损优先
    if (b.high >= target) { exit = target; reason = 'target'; exitIdx = j; break }
  }
  return { exit, reason, exitIdx }
}

/** 组装一笔 Trade 记录。 */
export function makeTrade(
  code: string,
  bars: Bar[],
  i: number,
  entry: number,
  stop: number,
  target: number,
  risk: number,
  sim: { exit: number; reason: Trade['reason']; exitIdx: number },
): Trade {
  return {
    code,
    date: bars[i].date,
    entry: r2(entry),
    stop: r2(stop),
    target: r2(target),
    exit: r2(sim.exit),
    exitDate: bars[sim.exitIdx].date,
    reason: sim.reason,
    retPct: r2((sim.exit / entry - 1) * 100),
    R: r2((sim.exit - entry) / risk),
    bars: sim.exitIdx - i,
  }
}

// ── 指标聚合 ──────────────────────────────────────────────────────────
export interface Metrics {
  n: number
  winRate: number
  avgRetPct: number
  avgWinPct: number
  avgLossPct: number
  payoff: number // 平均盈 / |平均亏| (R)
  profitFactor: number | null // ΣR+ / |ΣR-|;null=∞(零亏损——常见于小样本切片桶,显示层出「∞」,不可当数字比大小)
  expectancyR: number // 平均 R
  maxDDR: number // R 资金曲线最大回撤
  avgHoldBars: number
  targetRate: number
  stopRate: number
  timeRate: number
}

export function aggregate(trades: Trade[]): Metrics {
  const n = trades.length
  if (n === 0) {
    return {
      n: 0, winRate: 0, avgRetPct: 0, avgWinPct: 0, avgLossPct: 0, payoff: 0,
      profitFactor: 0, expectancyR: 0, maxDDR: 0, avgHoldBars: 0, targetRate: 0, stopRate: 0, timeRate: 0,
    }
  }
  const wins = trades.filter((t) => t.R > 0)
  const losses = trades.filter((t) => t.R <= 0)
  const grossWin = wins.reduce((s, t) => s + t.R, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.R, 0))
  // R 资金曲线最大回撤(按信号日时序)
  const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date))
  let cum = 0
  let peak = 0
  let maxDD = 0
  for (const t of ordered) {
    cum += t.R
    if (cum > peak) peak = cum
    if (peak - cum > maxDD) maxDD = peak - cum
  }
  const cnt = (r: Trade['reason'][]) => trades.filter((t) => r.includes(t.reason)).length
  return {
    n,
    winRate: r2((wins.length / n) * 100),
    avgRetPct: r2(mean(trades.map((t) => t.retPct))),
    avgWinPct: r2(mean(wins.map((t) => t.retPct))),
    avgLossPct: r2(mean(losses.map((t) => t.retPct))),
    payoff: r2(mean(wins.map((t) => t.R)) / Math.max(Math.abs(mean(losses.map((t) => t.R))), 1e-9)),
    // 零亏损时 grossWin/1e-9 会造出 ~10⁹ 的伪数误导小样本桶 → 用 null 表达 ∞(全败仍为 0)。
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? null : 0) : r2(grossWin / grossLoss),
    expectancyR: r2(mean(trades.map((t) => t.R))),
    maxDDR: r2(maxDD),
    avgHoldBars: r2(mean(trades.map((t) => t.bars))),
    targetRate: r2((cnt(['target', 'target-gap', 'trail']) / n) * 100),
    stopRate: r2((cnt(['stop', 'stop-gap']) / n) * 100),
    timeRate: r2((cnt(['time']) / n) * 100),
  }
}
