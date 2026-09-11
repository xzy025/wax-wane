// 板块轮动服务 · **公开数据层**。
//
// 本文件从私有战法层拆回：原 812 行里前 635 行是「板块宇宙 → 板块日线 → 长/短窗涨幅 →
// 2×2 象限」的纯取数与统计，后 177 行才是「板块内强势股下钻」——那一部分要跑新高战法
// `classify` / VCP / 分歧低吸等私有规则，已移到私有包的 `services/boardStrategyScan.ts`。
//
// 边界：本文件只回答「哪个板块在涨、成分股是谁」。任何「板块内哪只票该买」不属于本文件。
// 板块轮动服务:东财 行业/概念 板块宇宙 → 板块日线(=指数)→ 长/短窗涨幅 → 2×2 象限 + 宽度概览。
// 板块即指数(secid 90.BKxxxx),复用 fetchIndexKline 取日线;所有窗口从同一段 closes 现算。
import { EM_HEADERS } from '../lib/emHeaders'
import { emFetch } from '../lib/emFetch'
import { createCache, sessionTtl, type Cache } from '../lib/cache'
import { todayShanghai } from '../lib/time'
import { fetchIndexKline, fetchStockKline, type IndexKlineBar } from './ashare'
import { toSecids } from './emQuotes'
import { resolveStock } from './stockSearch'
import { CONCEPT_BLOCKLIST } from './moneyflow'
import { classifyQuadrant, type Quadrant } from './rotationRules'
import {
  fetchQuickTinyRotation,
  fetchQuickTinyStockSectors,
  makeQuickTinyBoardCode,
  quickTinyResponseSourceForCategory,
  quickTinySourceForCategory,
  type QuickTinyQuadrantKey,
  type QuickTinyRotationPayload,
} from './quicktinyRotation'

export type RotationCategory = 'theme' | 'industry' | 'concept'
export type EastmoneyRotationCategory = Exclude<RotationCategory, 'theme'>

export interface RotationBoard {
  code: string // BKxxxx
  name: string
  todayChg: number
  longChg: number // 原始长窗收益
  shortChg: number // 原始短窗收益
  longExcess: number // 相对沪深300的长窗超额收益
  shortExcess: number // 相对沪深300的短窗超额收益
  quadrant: Quadrant
  reconstructed?: boolean // 板块指数日线不可用时，按成分股等权日收益重构
  stockCount?: number
  volumeRatio?: number | null
  positionInRange?: number | null
  positionPctRank?: number | null
}
export interface RotationSummary {
  total: number
  hs: number
  ls: number
  hw: number
  lw: number
  shortUpPct: number // 短窗上涨板块占比
}
export interface RotationDataQuality {
  rawTotal: number // 上游板块列表原始行数
  taxonomyTotal: number // 可确定重复清理后的行业数
  selectedTotal: number // 本轮实际取数的行业数
  directCount: number // 官方板块指数日线有效数
  reconstructedCount: number // 成分股等权重构有效数
  representedPct: number | null // 不完整分页时保持 null
  directCoveragePct: number | null // 不完整分页时保持 null
  degraded: boolean
  taxonomy: 'quicktiny-kpl-v1' | 'quicktiny-cls-industry-v1' | 'quicktiny-cls-concept-v1' | 'em-mixed-dedup-v1'
}
export interface RotationResult {
  asof: string
  category: RotationCategory
  longWin: number
  shortWin: number
  boards: RotationBoard[]
  summary: RotationSummary
  quality: RotationDataQuality
  provider: 'quicktiny' | 'eastmoney'
  sourceLabel: string
  volumeAdjusted?: boolean
  volumeProgress?: number
}

export const ROTATION = {
  KLINE_BARS: 130, // 覆盖 120 日窗口
  CONCURRENCY: 10,
  // 东财 行业/概念 板块各 ~500 个(偏细分);按成交额截 top-N,聚焦真有资金轮动的活跃板块,
  // 同时把板块日线取数量控在可控范围(EM kline 偶发限流,少打更稳)。
  BOARD_CAP: 120,
  // 板块指数日线被上游限流时，主轮动页复用节奏表的成分股重构降级。
  RECON_CAP: 15,
  RECON_STOCKS: 12,
  RECON_COVERAGE: 6,
  DIRECT_COVERAGE_MIN_PCT: 60,
  DRILL_CAP: 60, // 下钻逐股扫描的成分股上限(按成交额取前 N)
  LONG_WINS: [5, 10, 20, 60, 120],
  SHORT_WINS: [3, 5, 10],
  DEFAULT_LONG: 60,
  DEFAULT_SHORT: 5,
} as const

