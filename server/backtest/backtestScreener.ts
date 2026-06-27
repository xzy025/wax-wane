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
import { SCREENER, PULLBACK, DIVERGENCE, HIGHDIV, VOLBREAK, FUNDRES, BHOLD, PBREAK, TRENDNEW, type ScreenerConfig, type PullbackConfig, type DivergenceConfig, type HighDivConfig, type VolBreakConfig, type FundResConfig, type BreakoutHoldConfig, type BreakoutPullbackConfig, type TrendNewConfig } from '../config/screener'
import { classify, marketRegime, smaAt, type Bar, type MarketRegime } from '../services/screenerRules'
import { classifyPullback } from '../services/pullbackRules'
import { classifyDivergence, classifyHighDivergence, type DivergenceGroup } from '../services/divergenceRules'
import { classifyVolBreakout } from '../services/volBreakoutRules'
import { classifyFundResonance } from '../services/fundResonanceRules'
import { classifyBreakoutHold } from '../services/breakoutHoldRules'
import { classifyTrendNewHigh } from '../services/trendNewHighRules'
import { classifyBreakoutPullback } from '../services/breakoutPullbackRules'
import { technicalCombo } from '../services/technicalScore'
import { fetchOrgSurveyHistory, countOrgsInRange, type SurveyEvent } from '../services/orgSurvey'
import { boardStrengthAsOf } from '../services/rotationRules'
import {
  buildLhbIndex,
  lhbFactorFor,
  serializeLhbIndex,
  deserializeLhbIndex,
  type LhbIndex,
  type LhbFactor,
} from '../services/lhbHistory'
import { resolveStockIndustryBoard } from '../services/rotation'

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
// COMBO: 龙虎榜(机构) + 板块轮动 因子检验(取数重,默认关;COMBO=1 开启)
const RUN_COMBO = process.env.COMBO === '1'
// PULLBACK: 回调二次启动 / 圆弧底反包 战法回测(新形态,默认关;PULLBACK=1 开启)
const RUN_PULLBACK = process.env.PULLBACK === '1'
// PYRAMID: 金字塔+保本/跟踪 进场方案回测(½突破进→+1R加½移保本→+2R跌破MA跟踪,默认关;PYRAMID=1 开启)
const RUN_PYRAMID = process.env.PYRAMID === '1'
// DIVERGENCE: 打板·连板分歧低吸 战法回测(分歧日尾盘进→次日反包/破位,默认关;DIVERGENCE=1 开启)
// ⚠ 缓存 bars 多为兜底源(无成交额)→ 弱转强用典型价(H+L+C)/3 代理,仅作方向性参考;真 VWAP 须新缓存。
const RUN_DIVERGENCE = process.env.DIVERGENCE === '1'
// HIGHDIV: 连续新高·缩量十字星·守MA5 分歧低吸(纯OHLCV,可真回测;默认关;HIGHDIV=1 开启)
const RUN_HIGHDIV = process.env.HIGHDIV === '1'
// VOLBREAK: 放量新高·资金驱动突破(MA5>MA21 + 持续放量,纯OHLCV,可真回测;默认关;VOLBREAK=1 开启)
const RUN_VOLBREAK = process.env.VOLBREAK === '1'
// FUNDRES: 资金流共振·机构调研 可回测子集(放量+短期多头+机构近N日调研;需取调研历史,默认关;FUNDRES=1 开启)
const RUN_FUNDRES = process.env.FUNDRES === '1'
const SURVEY_CONC = Number(process.env.SURVEY_CONC) || 4 // 调研历史取数并发(EM 限流,宜低)
// BHOLD: 突破整理·延续(放量大阳过前高 + 1~2根十字星整理 + 高低点双抬,纯OHLCV,可真回测;默认关;BHOLD=1 开启)
const RUN_BHOLD = process.env.BHOLD === '1'
// PBREAK: 突破次日回踩(放量突破前高→守住→今日回踩收站MA5,纯OHLCV,可真回测;默认关;PBREAK=1 开启)
const RUN_PBREAK = process.env.PBREAK === '1'
// TRENDNEW: 趋势新高(多头排列+持续创新高+贴52周高,纯OHLCV,可真回测;默认关;TRENDNEW=1 开启)
const RUN_TRENDNEW = process.env.TRENDNEW === '1'
// TA: 技术分析组合(Wyckoff+道氏+AlBrooks)因子分桶检验(把现有战法成交按 TA bias/distribution 分桶;默认关;TA=1 开启)
const RUN_TA = process.env.TA === '1'
const LHB_K = Number(process.env.LHB_K) || 5 // 龙虎榜回看窗口(交易日):信号日前 K 日有资金/机构埋伏
const LHB_INST = process.env.INST !== '0' // 取机构专用席位净买(默认是;=0 仅全口径净买,更快)
const LHB_CONC = Number(process.env.LHB_CONC) || 4 // 龙虎榜/板块取数并发(EM 限流,宜低)
const LONG_WIN = Number(process.env.LONG_WIN) || 60 // 板块长窗
const SHORT_WIN = Number(process.env.SHORT_WIN) || 5 // 板块短窗

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
  taBias?: 'demand' | 'supply' | 'neutral' // 技术分析组合:信号日 TA bias,供因子分桶
  taDist?: boolean // 技术分析组合:信号日是否强派发(distribution)
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

