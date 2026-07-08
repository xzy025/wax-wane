// 每日复盘综述:外围(日经/KOSPI/隔夜美股/恒指)→ 消息面(RSS+龙虎榜)→ 宏观日历 →
// A股三大指数 → 板块轮动,一张卡讲完当日全链路。
//
// 数据区=规则聚合(8 源 allSettled,单源失败该段消失,绝不拖垮整卡;内置规则日历
// 保证卡永不全空)。叙事段=LLM 每天盘后生成一次:当日磁盘存档就是叙事的持久层,
// 盘中刷新只更新数据区、复用已有叙事,避免短 TTL 反复打 LLM。
// 全流程照 marketStructure.ts 模板:compute → 落盘 review-<date>.json → 冷启动磁盘种子。
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createCache, sessionTtl, shanghaiClock } from '../lib/cache'
import { llmComplete, isLLMConfigured } from '../lib/llmComplete'
import { fetchIndexQuotes, type IndexQuote, type IndexSpec } from './emQuotes'
import { fetchUSData } from './us'
import { fetchHKData } from './hk'
import { fetchNewsFeed } from './news'
import { fetchHotList } from './hotlist'
import { fetchAShareData } from './ashare'
import { fetchMarketStructure } from './marketStructure'
import {
  fetchMacroCalendar,
  builtinCalendar,
  isImportant,
  todayShanghai,
  type MacroEvent,
  type MacroCalendarResult,
} from './macroCalendar'
import { buildReviewFacts, extractTone, REVIEW_SYSTEM_PROMPT } from './dailyReviewPrompt'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')
const CLOSED_TTL = 12 * 3_600_000 // 盘后长 TTL,同 structure
const REVIEW_RE = /^review-(\d{4}-\d{2}-\d{2})\.json$/
const NEWS_MAX = 6
const DRAGON_TOP = 3 // 龙虎榜净买/净卖各取前 N

// 日韩指数:东财全球指数 secid(与 us.ts 的 100.DJIA 同风格,已实测 f14 名称正确)。
const ASIA_INDICES: IndexSpec[] = [
  { secid: '100.N225', code: 'N225' },
  { secid: '100.KS11', code: 'KS11' },
]

export interface ReviewQuote {
  code: string
  name: string
  price: number
  changePct: number
}

export interface ReviewNewsItem {
  title: string
  summary: string
  source: string
  link: string
}

export interface ReviewDragonRow {
  code: string
  name: string
  changePct: number
  netAmt: number // 净买入(元),负=净卖
  reason: string
}

export interface ReviewBoardChip {
  name: string
  shortChg: number
  todayChg: number
}

export interface ReviewNarrative {
  tone: string // 一句话定调(折叠态展示)
  markdown: string // 完整叙事
  generatedAt: string
}

export interface DailyReviewData {
  asof: string
  generatedAt: string
  overnight: ReviewQuote[] // 隔夜美股三大
  asia: ReviewQuote[] // 日经/KOSPI/恒指
  news: ReviewNewsItem[]
  dragonTiger: ReviewDragonRow[] // 净买前3 + 净卖前3
  calendar: MacroEvent[] // 未来一周,已按重要度过滤
  calendarSource: MacroCalendarResult['source']
  ashare: {
    indices: ReviewQuote[] // 上证/深成/创业板
    totalTurnover: number // 元
    limitUp: number
    limitDown: number
    advance: number
    decline: number
  } | null
  structure: {
    hsCount: number
    lsCount: number
    hwCount: number
    lwCount: number
    shortUpPct: number
    topHs: ReviewBoardChip[]
    topLs: ReviewBoardChip[]
  } | null
  narrative: ReviewNarrative | null // LLM 未配置/失败/盘中未生成 → null
  fromCache?: boolean // 本次响应来自磁盘存档兜底(仅内存标记)
}

/**
 * 叙事生成门控:仅交易日(周一~五)盘后 15:10 起(给收盘数据定盘留 10 分钟缓冲)。
 * 盘中不打 LLM(盘中刷新只更新数据区);周末不生成——数据仍是上一交易日的,
 * 若给周六/周日的 asof 配新叙事既冗余又错标日期,改为借用最近存档的叙事。
 * (法定节假日落在工作日时无交易日历可判,会按普通盘后处理,属已知局限。)
 */
export function shouldGenerateNarrative(day: number, minutes: number): boolean {
  if (day === 0 || day === 6) return false
  return minutes >= 15 * 60 + 10
}

