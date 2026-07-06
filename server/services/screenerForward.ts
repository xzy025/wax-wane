// 选股战法 · 滚动实盘回测(forward-test / 实盘战绩)。
//
// 读侧消费者:不改任何 picks 的存档方式。读已有每日存档(screener_snapshots /
// docs/screener/<asof>.json),对每个买点战法的历史 pick 拉「信号日之后」的真实日线,
// 复用回测撮合内核(engine.simForward/makeTrade/aggregate)算出真实跑出来的结果:
//   · CLOSED —— 已止盈/止损/时间止损(窗口走满 HOLD)
//   · OPEN   —— 持有期未走完 → 用最新收盘盯市,给浮动 R
//   · PENDING—— 取K失败/退市停牌/信号日未覆盖 → 不计入指标
// 聚合每战法 实盘期望R/PF/胜率 并与回测基线对照,验证 edge 是否在样本外成立。
//
// 触发=按需(GET /api/screener/forward),复用 createCache + 盘后 12h 缓存兜底,
// 每次成功计算落盘 docs/screener/forward-<today>.json 供冷启动/抓取失败兜底。
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createCache, sessionTtl } from '../lib/cache'
import { todayShanghai } from '../lib/time'
import { parseScreenerArchiveName } from './screenerArchive'
import { isDbReady, getRecentScreenerSnapshots } from '../db/pgDatabase'
import { fetchStockKline, mapLimit } from './ashare'
import { simForward, makeTrade, aggregate, type Trade, type Metrics } from '../backtest/engine'
import { FUNDRES, BHOLD } from '../config/screener'
import type { Bar } from './screenerRules'
import type { ScreenerResult } from './screener'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')

// ── 调参 ──────────────────────────────────────────────────────────────
const HOLD = 20 // 持有/观察的最大交易日数(回测全局默认;fundres/bhold 见 HOLD_BY_GROUP)
const SNAP_LIMIT = 250 // 回溯多少份历史快照(≈1 交易年上限)
const CONCURRENCY = 12 // 每唯一 code 取K并发(与回测一致)
const FORWARD_CLOSED_TTL = 12 * 3_600_000 // 盘后长 TTL(同 screener)
const FORWARD_RE = /^forward-(\d{4}-\d{2}-\d{2})\.json$/

// 买点战法(评估);跳过非买点监控清单 watch / trendwatch(非买点·未回测)。
const BUY_GROUPS = [
  'breakout', 'trigger', 'pullback', 'highdiv', 'volbreak', 'fundres', 'bhold', 'trendnew',
] as const
export type BuyGroup = (typeof BUY_GROUPS)[number]
const NON_BUY = new Set(['watch', 'trendwatch', 'bholdwatch'])

// trigger 2026-07-04 降级为「观察口径」:实盘战绩 −0.43R(n=57,11日 caution 窗)显著为负,
// 但当前配置下回测直买为正(COMBO 全样本 0.39R/PF1.65/n202;旧"−0.11R"是 2026-06-22 扳机止损
// 收紧前的结论,已过时)——两路证据矛盾。处置:**继续评估攒实盘样本裁决,但移出 overall/
// totalPicks 总体口径**(不再稀释买点战法汇总),track 行挂矛盾说明;UI 卡片改"等突破确认"。
const OVERALL_EXCLUDED: ReadonlySet<BuyGroup> = new Set<BuyGroup>(['trigger'])

// 基线对照必须同持有期口径:fundres 基线(0.42R/PF2.22,STOP4)是 HOLD=3 跑出的、bhold 基线
// (0.45R/PF1.9)是 HOLD=10——统一按 20 撮合会让「实盘 vs 回测」对这两战法不可判读。
const HOLD_BY_GROUP: Partial<Record<BuyGroup, number>> = { fundres: FUNDRES.HOLD, bhold: 10 }
export const holdFor = (g: BuyGroup): number => HOLD_BY_GROUP[g] ?? HOLD

