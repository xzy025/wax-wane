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
import type { Bar } from './screenerRules'
import type { ScreenerResult } from './screener'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')

// ── 调参 ──────────────────────────────────────────────────────────────
const HOLD = 20 // 持有/观察的最大交易日数(与回测 HOLD 默认一致)
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

// 各战法回测基线(取自 screener.ts 注释/回测产物;缺者前端显示「—」)。
const BACKTEST_BASELINE: Partial<Record<BuyGroup, { expectancyR: number; profitFactor?: number }>> = {
  breakout: { expectancyR: 0.08 }, // 突破基线(PF 未单列)
  highdiv: { expectancyR: 0.19, profitFactor: 1.3 },
  volbreak: { expectancyR: 0.27, profitFactor: 1.41 },
  fundres: { expectancyR: 0.26, profitFactor: 2.08 },
  bhold: { expectancyR: 0.45, profitFactor: 1.9 },
  trendnew: { expectancyR: 0.28, profitFactor: 1.52 },
}
const BHOLD_NOTE =
  'v1 按信号日(整理日)收盘入场;真策略为「次日突破 trigger 确认入场」(回测 0.45R)。此处实盘 R 偏保守、回撤高估。'

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
export type ForwardReason = Trade['reason'] | 'open' | 'pending'

export interface ForwardPick {
  asof: string // 信号日(归档日)
  group: BuyGroup
  code: string
  name: string
  entry: number // 候选记录的介入位(归档基准)
  stop: number
  target: number
  status: 'open' | 'closed' | 'pending'
  exit: number // 平仓价 / 盯市价(前复权基准);pending=0
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
}