/** 回调二次启动:逐股逐日跑 classifyPullback,命中即按其结构化止损/目标撮合(同 simForward 内核)。 */
function simulatePullback(sb: StockBars, cfg: PullbackConfig, hold = HOLD): Trade[] {
  const { bars } = sb
  const len = bars.length
  const start = cfg.MA_LONG + cfg.MA_LONG_RISE_LOOKBACK
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classifyPullback(bars.slice(0, i + 1), cfg)
    if (!cand) {
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
    trades.push(makeTrade(sb.code, bars, i, entry, stop, cand.target, risk, simForward(bars, i, stop, cand.target, hold)))
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

/** 金字塔+保本/跟踪 撮合(用户设计):½仓突破日收盘进 → 盘中触 +1R 加½仓并把全仓止损移保本 →
 *  触 +2R 武装跟踪、其后跌破 MA(TRAIL_MA) 收盘离场。R 以初始满仓风险 R1=entry1−stop1 为单位,与基线可比;
 *  分两笔 ½+½ 故止损时仅约 −0.5R(分批进场的护城河),代价是大赢家上 tranche1 只有半仓。 */
function simForwardPyramid(bars: Bar[], i: number, stop1: number, cfg: ScreenerConfig, hold: number): Trade | null {
  const entry1 = bars[i].close
  const R1 = entry1 - stop1
  if (R1 <= 0) return null
  const closes = bars.map((b) => b.close)
  const addLevel = entry1 + cfg.ADD_R_MULT * R1 // +1R 加仓点
  const trailArm = entry1 + 2 * R1 // +2R 武装跟踪
  const end = Math.min(i + hold, bars.length - 1)
  let stop = stop1
  let added = false
  let entry2 = 0
  let trailing = false
  let exit = bars[end].close
  let reason: Trade['reason'] = 'time'
  let exitIdx = end
  for (let j = i + 1; j <= end; j++) {
    const b = bars[j]
    if (b.open <= stop) { exit = b.open; reason = 'stop-gap'; exitIdx = j; break }
    if (b.low <= stop) { exit = stop; reason = 'stop'; exitIdx = j; break } // 保守:同日止损优先
    if (!added && b.high >= addLevel) { added = true; entry2 = addLevel; stop = entry1 } // 加½仓 + 移保本
    if (!trailing && b.high >= trailArm) trailing = true
    if (trailing) {
      const ma = smaAt(closes, cfg.TRAIL_MA, j)
      if (ma > 0 && b.close < ma) { exit = b.close; reason = 'trail'; exitIdx = j; break } // 跟踪离场
    }
  }
  const r1 = (exit - entry1) / R1
  const R = added ? 0.5 * r1 + 0.5 * ((exit - entry2) / R1) : 0.5 * r1 // 未加仓则仅½仓在场
  const avgEntry = added ? (entry1 + entry2) / 2 : entry1
  return {
    code: '',
    date: bars[i].date,
    entry: r2(avgEntry),
    stop: r2(stop1),
    target: r2(trailArm),
    exit: r2(exit),
    exitDate: bars[exitIdx].date,
    reason,
    retPct: r2((exit / avgEntry - 1) * 100),
    R: r2(R),
    bars: exitIdx - i,
  }
}

/** 走查回测金字塔方案:仅 breakout 信号进场,逐笔走 simForwardPyramid。 */
function simulatePyramid(sb: StockBars, cfg: ScreenerConfig, hold = HOLD): Trade[] {
  const { bars } = sb
  const len = bars.length
  const start = cfg.MA_LONG + cfg.MA_LONG_RISE_LOOKBACK
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classify(bars.slice(0, i + 1), cfg)
    if (!cand || cand.group !== 'breakout') {
      i++
      continue
    }
    const t = simForwardPyramid(bars, i, cand.stopLoss, cfg, hold)
    if (t) {
      t.code = sb.code
      trades.push(t)
    }
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

/** 打板·连板分歧低吸 走查:分歧日尾盘以收盘价进场(保守=最差填单;实盘可挂均价低吸),
 *  止损=昨收下方破位、目标=次日反包冲今日涨停价,短持有撮合。⚠ 缓存无成交额时弱转强用典型价代理。 */
function simulateDivergence(sb: StockBars, cfg: DivergenceConfig, hold: number): Trade[] {
  const { bars, code } = sb
  const len = bars.length
  const start = cfg.MIN_BARS
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classifyDivergence(bars.slice(0, i + 1), code, cfg)
    if (!cand) {
      i++
      continue
    }
    // 实盘=尾盘挂均价低吸:有成交额时以当日均价(VWAP∈[low,high]故可成交)进场;无成交额回退收盘(保守)。
    const entry = cand.vwap != null ? cand.vwap : bars[i].close
    const risk = entry - cand.stop
    if (risk <= 0) {
      i++
      continue
    }
    const t = makeTrade(code, bars, i, entry, cand.stop, cand.target, risk, simForward(bars, i, cand.stop, cand.target, hold))
    t.divGroup = cand.group
    trades.push(t)
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

/** 连续新高·缩量十字星·守MA5 分歧低吸 走查:分歧日收盘进场(无脉冲故真实)、stop/target 来自候选,短持有撮合。
 *  纯 OHLCV → 现有缓存即可真回测(不依赖成交额/VWAP)。 */
function simulateHighDiv(sb: StockBars, cfg: HighDivConfig, hold: number): Trade[] {
  const { bars, code } = sb
  const len = bars.length
  const start = cfg.MIN_BARS
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classifyHighDivergence(bars.slice(0, i + 1), code, cfg)
    if (!cand) {
      i++
      continue
    }
    const risk = cand.entry - cand.stop
    if (risk <= 0) {
      i++
      continue
    }
    const t = makeTrade(code, bars, i, cand.entry, cand.stop, cand.target, risk, simForward(bars, i, cand.stop, cand.target, hold))
    t.hdConsolDays = cand.consolDays
    trades.push(t)
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

/** 走查回测「放量新高·资金驱动突破」(纯 OHLCV);信号日收盘进场,stop/target 来自规则。 */
function simulateVolBreak(sb: StockBars, cfg: VolBreakConfig, hold: number): Trade[] {
  const { bars, code } = sb
  const len = bars.length
  const start = cfg.MIN_BARS
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classifyVolBreakout(bars.slice(0, i + 1), code, cfg)
    if (!cand) {
      i++
      continue
    }
    const risk = cand.entry - cand.stop
    if (risk <= 0) {
      i++
      continue
    }
    const t = makeTrade(code, bars, i, cand.entry, cand.stop, cand.target, risk, simForward(bars, i, cand.stop, cand.target, hold))
    t.vbBurstDays = cand.volBurstDays
    trades.push(t)
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

/** 走查回测「突破整理·延续」(纯 OHLCV);信号日(整理日)收盘进场,stop/target 来自规则。 */
function simulateBreakoutHold(sb: StockBars, cfg: BreakoutHoldConfig, hold: number): Trade[] {
  const { bars, code } = sb
  const len = bars.length
  const start = cfg.MIN_BARS
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classifyBreakoutHold(bars.slice(0, i + 1), code, cfg)
    if (!cand) {
      i++
      continue
    }
    const risk = cand.entry - cand.stop
    if (risk <= 0) {
      i++
      continue
    }
    const t = makeTrade(code, bars, i, cand.entry, cand.stop, cand.target, risk, simForward(bars, i, cand.stop, cand.target, hold))
    t.bhConsolDays = cand.consolDays
    trades.push(t)
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

/** 走查回测「趋势新高」(纯 OHLCV);信号日收盘进场(EOD 趋势跟随),stop/target 来自规则。 */
function simulateTrendNewHigh(sb: StockBars, cfg: TrendNewConfig, hold: number): Trade[] {
  const { bars, code } = sb
  const len = bars.length
  const start = cfg.MIN_BARS
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classifyTrendNewHigh(bars.slice(0, i + 1), code, cfg)
    if (!cand) {
      i++
      continue
    }
    const risk = cand.entry - cand.stop
    if (risk <= 0) {
      i++
      continue
    }
    const t = makeTrade(code, bars, i, cand.entry, cand.stop, cand.target, risk, simForward(bars, i, cand.stop, cand.target, hold))
    t.tnNhDays = cand.nhDays
    trades.push(t)
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

/** 走查回测「突破整理·延续」**确认入场版**:信号日识别 setup,其后 confirmWin 日内突破整理高点 trigger 才介入
 *  (旗形突破确认,跳过整理日收盘介入被洗的 65% 假启动);若先跌破整理低点则放弃。entry=max(trigger, 当日开)。 */
function simulateBreakoutHoldConfirm(sb: StockBars, cfg: BreakoutHoldConfig, hold: number): Trade[] {
  const { bars, code } = sb
  const len = bars.length
  const start = cfg.MIN_BARS
  const confirmWin = cfg.CONFIRM_WINDOW
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classifyBreakoutHold(bars.slice(0, i + 1), code, cfg)
    if (!cand) {
      i++
      continue
    }
    // 确认:其后 confirmWin 日内某日 high≥trigger 即介入;若先跌破整理低点则作废。
    const end = Math.min(i + confirmWin, len - 1)
    let entryIdx = -1
    let entry = 0
    for (let j = i + 1; j <= end; j++) {
      if (bars[j].low < cand.consolLow) break // 整理结构破位,放弃
      if (bars[j].high >= cand.trigger) {
        entry = Math.max(cand.trigger, bars[j].open) // 跳空高开则按开盘
        entryIdx = j
        break
      }
    }
    if (entryIdx < 0) {
      i++ // 未确认,继续找下一个 setup
      continue
    }
    const stop = Math.max(cand.consolLow * 0.997, entry * (1 - cfg.STOP_MAX_PCT / 100))
    const risk = entry - stop
    if (risk <= 0) {
      i++
      continue
    }
    const target = entry + cfg.R_MULT * risk
    const t = makeTrade(code, bars, entryIdx, entry, stop, target, risk, simForward(bars, entryIdx, stop, target, hold))
    t.bhConsolDays = cand.consolDays
    trades.push(t)
    i = entryIdx + hold + 1 // 冷却从实际入场日起
  }
  return trades
}

/** 走查回测「突破次日回踩」(纯 OHLCV);回踩日收盘进场,stop/target 来自规则。 */
function simulateBreakoutPullback(sb: StockBars, cfg: BreakoutPullbackConfig, hold: number): Trade[] {
  const { bars, code } = sb
  const len = bars.length
  const start = cfg.MIN_BARS
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classifyBreakoutPullback(bars.slice(0, i + 1), code, cfg)
    if (!cand) {
      i++
      continue
    }
    const risk = cand.entry - cand.stop
    if (risk <= 0) {
      i++
      continue
    }
    const t = makeTrade(code, bars, i, cand.entry, cand.stop, cand.target, risk, simForward(bars, i, cand.stop, cand.target, hold))
    t.bpDaysSinceBreak = cand.daysSinceBreak
    trades.push(t)
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

/** 走查回测「突破次日回踩」**确认入场版**:回踩日识别 setup,其后 CONFIRM_WINDOW 日内突破回踩日高点才介入
 *  (回踩企稳后的突破确认);若先跌破回踩日低点则放弃。entry=max(回踩日高, 当日开)。 */
function simulateBreakoutPullbackConfirm(sb: StockBars, cfg: BreakoutPullbackConfig, hold: number): Trade[] {
  const { bars, code } = sb
  const len = bars.length
  const start = cfg.MIN_BARS
  const confirmWin = cfg.CONFIRM_WINDOW
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    const cand = classifyBreakoutPullback(bars.slice(0, i + 1), code, cfg)
    if (!cand) {
      i++
      continue
    }
    const trigger = bars[i].high // 回踩日高点 = 企稳突破确认位
    const structLow = Math.min(bars[i].low, cand.ma5)
    const end = Math.min(i + confirmWin, len - 1)
    let entryIdx = -1
    let entry = 0
    for (let j = i + 1; j <= end; j++) {
      if (bars[j].low < structLow) break // 回踩低破位,放弃
      if (bars[j].high >= trigger) {
        entry = Math.max(trigger, bars[j].open)
        entryIdx = j
        break
      }
    }
    if (entryIdx < 0) {
      i++
      continue
    }
    const stop = Math.max(structLow * 0.997, entry * (1 - cfg.STOP_MAX_PCT / 100))
    const risk = entry - stop
    if (risk <= 0) {
      i++
      continue
    }
    const target = entry + cfg.R_MULT * risk
    const t = makeTrade(code, bars, entryIdx, entry, stop, target, risk, simForward(bars, entryIdx, stop, target, hold))
    t.bpDaysSinceBreak = cand.daysSinceBreak
    trades.push(t)
    i = entryIdx + hold + 1
  }
  return trades
}

/** 走查回测「资金流共振·机构调研」可回测子集;信号日收盘进场,调研家数按信号日窗口实时算(零前视)。
 *  surveyEvents=该股调研全史(date/org);止损/目标来自规则,短持有撮合。 */
function simulateFundResonance(sb: StockBars, surveyEvents: SurveyEvent[], cfg: FundResConfig, hold: number): Trade[] {
  const { bars, code } = sb
  const len = bars.length
  const start = cfg.MIN_BARS
  const trades: Trade[] = []
  let i = start
  while (i <= len - 2) {
    // 信号日(含)前 SURVEY_LOOKBACK 个交易日的窗口 → distinct 机构家数(只用 ≤信号日的调研,零前视)
    const startDate = bars[Math.max(0, i - cfg.SURVEY_LOOKBACK)].date
    const surveyOrgs = countOrgsInRange(surveyEvents, startDate, bars[i].date)
    const cand = classifyFundResonance(bars.slice(0, i + 1), code, surveyOrgs, cfg)
    if (!cand) {
      i++
      continue
    }
    const risk = cand.entry - cand.stop
    if (risk <= 0) {
      i++
      continue
    }
    const t = makeTrade(code, bars, i, cand.entry, cand.stop, cand.target, risk, simForward(bars, i, cand.stop, cand.target, hold))
    t.frSurveyOrgs = surveyOrgs
    trades.push(t)
    i = i + hold + 1 // 冷却:一仓在手不重叠
  }
  return trades
}

/** 调研历史磁盘缓存(按 SAMPLE+KLINE;CACHE=0 不读)。返回 code → 调研事件全史(date/org)。 */
async function loadSurveyHistory(data: StockBars[], fromDate: string): Promise<Map<string, SurveyEvent[]>> {
  const file = join(OUT_DIR, `.survey-${SAMPLE}-${KLINE}.json`)
  if (USE_CACHE && existsSync(file)) {
    try {
      const obj = JSON.parse(readFileSync(file, 'utf8')) as Record<string, SurveyEvent[]>
      const m = new Map(Object.entries(obj))
      if (m.size) {
        console.log(`[FundRes] 复用缓存调研历史 ${m.size} 只 (${file};CACHE=0 强制重取)`)
        return m
      }
    } catch {
      /* 损坏重取 */
    }
  }
  console.log(`[FundRes] 取 ${data.length} 只调研历史(fromDate=${fromDate},并发 ${SURVEY_CONC})...`)
  let done = 0
  const lists = await mapLimit(data, SURVEY_CONC, async (sb) => {
    try {
      const ev = await fetchOrgSurveyHistory(sb.code, fromDate)
      done++
      if (done % 50 === 0) console.log(`[FundRes] 调研取数 ${done}/${data.length}`)
      return ev
    } catch {
      done++
      return [] as SurveyEvent[]
    }
  })
  const m = new Map<string, SurveyEvent[]>()
  data.forEach((sb, i) => m.set(sb.code, lists[i] ?? []))
  const withData = [...m.values()].filter((v) => v.length > 0).length
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(file, JSON.stringify(Object.fromEntries(m)))
  } catch {
    /* 缓存写失败非致命 */
  }
  console.log(`[FundRes] 调研历史就绪:${withData}/${data.length} 只有调研记录`)
  return m
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
    targetRate: r2((cnt(['target', 'target-gap', 'trail']) / n) * 100),
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

// ── 技术分析组合(TA)因子分桶检验 ─────────────────────────────────────
// 把已回测战法(breakout/highdiv/volbreak)的历史成交,按信号日 technicalCombo 的 bias / distribution 分桶,
// 看「供给 bias / distribution=是」是否跑输 → 判断 TA 因子有无区分度(决定接线权重/惩罚)。
function evaluateTechnicalFactor(data: StockBars[]): {
  overall: Metrics
  byBias: Record<string, Metrics>
  byDist: { dist: Metrics; nonDist: Metrics }
} {
  const tagged: Trade[] = []
  const tag = (t: Trade, slice: Bar[], code: string) => {
    const ta = technicalCombo(slice, code)
    t.taBias = ta.bias
    t.taDist = ta.distribution
    tagged.push(t)
  }
  for (const sb of data) {
    const { bars, code } = sb
    const len = bars.length
    // breakout(新高战法)
    let i = SCREENER.MA_LONG + SCREENER.MA_LONG_RISE_LOOKBACK
    while (i <= len - 2) {
      const slice = bars.slice(0, i + 1)
      const cand = classify(slice, SCREENER)
      if (cand && cand.group === 'breakout') {
        const risk = bars[i].close - cand.stopLoss
        if (risk > 0) tag(makeTrade(code, bars, i, bars[i].close, cand.stopLoss, cand.target, risk, simForward(bars, i, cand.stopLoss, cand.target, HOLD)), slice, code)
        i += HOLD + 1
      } else i++
    }
    // highdiv / volbreak(持有 20)
    for (const kind of ['hd', 'vb'] as const) {
      let j = kind === 'hd' ? HIGHDIV.MIN_BARS : VOLBREAK.MIN_BARS
      while (j <= len - 2) {
        const slice = bars.slice(0, j + 1)
        const cand = kind === 'hd' ? classifyHighDivergence(slice, code, HIGHDIV) : classifyVolBreakout(slice, code, VOLBREAK)
        if (cand) {
          const risk = cand.entry - cand.stop
          if (risk > 0) tag(makeTrade(code, bars, j, cand.entry, cand.stop, cand.target, risk, simForward(bars, j, cand.stop, cand.target, 20)), slice, code)
          j += 20 + 1
        } else j++
      }
    }
  }
  const byBias: Record<string, Metrics> = {}
  for (const b of ['demand', 'neutral', 'supply']) byBias[b] = aggregate(tagged.filter((t) => t.taBias === b))
  return {
    overall: aggregate(tagged),
    byBias,
    byDist: { dist: aggregate(tagged.filter((t) => t.taDist)), nonDist: aggregate(tagged.filter((t) => !t.taDist)) },
  }
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

  // COMBO: 龙虎榜(机构) + 板块轮动 因子检验(取数重,COMBO=1 开启)
  if (RUN_COMBO) {
    try {
      out.comboEval = await runCombo(data, base.metrics)
    } catch (err) {
      console.warn('[Combo] 因子检验失败:', err)
    }
  }

  // PULLBACK: 回调二次启动 / 圆弧底反包 战法(新形态,PULLBACK=1 开启)
  if (RUN_PULLBACK) {
    console.log('\n========== 回调二次启动 / 圆弧底反包(新形态)==========')
    console.log('（对照基准:突破组 ≈0.39R / 直买扳机 ≈-0.11R;通过线=期望明显为正、PF>1.3）')
    const variants: Array<{ name: string; over: Partial<PullbackConfig> }> = [
      { name: 'pullback-measured(→近高)', over: { TARGET_MODE: 'measured' } },
      { name: 'pullback-rmult-2', over: { TARGET_MODE: 'rmult', TARGET_R_MULT: 2 } },
      { name: 'pullback-rmult-2.5', over: { TARGET_MODE: 'rmult', TARGET_R_MULT: 2.5 } },
      { name: 'pullback-rmult-3', over: { TARGET_MODE: 'rmult', TARGET_R_MULT: 3 } },
    ]
    const pbVariants: Array<{ name: string; over: Partial<PullbackConfig>; metrics: Metrics }> = []
    for (const v of variants) {
      const cfg = { ...PULLBACK, ...v.over } as PullbackConfig
      const metrics = aggregate(data.flatMap((sb) => simulatePullback(sb, cfg)))
      console.log(fmtMetrics(v.name, metrics))
      pbVariants.push({ name: v.name, over: v.over, metrics })
    }
    // 阈值扫描(默认 measured 目标)：看样本量与期望对各旋钮是否稳健。
    const pbSweeps: Array<{ key: keyof PullbackConfig; values: number[] }> = [
      { key: 'VOL_SPIKE', values: [1.5, 1.8, 2.0, 2.5] },
      { key: 'RETRACE_MAX', values: [0.5, 0.6, 0.65] },
      { key: 'ARC_RECOVER_MIN', values: [0.03, 0.05, 0.08] },
      { key: 'CORRECTION_MIN_DAYS', values: [10, 15, 20] },
      { key: 'STOP_MAX_PCT', values: [0, 12, 15] },
    ]
    const pbSweepOut: Record<string, Array<{ value: number; metrics: Metrics }>> = {}
    for (const s of pbSweeps) {
      const key = String(s.key)
      console.log(`\n---------- 扫描 ${key}(基线=${(PULLBACK as Record<string, unknown>)[key]})----------`)
      pbSweepOut[key] = []
      for (const val of s.values) {
        const cfg = { ...PULLBACK, [s.key]: val } as PullbackConfig
        const metrics = aggregate(data.flatMap((sb) => simulatePullback(sb, cfg)))
        console.log(fmtMetrics(`${key}=${val}`, metrics))
        pbSweepOut[key].push({ value: val, metrics })
      }
    }
    out.pullbackEval = { config: PULLBACK, variants: pbVariants, sweeps: pbSweepOut }
  }

  // PYRAMID: 金字塔+保本/跟踪 进场方案 vs 基线(单笔/固定目标)。验证用户选定的"金字塔顺势加"是否改善期望。
  if (RUN_PYRAMID) {
    console.log('\n========== 金字塔+保本/跟踪 vs 基线(½突破进 → +1R加½移保本 → +2R跌破MA10跟踪)==========')
    const pyTrades = data.flatMap((sb) => simulatePyramid(sb, SCREENER))
    const pyMetrics = aggregate(pyTrades)
    console.log(fmtMetrics('baseline(单笔/固定目标)', base.metrics))
    console.log(fmtMetrics('pyramid(½+½/跟踪)', pyMetrics))
    console.log(
      `→ 期望差 ${r2(pyMetrics.expectancyR - base.metrics.expectancyR)}R · 止损率 ${base.metrics.stopRate}%→${pyMetrics.stopRate}% · 盈亏比 ${base.metrics.payoff}→${pyMetrics.payoff}`,
    )
    out.pyramidEval = {
      params: { ADD_R_MULT: SCREENER.ADD_R_MULT, BREAKEVEN_AT_R: SCREENER.BREAKEVEN_AT_R, TRAIL_MA: SCREENER.TRAIL_MA },
      baseline: base.metrics,
      pyramid: pyMetrics,
      deltaExpectancyR: r2(pyMetrics.expectancyR - base.metrics.expectancyR),
    }
  }

  // DIVERGENCE: 打板·连板分歧低吸(分歧日尾盘进→次日反包/破位)。⚠ 缓存无成交额→弱转强用典型价代理,仅方向性。
  if (RUN_DIVERGENCE) {
    const HOLD_DIV = 3
    console.log(`\n========== 打板·连板分歧低吸(尾盘收盘进→次日反包/破位,HOLD=${HOLD_DIV})==========`)
    console.log('⚠ 缓存 bars 无成交额 → 弱转强用典型价(H+L+C)/3 代理,真 VWAP 须新缓存;此处仅看 连板分歧→反包 的方向性赔率。')
    const all = data.flatMap((sb) => simulateDivergence(sb, DIVERGENCE, HOLD_DIV))
    const mAll = aggregate(all)
    const lb = aggregate(all.filter((t) => t.divGroup === 'lianban'))
    const pb2 = aggregate(all.filter((t) => t.divGroup === 'pullback2'))
    console.log(fmtMetrics('divergence-all', mAll))
    console.log(fmtMetrics('  连板分歧 lianban', lb))
    console.log(fmtMetrics('  回调二波 pullback2', pb2))
    out.divergenceEval = { hold: HOLD_DIV, proxyVWAP: true, all: mAll, lianban: lb, pullback2: pb2 }
  }

  // HIGHDIV: 连续新高·缩量十字星·守MA5 分歧低吸(纯 OHLCV,现有缓存即可真回测)。
  if (RUN_HIGHDIV) {
    const HOLD_HD = 20 // 持有到目标/止损(time-exit≈0,代表实盘"持到 rmult 目标或破位")
    console.log(`\n========== 连续新高·分歧低吸(缩量十字星·守MA5,收盘进→rmult 撮合,HOLD=${HOLD_HD})==========`)
    console.log('（纯 OHLCV,不依赖成交额;对照突破基线 0.08R。通过线=期望明显正、PF>1.3、样本足)')
    const all = data.flatMap((sb) => simulateHighDiv(sb, HIGHDIV, HOLD_HD))
    const m = aggregate(all)
    console.log(fmtMetrics('highdiv(基线cfg)', m))
    console.log(`→ vs 突破基线 ${base.metrics.expectancyR}R · 期望差 ${r2(m.expectancyR - base.metrics.expectancyR)}R`)

    // 阈值/撮合扫描:找更优 R_MULT / STOP_MAX / HOLD(目标、止损宽度、持有期)。
    console.log('\n---------- HIGHDIV 扫描 ----------')
    const hdSweep: Array<Record<string, unknown>> = []
    for (const RM of [1.5, 2, 2.5, 3]) {
      const mm = aggregate(data.flatMap((sb) => simulateHighDiv(sb, { ...HIGHDIV, R_MULT: RM }, HOLD_HD)))
      console.log(fmtMetrics(`R_MULT=${RM}`, mm))
      hdSweep.push({ knob: 'R_MULT', value: RM, metrics: mm })
    }
    for (const SM of [3, 4, 5, 7]) {
      const mm = aggregate(data.flatMap((sb) => simulateHighDiv(sb, { ...HIGHDIV, STOP_MAX: SM }, HOLD_HD)))
      console.log(fmtMetrics(`STOP_MAX=${SM}`, mm))
      hdSweep.push({ knob: 'STOP_MAX', value: SM, metrics: mm })
    }
    for (const H of [5, 10, 20, 30]) {
      const mm = aggregate(data.flatMap((sb) => simulateHighDiv(sb, HIGHDIV, H)))
      console.log(fmtMetrics(`HOLD=${H}`, mm))
      hdSweep.push({ knob: 'HOLD', value: H, metrics: mm })
    }
    for (const DRY of [0.5, 0.6, 0.7, 0.8]) {
      const mm = aggregate(data.flatMap((sb) => simulateHighDiv(sb, { ...HIGHDIV, DRY }, HOLD_HD)))
      console.log(fmtMetrics(`DRY=${DRY}`, mm))
      hdSweep.push({ knob: 'DRY', value: DRY, metrics: mm })
    }
    // 因子验证:按整理天数 consolDays 分桶,看是否「2-3 天峰值」——确认因子有方向性。
    console.log('\n---------- HIGHDIV 整理天数(consolDays)分桶 ----------')
    const allBase = data.flatMap((sb) => simulateHighDiv(sb, HIGHDIV, HOLD_HD))
    const buckets: Array<{ label: string; pick: (d: number) => boolean }> = [
      { label: 'consol=1', pick: (d) => d === 1 },
      { label: 'consol=2', pick: (d) => d === 2 },
      { label: 'consol=3', pick: (d) => d === 3 },
      { label: 'consol>=4', pick: (d) => d >= 4 },
    ]
    const factorEval: Array<Record<string, unknown>> = []
    for (const b of buckets) {
      const mm = aggregate(allBase.filter((t) => b.pick(t.hdConsolDays ?? 0)))
      console.log(fmtMetrics(b.label, mm))
      factorEval.push({ bucket: b.label, metrics: mm })
    }
    out.highDivEval = {
      hold: HOLD_HD,
      config: HIGHDIV,
      metrics: m,
      baselineExpectancyR: base.metrics.expectancyR,
      sweep: hdSweep,
      consolDaysBuckets: factorEval,
    }
  }

  // VOLBREAK: 放量新高·资金驱动突破(MA5>MA21 + 持续放量,纯 OHLCV,现有缓存即可真回测)。
  if (RUN_VOLBREAK) {
    const HOLD_VB = 20
    console.log(`\n========== 放量新高·资金驱动突破(MA5>MA21 + 持续放量,收盘进→rmult 撮合,HOLD=${HOLD_VB})==========`)
    console.log('（纯 OHLCV·相对量比,不依赖成交额;对照突破基线 0.08R / 分歧 0.19R。通过线=期望明显正、PF>1.3、样本足)')
    const all = data.flatMap((sb) => simulateVolBreak(sb, VOLBREAK, HOLD_VB))
    const m = aggregate(all)
    console.log(fmtMetrics('volbreak(基线cfg)', m))
    console.log(`→ vs 突破基线 ${base.metrics.expectancyR}R · 期望差 ${r2(m.expectancyR - base.metrics.expectancyR)}R`)

    // 阈值扫描:放量倍数 / 达标天数 / 突破窗口 / 目标 R。
    console.log('\n---------- VOLBREAK 扫描 ----------')
    const vbSweep: Array<Record<string, unknown>> = []
    for (const VM of [1.8, 2, 2.5, 3]) {
      const mm = aggregate(data.flatMap((sb) => simulateVolBreak(sb, { ...VOLBREAK, VOL_MULT: VM }, HOLD_VB)))
      console.log(fmtMetrics(`VOL_MULT=${VM}`, mm))
      vbSweep.push({ knob: 'VOL_MULT', value: VM, metrics: mm })
    }
    for (const MD of [6, 8, 10]) {
      const mm = aggregate(data.flatMap((sb) => simulateVolBreak(sb, { ...VOLBREAK, MIN_VOL_DAYS: MD }, HOLD_VB)))
      console.log(fmtMetrics(`MIN_VOL_DAYS=${MD}`, mm))
      vbSweep.push({ knob: 'MIN_VOL_DAYS', value: MD, metrics: mm })
    }
    for (const BL of [60, 120, 250]) {
      const mm = aggregate(data.flatMap((sb) => simulateVolBreak(sb, { ...VOLBREAK, BREAKOUT_LOOKBACK: BL }, HOLD_VB)))
      console.log(fmtMetrics(`BREAKOUT_LOOKBACK=${BL}`, mm))
      vbSweep.push({ knob: 'BREAKOUT_LOOKBACK', value: BL, metrics: mm })
    }
    for (const RM of [1.5, 2, 2.5, 3]) {
      const mm = aggregate(data.flatMap((sb) => simulateVolBreak(sb, { ...VOLBREAK, R_MULT: RM }, HOLD_VB)))
      console.log(fmtMetrics(`R_MULT=${RM}`, mm))
      vbSweep.push({ knob: 'R_MULT', value: RM, metrics: mm })
    }
    // 因子验证:按窗内放量达标天数 volBurstDays 分桶。
    console.log('\n---------- VOLBREAK 放量天数(volBurstDays)分桶 ----------')
    const allBase = data.flatMap((sb) => simulateVolBreak(sb, VOLBREAK, HOLD_VB))
    const buckets: Array<{ label: string; pick: (d: number) => boolean }> = [
      { label: 'burst=8-9', pick: (d) => d >= 8 && d <= 9 },
      { label: 'burst=10-11', pick: (d) => d >= 10 && d <= 11 },
      { label: 'burst=12', pick: (d) => d >= 12 },
    ]
    const factorEval: Array<Record<string, unknown>> = []
    for (const b of buckets) {
      const mm = aggregate(allBase.filter((t) => b.pick(t.vbBurstDays ?? 0)))
      console.log(fmtMetrics(b.label, mm))
      factorEval.push({ bucket: b.label, metrics: mm })
    }
    out.volBreakEval = {
      hold: HOLD_VB,
      config: VOLBREAK,
      metrics: m,
      baselineExpectancyR: base.metrics.expectancyR,
      sweep: vbSweep,
      burstDaysBuckets: factorEval,
    }
  }

  // FUNDRES: 资金流共振·机构调研 可回测子集(放量+短期多头+机构近N日调研)。需取调研历史(FUNDRES=1 开启)。
  if (RUN_FUNDRES) {
    const HOLD_FR = FUNDRES.HOLD // 持股≈3日(time-exit 捕捉"持股平均三天")
    console.log(`\n========== 资金流共振·机构调研(放量+短期多头+机构调研,收盘进→${HOLD_FR}日撮合)==========`)
    console.log('（机构调研历史可回溯;主力净流入真因子无免费历史→只在实盘 live 跑。对照突破基线 0.08R / 分歧 0.19R。通过线=期望明显正、PF>1.3、样本足)')
    const survey = await loadSurveyHistory(data, dateMin)
    const evOf = (code: string) => survey.get(code) ?? []
    const all = data.flatMap((sb) => simulateFundResonance(sb, evOf(sb.code), FUNDRES, HOLD_FR))
    const m = aggregate(all)
    console.log(fmtMetrics('fundres(基线cfg)', m))
    console.log(`→ vs 突破基线 ${base.metrics.expectancyR}R · 期望差 ${r2(m.expectancyR - base.metrics.expectancyR)}R`)

    // 关键对照:有无"机构调研"要求 —— 量化调研事件因子的增量(SURVEY_MIN_ORGS=0 = 纯放量强势)。
    const noSurvey = aggregate(data.flatMap((sb) => simulateFundResonance(sb, evOf(sb.code), { ...FUNDRES, SURVEY_MIN_ORGS: 0 }, HOLD_FR)))
    console.log(fmtMetrics('  └ SURVEY_MIN_ORGS=0(纯放量·无调研要求)', noSurvey))

    // 阈值扫描
    console.log('\n---------- FUNDRES 扫描 ----------')
    const frSweep: Array<Record<string, unknown>> = []
    for (const SO of [0, 1, 2, 3]) {
      const mm = aggregate(data.flatMap((sb) => simulateFundResonance(sb, evOf(sb.code), { ...FUNDRES, SURVEY_MIN_ORGS: SO }, HOLD_FR)))
      console.log(fmtMetrics(`SURVEY_MIN_ORGS=${SO}`, mm))
      frSweep.push({ knob: 'SURVEY_MIN_ORGS', value: SO, metrics: mm })
    }
    for (const SL of [5, 10, 20, 30]) {
      const mm = aggregate(data.flatMap((sb) => simulateFundResonance(sb, evOf(sb.code), { ...FUNDRES, SURVEY_LOOKBACK: SL }, HOLD_FR)))
      console.log(fmtMetrics(`SURVEY_LOOKBACK=${SL}`, mm))
      frSweep.push({ knob: 'SURVEY_LOOKBACK', value: SL, metrics: mm })
    }
    for (const VM of [1.5, 1.8, 2.2, 2.6]) {
      const mm = aggregate(data.flatMap((sb) => simulateFundResonance(sb, evOf(sb.code), { ...FUNDRES, VOL_MULT: VM }, HOLD_FR)))
      console.log(fmtMetrics(`VOL_MULT=${VM}`, mm))
      frSweep.push({ knob: 'VOL_MULT', value: VM, metrics: mm })
    }
    for (const RM of [1.5, 2, 2.5, 3]) {
      const mm = aggregate(data.flatMap((sb) => simulateFundResonance(sb, evOf(sb.code), { ...FUNDRES, R_MULT: RM }, HOLD_FR)))
      console.log(fmtMetrics(`R_MULT=${RM}`, mm))
      frSweep.push({ knob: 'R_MULT', value: RM, metrics: mm })
    }
    for (const H of [2, 3, 5, 10]) {
      const mm = aggregate(data.flatMap((sb) => simulateFundResonance(sb, evOf(sb.code), FUNDRES, H)))
      console.log(fmtMetrics(`HOLD=${H}`, mm))
      frSweep.push({ knob: 'HOLD', value: H, metrics: mm })
    }
    for (const GU of [false, true]) {
      const mm = aggregate(data.flatMap((sb) => simulateFundResonance(sb, evOf(sb.code), { ...FUNDRES, REQUIRE_GAP_UP: GU }, HOLD_FR)))
      console.log(fmtMetrics(`REQUIRE_GAP_UP=${GU}`, mm))
      frSweep.push({ knob: 'REQUIRE_GAP_UP', value: GU ? 1 : 0, metrics: mm })
    }

    // 因子验证:按调研机构家数分桶(SURVEY_MIN_ORGS=0 全样本),确认"调研越多→期望越高"是否成立。
    console.log('\n---------- FUNDRES 调研家数(surveyOrgs)分桶 ----------')
    const allNoReq = data.flatMap((sb) => simulateFundResonance(sb, evOf(sb.code), { ...FUNDRES, SURVEY_MIN_ORGS: 0 }, HOLD_FR))
    const buckets: Array<{ label: string; pick: (n: number) => boolean }> = [
      { label: 'orgs=0', pick: (n) => n === 0 },
      { label: 'orgs=1-2', pick: (n) => n >= 1 && n <= 2 },
      { label: 'orgs=3-5', pick: (n) => n >= 3 && n <= 5 },
      { label: 'orgs>=6', pick: (n) => n >= 6 },
    ]
    const factorEval: Array<Record<string, unknown>> = []
    for (const b of buckets) {
      const mm = aggregate(allNoReq.filter((t) => b.pick(t.frSurveyOrgs ?? 0)))
      console.log(fmtMetrics(b.label, mm))
      factorEval.push({ bucket: b.label, metrics: mm })
    }
    out.fundResEval = {
      hold: HOLD_FR,
      config: FUNDRES,
      metrics: m,
      noSurveyMetrics: noSurvey,
      baselineExpectancyR: base.metrics.expectancyR,
      sweep: frSweep,
      surveyOrgsBuckets: factorEval,
    }
  }

  // BHOLD: 突破整理·延续(放量大阳过前高 + 1~2根十字星整理 + 高低点双抬,纯 OHLCV,现有缓存即可真回测)。
  if (RUN_BHOLD) {
    const HOLD_BH = Number(process.env.HOLD_BH) || 10
    console.log(`\n========== 突破整理·延续(放量大阳过前高 + 十字星整理 + 高低点双抬,整理日收盘进→${HOLD_BH}日撮合)==========`)
    console.log('（纯 OHLCV,对照突破基线 0.08R / 分歧 0.19R / 放量新高 0.27R。通过线=期望明显正、PF>1.3、样本足)')
    // 入场对比:整理日收盘介入(close) vs 次日突破整理高点确认介入(confirm)。
    const mClose = aggregate(data.flatMap((sb) => simulateBreakoutHold(sb, BHOLD, HOLD_BH)))
    const m = aggregate(data.flatMap((sb) => simulateBreakoutHoldConfirm(sb, BHOLD, HOLD_BH)))
    console.log(fmtMetrics('bhold-close(整理日收盘进)', mClose))
    console.log(fmtMetrics('bhold-confirm(次日突破确认进)', m))
    console.log(`→ confirm vs close 期望差 ${r2(m.expectancyR - mClose.expectancyR)}R · vs 突破基线 ${base.metrics.expectancyR}R`)

    // 阈值扫描(全部 confirm 入场):放量倍数 / 大阳实体 / 整理小实体上限 / 突破回看 / 确认窗 / 目标 R / 持有 / 高低点开关。
    console.log('\n---------- BHOLD 扫描(confirm 入场)----------')
    const bhSweep: Array<Record<string, unknown>> = []
    const sweepConfirm = (over: Partial<BreakoutHoldConfig>, hold = HOLD_BH) =>
      aggregate(data.flatMap((sb) => simulateBreakoutHoldConfirm(sb, { ...BHOLD, ...over }, hold)))
    for (const PV of [1.5, 1.8, 2.2, 2.6]) {
      const mm = sweepConfirm({ POLE_VOL_MULT: PV })
      console.log(fmtMetrics(`POLE_VOL_MULT=${PV}`, mm))
      bhSweep.push({ knob: 'POLE_VOL_MULT', value: PV, metrics: mm })
    }
    for (const PB of [4, 5, 6, 7, 8]) {
      const mm = sweepConfirm({ POLE_BODY_MIN: PB })
      console.log(fmtMetrics(`POLE_BODY_MIN=${PB}`, mm))
      bhSweep.push({ knob: 'POLE_BODY_MIN', value: PB, metrics: mm })
    }
    for (const DB of [0.3, 0.4, 0.5, 0.6]) {
      const mm = sweepConfirm({ DOJI_BODY_MAX: DB })
      console.log(fmtMetrics(`DOJI_BODY_MAX=${DB}`, mm))
      bhSweep.push({ knob: 'DOJI_BODY_MAX', value: DB, metrics: mm })
    }
    for (const BL of [10, 20, 40, 60]) {
      const mm = sweepConfirm({ POLE_BREAK_LOOKBACK: BL })
      console.log(fmtMetrics(`POLE_BREAK_LOOKBACK=${BL}`, mm))
      bhSweep.push({ knob: 'POLE_BREAK_LOOKBACK', value: BL, metrics: mm })
    }
    for (const CW of [1, 2, 3, 5]) {
      const mm = sweepConfirm({ CONFIRM_WINDOW: CW })
      console.log(fmtMetrics(`CONFIRM_WINDOW=${CW}`, mm))
      bhSweep.push({ knob: 'CONFIRM_WINDOW', value: CW, metrics: mm })
    }
    for (const RM of [1.5, 2, 2.5, 3]) {
      const mm = sweepConfirm({ R_MULT: RM })
      console.log(fmtMetrics(`R_MULT=${RM}`, mm))
      bhSweep.push({ knob: 'R_MULT', value: RM, metrics: mm })
    }
    for (const H of [3, 5, 10, 20]) {
      const mm = sweepConfirm({}, H)
      console.log(fmtMetrics(`HOLD=${H}`, mm))
      bhSweep.push({ knob: 'HOLD', value: H, metrics: mm })
    }
    for (const [hh, hl] of [[true, true], [true, false], [false, true], [false, false]] as Array<[boolean, boolean]>) {
      const mm = sweepConfirm({ REQUIRE_HIGHER_HIGH: hh, REQUIRE_HIGHER_LOW: hl })
      console.log(fmtMetrics(`HH=${hh ? 1 : 0}/HL=${hl ? 1 : 0}`, mm))
      bhSweep.push({ knob: 'HH/HL', value: (hh ? 2 : 0) + (hl ? 1 : 0), metrics: mm })
    }

    out.breakoutHoldEval = {
      hold: HOLD_BH,
      config: BHOLD,
      metricsClose: mClose,
      metrics: m,
      baselineExpectancyR: base.metrics.expectancyR,
      sweep: bhSweep,
    }
  }

  // TRENDNEW: 趋势新高(多头排列 + 持续创新高 + 贴52周高,纯 OHLCV,现有缓存即可真回测)。
  if (RUN_TRENDNEW) {
    const HOLD_TN = Number(process.env.HOLD_TN) || 20
    console.log(`\n========== 趋势新高(多头排列 + 持续创新高 + 贴52周高,信号日收盘进→${HOLD_TN}日撮合)==========`)
    console.log('（纯 OHLCV,对照突破基线 0.08R / 分歧 0.19R / 放量新高 0.27R / 突破整理confirm 0.45R。通过线=期望明显正、PF>1.3、样本足）')
    const m = aggregate(data.flatMap((sb) => simulateTrendNewHigh(sb, TRENDNEW, HOLD_TN)))
    console.log(fmtMetrics('trendnew(收盘进)', m))
    console.log(`→ vs 突破基线 ${base.metrics.expectancyR}R`)

    // 阈值扫描:持续新高天数下限 / 贴高% / 新高回看 / 观察窗 / 追高 guard / 止损 / 目标 R / 持有。
    console.log('\n---------- TRENDNEW 扫描 ----------')
    const tnSweep: Array<Record<string, unknown>> = []
    const sweep = (over: Partial<TrendNewConfig>, hold = HOLD_TN) =>
      aggregate(data.flatMap((sb) => simulateTrendNewHigh(sb, { ...TRENDNEW, ...over }, hold)))
    for (const NH of [2, 3, 5, 8]) {
      const mm = sweep({ MIN_NH_DAYS: NH })
      console.log(fmtMetrics(`MIN_NH_DAYS=${NH}`, mm))
      tnSweep.push({ knob: 'MIN_NH_DAYS', value: NH, metrics: mm })
    }
    for (const NEAR of [3, 5, 8, 12]) {
      const mm = sweep({ NEAR_HIGH_PCT: NEAR })
      console.log(fmtMetrics(`NEAR_HIGH_PCT=${NEAR}`, mm))
      tnSweep.push({ knob: 'NEAR_HIGH_PCT', value: NEAR, metrics: mm })
    }
    for (const NL of [40, 60, 120, 250]) {
      const mm = sweep({ NH_LOOKBACK: NL })
      console.log(fmtMetrics(`NH_LOOKBACK=${NL}`, mm))
      tnSweep.push({ knob: 'NH_LOOKBACK', value: NL, metrics: mm })
    }
    for (const RW of [10, 20, 40]) {
      const mm = sweep({ RECENT_WIN: RW })
      console.log(fmtMetrics(`RECENT_WIN=${RW}`, mm))
      tnSweep.push({ knob: 'RECENT_WIN', value: RW, metrics: mm })
    }
    for (const EX of [15, 20, 30, 50]) {
      const mm = sweep({ EXT_MAX_PCT: EX })
      console.log(fmtMetrics(`EXT_MAX_PCT=${EX}`, mm))
      tnSweep.push({ knob: 'EXT_MAX_PCT', value: EX, metrics: mm })
    }
    for (const SM of [6, 8, 10, 12]) {
      const mm = sweep({ STOP_MAX_PCT: SM })
      console.log(fmtMetrics(`STOP_MAX_PCT=${SM}`, mm))
      tnSweep.push({ knob: 'STOP_MAX_PCT', value: SM, metrics: mm })
    }
    for (const RM of [1.5, 2, 2.5, 3]) {
      const mm = sweep({ R_MULT: RM })
      console.log(fmtMetrics(`R_MULT=${RM}`, mm))
      tnSweep.push({ knob: 'R_MULT', value: RM, metrics: mm })
    }
    for (const H of [10, 20, 40]) {
      const mm = sweep({}, H)
      console.log(fmtMetrics(`HOLD=${H}`, mm))
      tnSweep.push({ knob: 'HOLD', value: H, metrics: mm })
    }

    out.trendNewEval = {
      hold: HOLD_TN,
      config: TRENDNEW,
      metrics: m,
      baselineExpectancyR: base.metrics.expectancyR,
      sweep: tnSweep,
    }
  }

  // PBREAK: 突破次日回踩(放量突破前高→守住→今日回踩收站MA5,纯 OHLCV,现有缓存即可真回测)。
  if (RUN_PBREAK) {
    const HOLD_BP = Number(process.env.HOLD_BP) || 10
    console.log(`\n========== 突破次日回踩(放量突破→守住→今日回踩收站MA5,回踩日收盘进→${HOLD_BP}日撮合)==========`)
    console.log('（纯 OHLCV,对照突破基线 0.08R / 突破整理confirm 0.45R。通过线=期望明显正、PF>1.3、样本足)')
    const mClose = aggregate(data.flatMap((sb) => simulateBreakoutPullback(sb, PBREAK, HOLD_BP)))
    const m = aggregate(data.flatMap((sb) => simulateBreakoutPullbackConfirm(sb, PBREAK, HOLD_BP)))
    console.log(fmtMetrics('breakpull-close(回踩日收盘进)', mClose))
    console.log(fmtMetrics('breakpull-confirm(次日突破回踩高确认进)', m))
    console.log(`→ confirm vs close 期望差 ${r2(m.expectancyR - mClose.expectancyR)}R · vs 突破基线 ${base.metrics.expectancyR}R`)

    // 阈值扫描(close 入场为主,关键旋钮亦看 confirm)。
    console.log('\n---------- PBREAK 扫描(close 入场)----------')
    const bpSweep: Array<Record<string, unknown>> = []
    const sweepClose = (over: Partial<BreakoutPullbackConfig>, hold = HOLD_BP) =>
      aggregate(data.flatMap((sb) => simulateBreakoutPullback(sb, { ...PBREAK, ...over }, hold)))
    for (const VM of [1.5, 1.8, 2.2, 2.6]) {
      const mm = sweepClose({ VOL_MULT: VM })
      console.log(fmtMetrics(`VOL_MULT=${VM}`, mm))
      bpSweep.push({ knob: 'VOL_MULT', value: VM, metrics: mm })
    }
    for (const BL of [10, 20, 40, 60]) {
      const mm = sweepClose({ BREAK_LOOKBACK: BL })
      console.log(fmtMetrics(`BREAK_LOOKBACK=${BL}`, mm))
      bpSweep.push({ knob: 'BREAK_LOOKBACK', value: BL, metrics: mm })
    }
    for (const PA of [1, 2, 3, 5]) {
      const mm = sweepClose({ PB_MAX_AGO: PA })
      console.log(fmtMetrics(`PB_MAX_AGO=${PA}`, mm))
      bpSweep.push({ knob: 'PB_MAX_AGO', value: PA, metrics: mm })
    }
    for (const HT of [0.0, 0.02, 0.03, 0.05]) {
      const mm = sweepClose({ HOLD_TOL: HT })
      console.log(fmtMetrics(`HOLD_TOL=${HT}`, mm))
      bpSweep.push({ knob: 'HOLD_TOL', value: HT, metrics: mm })
    }
    for (const RM of [1.5, 2, 2.5, 3]) {
      const mm = sweepClose({ R_MULT: RM })
      console.log(fmtMetrics(`R_MULT=${RM}`, mm))
      bpSweep.push({ knob: 'R_MULT', value: RM, metrics: mm })
    }
    for (const H of [3, 5, 10, 20]) {
      const mm = sweepClose({}, H)
      console.log(fmtMetrics(`HOLD=${H}`, mm))
      bpSweep.push({ knob: 'HOLD', value: H, metrics: mm })
    }
    // 关键旋钮的 confirm 入场对照
    console.log('\n---------- PBREAK confirm 入场关键对照 ----------')
    for (const VM of [1.8, 2.2]) {
      const mm = aggregate(data.flatMap((sb) => simulateBreakoutPullbackConfirm(sb, { ...PBREAK, VOL_MULT: VM }, HOLD_BP)))
      console.log(fmtMetrics(`confirm·VOL_MULT=${VM}`, mm))
      bpSweep.push({ knob: 'confirm·VOL_MULT', value: VM, metrics: mm })
    }
    for (const BL of [10, 20]) {
      const mm = aggregate(data.flatMap((sb) => simulateBreakoutPullbackConfirm(sb, { ...PBREAK, BREAK_LOOKBACK: BL }, HOLD_BP)))
      console.log(fmtMetrics(`confirm·BREAK_LOOKBACK=${BL}`, mm))
      bpSweep.push({ knob: 'confirm·BREAK_LOOKBACK', value: BL, metrics: mm })
    }
    out.breakoutPullbackEval = {
      hold: HOLD_BP,
      config: PBREAK,
      metricsClose: mClose,
      metricsConfirm: m,
      baselineExpectancyR: base.metrics.expectancyR,
      sweep: bpSweep,
    }
  }

  // TA: 技术分析组合 因子分桶检验(breakout/highdiv/volbreak 成交按信号日 TA bias/distribution 分桶)。
  if (RUN_TA) {
    console.log('\n========== 技术分析组合(Wyckoff+道氏+AlBrooks)因子分桶检验 ==========')
    console.log('（按信号日 TA bias / distribution 分桶;期望 供给<中性<需求、distribution 跑输 → 据数定 WEIGHTS.ta 与降档惩罚)')
    const te = evaluateTechnicalFactor(data)
    console.log(fmtMetrics('全体 pooled', te.overall))
    for (const b of ['demand', 'neutral', 'supply']) console.log(fmtMetrics(`  bias=${b}`, te.byBias[b]))
    console.log(fmtMetrics('  distribution=是', te.byDist.dist))
    console.log(fmtMetrics('  distribution=否', te.byDist.nonDist))
    out.technicalFactorEval = te
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

// ── COMBO 因子检验:龙虎榜(机构) + 板块轮动 作为 breakout/trigger 加分因子 ──────
interface BoardSeries {
  dates: string[]
  closes: number[]
}

/** 样本所有 K 线日期并集 = 交易日历(升序)+ date→下标。 */
function buildCalendar(data: StockBars[]): { calendar: string[]; idxByDate: Map<string, number> } {
  const set = new Set<string>()
  for (const sb of data) for (const b of sb.bars) set.add(b.date)
  const calendar = [...set].sort()
  const idxByDate = new Map<string, number>()
  calendar.forEach((d, i) => idxByDate.set(d, i))
  return { calendar, idxByDate }
}

/** 信号日(含)及其前 k 个交易日。 */
function windowDatesFor(calendar: string[], idxByDate: Map<string, number>, signalDate: string, k: number): string[] {
  const i = idxByDate.get(signalDate)
  if (i === undefined) return [signalDate]
  return calendar.slice(Math.max(0, i - k), i + 1)
}

/** 龙虎榜索引磁盘缓存(增量:只补缺失日期再回写;CACHE=0 不读)。 */
async function loadLhbIndexFor(neededDates: string[]): Promise<LhbIndex> {
  const file = join(OUT_DIR, `.lhb-${LHB_K}-${LHB_INST ? 'inst' : 'net'}.json`)
  let index: LhbIndex = new Map()
  if (USE_CACHE && existsSync(file)) {
    try {
      index = deserializeLhbIndex(JSON.parse(readFileSync(file, 'utf8')))
    } catch {
      /* 损坏则重建 */
    }
  }
  const missing = neededDates.filter((d) => !index.has(d))
  if (missing.length) {
    console.log(`[Combo] 龙虎榜取数 ${missing.length} 个交易日(缓存命中 ${neededDates.length - missing.length};INST=${LHB_INST})...`)
    const fresh = await buildLhbIndex(missing, {
      institutional: LHB_INST,
      concurrency: LHB_CONC,
      onProgress: (d, t) => {
        if (d % 50 === 0) console.log(`[Combo]   LHB ${d}/${t}`)
      },
    })
    for (const [date, m] of fresh) index.set(date, m)
    try {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(file, JSON.stringify(serializeLhbIndex(index)))
    } catch {
      /* 缓存写失败非致命 */
    }
  }
  return index
}

/** 个股→主行业板块 BKxxxx(磁盘缓存,当前态)。 */
async function loadStockBoards(codes: string[]): Promise<Map<string, string>> {
  const file = join(OUT_DIR, `.stock-boards-${SAMPLE}.json`)
  let map = new Map<string, string>()
  if (USE_CACHE && existsSync(file)) {
    try {
      map = new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>))
    } catch {
      /* */
    }
  }
  const missing = codes.filter((c) => !map.has(c))
  if (missing.length) {
    console.log(`[Combo] 解析个股行业板块 ${missing.length} 只...`)
    const res = await mapLimit(missing, LHB_CONC, async (c) => ({ c, bk: (await resolveStockIndustryBoard(c)).bk }))
    for (const { c, bk } of res) map.set(c, bk)
    try {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(file, JSON.stringify(Object.fromEntries(map)))
    } catch {
      /* */
    }
  }
  return map
}

/** 板块→日线 closes(磁盘缓存)。 */
async function loadBoardCloses(bks: string[]): Promise<Map<string, BoardSeries>> {
  const file = join(OUT_DIR, `.board-closes-${SAMPLE}.json`)
  let map = new Map<string, BoardSeries>()
  if (USE_CACHE && existsSync(file)) {
    try {
      map = new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, BoardSeries>))
    } catch {
      /* */
    }
  }
  const missing = bks.filter((b) => b && !map.has(b))
  if (missing.length) {
    console.log(`[Combo] 取板块日线 ${missing.length} 个...`)
    const res = await mapLimit(missing, LHB_CONC, async (b) => {
      try {
        const bars = await fetchIndexKline(`90.${b}`, KLINE + 60)
        return { b, s: { dates: bars.map((x) => x.date), closes: bars.map((x) => x.close) } as BoardSeries }
      } catch {
        return { b, s: { dates: [], closes: [] } as BoardSeries }
      }
    })
    for (const { b, s } of res) map.set(b, s)
    // 只持久化非空序列:板块 90.BK 无 Sina 兜底,EM 限流时会整批返回空——不缓存空,避免毒化后续重跑。
    const good = Object.fromEntries([...map].filter(([, s]) => s.closes.length > 0))
    try {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(file, JSON.stringify(good))
    } catch {
      /* */
    }
  }
  return map
}

/** 某笔交易信号日的板块强弱(找板块 closes 里 ≤ 信号日的最大下标,切片分类)。 */
function boardStrengthForTrade(
  code: string,
  date: string,
  stockBoards: Map<string, string>,
  boardCloses: Map<string, BoardSeries>,
): ReturnType<typeof boardStrengthAsOf> {
  const bk = stockBoards.get(code)
  if (!bk) return null
  const s = boardCloses.get(bk)
  if (!s || s.closes.length === 0) return null
  let idx = -1
  for (let k = 0; k < s.dates.length; k++) {
    if (s.dates[k] <= date) idx = k
    else break
  }
  if (idx < 0) return null
  return boardStrengthAsOf(s.closes, idx, LONG_WIN, SHORT_WIN)
}

/** COMBO 主流程:收集信号 → 取龙虎榜/板块 → 分桶对比期望/PF → trigger 角度 + 覆盖率。 */
async function runCombo(data: StockBars[], base: Metrics): Promise<Record<string, unknown>> {
  const { calendar, idxByDate } = buildCalendar(data)

  const breakoutTrades = data.flatMap((sb) => simulate(sb, SCREENER, 'breakout', HOLD))
  const triggerTrades = data.flatMap((sb) => simulate(sb, SCREENER, 'trigger', HOLD))
  console.log('\n========== COMBO 龙虎榜(机构) + 板块轮动 因子检验 ==========')
  console.log(`[Combo] breakout 信号 ${breakoutTrades.length} 笔 / trigger 信号 ${triggerTrades.length} 笔;K=${LHB_K} 长窗=${LONG_WIN} 短窗=${SHORT_WIN}`)

  // 需要的龙虎榜日期 = 所有信号日的 [date-K..date] 并集
  const neededSet = new Set<string>()
  for (const t of [...breakoutTrades, ...triggerTrades]) {
    for (const d of windowDatesFor(calendar, idxByDate, t.date, LHB_K)) neededSet.add(d)
  }
  const lhbIndex = await loadLhbIndexFor([...neededSet].sort())

  const codes = [...new Set([...breakoutTrades, ...triggerTrades].map((t) => t.code))]
  const stockBoards = await loadStockBoards(codes)
  const boardCloses = await loadBoardCloses([...new Set([...stockBoards.values()].filter(Boolean))])

  const lhbOf = (t: Trade): LhbFactor => lhbFactorFor(t.code, windowDatesFor(calendar, idxByDate, t.date, LHB_K), lhbIndex)
  const taggedBO = breakoutTrades.map((t) => ({
    t,
    lhb: lhbOf(t),
    board: boardStrengthForTrade(t.code, t.date, stockBoards, boardCloses),
  }))

  const seg = (label: string, subset: Trade[]) => {
    const m = aggregate(subset)
    console.log(fmtMetrics(label, m))
    return { n: subset.length, metrics: m }
  }
  // score01/净额 三分位单调性(高分位期望应高于低分位 = 因子有区分度)。正分样本不足则跳过。
  const tercile = (label: string, vals: Array<{ t: Trade; v: number }>) => {
    const pos = vals.filter((x) => x.v > 0).sort((a, b) => a.v - b.v)
    if (pos.length < 9) {
      console.log(`  ${label}: 正分样本 ${pos.length} 不足,跳过三分位`)
      return null
    }
    const t1 = pos.slice(0, Math.floor(pos.length / 3))
    const t3 = pos.slice(Math.ceil((pos.length * 2) / 3))
    return { low: seg(`  ${label} 低分位`, t1.map((x) => x.t)), high: seg(`  ${label} 高分位`, t3.map((x) => x.t)) }
  }

  console.log(`\n--- breakout 按 龙虎榜 因子分桶(基线 n=${base.n} 期望 ${base.expectancyR}R PF ${base.profitFactor})---`)
  const boInstMulti = taggedBO.filter((x) => x.lhb.instDays >= 2).map((x) => x.t)
  const boInst = taggedBO.filter((x) => x.lhb.instDays >= 1).map((x) => x.t)
  const boAnyNet = taggedBO.filter((x) => x.lhb.onDays >= 1 && x.lhb.netSum > 0).map((x) => x.t)
  const boNoLhb = taggedBO.filter((x) => x.lhb.onDays === 0).map((x) => x.t)
  const lhbBuckets = {
    instMulti: seg('  机构多日净买', boInstMulti),
    inst: seg('  机构净买(≥1日)', boInst),
    anyNet: seg('  全口径净买>0', boAnyNet),
    noLhb: seg('  窗口内未上榜', boNoLhb),
  }

  // 游资(知名营业部)分桶:游资净买是否独立于机构带来 alpha。「纯游资」=有游资买、无机构买,
  // 用于隔离游资本身的贡献(避免与机构因子混淆)。
  console.log('\n--- breakout 按 游资 因子分桶 ---')
  const boHotMulti = taggedBO.filter((x) => x.lhb.hotDays >= 2).map((x) => x.t)
  const boHot = taggedBO.filter((x) => x.lhb.hotDays >= 1).map((x) => x.t)
  const boHotOnly = taggedBO.filter((x) => x.lhb.hotDays >= 1 && x.lhb.instDays === 0).map((x) => x.t)
  const boHotAndInst = taggedBO.filter((x) => x.lhb.hotDays >= 1 && x.lhb.instDays >= 1).map((x) => x.t)
  const hotBuckets = {
    hotMulti: seg('  游资多日净买', boHotMulti),
    hot: seg('  游资净买(≥1日)', boHot),
    hotOnly: seg('  纯游资(无机构)', boHotOnly),
    hotAndInst: seg('  游资+机构', boHotAndInst),
  }

  // 游资净买额三分位(高>低 = 资金量级有区分度)
  console.log('\n--- breakout 游资净买额 三分位(高>低 = 因子有区分度)---')
  const hotTercile = tercile('游资净买额', taggedBO.map((x) => ({ t: x.t, v: x.lhb.hotNetSum })))

  console.log('\n--- breakout 按 板块强弱 分桶 ---')
  const boBoardStrong = taggedBO.filter((x) => x.board?.strong).map((x) => x.t)
  const boBoardWeak = taggedBO.filter((x) => x.board && !x.board.strong).map((x) => x.t)
  const boBoardHs = taggedBO.filter((x) => x.board?.quadrant === 'hs').map((x) => x.t)
  const boardBuckets = {
    strong: seg('  板块短期强(hs/ls)', boBoardStrong),
    weak: seg('  板块短期弱(hw/lw)', boBoardWeak),
    hs: seg('  板块强势延续(hs)', boBoardHs),
  }

  console.log('\n--- breakout 2×2(龙虎榜机构 × 板块强)---')
  const both = taggedBO.filter((x) => x.lhb.instDays >= 1 && x.board?.strong).map((x) => x.t)
  const lhbOnly = taggedBO.filter((x) => x.lhb.instDays >= 1 && !x.board?.strong).map((x) => x.t)
  const boardOnly = taggedBO.filter((x) => x.lhb.instDays === 0 && x.board?.strong).map((x) => x.t)
  const neither = taggedBO.filter((x) => x.lhb.instDays === 0 && !x.board?.strong).map((x) => x.t)
  const twoBy = {
    instAndStrong: seg('  机构+板块强', both),
    instOnly: seg('  仅机构', lhbOnly),
    strongOnly: seg('  仅板块强', boardOnly),
    neither: seg('  皆无', neither),
  }

  console.log('\n--- breakout score01 三分位(高>低 = 因子有区分度)---')
  const lhbTercile = tercile('LHB', taggedBO.map((x) => ({ t: x.t, v: x.lhb.score01 })))
  const boardTercile = tercile('板块', taggedBO.map((x) => ({ t: x.t, v: x.board?.score01 ?? 0 })))

  // trigger 角度:机构埋伏(前 K 日机构净买)的扳机 直买表现 vs 普通扳机
  console.log(`\n--- trigger 直买:机构埋伏(前${LHB_K}日机构净买) vs 普通 ---`)
  const taggedTR = triggerTrades.map((t) => ({ t, lhb: lhbOf(t) }))
  const trInst = taggedTR.filter((x) => x.lhb.instDays >= 1).map((x) => x.t)
  const trNoInst = taggedTR.filter((x) => x.lhb.instDays === 0).map((x) => x.t)
  const triggerSplit = { instBacked: seg('  机构埋伏扳机', trInst), plain: seg('  普通扳机', trNoInst) }

  // trigger 游资埋伏(前 K 日游资净买)直买表现 vs 普通
  console.log(`\n--- trigger 直买:游资埋伏(前${LHB_K}日游资净买) vs 普通 ---`)
  const trHot = taggedTR.filter((x) => x.lhb.hotDays >= 1).map((x) => x.t)
  const trNoHot = taggedTR.filter((x) => x.lhb.hotDays === 0).map((x) => x.t)
  const triggerHotSplit = { hotBacked: seg('  游资埋伏扳机', trHot), plain: seg('  无游资扳机', trNoHot) }

  const coverage = {
    breakoutTotal: breakoutTrades.length,
    breakoutInst: boInst.length,
    breakoutInstMulti: boInstMulti.length,
    breakoutAnyNet: boAnyNet.length,
    breakoutHot: boHot.length,
    breakoutHotMulti: boHotMulti.length,
    breakoutHotOnly: boHotOnly.length,
    breakoutBoardStrong: boBoardStrong.length,
    triggerTotal: triggerTrades.length,
    triggerInst: trInst.length,
    triggerHot: trHot.length,
    instCoveragePct: r2(breakoutTrades.length ? (boInst.length / breakoutTrades.length) * 100 : 0),
    hotCoveragePct: r2(breakoutTrades.length ? (boHot.length / breakoutTrades.length) * 100 : 0),
  }
  console.log(
    `\n[Combo] 覆盖率:breakout 机构埋伏 ${coverage.breakoutInst}/${coverage.breakoutTotal}(${coverage.instCoveragePct}%)、机构多日 ${coverage.breakoutInstMulti}、` +
      `游资埋伏 ${coverage.breakoutHot}(${coverage.hotCoveragePct}%)、纯游资 ${coverage.breakoutHotOnly}、板块强 ${coverage.breakoutBoardStrong};` +
      `trigger 机构埋伏 ${coverage.triggerInst}/${coverage.triggerTotal}、游资埋伏 ${coverage.triggerHot}`,
  )

  return {
    params: { K: LHB_K, institutional: LHB_INST, longWin: LONG_WIN, shortWin: SHORT_WIN },
    coverage,
    baseline: base,
    lhbBuckets,
    hotBuckets,
    hotTercile,
    boardBuckets,
    twoBy,
    lhbTercile,
    boardTercile,
    triggerSplit,
    triggerHotSplit,
    note: '相对基线比较;个股→板块为「当前」归属(轻度前视)、幸存者偏差同主回测;机构/游资席位仅单日榜可得。游资=hotMoneySeats 名单识别。',
  }
}

main().catch((err) => {
  console.error('[Backtest] 失败:', err)
  process.exit(1)
})