// 各战法回测基线(取自 screener.ts 注释/回测产物;缺者前端显示「—」)。
const BACKTEST_BASELINE: Partial<Record<BuyGroup, { expectancyR: number; profitFactor?: number }>> = {
  breakout: { expectancyR: 0.08 }, // 突破基线(PF 未单列)
  trigger: { expectancyR: 0.39, profitFactor: 1.65 }, // 2026-07-04 当前配置直买全样本(COMBO n202;观察口径对照用)
  highdiv: { expectancyR: 0.19, profitFactor: 1.3 },
  volbreak: { expectancyR: 0.27, profitFactor: 1.41 },
  fundres: { expectancyR: 0.42, profitFactor: 2.22 }, // 2026-07-06 止损校准 STOP 6→4 后基线(n110;入场五臂对照 close 维持最优)
  bhold: { expectancyR: 0.45, profitFactor: 1.9 },
  trendnew: { expectancyR: 0.28, profitFactor: 1.52 },
}
const BHOLD_NOTE =
  '已对齐回测确认口径:信号日(整理日)后 3 日内突破整理高点 trigger 才入场(0.45R 基线可比);' +
  'skipped=确认窗内未触发或先破整理低点废弃(不进胜率/期望)。旧快照缺 trigger 字段的笔回退整理日收盘口径。'
const TRIGGER_NOTE =
  '观察口径·不计入总体:扳机直买 实盘 −0.43R(11日/caution) vs 当前配置回测 +0.39R(n202)矛盾,' +
  '继续攒实盘样本裁决;操作上等放量突破确认(转为突破信号)再买。'

// 停牌/退市判定:末根 K 线距今超过该日历天数(≈10 个交易日)仍未走满 hold → 不再无限期
// 挂 open(那会把走弱停牌票永远踢出 closed 分母=幸存者偏差),按最后可得收盘 mark-to-last
// 计入 closed(reason='stale'),并单独计数供面板提示。
const STALE_CAL_DAYS = 15

/** 末根 K 线是否已陈旧(停牌/退市迹象):距 today 超过 STALE_CAL_DAYS 个日历日。 */
export function isBarStale(lastBarDate: string, todayIso: string): boolean {
  const last = Date.parse(`${lastBarDate}T00:00:00Z`)
  const today = Date.parse(`${todayIso}T00:00:00Z`)
  if (!Number.isFinite(last) || !Number.isFinite(today)) return false
  return (today - last) / 86_400_000 > STALE_CAL_DAYS
}

