// 回测驱动的「入场×持有×目标/止损」网格寻优 + 样本外(train/test)前沿选择。
//
// 目标(用户口径):胜率为约束、期望为目标——每战法在网格里选「train.winRate≥40% 且
// expectancyR 最高」的配置,并报告其 test 段表现;仅 OOS 仍站得住(test.winRate≥35% 且
// expectancyR>0)的才标「推荐」。同时给胜率×期望前沿表供人工挑。propose-only:只产出
// 建议 diff,不自动改 config/screener.ts(防过拟合参数静默上线)。
//
// 运行:npm --prefix server run optimize
//   SAMPLE/KLINE/CACHE 沿用 backtest;OPT_STRATS=breakout,trendnew 选战法;
//   MIN_N=30 TRAIN_FRAC=0.7 GAP_PCTS=0,1,2 可调。
//
// 复用:engine 撮合内核 + universe 宇宙缓存 + 各 classify* 规则。纯读缓存 bars,零网络。
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { simForward, makeTrade, aggregate, type Trade, type Metrics } from './engine'
import { type StockBars, loadBarsCached } from './universe'
import type { Bar } from '../services/screenerRules'
import { classify } from '../services/screenerRules'
import { classifyPullback } from '../services/pullbackRules'
import { classifyHighDivergence } from '../services/divergenceRules'
import { classifyVolBreakout } from '../services/volBreakoutRules'
import { classifyTrendNewHigh } from '../services/trendNewHighRules'
import { SCREENER, PULLBACK, HIGHDIV, VOLBREAK, TRENDNEW } from '../config/screener'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', '..', 'docs', 'screener')

// ── ENV 可调 ─────────────────────────────────────────────────────────
const MIN_N = Number(process.env.MIN_N) || 30 // 一格最少成交数(防小样本假象)
const TRAIN_FRAC = Number(process.env.TRAIN_FRAC) || 0.7 // 训练段占比(按交易日切)
const WIN_FLOOR = 40 // 训练段胜率约束(%)
const TEST_WIN_FLOOR = 35 // 样本外胜率门槛(%)
const HOLDS = [2, 3, 4, 5, 20] // 短持有 + 20 作参照
const RMULTS = [1, 1.3, 1.5, 2, 2.5] // 目标盈亏倍数
const STOPS = [6, 8] // 止损封顶 %
const GAP_PCTS = (process.env.GAP_PCTS ?? '0,1,2').split(',').map((s) => Number(s.trim())).filter((x) => Number.isFinite(x))

const r2 = (n: number) => Math.round(n * 100) / 100

// ── 入场模式 ─────────────────────────────────────────────────────────
type EntryMode = 'close' | 'nextOpen' | 'nextGapUp'
interface EntryVariant {
  label: string
  mode: EntryMode
  gapPct: number
}
function entryVariants(): EntryVariant[] {
  const out: EntryVariant[] = [
    { label: 'close', mode: 'close', gapPct: 0 },
    { label: 'nextOpen', mode: 'nextOpen', gapPct: 0 },
  ]
  for (const g of GAP_PCTS) out.push({ label: `gapUp${g}`, mode: 'nextGapUp', gapPct: g })
  return out
}

// ── 战法定义(纯 OHLCV·统一 R:R 形状;排除 divergence/fundres——非 R_MULT 口径/需额外数据)──
interface Levels { entry: number; stop: number }
interface StrategyDef {
  key: string
  label: string
  baseCfg: Record<string, unknown>
  rMultKey: string // 目标倍数旋钮
  stopKey: string // 止损封顶旋钮
  extraCfg?: Record<string, unknown>
  start: (cfg: Record<string, unknown>) => number
  levels: (window: Bar[], cfg: Record<string, unknown>, code: string) => Levels | null
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)
const maStart = (cfg: Record<string, unknown>) => num(cfg.MA_LONG) + num(cfg.MA_LONG_RISE_LOOKBACK)
const minBarsStart = (cfg: Record<string, unknown>) => num(cfg.MIN_BARS)