const FS: Record<EastmoneyRotationCategory, string> = { industry: 'm:90+t:2', concept: 'm:90+t:3' }
const CLIST_HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '82.push2.eastmoney.com']
// 行业宇宙按成交额截断时，仍保留消费大类及其酒类/饮料细分，避免“有轮动但列表没看见”。
const CORE_INDUSTRY_CODES = new Set(['BK0438', 'BK1575', 'BK1279', 'BK1577', 'BK1282', 'BK1585', 'BK1281'])

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

export function clampLong(n: number): number {
  return (ROTATION.LONG_WINS as readonly number[]).includes(n) ? n : ROTATION.DEFAULT_LONG
}
export function clampShort(n: number): number {
  return (ROTATION.SHORT_WINS as readonly number[]).includes(n) ? n : ROTATION.DEFAULT_SHORT
}

export interface BoardMeta {
  code: string
  name: string
  todayChg: number
  amount: number
}

const romanRank = (name: string) => {
  const suffix = name.match(/[ⅠⅡⅢ]$/)?.[0]
  return suffix === 'Ⅲ' ? 3 : suffix === 'Ⅱ' ? 2 : suffix === 'Ⅰ' ? 1 : 0
}

/** 东财 t:2 同时含部分Ⅱ/Ⅲ层级。只清除可以确定的同名层级重复，保留其余层级关系供后续正式 taxonomy 接入。 */
export function normalizeRotationUniverse(category: EastmoneyRotationCategory, universe: BoardMeta[]): BoardMeta[] {
  if (category !== 'industry') return universe
  const byName = new Map<string, BoardMeta>()
  for (const board of universe) {
    const key = board.name.replace(/[ⅠⅡⅢ]$/, '')
    const current = byName.get(key)
    if (!current || romanRank(board.name) > romanRank(current.name) || (romanRank(board.name) === romanRank(current.name) && board.amount > current.amount)) {
      byName.set(key, board)
    }
  }
  return [...byName.values()]
}

/** 成交额聚焦不应吞掉消费大类及酒类/饮料细分。 */
export function selectRotationUniverse(category: EastmoneyRotationCategory, rawUniverse: BoardMeta[], cap: number = ROTATION.BOARD_CAP): BoardMeta[] {
  const sorted = [...normalizeRotationUniverse(category, rawUniverse)].sort((a, b) => b.amount - a.amount)
  if (category !== 'industry' || sorted.length <= cap) return sorted.slice(0, cap)
  const selected = new Map(sorted.slice(0, cap).map((b) => [b.code, b]))
  for (const b of sorted) {
    if (CORE_INDUSTRY_CODES.has(b.code)) selected.set(b.code, b)
  }
  return [...selected.values()]
}

/** clist 翻页取一个分类的板块宇宙(镜像主机轮换容错)。 */
interface ClistPageResult {
  rows: Record<string, unknown>[]
  total: number | null
}

async function fetchClistPage(
  category: EastmoneyRotationCategory,
  pn: number,
): Promise<ClistPageResult | null> {
  for (let i = 0; i < CLIST_HOSTS.length; i++) {
    const host = CLIST_HOSTS[(pn + i) % CLIST_HOSTS.length]
    const url =
      'https://' + host + '/api/qt/clist/get?pn=' + pn + '&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3' +
      '&fs=' + encodeURIComponent(FS[category]) + '&fields=f12,f13,f14,f3,f6'
    try {
      const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
      if (!res.ok) throw new Error('clist HTTP ' + res.status)
      const json = (await res.json()) as any
      const total = Number(json?.data?.total)
      return {
        rows: (json?.data?.diff ?? []) as Record<string, unknown>[],
        total: Number.isFinite(total) && total > 0 ? total : null,
      }
    } catch {
      /* 试下一个镜像 */
    }
  }
  return null
}

interface BoardUniverseCapture {
  rows: BoardMeta[]
  expectedTotal: number | null
  fetchedRawCount: number
  fetchedPages: number
  failedPages: number
  complete: boolean
}