export type SampleConfidence = 'low' | 'medium' | 'high'
/** n<10 视为噪声、10~29 方向性参考、≥30 与 optimize.ts 网格搜索的 MIN_N 门槛一致、可信。 */
export function sampleConfidenceFor(n: number): SampleConfidence {
  if (n < 10) return 'low'
  if (n < 30) return 'medium'
  return 'high'
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
const r2 = (n: number) => Math.round(n * 100) / 100
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

// ── 输出类型 ──────────────────────────────────────────────────────────
// 'stale'=停牌/退市 mark-to-last 平仓;'skipped'=bhold 确认口径下未触发/破位废弃(不进指标)。
export type ForwardReason = Trade['reason'] | 'open' | 'pending' | 'stale' | 'skipped'

export interface ForwardPick {
  asof: string // 信号日(归档日)
  group: BuyGroup
  code: string
  name: string
  entry: number // 候选记录的介入位(归档基准)
  stop: number
  target: number
  status: 'open' | 'closed' | 'pending' | 'skipped'
  exit: number // 平仓价 / 盯市价(前复权基准);pending/skipped=0
  exitDate: string
  reason: ForwardReason
  R: number // 已实现 R(closed)或浮动 R(open);pending=0
  retPct: number
  barsHeld: number // 实际持有交易日数
  barsElapsed: number // 信号日至今经过的交易日数
  // 归因切片标签(事后分析用,从归档候选透传,不参与撮合计算;缺失=该因子当时未挂上)。
  score?: number
  taBias?: string // 'demand' | 'supply' | 'neutral'
  lhbInstDays?: number
  boardQuadrant?: string // 'hs' | 'ls' | 'hw' | 'lw'
  regimePhase?: string // 信号日快照的情绪环境 attack/caution/retreat(来自 snap.regime.phase)
  marketTrend?: string // 信号日快照的大盘趋势 strong/neutral/weak(来自 snap.regime.marketTrend)
}

export interface StrategyTrack {
  group: BuyGroup
  closed: Metrics // 仅对已平仓样本聚合
  closedCount: number
  openCount: number
  pendingCount: number
  staleCount: number // closed 里按 mark-to-last 平仓的停牌/退市笔数(已含在 closedCount 内)
  skippedCount: number // bhold 确认口径下废弃的笔数(不进任何指标)
  sampleConfidence: SampleConfidence // 已平仓样本量可信度(仿 optimize.ts MIN_N=30)
  unrealizedAvgR: number // 持仓中样本的平均浮动 R
  backtestExpectancyR?: number
  backtestProfitFactor?: number
  note?: string
  picks: ForwardPick[]
}

export interface SegmentBucket {
  label: string
  metrics: Metrics
  sampleConfidence: SampleConfidence
}
export interface SegmentGroup {
  by: string // 'taBias' | 'lhb' | 'board' | 'scoreTier'
  buckets: SegmentBucket[]
}

export interface ScreenerForwardResult {
  asof: string // 生成日(上海)
  generatedAt: string // ISO
  hold: number
  snapshotCount: number // 实际纳入评估的快照份数
  dateRange: [string, string] | null // [最早信号日, 最晚信号日]
  totalPicks: number
  pendingCount: number
  skippedCount?: number // bhold 确认口径下废弃的总笔数(不进任何指标)
  strategies: StrategyTrack[]
  overall: Metrics // 买点战法已平仓汇总(observed 组如 trigger 不计,见 OVERALL_EXCLUDED)
  breakoutSegments?: SegmentGroup[] // breakout 通用切片归因(仅样本够格时才有意义,用户先聚焦这一个战法)
  regimeSegments?: SegmentGroup[] // 全买点战法按信号日市场环境(情绪 phase / 大盘趋势)切片——攒实盘证据供环境闸门复裁
  fromCache?: boolean // 本次来自磁盘兜底
}

// ── 纯函数(单测) ────────────────────────────────────────────────────
interface RawCandidate {
  code: string
  name: string
  price?: number
  entry?: number
  stopLoss?: number
  stop?: number
  target?: number
  // 归因切片标签源字段(形状同 screener.ts 的 ScreenerCandidate,直接从归档 JSON 读,best-effort)。
  score?: number
  ta?: { bias?: string }
  lhbInst?: { instDays?: number }
  board?: { quadrant?: string }
  // bhold 确认口径字段(BHoldScreenerCandidate 独有;旧快照缺失时回退收盘口径)。
  trigger?: number // 确认入场位=整理段(含pole)最高
  consolLow?: number // 整理段最低(结构止损/破位废弃线)
}

/** 位价归一化:吸收字段名漂移(stopLoss/stop、entry 缺失→price);非买点/缺位价/非正风险→null。 */
export function pickLevels(
  group: string,
  cand: RawCandidate,
): { entry: number; stop: number; target: number } | null {
  if (NON_BUY.has(group)) return null
  const entry = num(cand.entry) || num(cand.price) // pullback 无 entry → price
  const stop = num(cand.stopLoss) || num(cand.stop) // Candidate 用 stopLoss;新组用 stop
  const target = num(cand.target)
  if (!(entry > 0 && stop > 0 && target > 0)) return null // 旧快照缺位价 → 跳过
  if (entry - stop <= 0) return null // 非正风险 → 跳过
  return { entry, stop, target }
}

/** 开/平仓判定:simForward 总会返回(默认 time 止于末根)→ 区分「真时间止损」与「窗口未走完」。
 *  lastBarStale=true(末根距今超 STALE_CAL_DAYS,停牌/退市迹象)时窗口未走完也不再挂 open,
 *  返回 'stale' 由调用方按 mark-to-last 计入 closed——否则弱票停牌即永久 open、被踢出
 *  closed 分母,是幸存者偏差。 */
export function classifyForward(
  reason: Trade['reason'],
  hold: number,
  lenAfter: number,
  lastBarStale = false,
): 'open' | 'closed' | 'stale' {
  if (reason !== 'time') return 'closed' // 已触发 stop/target(含跳空)
  if (lenAfter >= hold) return 'closed' // 走满 hold 根的真时间止损
  return lastBarStale ? 'stale' : 'open' // 未走完:停牌陈旧 → mark-to-last;否则盯市
}

/** 估算需取的日线根数:覆盖最早信号日至今(日历→交易日近似)+ 充裕 pad,封顶 600。 */
export function neededBars(earliestAsof: string, nowMs: number): number {
  const startMs = Date.parse(`${earliestAsof}T00:00:00Z`)
  const calDays = Number.isFinite(startMs) ? Math.max(0, (nowMs - startMs) / 86_400_000) : 0
  const tradingApprox = Math.ceil((calDays * 5) / 7)
  return Math.min(600, Math.max(60, tradingApprox + HOLD + 15))
}

// ── 评估一笔 pick ─────────────────────────────────────────────────────
interface Task {
  asof: string
  group: BuyGroup
  code: string
  name: string
  entry: number
  stop: number
  target: number
  trigger?: number // bhold 确认口径:确认入场位(旧快照缺失→回退收盘口径)
  consolLow?: number // bhold 确认口径:整理低点(破位废弃线)
  score?: number
  taBias?: string
  lhbInstDays?: number
  boardQuadrant?: string
  regimePhase?: string
  marketTrend?: string
}

function pendingPick(t: Task): ForwardPick {
  return {
    asof: t.asof, group: t.group, code: t.code, name: t.name,
    entry: r2(t.entry), stop: r2(t.stop), target: r2(t.target),
    status: 'pending', exit: 0, exitDate: '', reason: 'pending', R: 0, retPct: 0, barsHeld: 0, barsElapsed: 0,
    score: t.score, taBias: t.taBias, lhbInstDays: t.lhbInstDays, boardQuadrant: t.boardQuadrant,
    regimePhase: t.regimePhase, marketTrend: t.marketTrend,
  }
}

/** bhold 确认口径:确认窗内未触发/先破位 → 废弃,不进任何指标(与回测 simulateBreakoutHoldConfirm 口径一致)。 */
function skippedPick(t: Task, barsElapsed: number): ForwardPick {
  return { ...pendingPick(t), status: 'skipped', reason: 'skipped', barsElapsed }
}

/** 把候选的止损/目标按「相对介入的比率」映射到前复权基准的信号日收盘,再撮合——
 *  令 entry/stop/target/exit 同基准,R 对 复权再调整 不变。
 *  todayIso:停牌陈旧判定基准日(生产传 todayShanghai(),测试注入固定值)。 */
export function evaluateTask(t: Task, bars: Bar[] | undefined, todayIso: string): ForwardPick {
  if (!bars || bars.length < 2) return pendingPick(t)
  // 信号日索引:最后一根 date<=asof(用 <= 容忍周末/节假日戳的 asof)。
  let i = -1
  for (let k = bars.length - 1; k >= 0; k--) {
    if (bars[k].date <= t.asof) { i = k; break }
  }
  if (i < 0) return pendingPick(t) // 取到的窗口未覆盖信号日
  // bhold 走确认口径(0.45R 基线的真实入场机制);旧快照缺 trigger 字段回退收盘口径。
  if (t.group === 'bhold' && t.trigger != null && t.trigger > 0 && t.consolLow != null && t.consolLow > 0) {
    return evaluateBholdConfirm(t, bars, i, todayIso)
  }
  const stopFrac = t.stop / t.entry
  const targetFrac = t.target / t.entry
  const entryRef = bars[i].close
  const stopRef = entryRef * stopFrac
  const targetRef = entryRef * targetFrac
  const risk = entryRef - stopRef
  if (risk <= 0) return pendingPick(t)
  const lenAfter = bars.length - 1 - i
  const hold = holdFor(t.group) // 与该战法回测基线同持有期口径
  const sim = simForward(bars, i, stopRef, targetRef, hold)
  const trade = makeTrade(t.code, bars, i, entryRef, stopRef, targetRef, risk, sim)
  const cls = classifyForward(sim.reason, hold, lenAfter, isBarStale(bars[bars.length - 1].date, todayIso))
  // open 情形:lenAfter<HOLD 且未触发 → sim 末根即最新收盘 → trade 已是盯市 R,仅改 reason。
  // stale 情形:同一 sim 结果按 mark-to-last 计入 closed(exit=末根收盘),reason='stale'。
  // 展示 entry/stop/target 用前复权基准(trade.*),与 exit 同基准 → (exit-entry)/(entry-stop)=R 恒成立。
  return {
    asof: t.asof, group: t.group, code: t.code, name: t.name,
    entry: trade.entry, stop: trade.stop, target: trade.target,
    status: cls === 'open' ? 'open' : 'closed',
    exit: trade.exit,
    exitDate: trade.exitDate,
    reason: cls === 'open' ? 'open' : cls === 'stale' ? 'stale' : trade.reason,
    R: trade.R,
    retPct: trade.retPct,
    barsHeld: trade.bars,
    barsElapsed: lenAfter,
    score: t.score, taBias: t.taBias, lhbInstDays: t.lhbInstDays, boardQuadrant: t.boardQuadrant,
    regimePhase: t.regimePhase, marketTrend: t.marketTrend,
  }
}

/** bhold 确认口径评估(与回测 simulateBreakoutHoldConfirm 同款):信号日后 CONFIRM_WINDOW 根内
 *  先破整理低点 → 废弃;high≥trigger → 以 max(trigger, 当日开) 入场(跳空高开按开盘),入场日
 *  剩余走势参与撮合(checkEntryBar);窗口走完未触发 → 废弃;bars 不够看完确认窗 → pending。
 *  trigger/consolLow 按相对快照 entry 的比率重锚到前复权基准 → 复权再调整不变。 */
function evaluateBholdConfirm(t: Task, bars: Bar[], i: number, todayIso: string): ForwardPick {
  const lenAfter = bars.length - 1 - i
  const baseRef = bars[i].close // 前复权基准的整理日收盘(对应快照 entry)
  const triggerRef = baseRef * ((t.trigger as number) / t.entry)
  const consolLowRef = baseRef * ((t.consolLow as number) / t.entry)
  const confirmWin = BHOLD.CONFIRM_WINDOW
  const end = Math.min(i + confirmWin, bars.length - 1)
  let entryIdx = -1
  let entryPx = 0
  for (let j = i + 1; j <= end; j++) {
    if (bars[j].low < consolLowRef) return skippedPick(t, lenAfter) // 整理结构破位,放弃
    if (bars[j].high >= triggerRef) {
      entryPx = Math.max(triggerRef, bars[j].open) // 跳空高开则按开盘
      entryIdx = j
      break
    }
  }
  if (entryIdx < 0) {
    // 确认窗未触发:窗口已走完 → 废弃;bars 不够(信号太新)→ pending 等后续数据。
    return lenAfter >= confirmWin ? skippedPick(t, lenAfter) : pendingPick(t)
  }
  const stop = Math.max(consolLowRef * 0.997, entryPx * (1 - BHOLD.STOP_MAX_PCT / 100))
  const risk = entryPx - stop
  if (risk <= 0) return pendingPick(t)
  const target = entryPx + BHOLD.R_MULT * risk
  const hold = holdFor('bhold')
  const lenAfterEntry = bars.length - 1 - entryIdx
  const sim = simForward(bars, entryIdx, stop, target, hold, true) // 盘中触发价入场 → 入场日参与撮合
  const trade = makeTrade(t.code, bars, entryIdx, entryPx, stop, target, risk, sim)
  const cls = classifyForward(sim.reason, hold, lenAfterEntry, isBarStale(bars[bars.length - 1].date, todayIso))
  return {
    asof: t.asof, group: t.group, code: t.code, name: t.name,
    entry: trade.entry, stop: trade.stop, target: trade.target,
    status: cls === 'open' ? 'open' : 'closed',
    exit: trade.exit,
    exitDate: trade.exitDate,
    reason: cls === 'open' ? 'open' : cls === 'stale' ? 'stale' : trade.reason,
    R: trade.R,
    retPct: trade.retPct,
    barsHeld: trade.bars,
    barsElapsed: lenAfter,
    score: t.score, taBias: t.taBias, lhbInstDays: t.lhbInstDays, boardQuadrant: t.boardQuadrant,
    regimePhase: t.regimePhase, marketTrend: t.marketTrend,
  }
}

// ── 快照读取(DB 优先 / 磁盘兜底) ────────────────────────────────────
function groupArray(r: ScreenerResult, g: BuyGroup): RawCandidate[] {
  const arr = (r as unknown as Record<string, unknown>)[g]
  return Array.isArray(arr) ? (arr as RawCandidate[]) : []
}

/** 比 isScreenerResult 宽松:只要 asof + 至少一个买点组数组(收纳 pullback 之前的旧 2 组快照)。 */
function isUsableSnapshot(v: unknown): v is ScreenerResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.asof === 'string' && BUY_GROUPS.some((g) => Array.isArray(r[g]))
}

