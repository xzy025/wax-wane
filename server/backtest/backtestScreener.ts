// 新高战法选股器 · 走查式(walk-forward)历史回测 + 阈值参数扫描。
//
// 方法论(诚实声明其偏差):
//  1. 宇宙(universe):取当前东财全市场 clist,仅按 ST/退、流动性、市值过滤(不掺动量,
//     否则会引入"只测当下强势股"的前视偏差),再做跨代码段分层抽样到 SAMPLE 只。
//     ⚠ 幸存者偏差不可避免:已退市/已 ST 的票不在 clist 里 → 结果偏乐观,把数字当
//     相对比较(参数 A vs B)而非绝对收益预期。
//  2. 对每只票取 KLINE 根前复权日线;从第 (MA250+lookback+1) 根起逐日切片,
//     对切片跑与线上完全一致的 classify(),仅回测 breakout(实际买入信号)。
//  3. 成交:信号日收盘价进场(EOD 信号),止损/目标用 classify 给出的 stopLoss/target,
//     向后 HOLD 个交易日逐日撮合(跳空在开盘成交;同日止损与目标同现时保守判止损先到);
//     未触发则 HOLD 末日收盘时间止损。每票同一时间仅一仓(冷却 HOLD 根防重叠)。
//  4. 指标:胜率、平均盈/亏、盈亏比(payoff)、盈亏因子(profit factor)、
//     期望(每笔平均 R 与平均收益%)、R 资金曲线最大回撤、目标/止损/时间出场占比。
//  5. 参数扫描:逐个阈值在缓存好的 K 线上重跑(注入 cfg 覆盖版),对比期望/胜率/样本量。
//
// 运行: npm --prefix server run backtest   (可用环境变量调参,见下方 ENV)
//   SAMPLE=300 KLINE=700 HOLD=20 SWEEP=1 npm --prefix server run backtest

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { EM_HEADERS } from '../lib/emHeaders'
import { fetchStockKline, fetchIndexKline } from '../services/ashare'
import { SCREENER, type ScreenerConfig } from '../config/screener'
import { classify, marketRegime, type Bar, type MarketRegime } from '../services/screenerRules'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', '..', 'docs', 'screener')

// ── ENV 可调 ──────────────────────────────────────────────────────────
const SAMPLE = Number(process.env.SAMPLE) || 300 // 抽样只数
const KLINE = Number(process.env.KLINE) || 700 // 每票取多少根日线
const HOLD = Number(process.env.HOLD) || 20 // 持有/观察的最大交易日数
const CONCURRENCY = Number(process.env.CONCURRENCY) || 12
const DO_SWEEP = process.env.SWEEP !== '0' // 默认做参数扫描
const RUN_TRIGGER = process.env.TRIGGER !== '0' // 默认做扳机组诊断(#3)
const RUN_REGIME = process.env.REGIME !== '0' // 默认做动态目标位(大盘环境)验证

type RMap = Record<MarketRegime, number>

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
const r2 = (n: number) => Math.round(n * 100) / 100
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

// ── Universe: clist 取数 + 廉价过滤(不含动量)+ 分层抽样 ────────────────
const CLIST_FIELDS = 'f2,f6,f12,f14,f20'
const CLIST_PZ = 100
const CLIST_HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '82.push2.eastmoney.com']

async function fetchClistPage(pn: number, attempt = 0): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  for (let i = 0; i < CLIST_HOSTS.length; i++) {
    const host = CLIST_HOSTS[(pn + i) % CLIST_HOSTS.length]
    const url =
      `https://${host}/api/qt/clist/get?pn=${pn}&pz=${CLIST_PZ}&po=1&np=1&fltt=2&invt=2&fid=f3` +
      `&fs=${encodeURIComponent(SCREENER.CLIST_FS)}&fields=${CLIST_FIELDS}`
    try {
      const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`clist HTTP ${res.status}`)
      const json = await res.json()
      return { rows: (json?.data?.diff ?? []) as Record<string, unknown>[], total: Number(json?.data?.total) || 0 }
    } catch {
      /* 试下一个镜像 */
    }
  }
  if (attempt < 1) {
    await new Promise((r) => setTimeout(r, 800))
    return fetchClistPage(pn, attempt + 1)
  }
  throw new Error('clist 全部镜像均失败')
}