async function fetchBoardUniverseCapture(
  category: EastmoneyRotationCategory,
): Promise<BoardUniverseCapture> {
  const out: BoardMeta[] = []
  let expectedTotal: number | null = null
  let fetchedRawCount = 0
  let fetchedPages = 0
  let failedPages = 0
  let lastPageSize = 0
  for (let pn = 1; pn <= 6; pn++) {
    const page = await fetchClistPage(category, pn)
    if (!page) {
      failedPages += 1
      break
    }
    fetchedPages += 1
    expectedTotal = page.total ?? expectedTotal
    lastPageSize = page.rows.length
    fetchedRawCount += page.rows.length
    if (page.rows.length === 0) break
    for (const d of page.rows) {
      const code = String(d.f12 ?? '')
      const name = String(d.f14 ?? '')
      if (!code || !name) continue
      if (CONCEPT_BLOCKLIST.some((b) => name.includes(b))) continue
      out.push({ code, name, todayChg: num(d.f3), amount: num(d.f6) })
    }
    if (page.rows.length < 100) break
    await new Promise((rs) => setTimeout(rs, 120))
  }
  const complete =
    failedPages === 0 &&
    (expectedTotal != null ? fetchedRawCount >= expectedTotal : fetchedPages < 6 && lastPageSize < 100)
  return { rows: out, expectedTotal, fetchedRawCount, fetchedPages, failedPages, complete }
}

/** 导出兼容入口；需要覆盖率元数据时使用内部 capture。 */
export async function fetchBoardUniverse(category: EastmoneyRotationCategory): Promise<BoardMeta[]> {
  return (await fetchBoardUniverseCapture(category)).rows
}
// 板块日线 bars 长缓存(历史不可变;手动刷新时清空以纳入当日最新)。
// 原为 closes-only,节奏表(rotationTempo)需要 volume 判放缩量 → 升级存全 bars,
// 象限视图经 getBoardCloses 薄壳零改动;fetchIndexKline 本就返回 OHLCV,零额外上游成本。
const barsCache = new Map<string, { bars: IndexKlineBar[]; expires: number }>()
const BARS_TTL = 24 * 3600_000

/** 板块/指数日线全 bars(secid 如 '90.BK1036' 或 '1.000001');节奏表与象限视图共享同一取数预算。 */
export async function getBoardBars(secid: string): Promise<IndexKlineBar[]> {
  const hit = barsCache.get(secid)
  if (hit && hit.expires > Date.now()) return hit.bars
  const bars = await fetchIndexKline(secid, ROTATION.KLINE_BARS)
  // 空序列=上游失败(限流/镜像全挂),缓存它会把故障固化 24h——只缓存有效数据。
  if (bars.length > 0) barsCache.set(secid, { bars, expires: Date.now() + BARS_TTL })
  return bars
}

/** 有界并发。导出:rotationTempo 复用。 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const cur = i++
      out[cur] = await fn(items[cur])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** 板块日线断供时，用成交额靠前成分股的等权日收益合成一个价格序列。
 *  只用于轮动展示，明确标为 reconstructed；不进入任何战法评分或回测因子。 */