async function loadRecentSnapshots(limit: number): Promise<ScreenerResult[]> {
  if (isDbReady()) {
    try {
      const rows = await getRecentScreenerSnapshots(limit)
      const out: ScreenerResult[] = []
      for (const row of rows) {
        try {
          const r = JSON.parse(row.result_json)
          if (isUsableSnapshot(r)) out.push(r)
        } catch {
          /* 损坏行跳过 */
        }
      }
      if (out.length) return out // DB 尚未攒到历史时落空 → 回退磁盘
    } catch (err) {
      console.warn('[ScreenerForward] DB 快照读取失败,回退磁盘:', err)
    }
  }
  let files: string[]
  try {
    files = readdirSync(SCREENER_DIR)
  } catch {
    return []
  }
  const refs = files
    .map(parseScreenerArchiveName)
    .filter((x): x is NonNullable<ReturnType<typeof parseScreenerArchiveName>> => x != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1)) // DESC
    .slice(0, limit)
  const out: ScreenerResult[] = []
  for (const ref of refs) {
    try {
      const raw = JSON.parse(readFileSync(join(SCREENER_DIR, `${ref.date}.json`), 'utf8'))
      if (isUsableSnapshot(raw)) out.push(raw)
    } catch {
      /* 损坏/缺失跳过 */
    }
  }
  return out
}