export interface StrategyTrack {
  group: BuyGroup
  closed: Metrics // 仅对已平仓样本聚合
  closedCount: number
  openCount: number
  pendingCount: number
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
  strategies: StrategyTrack[]
  overall: Metrics // 全战法已平仓汇总
  breakoutSegments?: SegmentGroup[] // breakout 通用切片归因(仅样本够格时才有意义,用户先聚焦这一个战法)
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

/** 开/平仓判定:simForward 总会返回(默认 time 止于末根)→ 区分「真时间止损」与「窗口未走完」。 */
export function classifyForward(reason: Trade['reason'], hold: number, lenAfter: number): 'open' | 'closed' {
  if (reason !== 'time') return 'closed' // 已触发 stop/target(含跳空)
  if (lenAfter >= hold) return 'closed' // 走满 hold 根的真时间止损
  return 'open' // 窗口未走完 → 盯市
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
  score?: number
  taBias?: string
  lhbInstDays?: number
  boardQuadrant?: string
}

function pendingPick(t: Task): ForwardPick {
  return {
    asof: t.asof, group: t.group, code: t.code, name: t.name,
    entry: r2(t.entry), stop: r2(t.stop), target: r2(t.target),
    status: 'pending', exit: 0, exitDate: '', reason: 'pending', R: 0, retPct: 0, barsHeld: 0, barsElapsed: 0,
    score: t.score, taBias: t.taBias, lhbInstDays: t.lhbInstDays, boardQuadrant: t.boardQuadrant,
  }
}

/** 把候选的止损/目标按「相对介入的比率」映射到前复权基准的信号日收盘,再撮合——
 *  令 entry/stop/target/exit 同基准,R 对 复权再调整 不变。 */
export function evaluateTask(t: Task, bars: Bar[] | undefined): ForwardPick {
  if (!bars || bars.length < 2) return pendingPick(t)
  // 信号日索引:最后一根 date<=asof(用 <= 容忍周末/节假日戳的 asof)。
  let i = -1
  for (let k = bars.length - 1; k >= 0; k--) {
    if (bars[k].date <= t.asof) { i = k; break }
  }
  if (i < 0) return pendingPick(t) // 取到的窗口未覆盖信号日
  const stopFrac = t.stop / t.entry
  const targetFrac = t.target / t.entry
  const entryRef = bars[i].close
  const stopRef = entryRef * stopFrac
  const targetRef = entryRef * targetFrac
  const risk = entryRef - stopRef
  if (risk <= 0) return pendingPick(t)
  const lenAfter = bars.length - 1 - i
  const sim = simForward(bars, i, stopRef, targetRef, HOLD)
  const trade = makeTrade(t.code, bars, i, entryRef, stopRef, targetRef, risk, sim)
  const status = classifyForward(sim.reason, HOLD, lenAfter)
  // open 情形:lenAfter<HOLD 且未触发 → sim 末根即最新收盘 → trade 已是盯市 R,仅改 reason。
  // 展示 entry/stop/target 用前复权基准(trade.*),与 exit 同基准 → (exit-entry)/(entry-stop)=R 恒成立。
  return {
    asof: t.asof, group: t.group, code: t.code, name: t.name,
    entry: trade.entry, stop: trade.stop, target: trade.target,
    status,
    exit: trade.exit,
    exitDate: trade.exitDate,
    reason: status === 'open' ? 'open' : trade.reason,
    R: trade.R,
    retPct: trade.retPct,
    barsHeld: trade.bars,
    barsElapsed: lenAfter,
    score: t.score, taBias: t.taBias, lhbInstDays: t.lhbInstDays, boardQuadrant: t.boardQuadrant,
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
    sampleConfidence: sampleConfidenceFor(closed.length),
    unrealizedAvgR: open.length ? r2(mean(open.map((p) => p.R))) : 0,
    backtestExpectancyR: bl?.expectancyR,
    backtestProfitFactor: bl?.profitFactor,
    note: group === 'bhold' ? BHOLD_NOTE : undefined,
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
  const tasks: Task[] = []
  const earliest = new Map<string, string>()
  let minAsof = ''
  let maxAsof = ''
  for (const snap of snapshots) {
    if (typeof snap.asof !== 'string') continue
    if (!minAsof || snap.asof < minAsof) minAsof = snap.asof
    if (!maxAsof || snap.asof > maxAsof) maxAsof = snap.asof
    for (const g of BUY_GROUPS) {
      for (const cand of groupArray(snap, g)) {
        if (!cand || typeof cand.code !== 'string') continue
        const lv = pickLevels(g, cand)
        if (!lv) continue
        tasks.push({
          asof: snap.asof, group: g, code: cand.code, name: cand.name ?? cand.code, ...lv,
          score: cand.score, taBias: cand.ta?.bias, lhbInstDays: cand.lhbInst?.instDays, boardQuadrant: cand.board?.quadrant,
        })
        const prev = earliest.get(cand.code)
        if (!prev || snap.asof < prev) earliest.set(cand.code, snap.asof)
      }
    }
  }

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

  // Phase 3:评估(无网络)。
  const byGroup = new Map<BuyGroup, ForwardPick[]>()
  for (const g of BUY_GROUPS) byGroup.set(g, [])
  let pendingCount = 0
  const allClosed: Trade[] = []
  for (const t of tasks) {
    const pick = evaluateTask(t, barsByCode.get(t.code))
    byGroup.get(t.group)?.push(pick)
    if (pick.status === 'pending') pendingCount++
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
  ].filter((s) => s.buckets.length > 0)

  const result: ScreenerForwardResult = {
    asof: todayShanghai(),
    generatedAt: new Date().toISOString(),
    hold: HOLD,
    snapshotCount: snapshots.length,
    dateRange: minAsof && maxAsof ? [minAsof, maxAsof] : null,
    totalPicks: tasks.length,
    pendingCount,
    strategies,
    overall: aggregate(allClosed),
    breakoutSegments: breakoutSegments.length ? breakoutSegments : undefined,
  }
  console.log(
    `[ScreenerForward] 完成:快照 ${snapshots.length} 份 / 唯一票 ${codes.length}(取K ${fetched}) / ` +
      `pick ${tasks.length}(待定 ${pendingCount})/ 已平 ${allClosed.length}, 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
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