/**
 * 数据区是否有实际内容。8 源大面积挂掉(如东财限流+全局 /api/refresh 清缓存)时
 * 聚合出的"空壳"不允许落盘/进缓存——compute 抛错,交给 createCache 的
 * serve-stale + 磁盘 fallback,防止覆盖当天已有的完整存档(对齐 marketStructure
 * 模板"主源失败即 throw"的语义;builtin 日历永远有值,故不计入)。
 */
export function hasReviewContent(d: DailyReviewData): boolean {
  return (
    d.overnight.length > 0 ||
    d.asia.length > 0 ||
    d.news.length > 0 ||
    d.dragonTiger.length > 0 ||
    (d.ashare !== null && (d.ashare.indices.length > 0 || d.ashare.totalTurnover > 0)) ||
    (d.structure !== null && d.structure.hsCount + d.structure.lsCount + d.structure.hwCount + d.structure.lwCount > 0)
  )
}

const toQuote = (q: IndexQuote): ReviewQuote => ({
  code: q.code,
  name: q.name,
  price: q.price,
  changePct: q.changePct,
})

async function computeDailyReview(): Promise<DailyReviewData> {
  const asof = todayShanghai()
  const [us, asiaQ, hk, news, hot, cal, ashare, structure] = await Promise.allSettled([
    fetchUSData(),
    fetchIndexQuotes(ASIA_INDICES),
    fetchHKData(),
    fetchNewsFeed(),
    fetchHotList(),
    fetchMacroCalendar(),
    fetchAShareData(),
    fetchMarketStructure(),
  ])
  const val = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null)

  const hsi = val(hk)?.indices.find((q) => q.code === 'HSI')
  const asia = [...(val(asiaQ) ?? []), ...(hsi ? [hsi] : [])].map(toQuote)

  // news.ts 未配置 RSS 时返回 source='system' 的占位条目,不算真实消息
  const newsItems: ReviewNewsItem[] = (val(news) ?? [])
    .filter((n) => n.source !== 'system')
    .slice(0, NEWS_MAX)
    .map((n) => ({ title: n.title, summary: n.summary.slice(0, 200), source: n.source, link: n.link }))

  const dt = val(hot)?.dragonTiger ?? []
  const buys = dt
    .filter((x) => x.netAmt > 0)
    .sort((a, b) => b.netAmt - a.netAmt)
    .slice(0, DRAGON_TOP)
  const sells = dt
    .filter((x) => x.netAmt <= 0)
    .sort((a, b) => a.netAmt - b.netAmt)
    .slice(0, DRAGON_TOP)
  const dragonTiger: ReviewDragonRow[] = [...buys, ...sells].map((x) => ({
    code: x.code,
    name: x.name,
    changePct: x.changePct,
    netAmt: x.netAmt,
    reason: x.reason,
  }))

  // 日历兜底的兜底:连 fetchMacroCalendar 都挂了(理论不该发生)也直接用规则日历
  const calData = val(cal) ?? { asof, events: builtinCalendar(asof, 7).filter(isImportant), source: 'builtin' as const }

  const ash = val(ashare)
  const ashareSec: DailyReviewData['ashare'] = ash
    ? {
        indices: ash.indices.map(toQuote),
        totalTurnover: ash.totalTurnover,
        limitUp: ash.limitUpCount,
        limitDown: ash.limitDownCount,
        advance: ash.advance,
        decline: ash.decline,
      }
    : null

  const st = val(structure)
  const chip = (b: { name: string; shortChg: number; todayChg: number }): ReviewBoardChip => ({
    name: b.name,
    shortChg: b.shortChg,
    todayChg: b.todayChg,
  })
  const structureSec: DailyReviewData['structure'] = st
    ? {
        hsCount: st.hsCount,
        lsCount: st.lsCount,
        hwCount: st.hwCount,
        lwCount: st.lwCount,
        shortUpPct: st.shortUpPct,
        topHs: st.topHs.map(chip),
        topLs: st.topLs.map(chip),
      }
    : null

  const data: DailyReviewData = {
    asof,
    generatedAt: new Date().toISOString(),
    overnight: (val(us)?.indices ?? []).map(toQuote),
    asia,
    news: newsItems,
    dragonTiger,
    calendar: calData.events,
    calendarSource: calData.source,
    ashare: ashareSec,
    structure: structureSec,
    narrative: null,
  }

  // 空壳保护:上游大面积失败时不落盘不进缓存,抛给 createCache 走 serve-stale/磁盘兜底。
  if (!hasReviewContent(data)) {
    throw new Error('[DailyReview] 所有数据源均无内容,保留既有缓存/存档')
  }

  // LLM 叙事:每个交易日一次。当日磁盘存档就是叙事的持久层——已有则复用(零 LLM 调用);
  // 没有且处于盘后窗口才生成;失败 null 优雅降级(fetchDailyReview 的惰性补生成会限流重试)。
  // 周末:非交易日不打 LLM,直接借用最近存档(通常是周五)的叙事。
  const { day, minutes } = shanghaiClock()
  const isWeekend = day === 0 || day === 6
  const prior = loadReviewDisk(asof)
  let narrative = prior?.narrative ?? null
  if (narrative === null && isWeekend) {
    narrative = loadLatestReviewDisk()?.narrative ?? null
  }
  if (narrative === null && isLLMConfigured() && shouldGenerateNarrative(day, minutes)) {
    const done = await llmComplete(buildReviewFacts(data), {
      system: REVIEW_SYSTEM_PROMPT,
      maxTokens: 800,
      temperature: 0.3,
      timeoutMs: 30_000,
      llmId: 'gemini',
    })
    if (done) {
      narrative = { tone: extractTone(done.text), markdown: done.text.trim(), generatedAt: new Date().toISOString() }
      console.log(`[DailyReview] 叙事生成完成(${done.totalTokens ?? '?'} tokens)`)
    } else {
      console.warn('[DailyReview] 叙事生成失败(非致命),本次仅数据区')
    }
  }
  data.narrative = narrative

  // 周末不落盘:asof 是非交易日,数据实为上一交易日,落盘会遮住冷启动种子里真正的交易日存档。
  if (!isWeekend) writeReviewDisk(data)
  return data
}