async function reconstructBoardBars(bkCode: string): Promise<IndexKlineBar[]> {
  const members = (await fetchBoardConstituents(bkCode)).slice(0, ROTATION.RECON_STOCKS)
  if (members.length < ROTATION.RECON_COVERAGE) return []
  const changesByDate = new Map<string, number[]>()
  await mapLimit(members, 6, async (member) => {
    try {
      const { klines } = await fetchStockKline(member.code, 101, ROTATION.KLINE_BARS + 5)
      for (let i = 1; i < klines.length; i++) {
        const prev = klines[i - 1]
        const curr = klines[i]
        if (!(prev.close > 0 && curr.close > 0)) continue
        const changes = changesByDate.get(curr.date) ?? []
        changes.push((curr.close / prev.close - 1) * 100)
        changesByDate.set(curr.date, changes)
      }
    } catch {
      /* 单个成分股失败不放大为整个板块失败 */
    }
  })
  let level = 100
  const bars: IndexKlineBar[] = []
  for (const [date, changes] of [...changesByDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (changes.length < Math.min(ROTATION.RECON_COVERAGE, members.length)) continue
    level *= 1 + changes.reduce((sum, value) => sum + value, 0) / changes.length / 100
    bars.push({ date, open: level, close: level, high: level, low: level, volume: 0 })
  }
  return bars
}

/** 指定板块与沪深300按同一交易日的起止点计算原始/超额收益。缺任一端则不比较。 */
export function returnsAgainstBenchmark(
  boardBars: Pick<IndexKlineBar, 'date' | 'close'>[],
  benchmarkBars: Pick<IndexKlineBar, 'date' | 'close'>[],
  window: number,
): { raw: number; excess: number } | null {
  if (window <= 0 || benchmarkBars.length < window + 1) return null
  const boardByDate = new Map(boardBars.map((b) => [b.date, b.close]))
  const benchmarkByDate = new Map(benchmarkBars.map((b) => [b.date, b.close]))
  let endIdx = -1
  for (let i = benchmarkBars.length - 1; i >= window; i--) {
    const end = benchmarkBars[i]
    const start = benchmarkBars[i - window]
    if (boardByDate.get(end.date) && boardByDate.get(start.date) && end.close > 0 && start.close > 0) {
      endIdx = i
      break
    }
  }
  if (endIdx < 0) return null
  const end = benchmarkBars[endIdx]
  const start = benchmarkBars[endIdx - window]
  const boardEnd = boardByDate.get(end.date) as number
  const boardStart = boardByDate.get(start.date) as number
  const benchmarkRaw = end.close / start.close - 1
  const raw = boardEnd / boardStart - 1
  return { raw: raw * 100, excess: (raw - benchmarkRaw) * 100 }
}

function boardFromSeries(
  meta: BoardMeta,
  bars: IndexKlineBar[],
  benchmarkBars: IndexKlineBar[],
  longWin: number,
  shortWin: number,
  reconstructed = false,
): RotationBoard | null {
  if (bars.at(-1)?.date !== benchmarkBars.at(-1)?.date) return null
  const long = returnsAgainstBenchmark(bars, benchmarkBars, longWin)
  const short = returnsAgainstBenchmark(bars, benchmarkBars, shortWin)
  if (!long || !short) return null
  return {
    code: meta.code,
    name: meta.name,
    todayChg: r2(meta.todayChg),
    longChg: r2(long.raw),
    shortChg: r2(short.raw),
    longExcess: r2(long.excess),
    shortExcess: r2(short.excess),
    quadrant: classifyQuadrant(long.excess, short.excess),
    reconstructed,
  }
}

async function fetchEastmoneyRotationFresh(
  category: EastmoneyRotationCategory,
  longWin: number,
  shortWin: number,
): Promise<RotationResult> {
  const universeCapture = await fetchBoardUniverseCapture(category)
  const rawUniverse = universeCapture.rows
  const taxonomyUniverse = normalizeRotationUniverse(category, rawUniverse)
  const universe = selectRotationUniverse(category, rawUniverse)
  const benchmarkBars = await getBoardBars('1.000300')
  if (benchmarkBars.length < longWin + 1) throw new Error('[Rotation] 沪深300日线不足，无法计算超额收益')

  const directRows = (
    await mapLimit(universe, ROTATION.CONCURRENCY, async (b): Promise<RotationBoard | null> => {
      try {
        return boardFromSeries(b, await getBoardBars(`90.${b.code}`), benchmarkBars, longWin, shortWin)
      } catch {
        return null
      }
    })
  ).filter((x): x is RotationBoard => x != null)
  const directCodes = new Set(directRows.map((b) => b.code))
  const failed = universe.filter((b) => !directCodes.has(b.code))
  const reconTargets = [...failed]
    .sort((a, b) => Number(CORE_INDUSTRY_CODES.has(b.code)) - Number(CORE_INDUSTRY_CODES.has(a.code)) || b.amount - a.amount)
    .slice(0, ROTATION.RECON_CAP)
  const reconRows = (
    await mapLimit(reconTargets, 3, async (b): Promise<RotationBoard | null> => {
      try {
        return boardFromSeries(b, await reconstructBoardBars(b.code), benchmarkBars, longWin, shortWin, true)
      } catch {
        return null
      }
    })
  ).filter((x): x is RotationBoard => x != null)
  const rows = [...directRows, ...reconRows]
  if (rows.length === 0) throw new Error('[Rotation] 无有效板块序列，保留缓存或提示数据源失败')

  rows.sort((a, b) => b.shortExcess - a.shortExcess) // 短窗超额强→弱;前端按象限分组保序

  const cnt = (q: Quadrant) => rows.filter((b) => b.quadrant === q).length
  const shortUp = rows.filter((b) => b.shortExcess >= 0).length
  const summary: RotationSummary = {
    total: rows.length,
    hs: cnt('hs'),
    ls: cnt('ls'),
    hw: cnt('hw'),
    lw: cnt('lw'),
    shortUpPct: rows.length ? r2((shortUp / rows.length) * 100) : 0,
  }
  const representedPct = universeCapture.complete && universe.length ? r2((rows.length / universe.length) * 100) : null
  const directCoveragePct = universeCapture.complete && universe.length ? r2((directRows.length / universe.length) * 100) : null
  const quality: RotationDataQuality = {
    rawTotal: universeCapture.expectedTotal ?? universeCapture.fetchedRawCount,
    taxonomyTotal: taxonomyUniverse.length,
    selectedTotal: universe.length,
    directCount: directRows.length,
    reconstructedCount: reconRows.length,
    representedPct,
    directCoveragePct,
    degraded: !universeCapture.complete || directCoveragePct == null || directCoveragePct < ROTATION.DIRECT_COVERAGE_MIN_PCT,
    taxonomy: 'em-mixed-dedup-v1',
  }

  console.log(`[Rotation] ${category} 原始${rawUniverse.length}/去重${taxonomyUniverse.length}/选中${universe.length}→有效${rows.length}(官方${directRows.length},重构${reconRows.length});长${longWin}/短${shortWin}日`)
  return {
    // Use the last benchmark bar as the data date; wall-clock today may be a
    // weekend or a session whose upstream bars have not settled yet.
    asof: benchmarkBars.at(-1)?.date?.slice(0, 10) ?? todayShanghai(),
    category,
    longWin,
    shortWin,
    boards: rows,
    summary,
    quality,
    provider: 'eastmoney',
    sourceLabel: '东方财富' + (category === 'industry' ? '行业' : '概念') + (universeCapture.complete ? '' : '（分页不完整）'),
  }
}

const QUICKTINY_QUADRANTS: Record<QuickTinyQuadrantKey, Quadrant> = {
  highStrong: 'hs',
  lowStrong: 'ls',
  highWeak: 'hw',
  lowWeak: 'lw',
}

const QUICKTINY_TAXONOMY: Record<RotationCategory, RotationDataQuality['taxonomy']> = {
  theme: 'quicktiny-kpl-v1',
  industry: 'quicktiny-cls-industry-v1',
  concept: 'quicktiny-cls-concept-v1',
}

function normalizeAsof(date: string): string {
  return /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : date
}

/** 将 QuickTiny 的四象限响应映射为项目通用结构。其象限按原始涨跌划分，不减沪深300。 */
export function buildQuickTinyRotationResult(
  category: RotationCategory,
  longWin: number,
  shortWin: number,
  payload: QuickTinyRotationPayload,
): RotationResult {
  const source = quickTinySourceForCategory(category)
  const boards = (Object.entries(QUICKTINY_QUADRANTS) as Array<[QuickTinyQuadrantKey, Quadrant]>)
    .flatMap(([key, quadrant]) =>
      payload.quadrants[key].map((row): RotationBoard => ({
        code: makeQuickTinyBoardCode(source, row.name),
        name: row.name,
        todayChg: r2(row.todayChange),
        longChg: r2(row.periodChange),
        shortChg: r2(row.recentChange),
        // 兼容现有前端字段；QuickTiny 模式下这里等于原始涨跌，不代表相对指数超额。
        longExcess: r2(row.periodChange),
        shortExcess: r2(row.recentChange),
        quadrant,
        stockCount: row.stockCount,
        volumeRatio: row.volumeRatio,
        positionInRange: row.positionInRange,
        positionPctRank: row.positionPctRank,
      })),
    )
    .sort((a, b) => b.shortChg - a.shortChg)

  const count = (quadrant: Quadrant) => boards.filter((board) => board.quadrant === quadrant).length
  const shortUp = boards.filter((board) => board.shortChg >= 0).length
  const total = boards.length
  const sectorCount = Number.isFinite(payload.meta.sectorCount) && payload.meta.sectorCount > 0 ? payload.meta.sectorCount : null
  return {
    asof: normalizeAsof(payload.meta.date),
    category,
    longWin,
    shortWin,
    boards,
    summary: {
      total,
      hs: count('hs'),
      ls: count('ls'),
      hw: count('hw'),
      lw: count('lw'),
      shortUpPct: total ? r2((shortUp / total) * 100) : 0,
    },
    quality: {
      rawTotal: sectorCount ?? total,
      taxonomyTotal: sectorCount ?? total,
      selectedTotal: sectorCount ?? total,
      directCount: total,
      reconstructedCount: 0,
      representedPct: sectorCount ? r2((total / sectorCount) * 100) : null,
      directCoveragePct: sectorCount ? r2((total / sectorCount) * 100) : null,
      degraded: total === 0 || sectorCount == null || total < sectorCount * 0.9,
      taxonomy: QUICKTINY_TAXONOMY[category],
    },
    provider: 'quicktiny',
    sourceLabel: payload.meta.sourceLabel,
    volumeAdjusted: payload.meta.volumeAdjusted,
    volumeProgress: payload.meta.volumeProgress,
  }
}

async function fetchRotationFresh(
  category: RotationCategory,
  longWin: number,
  shortWin: number,
): Promise<RotationResult> {
  try {
    const payload = await fetchQuickTinyRotation(quickTinySourceForCategory(category), longWin, shortWin)
    return buildQuickTinyRotationResult(category, longWin, shortWin, payload)
  } catch (error) {
    if (category === 'theme') throw error
    console.warn(`[Rotation] QuickTiny ${category} 不可用，降级东方财富：${error instanceof Error ? error.message : String(error)}`)
    return fetchEastmoneyRotationFresh(category, longWin, shortWin)
  }
}

// 结果按 分类|长窗|短窗 分别缓存(共享 closesCache,切窗口免重取日线)。
const resultCaches = new Map<string, Cache<RotationResult>>()
function cacheFor(category: RotationCategory, longWin: number, shortWin: number): Cache<RotationResult> {
  const key = `${category}|${longWin}|${shortWin}`
  let c = resultCaches.get(key)
  if (!c) {
    c = createCache<RotationResult>({
      name: `Rotation:${key}`,
      ttl: sessionTtl(120_000, 30 * 60_000),
      fetcher: () => fetchRotationFresh(category, longWin, shortWin),
    })
    resultCaches.set(key, c)
  }
  return c
}

export function fetchRotation(category: RotationCategory, longWin: number, shortWin: number): Promise<RotationResult> {
  return cacheFor(category, clampLong(longWin), clampShort(shortWin)).get()
}

/**
 * 私有战法层注册的额外缓存清理器（板块下钻缓存等）。
 *
 * 公开侧不需要知道这些缓存是什么，只知道「清轮动缓存时要把它们一起清掉」——
 * 否则私有层会短暂读到过期的下钻结果。
 */
const extraCacheClearers = new Set<() => void>()

export function registerRotationCacheClearer(clear: () => void): void {
  extraCacheClearers.add(clear)
}

export function clearRotationCache(): void {
  for (const c of resultCaches.values()) c.clear()
  barsCache.clear()
  for (const clear of extraCacheClearers) clear()
}

/** 搜个股 → 解析 + 按当前分类取所属板块名(供前端过滤命中的板块)。 */
export async function fetchStockBoards(
  query: string,
  category: RotationCategory = 'theme',
): Promise<{ code: string; name: string; boards: string[] }> {
  const m = await resolveStock(query)
  if (!m) return { code: '', name: '', boards: [] }
  try {
    const payload = await fetchQuickTinyStockSectors(m.code)
    const source = quickTinyResponseSourceForCategory(category)
    const hit = payload.results.find((result) => result.source === source)
    if (hit) return { code: m.code, name: m.name, boards: hit.sectors.map((sector) => sector.name).filter(Boolean) }
  } catch {
    // 题材没有可等价替代的分类源；行业/概念继续尝试东方财富降级。
    if (category === 'theme') return { code: m.code, name: m.name, boards: [] }
  }
  if (category === 'theme') return { code: m.code, name: m.name, boards: [] }
  const secid = toSecids(m.code)[0]
  if (!secid) return { code: m.code, name: m.name, boards: [] }
  try {
    const url =
      `https://push2.eastmoney.com/api/qt/slist/get?spt=3&fltt=2&invt=2&fid=f3&po=1&pn=1&pz=100` +
      `&secid=${secid}&fields=f12,f14`
    const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 6000 })
    if (!res.ok) return { code: m.code, name: m.name, boards: [] }
    const json = (await res.json()) as { data?: { diff?: unknown } }
    const diff = json.data?.diff
    const arr: Record<string, unknown>[] = diff ? (Array.isArray(diff) ? diff : Object.values(diff)) : []
    const boards = arr.map((d) => String(d.f14 ?? '')).filter(Boolean)
    return { code: m.code, name: m.name, boards }
  } catch {
    return { code: m.code, name: m.name, boards: [] }
  }
}