interface UnivStock {
  code: string
  name: string
}

async function buildUniverse(): Promise<UnivStock[]> {
  const first = await fetchClistPage(1)
  const total = first.total || first.rows.length
  const pages = Math.min(Math.ceil(total / CLIST_PZ), 60)
  const diff: Record<string, unknown>[] = [...first.rows]
  for (let pn = 2; pn <= pages; pn++) {
    await new Promise((r) => setTimeout(r, 120))
    try {
      const page = await fetchClistPage(pn)
      if (page.rows.length === 0) break
      diff.push(...page.rows)
    } catch {
      console.warn(`[Backtest] clist 第 ${pn} 页失败,使用已取 ${diff.length} 只继续`)
      break
    }
  }

  const eligible: UnivStock[] = []
  for (const d of diff) {
    const code = String(d.f12 ?? '')
    const name = String(d.f14 ?? '')
    const price = num(d.f2)
    const amount = num(d.f6)
    const mcap = num(d.f20)
    if (!code || price <= 0) continue
    if (/ST|退/i.test(name)) continue
    if (amount < SCREENER.LIQUIDITY_MIN) continue // 当下流动性(近似:活跃票才有历史可测)
    if (mcap < SCREENER.MCAP_MIN) continue
    eligible.push({ code, name })
  }
  // 按代码排序后等距分层抽样,跨 600/000/300/688 各段均匀覆盖,避免偏向某板块。
  eligible.sort((a, b) => a.code.localeCompare(b.code))
  if (eligible.length <= SAMPLE) return eligible
  const step = eligible.length / SAMPLE
  const sampled: UnivStock[] = []
  for (let i = 0; i < SAMPLE; i++) sampled.push(eligible[Math.floor(i * step)])
  return sampled
}