function writeReviewDisk(result: DailyReviewData): void {
  try {
    mkdirSync(SCREENER_DIR, { recursive: true })
    writeFileSync(join(SCREENER_DIR, `review-${result.asof}.json`), JSON.stringify(result, null, 2))
  } catch (err) {
    console.warn('[DailyReview] 存档失败(非致命):', err)
  }
}

export function isReviewResult(v: unknown): v is DailyReviewData {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.asof === 'string' && Array.isArray(r.overnight) && Array.isArray(r.calendar)
}

/** 读指定日期的存档(叙事复用用,精确当日;损坏/缺失 → null)。 */
function loadReviewDisk(date: string): DailyReviewData | null {
  try {
    const raw = JSON.parse(readFileSync(join(SCREENER_DIR, `review-${date}.json`), 'utf8'))
    return isReviewResult(raw) ? raw : null
  } catch {
    return null
  }
}

/** 读最新 review-YYYY-MM-DD.json(冷启动种子 + 抓取失败兜底)。 */
function loadLatestReviewDisk(): DailyReviewData | null {
  let files: string[]
  try {
    files = readdirSync(SCREENER_DIR)
  } catch {
    return null
  }
  let latest = ''
  for (const f of files) {
    const m = REVIEW_RE.exec(f)
    if (m && m[1] > latest) latest = m[1]
  }
  if (!latest) return null
  const raw = loadReviewDisk(latest)
  return raw ? { ...raw, fromCache: true } : null
}

const reviewCache = createCache<DailyReviewData>({
  name: 'DailyReview',
  ttl: sessionTtl(120_000, CLOSED_TTL),
  fetcher: computeDailyReview,
  fallback: loadLatestReviewDisk,
})

// 叙事惰性补生成的限流:LLM 持续失败(如 key 失效)时最多每 30 分钟重试一次,
// 避免盘后每个 GET 都触发一次全量重算+失败的 LLM 调用。
const NARRATIVE_RETRY_MS = 30 * 60_000
let lastNarrativeAttempt = 0

/**
 * 取综述,并惰性补生成叙事。必要性:sessionTtl 在【读取时】求值——盘中 14:30 算出的
 * narrative=null 缓存值,时钟一过 15:00 其 TTL 立即从 120s 变成 12h,盘后所有 GET 都会
 * 命中这个"被追认新鲜"的无叙事值,永远等不到 15:10 门控里的生成(冷启动磁盘种子同理)。
 * 所以在读取层补一刀:盘后窗口读到 null 叙事且 LLM 可用,就清缓存强制重算一次
 * (重算走 compute 的 15:10 门控,底层 8 源各自有缓存,成本≈一次 LLM 调用)。
 */
export async function fetchDailyReview(): Promise<DailyReviewData> {
  const result = await reviewCache.get()
  if (result.narrative !== null || !isLLMConfigured()) return result
  const { day, minutes } = shanghaiClock()
  if (!shouldGenerateNarrative(day, minutes)) return result
  if (Date.now() - lastNarrativeAttempt < NARRATIVE_RETRY_MS) return result
  lastNarrativeAttempt = Date.now()
  reviewCache.clear()
  return reviewCache.get()
}

export function clearDailyReviewCache(): void {
  reviewCache.clear()
}