const STRATEGIES: StrategyDef[] = [
  {
    key: 'breakout', label: '突破', baseCfg: SCREENER, rMultKey: 'TARGET_R_MULT', stopKey: 'STOP_MAX_PCT',
    extraCfg: { TARGET_MODE: 'rmult' }, start: maStart,
    levels: (w, cfg) => { const c = classify(w, cfg as never); return c && c.group === 'breakout' ? { entry: c.entry, stop: c.stopLoss } : null },
  },
  {
    key: 'trigger', label: '扳机', baseCfg: SCREENER, rMultKey: 'TARGET_R_MULT', stopKey: 'STARTER_STOP_PCT',
    extraCfg: { TARGET_MODE: 'rmult' }, start: maStart,
    levels: (w, cfg) => { const c = classify(w, cfg as never); return c && c.group === 'trigger' ? { entry: c.entry, stop: c.stopLoss } : null },
  },
  {
    key: 'pullback', label: '回调', baseCfg: PULLBACK, rMultKey: 'TARGET_R_MULT', stopKey: 'STOP_MAX_PCT',
    extraCfg: { TARGET_MODE: 'rmult' }, start: maStart,
    levels: (w, cfg) => { const c = classifyPullback(w, cfg as never); return c ? { entry: w[w.length - 1].close, stop: c.stopLoss } : null },
  },
  {
    key: 'highdiv', label: '新高分歧', baseCfg: HIGHDIV, rMultKey: 'R_MULT', stopKey: 'STOP_MAX', start: minBarsStart,
    levels: (w, cfg, code) => { const c = classifyHighDivergence(w, code, cfg as never); return c ? { entry: c.entry, stop: c.stop } : null },
  },
  {
    key: 'volbreak', label: '放量新高', baseCfg: VOLBREAK, rMultKey: 'R_MULT', stopKey: 'STOP_MAX_PCT', start: minBarsStart,
    levels: (w, cfg, code) => { const c = classifyVolBreakout(w, code, cfg as never); return c ? { entry: c.entry, stop: c.stop } : null },
  },
  // bhold 已移出网格:live/回测过线口径是「次日突破整理高点 trigger 确认入场」(0.45R),
  // 网格的 close/nextOpen/gapUp 变体搜的是 classifyBreakoutHold 的收盘位(0.17R 的口径),
  // 与真实策略不一致 → 网格结论无效。见 report.excluded。
  {
    key: 'trendnew', label: '趋势新高', baseCfg: TRENDNEW, rMultKey: 'R_MULT', stopKey: 'STOP_MAX_PCT', start: minBarsStart,
    levels: (w, cfg, code) => { const c = classifyTrendNewHigh(w, code, cfg as never); return c ? { entry: c.entry, stop: c.stop } : null },
  },
]

// ── 信号预计算(每 strategy×STOP 跑一次 classify;信号集与 R_MULT/入场/持有无关)──
interface Signal { idx: number; entry: number; stop: number; date: string }

function collectSignals(data: StockBars[], def: StrategyDef, stopVal: number): Signal[][] {
  const cfg = { ...def.baseCfg, ...def.extraCfg, [def.stopKey]: stopVal }
  const start = def.start(cfg)
  return data.map((sb) => {
    const out: Signal[] = []
    const len = sb.bars.length
    for (let i = start; i <= len - 2; i++) {
      const lv = def.levels(sb.bars.slice(0, i + 1), cfg, sb.code)
      if (lv && lv.entry > 0 && lv.entry - lv.stop > 0) out.push({ idx: i, entry: lv.entry, stop: lv.stop, date: sb.bars[i].date })
    }
    return out
  })
}

// ── 单笔入场撮合(纯函数·单测):按比率把 stop/target 重锚到实际进场价 → R 对复权不变 ──
export function simulateEntry(
  bars: Bar[], i: number, levels: { entry: number; stop: number; target: number },
  mode: EntryMode, gapPct: number, hold: number, code: string,
): { trade: Trade; entryIdx: number } | null {
  let entryIdx: number
  let entryPx: number
  if (mode === 'close') {
    entryIdx = i
    entryPx = bars[i].close
  } else {
    if (i + 1 >= bars.length) return null
    const next = bars[i + 1]
    if (mode === 'nextGapUp' && next.open < bars[i].close * (1 + gapPct / 100)) return null // 未高开 → 不入场
    entryIdx = i + 1
    entryPx = next.open
  }
  if (entryPx <= 0 || levels.entry <= 0) return null
  const stopFrac = levels.stop / levels.entry
  const targetFrac = levels.target / levels.entry
  const stop = entryPx * stopFrac
  const target = entryPx * targetFrac
  const risk = entryPx - stop
  if (risk <= 0) return null
  // 非 close 入场(次日开盘/高开)发生在 entryIdx 日盘初,当日剩余走势必须参与撮合
  const sim = simForward(bars, entryIdx, stop, target, hold, mode !== 'close')
  return { trade: makeTrade(code, bars, entryIdx, entryPx, stop, target, risk, sim), entryIdx }
}