// ── 取 K 线(并发受限)────────────────────────────────────────────────
interface StockBars {
  code: string
  name: string
  bars: Bar[]
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let idx = 0
  const worker = async () => {
    while (idx < items.length) {
      const cur = idx++
      out[cur] = await fn(items[cur], cur)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function loadBars(univ: UnivStock[]): Promise<StockBars[]> {
  let done = 0
  const res = await mapLimit(univ, CONCURRENCY, async (s) => {
    try {
      const { klines } = await fetchStockKline(s.code, 101, KLINE)
      done++
      if (done % 50 === 0) console.log(`[Backtest] 取K线 ${done}/${univ.length}`)
      if (!klines || klines.length < SCREENER.MA_LONG + SCREENER.MA_LONG_RISE_LOOKBACK + 1 + HOLD + 2) return null
      return { code: s.code, name: s.name, bars: klines as Bar[] }
    } catch {
      done++
      return null
    }
  })
  return res.filter((x): x is StockBars => x != null)
}

// 抽样宇宙是确定性的(按代码分层),故同 SAMPLE+KLINE 的 K 线可缓存到盘上,
// 重跑(调参/换指数)免再打 EM,也避免触发限流。CACHE=0 强制重取。
const USE_CACHE = process.env.CACHE !== '0'
const BARS_CACHE = join(OUT_DIR, `.bars-${SAMPLE}-${KLINE}.json`)

async function loadBarsCached(): Promise<StockBars[]> {
  if (USE_CACHE && existsSync(BARS_CACHE)) {
    try {
      const data = JSON.parse(readFileSync(BARS_CACHE, 'utf8')) as StockBars[]
      if (Array.isArray(data) && data.length) {
        console.log(`[Backtest] 复用缓存 K 线 ${data.length} 只 (${BARS_CACHE};CACHE=0 可强制重取)`)
        return data
      }
    } catch {
      /* 缓存损坏,重取 */
    }
  }
  console.log('[Backtest] 构建宇宙(clist 全市场 → 过滤 → 抽样)...')
  const univ = await buildUniverse()
  console.log(`[Backtest] 抽样 ${univ.length} 只,开始取 K 线...`)
  const data = await loadBars(univ)
  // 仅在取数较完整时落缓存,避免把"被限流的残缺结果"写进缓存毒化后续重跑。
  if (data.length >= univ.length * 0.6) {
    try {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(BARS_CACHE, JSON.stringify(data))
    } catch {
      /* 缓存写失败非致命 */
    }
  } else {
    console.warn(`[Backtest] 有效样本仅 ${data.length}/${univ.length}(疑似限流),不落缓存`)
  }
  return data
}

// ── 一笔模拟成交 ──────────────────────────────────────────────────────
interface Trade {
  code: string
  date: string // 信号日(进场日)
  entry: number
  stop: number
  target: number
  exit: number
  exitDate: string
  reason: 'target' | 'target-gap' | 'stop' | 'stop-gap' | 'time'
  retPct: number
  R: number
  bars: number // 持有交易日数
  regime?: MarketRegime // 信号日的大盘环境(动态目标位用)
}

/** 向后撮合内核:从信号日 i 进场,逐日判止损/目标,跳空开盘成交、同日止损优先、HOLD 末日时间止损。 */
function simForward(
  bars: Bar[],
  i: number,
  stop: number,
  target: number,
  hold: number,
): { exit: number; reason: Trade['reason']; exitIdx: number } {
  const len = bars.length
  const end = Math.min(i + hold, len - 1)
  let exit = bars[end].close // 默认时间止损
  let reason: Trade['reason'] = 'time'
  let exitIdx = end
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
function makeTrade(
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

/** 走查回测某一组(默认 breakout 买点),hold 可变(供 HOLD 扫描)。
 *  regimeByDate 给定则给每笔打上信号日大盘环境;rMap 给定则按环境覆盖目标位 = 进场 + R×风险。 */
function simulate(
  sb: StockBars,
  cfg: ScreenerConfig,
  group: 'breakout' | 'trigger' = 'breakout',
  hold = HOLD,
  regimeByDate?: Map<string, MarketRegime>,
  rMap?: RMap,
): Trade[] {
  const { bars } = sb
  const len = bars.length
  const start = cfg.MA_LONG + cfg.MA_LONG_RISE_LOOKBACK // 切片需 +1 长度
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classify(bars.slice(0, i + 1), cfg)
    if (!cand || cand.group !== group) {
      i++
      continue
    }
    const entry = bars[i].close
    const stop = cand.stopLoss
    const risk = entry - stop
    if (risk <= 0) {
      i++
      continue
    }
    const regime = regimeByDate?.get(bars[i].date)
    const target = rMap && regime ? entry + rMap[regime] * risk : cand.target
    const t = makeTrade(sb.code, bars, i, entry, stop, target, risk, simForward(bars, i, stop, target, hold))
    if (regime) t.regime = regime
    trades.push(t)
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

// ── 指标聚合 ──────────────────────────────────────────────────────────
interface Metrics {
  n: number
  winRate: number
  avgRetPct: number
  avgWinPct: number
  avgLossPct: number
  payoff: number // 平均盈 / |平均亏| (R)
  profitFactor: number // ΣR+ / |ΣR-|
  expectancyR: number // 平均 R
  maxDDR: number // R 资金曲线最大回撤
  avgHoldBars: number
  targetRate: number
  stopRate: number
  timeRate: number
}

function aggregate(trades: Trade[]): Metrics {
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
    profitFactor: r2(grossWin / Math.max(grossLoss, 1e-9)),
    expectancyR: r2(mean(trades.map((t) => t.R))),
    maxDDR: r2(maxDD),
    avgHoldBars: r2(mean(trades.map((t) => t.bars))),
    targetRate: r2((cnt(['target', 'target-gap']) / n) * 100),
    stopRate: r2((cnt(['stop', 'stop-gap']) / n) * 100),
    timeRate: r2((cnt(['time']) / n) * 100),
  }
}

function runConfig(
  data: StockBars[],
  cfg: ScreenerConfig,
  regimeByDate?: Map<string, MarketRegime>,
  rMap?: RMap,
): { metrics: Metrics; trades: Trade[] } {
  const trades = data.flatMap((sb) => simulate(sb, cfg, 'breakout', HOLD, regimeByDate, rMap))
  return { metrics: aggregate(trades), trades }
}

/** 用指数收盘序列为每个交易日打大盘环境标签。 */
function buildRegimeByDate(idxBars: { date: string; close: number }[], cfg: ScreenerConfig): Map<string, MarketRegime> {
  const closes = idxBars.map((b) => b.close)
  const m = new Map<string, MarketRegime>()
  for (let i = 0; i < idxBars.length; i++) m.set(idxBars[i].date, marketRegime(closes.slice(0, i + 1), cfg))
  return m
}

/** 按大盘环境拆分交易。 */
function splitByRegime(trades: Trade[]): Record<MarketRegime, Trade[]> {
  const out: Record<MarketRegime, Trade[]> = { strong: [], neutral: [], weak: [] }
  for (const t of trades) if (t.regime) out[t.regime].push(t)
  return out
}

function fmtMetrics(label: string, m: Metrics): string {
  return (
    `${label.padEnd(22)} n=${String(m.n).padStart(4)}  胜率 ${String(m.winRate).padStart(5)}%  ` +
    `期望 ${String(m.expectancyR).padStart(6)}R  盈亏比 ${String(m.payoff).padStart(5)}  PF ${String(m.profitFactor).padStart(5)}  ` +
    `平均收益 ${String(m.avgRetPct).padStart(6)}%  最大回撤 ${String(m.maxDDR).padStart(6)}R  ` +
    `[目标 ${m.targetRate}% / 止损 ${m.stopRate}% / 时间 ${m.timeRate}%]`
  )
}

// ── 主流程 ────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now()
  console.log(`[Backtest] 配置 SAMPLE=${SAMPLE} KLINE=${KLINE} HOLD=${HOLD} 并发=${CONCURRENCY} 扫描=${DO_SWEEP} 扳机=${RUN_TRIGGER} 大盘环境=${RUN_REGIME}`)

  const data = await loadBarsCached()
  const allDates = data.flatMap((d) => [d.bars[0].date, d.bars[d.bars.length - 1].date])
  const dateMin = allDates.reduce((a, b) => (a < b ? a : b), '9999')
  const dateMax = allDates.reduce((a, b) => (a > b ? a : b), '0000')
  console.log(`[Backtest] 有效样本 ${data.length} 只,K 线区间 ${dateMin} ~ ${dateMax}`)

  // 基线
  const base = runConfig(data, SCREENER)
  console.log('\n========== 基线(当前 config/screener.ts)==========')
  console.log(fmtMetrics('baseline', base.metrics))

  const out: Record<string, unknown> = {
    asof: dateMax,
    meta: {
      sample: SAMPLE,
      validSample: data.length,
      kline: KLINE,
      hold: HOLD,
      dateRange: [dateMin, dateMax],
      note: '幸存者偏差(已退市/ST 票不在 clist)使绝对收益偏乐观;以相对比较为准。信号日收盘进场。candidates=#2目标位模式对比;triggerEval=#3扳机组诊断。',
      targetMode: SCREENER.TARGET_MODE,
    },
    baselineConfig: SCREENER,
    baseline: base.metrics,
  }

  // #2 目标位模式对比(叠加在已校准的 close.75/stop7 基线之上)。
  // baseline 已是 resistance(payoff≈0.5),对比 rmult/measured/atr 哪种把 payoff 抬过 1。
  const candidates: Array<{ name: string; over: Partial<ScreenerConfig> }> = [
    { name: 'target-resistance', over: { TARGET_MODE: 'resistance' } },
    { name: 'target-rmult-1.5', over: { TARGET_MODE: 'rmult', TARGET_R_MULT: 1.5 } },
    { name: 'target-rmult-2', over: { TARGET_MODE: 'rmult', TARGET_R_MULT: 2 } },
    { name: 'target-rmult-2.5', over: { TARGET_MODE: 'rmult', TARGET_R_MULT: 2.5 } },
    { name: 'target-rmult-3', over: { TARGET_MODE: 'rmult', TARGET_R_MULT: 3 } },
    { name: 'target-measured-40', over: { TARGET_MODE: 'measured', BASE_LOOKBACK: 40 } },
    { name: 'target-measured-60', over: { TARGET_MODE: 'measured', BASE_LOOKBACK: 60 } },
    { name: 'target-atr-4', over: { TARGET_MODE: 'atr', TARGET_ATR_MULT: 4 } },
    { name: 'target-atr-6', over: { TARGET_MODE: 'atr', TARGET_ATR_MULT: 6 } },
  ]
  console.log(`\n========== #2 目标位模式对比(HOLD=${HOLD})==========`)
  const candOut: Array<{ name: string; over: Partial<ScreenerConfig>; metrics: Metrics }> = []
  for (const c of candidates) {
    const cfg = { ...SCREENER, ...c.over } as ScreenerConfig
    const { metrics } = runConfig(data, cfg)
    console.log(fmtMetrics(c.name, metrics))
    candOut.push({ name: c.name, over: c.over, metrics })
  }
  out.candidates = candOut

  if (DO_SWEEP) {
    const sweeps: Array<{ key: keyof ScreenerConfig; values: number[] }> = [
      { key: 'BREAKOUT_VOL', values: [1.3, 1.5, 1.8, 2.2, 2.6] },
      { key: 'EXT_MAX', values: [2, 3, 5, 8, 12] },
      { key: 'CLOSE_STRENGTH', values: [0.5, 0.6, 0.66, 0.75, 0.85] },
      { key: 'STOP_MAX_PCT', values: [5, 7, 8, 10, 12] },
      { key: 'HI52_NEAR', values: [0.8, 0.85, 0.9, 0.92] },
      { key: 'RESIST_LOOKBACK', values: [120, 180, 250] },
    ]
    const sweepOut: Record<string, Array<{ value: number; metrics: Metrics }>> = {}
    for (const s of sweeps) {
      const key = String(s.key)
      console.log(`\n---------- 扫描 ${key}(基线=${(SCREENER as Record<string, unknown>)[key]})----------`)
      sweepOut[key] = []
      for (const v of s.values) {
        const cfg = { ...SCREENER, [s.key]: v } as ScreenerConfig
        const { metrics } = runConfig(data, cfg)
        console.log(fmtMetrics(`${key}=${v}`, metrics))
        sweepOut[key].push({ value: v, metrics })
      }
    }
    // HOLD 是回测参数(非 config),单独扫:用基线 cfg,改全局 HOLD 不便,这里用临时实现。
    console.log(`\n---------- 扫描 HOLD(持有天数,基线=${HOLD})----------`)
    const holdOut: Array<{ value: number; metrics: Metrics }> = []
    for (const h of [10, 15, 20, 30, 40]) {
      const trades = data.flatMap((sb) => simulate(sb, SCREENER, 'breakout', h))
      const metrics = aggregate(trades)
      console.log(fmtMetrics(`HOLD=${h}`, metrics))
      holdOut.push({ value: h, metrics })
    }
    out.sweeps = sweepOut
    out.holdSweep = holdOut
  }

  // #3 扳机(trigger)组诊断:转化率 + 前看收益 + 直接买入表现 + 阈值扫描。
  if (RUN_TRIGGER) {
    console.log('\n========== #3 扳机(trigger)组诊断 ==========')
    const trigOut: Array<Record<string, unknown>> = []
    for (const cd of [10, 20]) {
      const te = evaluateTriggers(data, SCREENER, cd, HOLD)
      console.log(
        `convDays=${String(cd).padStart(2)}  n=${String(te.n).padStart(4)}  转化率 ${String(te.convRate).padStart(5)}%  ` +
          `平均转化 ${te.avgConvDays}d  前看[5d ${te.fwd5}% / 10d ${te.fwd10}% / 20d ${te.fwd20}%]  10d胜率 ${te.fwdWin10}%`,
      )
      console.log('  ' + fmtMetrics(`trigger直买(cd=${cd})`, te.directBuy))
      trigOut.push({ convDays: cd, ...te })
    }
    // 扳机阈值扫描:看哪个 NEAR_PCT / VOL_DRY_MAX 给出更高转化率与前看收益(convDays=10)。
    console.log('\n---------- 扫描 NEAR_PCT(扳机·基线=5)----------')
    const nearOut: Array<Record<string, unknown>> = []
    for (const np of [3, 4, 5, 6, 8]) {
      const te = evaluateTriggers(data, { ...SCREENER, NEAR_PCT: np } as ScreenerConfig, 10, HOLD)
      console.log(`NEAR_PCT=${np}  n=${String(te.n).padStart(4)}  转化率 ${String(te.convRate).padStart(5)}%  前看10d ${te.fwd10}%  直买期望 ${te.directBuy.expectancyR}R`)
      nearOut.push({ value: np, n: te.n, convRate: te.convRate, fwd10: te.fwd10, directExpR: te.directBuy.expectancyR })
    }
    console.log('\n---------- 扫描 VOL_DRY_MAX(扳机·基线=0.9)----------')
    const vdOut: Array<Record<string, unknown>> = []
    for (const vd of [0.7, 0.8, 0.9, 1.0]) {
      const te = evaluateTriggers(data, { ...SCREENER, VOL_DRY_MAX: vd } as ScreenerConfig, 10, HOLD)
      console.log(`VOL_DRY_MAX=${vd}  n=${String(te.n).padStart(4)}  转化率 ${String(te.convRate).padStart(5)}%  前看10d ${te.fwd10}%  直买期望 ${te.directBuy.expectancyR}R`)
      vdOut.push({ value: vd, n: te.n, convRate: te.convRate, fwd10: te.fwd10, directExpR: te.directBuy.expectancyR })
    }
    out.triggerEval = trigOut
    out.triggerNearSweep = nearOut
    out.triggerVolDrySweep = vdOut
  }

  // 动态目标位:用指数趋势代理大盘环境,验证"分环境表现有差异 + 动态R优于固定R"。
  if (RUN_REGIME) {
    console.log('\n========== 动态目标位 · 大盘环境(指数趋势代理)==========')
    const INDICES = [
      { name: '沪深300', secid: '1.000300' },
      { name: '创业板指', secid: '0.399006' },
      { name: '中证全指', secid: '1.000985' },
    ]
    const rMaps: Record<string, RMap> = {
      'fixed-2.0': { strong: 2.0, neutral: 2.0, weak: 2.0 },
      'fixed-2.5': { strong: 2.5, neutral: 2.5, weak: 2.5 },
      'fixed-3.0': { strong: 3.0, neutral: 3.0, weak: 3.0 },
      'dyn-conservative(3/2.5/2)': { strong: 3.0, neutral: 2.5, weak: 2.0 },
      'dyn-aggressive(3.5/2.5/1.5)': { strong: 3.5, neutral: 2.5, weak: 1.5 },
      // 逆向(数据显示弱市新高=真龙头,跑更远):强市收近、弱市放远。
      'dyn-inverse-mild(2/2.5/3)': { strong: 2.0, neutral: 2.5, weak: 3.0 },
      'dyn-inverse-strong(2/3/3.5)': { strong: 2.0, neutral: 3.0, weak: 3.5 },
    }
    const regimeOut: Record<string, unknown> = {}
    for (const idx of INDICES) {
      let idxBars: { date: string; close: number }[]
      try {
        idxBars = await fetchIndexKline(idx.secid, KLINE + 60)
      } catch (err) {
        console.warn(`[Backtest] 指数 ${idx.name} 取数失败,跳过:`, err)
        continue
      }
      const regimeByDate = buildRegimeByDate(idxBars, SCREENER)
      // (a) 假设检验:按环境拆分固定 2.5R 的交易
      const tagged = runConfig(data, SCREENER, regimeByDate) // SCREENER 默认 rmult/2.5
      const byReg = splitByRegime(tagged.trades)
      const total = tagged.trades.filter((t) => t.regime).length || 1
      console.log(`\n--- ${idx.name}(${idx.secid}) 按环境拆分(固定2.5R)---`)
      for (const rg of ['strong', 'neutral', 'weak'] as MarketRegime[]) {
        const share = r2((byReg[rg].length / total) * 100)
        console.log(fmtMetrics(`  ${rg}(${share}%)`, aggregate(byReg[rg])))
      }
      // (b) 动态 vs 固定
      console.log(`--- ${idx.name} 动态 vs 固定 ---`)
      const cmp: Record<string, Metrics> = {}
      for (const [name, rMap] of Object.entries(rMaps)) {
        const { metrics } = runConfig(data, SCREENER, regimeByDate, rMap)
        console.log(fmtMetrics(`  ${name}`, metrics))
        cmp[name] = metrics
      }
      regimeOut[idx.name] = {
        secid: idx.secid,
        byRegime: Object.fromEntries(
          (['strong', 'neutral', 'weak'] as MarketRegime[]).map((rg) => [rg, { n: byReg[rg].length, metrics: aggregate(byReg[rg]) }]),
        ),
        compare: cmp,
      }
    }
    out.regimeEval = regimeOut
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `backtest-${dateMax}.json`)
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`\n[Backtest] 完成,用时 ${r2((Date.now() - t0) / 1000)}s。结果已写入 ${file}`)
}

// ── #3 扳机(trigger)组诊断 ────────────────────────────────────────────
interface TriggerEval {
  n: number
  convRate: number // convDays 内转化为 breakout 的比例(%)
  avgConvDays: number // 平均转化天数
  fwd5: number // 平均前看收益%(纯收盘,不带止损)
  fwd10: number
  fwd20: number
  fwdWin10: number // 10 日前看为正的比例(%)
  directBuy: Metrics // 直接买入扳机(用 trigger 的 stop/target)的交易指标
}

/**
 * 走查遍历 trigger 信号:① 是否在 convDays 内转成 breakout(转化率/转化天数);
 * ② 纯前看收益 5/10/20 日;③ 直接买入扳机(等不等突破确认的对照)。
 */
function evaluateTriggers(data: StockBars[], cfg: ScreenerConfig, convDays: number, hold: number): TriggerEval {
  let n = 0
  let conv = 0
  let convDaysSum = 0
  const fwd5: number[] = []
  const fwd10: number[] = []
  const fwd20: number[] = []
  const directTrades: Trade[] = []
  for (const sb of data) {
    const { bars } = sb
    const len = bars.length
    const start = cfg.MA_LONG + cfg.MA_LONG_RISE_LOOKBACK
    let i = start
    while (i <= len - 2) {
      const cand = classify(bars.slice(0, i + 1), cfg)
      if (!cand || cand.group !== 'trigger') {
        i++
        continue
      }
      n++
      const fret = (k: number) => (i + k < len ? (bars[i + k].close / bars[i].close - 1) * 100 : NaN)
      const f5 = fret(5)
      const f10 = fret(10)
      const f20 = fret(20)
      if (!Number.isNaN(f5)) fwd5.push(f5)
      if (!Number.isNaN(f10)) fwd10.push(f10)
      if (!Number.isNaN(f20)) fwd20.push(f20)
      // 转化:convDays 内是否出现 breakout
      const cend = Math.min(i + convDays, len - 1)
      for (let j = i + 1; j <= cend; j++) {
        const c2 = classify(bars.slice(0, j + 1), cfg)
        if (c2 && c2.group === 'breakout') {
          conv++
          convDaysSum += j - i
          break
        }
      }
      // 直接买入扳机本身(对照"等突破确认")
      const entry = bars[i].close
      const stop = cand.stopLoss
      const target = cand.target
      const risk = entry - stop
      if (risk > 0) {
        directTrades.push(makeTrade(sb.code, bars, i, entry, stop, target, risk, simForward(bars, i, stop, target, hold)))
      }
      i = i + hold + 1 // 冷却
    }
  }
  return {
    n,
    convRate: r2(n ? (conv / n) * 100 : 0),
    avgConvDays: r2(conv ? convDaysSum / conv : 0),
    fwd5: r2(mean(fwd5)),
    fwd10: r2(mean(fwd10)),
    fwd20: r2(mean(fwd20)),
    fwdWin10: r2(fwd10.length ? (fwd10.filter((x) => x > 0).length / fwd10.length) * 100 : 0),
    directBuy: aggregate(directTrades),
  }
}

main().catch((err) => {
  console.error('[Backtest] 失败:', err)
  process.exit(1)
})