// ── 主计算 ────────────────────────────────────────────────────────────
function emptyResult(): ScreenerForwardResult {
  return {
    asof: todayShanghai(), generatedAt: new Date().toISOString(), hold: HOLD,
    snapshotCount: 0, dateRange: null, totalPicks: 0, pendingCount: 0,
    strategies: [], overall: aggregate([]),
  }
}

/** 已平仓 pick → 回测撮合内核的 Trade 形状(buildTrack/segmentClosedPicks 共用,避免两处重复维护映射)。 */
function toTrade(p: ForwardPick): Trade {
  return {
    code: p.code, date: p.asof, entry: p.entry, stop: p.stop, target: p.target,
    exit: p.exit, exitDate: p.exitDate, reason: p.reason as Trade['reason'],
    retPct: p.retPct, R: p.R, bars: p.barsHeld,
  }
}

/** 按 keyFn 给已平仓 picks 分桶聚合(纯函数,复用回测同款 aggregate);keyFn 返回 null 的
 *  pick 不进任何桶(该因子当时未挂上/缺失)。每桶附带样本可信度,避免小样本桶被误读为信号。 */
export function segmentClosedPicks(picks: ForwardPick[], keyFn: (p: ForwardPick) => string | null): SegmentBucket[] {
  const byKey = new Map<string, Trade[]>()
  for (const p of picks) {
    if (p.status !== 'closed') continue
    const key = keyFn(p)
    if (key == null) continue
    const arr = byKey.get(key) ?? []
    arr.push(toTrade(p))
    byKey.set(key, arr)
  }
  return [...byKey.entries()].map(([label, trades]) => ({
    label, metrics: aggregate(trades), sampleConfidence: sampleConfidenceFor(trades.length),
  }))
}