// ── 一格回测:对预计算信号回放(冷却 entryIdx+hold+1),按 rMult 现算 target ──
function runCell(data: StockBars[], signalsByStock: Signal[][], rMult: number, v: EntryVariant, hold: number): Trade[] {
  const trades: Trade[] = []
  data.forEach((sb, si) => {
    let lastEntryIdx = -Infinity
    for (const s of signalsByStock[si]) {
      if (s.idx <= lastEntryIdx + hold) continue // 冷却:一仓在手不重叠
      const target = s.entry + rMult * (s.entry - s.stop)
      const res = simulateEntry(sb.bars, s.idx, { entry: s.entry, stop: s.stop, target }, v.mode, v.gapPct, hold, sb.code)
      if (!res) continue // 高开未达/无次根/风险≤0 → 不取、不冷却(同原 walk 的 i++)
      trades.push(res.trade)
      lastEntryIdx = res.entryIdx
    }
  })
  return trades
}

// ── 网格单元 + 前沿选择 ───────────────────────────────────────────────
export interface Cell {
  entry: string
  hold: number
  rMult: number
  stop: number
  train: Metrics
  test: Metrics
}

/** 约束(train.winRate≥40% & n≥MIN_N)下取期望最高、且 OOS 站得住的格;无则 null。 */
export function selectFrontier(cells: Cell[], minN: number): {
  recommended: Cell | null
  frontier: Cell[]
} {
  const eligible = cells
    .filter((c) => c.train.n >= minN && c.train.winRate >= WIN_FLOOR)
    .sort((a, b) => b.train.expectancyR - a.train.expectancyR)
  const recommended = eligible.find((c) => c.test.winRate >= TEST_WIN_FLOOR && c.test.expectancyR > 0) ?? null
  // 胜率×期望 Pareto 前沿(train 段;n≥minN):没有任何一格在两维上都更优。
  const pool = cells.filter((c) => c.train.n >= minN)
  const frontier = pool
    .filter((c) => !pool.some((o) => o !== c && o.train.winRate >= c.train.winRate && o.train.expectancyR >= c.train.expectancyR && (o.train.winRate > c.train.winRate || o.train.expectancyR > c.train.expectancyR)))
    .sort((a, b) => b.train.winRate - a.train.winRate)
  return { recommended, frontier }
}

// ── 时序切分:全样本交易日的 TRAIN_FRAC 分位作固定 cutoff ──
function trainCutoff(data: StockBars[]): string {
  const dates = new Set<string>()
  for (const sb of data) for (const b of sb.bars) dates.add(b.date)
  const sorted = [...dates].sort()
  return sorted[Math.floor(sorted.length * TRAIN_FRAC)] ?? sorted[sorted.length - 1] ?? ''
}

/** 时序泄漏防护(purge):信号日在 cutoff 前、但持有窗跨过 cutoff 的交易,其出场价来自
 *  test 段 K 线——旧版只按信号日二分,train 偷看了 test 段价格(边界带 ≈ max(HOLDS) 个
 *  交易日)。按 exitDate 精确判定:持有窗完全落在 train 段内才进 train;跨界带两集都
 *  不进,计入 purged 如实报告。 */
export function split(trades: Trade[], cutoff: string): { train: Metrics; test: Metrics; purged: number } {
  const train = trades.filter((t) => t.exitDate < cutoff)
  const test = trades.filter((t) => t.date >= cutoff)
  return { train: aggregate(train), test: aggregate(test), purged: trades.length - train.length - test.length }
}

// ── 输出格式 ─────────────────────────────────────────────────────────
function fmtCell(label: string, c: Cell): string {
  const f = (m: Metrics) => `胜率${String(m.winRate).padStart(5)}% 期望${String(m.expectancyR).padStart(6)}R PF${String(m.profitFactor ?? '∞').padStart(5)} n${String(m.n).padStart(4)}`
  return `${label.padEnd(30)} train[${f(c.train)}]  test[${f(c.test)}]`
}