// ── 个股 → 所属行业板块(供选股「板块强弱」加分 / 回测 as-of 强弱)──────────
// ⚠ slist 仅返回「当前」所属板块,无历史。回测里以「今日行业归属」近似过去归属(行业成员稳定),
// 引入轻度前视偏差,按相对比较对待(同回测既有的幸存者偏差)。

/** slist 取个股所属板块 {bk, name}(含 BK 代码 f12 + 名称 f14)。 */
async function fetchStockBoardList(code: string): Promise<{ bk: string; name: string }[]> {
  const secid = toSecids(code)[0]
  if (!secid) return []
  try {
    const url =
      `https://push2.eastmoney.com/api/qt/slist/get?spt=3&fltt=2&invt=2&fid=f3&po=1&pn=1&pz=100` +
      `&secid=${secid}&fields=f12,f14`
    const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 6000 })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: { diff?: unknown } }
    const diff = json.data?.diff
    const arr: Record<string, unknown>[] = diff ? (Array.isArray(diff) ? diff : Object.values(diff)) : []
    return arr.map((d) => ({ bk: String(d.f12 ?? ''), name: String(d.f14 ?? '') })).filter((b) => b.bk && b.name)
  } catch {
    return []
  }
}

// 行业板块代码集合(t:2)缓存:从个股所属板块里挑「行业」板(成员稳定,优于概念)。
let industrySetCache: { set: Set<string>; expires: number } | null = null
async function getIndustryBoardSet(): Promise<Set<string>> {
  if (industrySetCache && industrySetCache.expires > Date.now()) return industrySetCache.set
  const universe = await fetchBoardUniverse('industry')
  const set = new Set(universe.map((b) => b.code))
  industrySetCache = { set, expires: Date.now() + 24 * 3600_000 }
  return set
}