function buildTrack(group: BuyGroup, picks: ForwardPick[]): StrategyTrack {
  const closed = picks.filter((p) => p.status === 'closed')
  const open = picks.filter((p) => p.status === 'open')
  const pending = picks.filter((p) => p.status === 'pending')
  const skipped = picks.filter((p) => p.status === 'skipped')
  const stale = closed.filter((p) => p.reason === 'stale')
  const closedTrades: Trade[] = closed.map(toTrade)
  const bl = BACKTEST_BASELINE[group]
  // 展示排序:信号日 DESC(最新在前)。
  const sorted = [...picks].sort((a, b) => (a.asof < b.asof ? 1 : a.asof > b.asof ? -1 : 0))
  return {
    group,
    closed: aggregate(closedTrades),
    closedCount: closed.length,
    openCount: open.length,
    pendingCount: pending.length,
    staleCount: stale.length,
    skippedCount: skipped.length,
    sampleConfidence: sampleConfidenceFor(closed.length),
    unrealizedAvgR: open.length ? r2(mean(open.map((p) => p.R))) : 0,
    backtestExpectancyR: bl?.expectancyR,
    backtestProfitFactor: bl?.profitFactor,
    note: group === 'bhold' ? BHOLD_NOTE : group === 'trigger' ? TRIGGER_NOTE : undefined,
    picks: sorted,
  }
}

