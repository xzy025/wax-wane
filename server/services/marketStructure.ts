// 每日市场结构快照:板块集中度(2×2象限计数+短窗宽度)+ 涨跌停/赚钱效应,
// 固化"K型分化/抱团"分析为可复用的每日数据(而非每次临时口头问)。
//
// 触发=按需(GET /api/screener/market-structure),复用 createCache + 盘后长 TTL,
// 每次成功计算落盘 docs/screener/structure-<today>.json 供冷启动/抓取失败兜底。
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createCache, sessionTtl } from '../lib/cache'
import { todayShanghai } from '../lib/time'
import { fetchSentiment } from './kaipanla'
import { fetchRotation, type RotationBoard } from './rotation'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')
const CLOSED_TTL = 12 * 3_600_000 // 盘后长 TTL,同 screener/forward,避免盘后反复打接口
const STRUCTURE_RE = /^structure-(\d{4}-\d{2}-\d{2})\.json$/
const TOP_N = 5 // Top HS/LS 板块展示上限

export interface MarketStructureBoard {
  code: string
  name: string
  longChg: number
  shortChg: number
  todayChg: number
}

export interface MarketStructureSummary {
  asof: string
  generatedAt: string
  limitUp: number // 涨停家数
  limitDown: number // 跌停家数
  advanceCount: number // 上涨家数
  declineCount: number // 下跌家数
  breakRate: number // 破板率%
  boardTotal: number // 参与轮动统计的板块总数
  hsCount: number // 强势延续(抱团/龙头)
  lsCount: number // 底部反转
  hwCount: number // 高位回调
  lwCount: number // 持续走弱
  shortUpPct: number // 近短窗上涨板块占比%(市场宽度)
  topHs: MarketStructureBoard[] // 抱团龙头板块(按短窗涨幅降序)
  topLs: MarketStructureBoard[] // 底部反转候选板块(按短窗涨幅降序)
  fromCache?: boolean // 本次响应来自磁盘存档兜底(仅内存标记,不落盘)
}

async function computeMarketStructure(): Promise<MarketStructureSummary> {
  const [sentiment, rotation] = await Promise.all([
    fetchSentiment().catch(() => null), // 情绪源独立,取不到就整体因子中性(0),不拖垮板块结构
    fetchRotation('industry', 60, 5),
  ])
  // 板块象限是本卡主源:东财限流时 120 板块可能全部取不到日线(rows=0),此时的
  // "全 0 象限"是故障不是事实,绝不能落盘覆盖当日好档——throw 交给 createCache
  // 走 serve-stale/磁盘兜底(对齐 dailyReview hasReviewContent 的空壳保护语义)。
  if (rotation.summary.total === 0) {
    throw new Error('[MarketStructure] rotation 板块全量失败,保留既有缓存/存档')
  }
  const byQuad = (q: RotationBoard['quadrant']) => rotation.boards.filter((b) => b.quadrant === q)
  const topBy = (boards: RotationBoard[]): MarketStructureBoard[] =>
    [...boards]
      .sort((a, b) => b.shortChg - a.shortChg)
      .slice(0, TOP_N)
      .map((b) => ({ code: b.code, name: b.name, longChg: b.longChg, shortChg: b.shortChg, todayChg: b.todayChg }))

  const result: MarketStructureSummary = {
    asof: todayShanghai(),
    generatedAt: new Date().toISOString(),
    limitUp: sentiment?.limitUp ?? 0,
    limitDown: sentiment?.limitDown ?? 0,
    advanceCount: sentiment?.riseCount ?? 0,
    declineCount: sentiment?.fallCount ?? 0,
    breakRate: sentiment?.breakRate ?? 0,
    boardTotal: rotation.summary.total,
    hsCount: rotation.summary.hs,
    lsCount: rotation.summary.ls,
    hwCount: rotation.summary.hw,
    lwCount: rotation.summary.lw,
    shortUpPct: rotation.summary.shortUpPct,
    topHs: topBy(byQuad('hs')),
    topLs: topBy(byQuad('ls')),
  }
  writeStructureDisk(result)
  return result
}

function writeStructureDisk(result: MarketStructureSummary): void {
  try {
    mkdirSync(SCREENER_DIR, { recursive: true })
    writeFileSync(join(SCREENER_DIR, `structure-${result.asof}.json`), JSON.stringify(result, null, 2))
  } catch (err) {
    console.warn('[MarketStructure] 存档失败(非致命):', err)
  }
}

function isStructureResult(v: unknown): v is MarketStructureSummary {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.asof === 'string' && typeof r.boardTotal === 'number'
}

/** 读最新 structure-YYYY-MM-DD.json(冷启动种子 + 抓取失败兜底)。 */
function loadLatestStructureDisk(): MarketStructureSummary | null {
  let files: string[]
  try {
    files = readdirSync(SCREENER_DIR)
  } catch {
    return null
  }
  let latest = ''
  for (const f of files) {
    const m = STRUCTURE_RE.exec(f)
    if (m && m[1] > latest) latest = m[1]
  }
  if (!latest) return null
  try {
    const raw = JSON.parse(readFileSync(join(SCREENER_DIR, `structure-${latest}.json`), 'utf8'))
    if (!isStructureResult(raw)) return null
    return { ...raw, fromCache: true }
  } catch {
    return null
  }
}

const structureCache = createCache<MarketStructureSummary>({
  name: 'MarketStructure',
  ttl: sessionTtl(120_000, CLOSED_TTL),
  fetcher: computeMarketStructure,
  fallback: loadLatestStructureDisk,
})

export function fetchMarketStructure(): Promise<MarketStructureSummary> {
  return structureCache.get()
}

export function clearMarketStructureCache(): void {
  structureCache.clear()
}