/** 个股 → 主行业板块 {bk, name}(优先 slist 命中的行业板;无则退第一个非伪板块)。bk='' = 无法解析。 */
export async function resolveStockIndustryBoard(code: string): Promise<{ bk: string; name: string }> {
  const boards = await fetchStockBoardList(code)
  if (boards.length === 0) return { bk: '', name: '' }
  const filtered = boards.filter((b) => !CONCEPT_BLOCKLIST.some((x) => b.name.includes(x)))
  const pool = filtered.length ? filtered : boards
  try {
    const industrySet = await getIndustryBoardSet()
    const hit = pool.find((b) => industrySet.has(b.bk))
    if (hit) return { bk: hit.bk, name: hit.name }
  } catch {
    /* 行业宇宙取数失败 → 退回第一个板 */
  }
  return { bk: pool[0].bk, name: pool[0].name }
}

/** 成分股当日涨跌幅榜(按 changePct 降序取前 n);纯函数,不跑 K线/classify——
 *  蓝筹反转板块(如保险)成分股基本不符合新高战法趋势模板,靠这个才能看清"具体是谁在涨"。 */
export function rankTopMovers<T extends { changePct: number }>(members: T[], n: number): T[] {
  return [...members].sort((a, b) => b.changePct - a.changePct).slice(0, n)
}

/** 板块成分股(报价调用 fs=b:BKxxxx,不受 kline 限流);按成交额降序。changePct=当日涨跌幅%(f3)。
 *  导出:reboundReview 取券商板块领涨成分用。 */
export async function fetchBoardConstituents(
  bkCode: string,
): Promise<{ code: string; name: string; amount: number; changePct: number }[]> {
  for (let i = 0; i < CLIST_HOSTS.length; i++) {
    const host = CLIST_HOSTS[i]
    const url =
      `https://${host}/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f6` +
      `&fs=${encodeURIComponent(`b:${bkCode}`)}&fields=f12,f14,f6,f3`
    try {
      const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 8000 })
      if (!res.ok) throw new Error(`clist b: HTTP ${res.status}`)
      const json = (await res.json()) as any
      const diff = (json?.data?.diff ?? []) as Record<string, unknown>[]
      if (diff.length) {
        return diff
          .map((d) => ({ code: String(d.f12 ?? ''), name: String(d.f14 ?? ''), amount: num(d.f6), changePct: num(d.f3) }))
          .filter((x) => x.code)
      }
    } catch {
      /* 试下一个镜像 */
    }
  }
  return []
}