// ── 主流程 ───────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now()
  const stratFilter = (process.env.OPT_STRATS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const strategies = stratFilter.length ? STRATEGIES.filter((s) => stratFilter.includes(s.key)) : STRATEGIES
  console.log(`[Optimize] 战法 ${strategies.map((s) => s.key).join(',')} | 入场 ${entryVariants().map((v) => v.label).join(',')} | hold ${HOLDS.join(',')} | R ${RMULTS.join(',')} | stop ${STOPS.join(',')} | MIN_N=${MIN_N} TRAIN_FRAC=${TRAIN_FRAC}`)

  const data = await loadBarsCached()
  const asof = data.reduce((m, sb) => { const d = sb.bars[sb.bars.length - 1]?.date ?? ''; return d > m ? d : m }, '')
  const cutoff = trainCutoff(data)
  console.log(`[Optimize] 样本 ${data.length} 只,train/test 切分日=${cutoff}（前=train）`)

  const variants = entryVariants()
  const cellsPerStrat = variants.length * HOLDS.length * RMULTS.length * STOPS.length
  console.log(`[Optimize] 每战法 ${cellsPerStrat} 格 × ${strategies.length} 战法\n`)

  const report: Record<string, unknown> = { asof, generatedAt: new Date().toISOString(), cutoff, params: { MIN_N, TRAIN_FRAC, HOLDS, RMULTS, STOPS, gapPcts: GAP_PCTS, winFloor: WIN_FLOOR, testWinFloor: TEST_WIN_FLOOR }, excluded: { divergence: '止损锚昨收·目标=涨停价,R_MULT 不适用', fundres: '需机构调研历史(非纯OHLCV)', bhold: 'live 口径=次日突破整理高点 trigger 确认入场(0.45R),网格 close/nextOpen 变体与之不符 → 结论无效;confirm 变体网格如需另行实现' }, strategies: {} }

  for (const def of strategies) {
    const cells: Cell[] = []
    let purgedSum = 0 // 跨 cutoff 持有窗被 purge 的交易总数(全部格累计,如实报告)
    for (const stopVal of STOPS) {
      const signals = collectSignals(data, def, stopVal) // 每 strategy×STOP 跑一次 classify
      for (const v of variants) {
        for (const hold of HOLDS) {
          for (const rMult of RMULTS) {
            const sm = split(runCell(data, signals, rMult, v, hold), cutoff)
            purgedSum += sm.purged
            cells.push({ entry: v.label, hold, rMult, stop: stopVal, train: sm.train, test: sm.test })
          }
        }
      }
    }
    const { recommended, frontier } = selectFrontier(cells, MIN_N)
    // baseline 参照:用战法「真实默认」R/STOP 显式跑一格(close + hold20),诚实「before」。
    // (默认 STOP 可能不在网格 STOPS 里,故单独 collectSignals,不从网格里凑近似格。)
    const baseR = num((def.baseCfg as Record<string, unknown>)[def.rMultKey])
    const baseStop = num((def.baseCfg as Record<string, unknown>)[def.stopKey])
    const baseSignals = collectSignals(data, def, baseStop)
    const bsplit = split(runCell(data, baseSignals, baseR, { label: 'close', mode: 'close', gapPct: 0 }, 20), cutoff)
    const baseline: Cell = { entry: 'close', hold: 20, rMult: baseR, stop: baseStop, train: bsplit.train, test: bsplit.test }

    console.log(`========== ${def.label}(${def.key})==========`)
    console.log(`  (purge:全格累计剔除跨 cutoff 持有窗交易 ${purgedSum} 笔,两集皆不计)`)
    console.log(fmtCell(`baseline(close/h20/R${baseR}/S${baseStop})`, baseline))
    if (recommended) {
      console.log(fmtCell(`✅推荐 ${recommended.entry}/h${recommended.hold}/R${recommended.rMult}/S${recommended.stop}`, recommended))
    } else {
      console.log('  ⚠ 约束带内(train胜率≥40% 且 OOS 站得住)无配置——如实报告 recommended=null,不强凑。')
    }
    console.log('  前沿(胜率×期望 Pareto,train):')
    for (const c of frontier.slice(0, 6)) console.log(fmtCell(`   ${c.entry}/h${c.hold}/R${c.rMult}/S${c.stop}`, c))
    console.log('')

    ;(report.strategies as Record<string, unknown>)[def.key] = {
      label: def.label,
      baseline,
      recommended,
      suggestedConfigDiff: recommended ? { [def.rMultKey]: recommended.rMult, [def.stopKey]: recommended.stop, _entryMode: recommended.entry, _hold: recommended.hold } : null,
      frontier,
      allCells: cells,
      purgedTradesTotal: purgedSum, // 跨 cutoff 持有窗、两集皆不进的交易(泄漏防护)累计
    }
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `backtest-grid-${asof}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`[Optimize] 完成,用时 ${r2((Date.now() - t0) / 1000)}s。结果已写入 ${file}`)
}

// 仅在直接执行时跑 main();被测试 import 时不触发(pathToFileURL 归一 Windows 路径)。
const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((e) => {
    console.error('[Optimize] 失败:', e)
    process.exit(1)
  })
}