async function computeForward(): Promise<ScreenerForwardResult> {
  const t0 = Date.now()
  const snapshots = await loadRecentSnapshots(SNAP_LIMIT)
  if (snapshots.length === 0) {
    console.log('[ScreenerForward] 无历史快照,返回空战绩')
    const empty = emptyResult()
    writeForwardDisk(empty)
    return empty
  }

  // Phase 1:摊平任务 + 每 code 最早信号日。
  // 同票冷却去重:同一 (战法, code) 在 hold 窗口内连续上榜只算最早那笔——回测基线全部
  // 带「i = 入场+hold+1 一仓在手不重叠」冷却,实盘战绩不去重的话同段行情被复制 N 次
  // (实测 660 笔里 34% 是重叠窗口伪样本),n 虚高、sampleConfidence 与基线对照全失真。
  // 交易日距离用快照序号近似(每交易日一份快照)。
  const snapsAsc = [...snapshots].sort((a, b) => (a.asof < b.asof ? -1 : 1))
  const dateRank = new Map<string, number>()
  for (const snap of snapsAsc) {
    if (typeof snap.asof === 'string' && !dateRank.has(snap.asof)) dateRank.set(snap.asof, dateRank.size)
  }
  const tasks: Task[] = []
  const earliest = new Map<string, string>()
  const lastKeptRank = new Map<string, number>()
  let dedupSkipped = 0
  let minAsof = ''
  let maxAsof = ''
  for (const snap of snapsAsc) {
    if (typeof snap.asof !== 'string') continue
    if (!minAsof || snap.asof < minAsof) minAsof = snap.asof
    if (!maxAsof || snap.asof > maxAsof) maxAsof = snap.asof
    const rank = dateRank.get(snap.asof) ?? 0
    // 信号日市场环境标签(regime 切片归因用;旧快照缺失 → undefined 不进桶)。
    const regimePhase = typeof snap.regime?.phase === 'string' ? snap.regime.phase : undefined
    const marketTrend = typeof snap.regime?.marketTrend === 'string' ? snap.regime.marketTrend : undefined
    for (const g of BUY_GROUPS) {
      for (const cand of groupArray(snap, g)) {
        if (!cand || typeof cand.code !== 'string') continue
        const lv = pickLevels(g, cand)
        if (!lv) continue
        const key = `${g}|${cand.code}`
        const last = lastKeptRank.get(key)
        if (last !== undefined && rank - last <= holdFor(g)) {
          dedupSkipped++ // 仍在上一笔持有窗口内的重复上榜,不另计一笔
          continue
        }
        lastKeptRank.set(key, rank)
        tasks.push({
          asof: snap.asof, group: g, code: cand.code, name: cand.name ?? cand.code, ...lv,
          trigger: num(cand.trigger) || undefined, consolLow: num(cand.consolLow) || undefined, // bhold 确认口径(他组无此字段)
          score: cand.score, taBias: cand.ta?.bias, lhbInstDays: cand.lhbInst?.instDays, boardQuadrant: cand.board?.quadrant,
          regimePhase, marketTrend,
        })
        const prev = earliest.get(cand.code)
        if (!prev || snap.asof < prev) earliest.set(cand.code, snap.asof)
      }
    }
  }
  if (dedupSkipped > 0) console.log(`[ScreenerForward] 冷却去重:跳过 ${dedupSkipped} 笔重叠窗口内的重复上榜`)

  // Phase 2:每唯一 code 取一次 K(按最早信号日定窗),失败该 code 全部 picks 记 pending。
  const nowMs = Date.now()
  const codes = [...earliest.keys()]
  const barsByCode = new Map<string, Bar[]>()
  let fetched = 0
  await mapLimit(codes, CONCURRENCY, async (code) => {
    try {
      const count = neededBars(earliest.get(code) ?? minAsof, nowMs)
      const { klines } = await fetchStockKline(code, 101, count)
      if (Array.isArray(klines) && klines.length) {
        barsByCode.set(code, klines as unknown as Bar[])
        fetched++
      }
    } catch {
      /* pending */
    }
  })

  // Phase 3:评估(无网络)。observed 组(OVERALL_EXCLUDED,如 trigger)照常评估出 track,
  // 但不进 overall/totalPicks/pendingCount 总体口径——观察诊断,不稀释买点战法汇总。
  const byGroup = new Map<BuyGroup, ForwardPick[]>()
  for (const g of BUY_GROUPS) byGroup.set(g, [])
  let overallTasks = 0
  let pendingCount = 0
  let skippedCount = 0
  const today = todayShanghai() // 停牌陈旧判定基准
  const allClosed: Trade[] = []
  for (const t of tasks) {
    const pick = evaluateTask(t, barsByCode.get(t.code), today)
    byGroup.get(t.group)?.push(pick)
    if (OVERALL_EXCLUDED.has(t.group)) continue
    overallTasks++
    if (pick.status === 'pending') pendingCount++
    else if (pick.status === 'skipped') skippedCount++
    else if (pick.status === 'closed') allClosed.push(toTrade(pick))
  }

  const strategies = BUY_GROUPS.map((g) => buildTrack(g, byGroup.get(g) ?? [])).filter((s) => s.picks.length > 0)

  // breakout 通用切片归因(用户先聚焦这一个战法,其余样本太薄先不接):按技术面偏向/龙虎榜机构/
  // 板块象限/评分档四个维度分桶,帮着看是哪个子集在拖累整体实盘表现。
  const breakoutPicks = byGroup.get('breakout') ?? []
  const breakoutSegments: SegmentGroup[] = [
    { by: 'taBias', buckets: segmentClosedPicks(breakoutPicks, (p) => p.taBias ?? null) },
    { by: 'lhb', buckets: segmentClosedPicks(breakoutPicks, (p) => (p.lhbInstDays == null ? null : p.lhbInstDays > 0 ? 'inst' : 'none')) },
    { by: 'board', buckets: segmentClosedPicks(breakoutPicks, (p) => p.boardQuadrant ?? null) },
    { by: 'scoreTier', buckets: segmentClosedPicks(breakoutPicks, (p) => (p.score == null ? null : p.score >= 80 ? 'high' : p.score >= 60 ? 'mid' : 'low')) },
    { by: 'regimePhase', buckets: segmentClosedPicks(breakoutPicks, (p) => p.regimePhase ?? null) },
    { by: 'marketTrend', buckets: segmentClosedPicks(breakoutPicks, (p) => p.marketTrend ?? null) },
  ].filter((s) => s.buckets.length > 0)

  // 全买点战法 pooled 按信号日市场环境切片(REGIMEBUCKET 回测未过闸门线 → 不拦截,
  // 但在实盘持续攒"环境×实盘表现"证据,供下一轮复裁;observed 组不进)。
  const buyPicks = [...byGroup.entries()].filter(([g]) => !OVERALL_EXCLUDED.has(g)).flatMap(([, arr]) => arr)
  const regimeSegments: SegmentGroup[] = [
    { by: 'regimePhase', buckets: segmentClosedPicks(buyPicks, (p) => p.regimePhase ?? null) },
    { by: 'marketTrend', buckets: segmentClosedPicks(buyPicks, (p) => p.marketTrend ?? null) },
  ].filter((s) => s.buckets.length > 0)

  const result: ScreenerForwardResult = {
    asof: todayShanghai(),
    generatedAt: new Date().toISOString(),
    hold: HOLD,
    snapshotCount: snapshots.length,
    dateRange: minAsof && maxAsof ? [minAsof, maxAsof] : null,
    totalPicks: overallTasks, // 买点口径(observed 组不计,见 OVERALL_EXCLUDED)
    pendingCount,
    skippedCount,
    strategies,
    overall: aggregate(allClosed),
    breakoutSegments: breakoutSegments.length ? breakoutSegments : undefined,
    regimeSegments: regimeSegments.length ? regimeSegments : undefined,
  }
  console.log(
    `[ScreenerForward] 完成:快照 ${snapshots.length} 份 / 唯一票 ${codes.length}(取K ${fetched}) / ` +
      `pick ${tasks.length}(待定 ${pendingCount} 废弃 ${skippedCount})/ 已平 ${allClosed.length}, 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
  writeForwardDisk(result)
  return result
}

// ── 磁盘兜底 ──────────────────────────────────────────────────────────
function writeForwardDisk(result: ScreenerForwardResult): void {
  try {
    mkdirSync(SCREENER_DIR, { recursive: true })
    writeFileSync(join(SCREENER_DIR, `forward-${result.asof}.json`), JSON.stringify(result, null, 2))
  } catch (err) {
    console.warn('[ScreenerForward] 存档失败(非致命):', err)
  }
}

function isForwardResult(v: unknown): v is ScreenerForwardResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.asof === 'string' && Array.isArray(r.strategies) && typeof r.overall === 'object'
}

/** 读最新 forward-YYYY-MM-DD.json(冷启动种子 + 抓取失败兜底)。 */
function loadLatestForwardDisk(): ScreenerForwardResult | null {
  let files: string[]
  try {
    files = readdirSync(SCREENER_DIR)
  } catch {
    return null
  }
  let latest = ''
  for (const f of files) {
    const m = FORWARD_RE.exec(f)
    if (m && m[1] > latest) latest = m[1]
  }
  if (!latest) return null
  try {
    const raw = JSON.parse(readFileSync(join(SCREENER_DIR, `forward-${latest}.json`), 'utf8'))
    if (!isForwardResult(raw)) return null
    return { ...raw, fromCache: true }
  } catch {
    return null
  }
}

// ── 缓存 + 公开 API ───────────────────────────────────────────────────
const forwardCache = createCache<ScreenerForwardResult>({
  name: 'ScreenerForward',
  ttl: sessionTtl(120_000, FORWARD_CLOSED_TTL),
  fetcher: computeForward,
  fallback: loadLatestForwardDisk,
})

export function fetchScreenerForward(): Promise<ScreenerForwardResult> {
  return forwardCache.get()
}

export function clearScreenerForwardCache(): void {
  forwardCache.clear()
}
