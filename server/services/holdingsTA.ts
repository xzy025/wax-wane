// 盘后持仓深度技术分析 · IO/缓存/落盘编排层(纯函数判定见 holdingsTARules.ts)。
// 持仓在前端合成(auto=交易重放 + manual=localStorage),服务端不知情——由客户端上报代码列表,
// 本层逐只取 280 根日 K 跑深度 TA、按板块动态基准算相对强度,并与上一份存档做 delta。
// 落盘:盘中(工作日 09:15~15:10)返回 live 不落盘;盘后以**最后一根 K 线日期**为信号日写
// docs/screener/holdings-ta-<date>.json(该目录已 gitignore;档内不写 avgCost,降低敏感面)。
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { shanghaiClock, isAShareSession } from '../lib/cache'
import { todayShanghai } from '../lib/time'
import { HOLDINGS, SCREENER } from '../config/screener'
import { fetchStockKline, fetchIndexKline, mapLimit } from './ashare'
import { enrichRelStrength, type Bar } from './screenerRules'
import {
  buildHoldingTAFromBars,
  codesKey,
  diffHoldingTA,
  isHoldingsTAResult,
  isSettledClock,
  pickPrevArchiveName,
  shouldReplaceHoldingsArchive,
  type HoldingTAItem,
  type HoldingsTAResult,
} from './holdingsTARules'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')
const LIVE_TTL = 120_000
const CLOSED_TTL = 12 * 3_600_000

export interface HoldingsTAPosition {
  code: string
  /** 仅供 LLM 叙事的浮盈上下文;TA 计算不依赖,也绝不落盘。 */
  avgCost?: number
}

// 单槽缓存(createCache 是零参缓存不适用——key 随持仓集合变):key=排序去重 codes。
// avgCost 不进 key(只影响叙事,叙事每日只生成一次)。
let cached: { key: string; at: number; result: HoldingsTAResult } | null = null
let inflight: { key: string; p: Promise<HoldingsTAResult> } | null = null

export function clearHoldingsTACache(): void {
  cached = null
}

const errorItem = (code: string, error: string): HoldingTAItem => ({
  code,
  name: code,
  date: '',
  close: 0,
  changePct: 0,
  combo: { score01: 0.5, bias: 'neutral', distribution: false, wyckoffPhase: '未明', tags: [], note: '数据不足' },
  trendTemplateOk: null,
  ma: { ma5: 0, ma10: 0, ma20: 0, ma60: 0, ma250: 0 },
  aboveMa: { ma5: false, ma10: false, ma20: false, ma60: false, ma250: false },
  volRatio: 0,
  breakoutVolRatio: 0,
  hi52: 0,
  dist52Pct: 0,
  rsRaw: 0,
  atr14: 0,
  atrStop: 0,
  pivotHigh250: 0,
  pivots: { r1: 0, r2: 0, s1: 0, s2: 0 },
  delta: null,
  error,
})

/** 三基准当日涨跌幅(沪深300/创业板指/科创50);单基准失败兜 0(退化为绝对涨跌幅口径)。 */
async function fetchBenchmarks(): Promise<HoldingsTAResult['benchmarks']> {
  const chgOf = async (secid: string): Promise<number> => {
    try {
      const k = await fetchIndexKline(secid, 2)
      const n = k.length
      return n >= 2 && k[n - 2].close > 0 ? (k[n - 1].close / k[n - 2].close - 1) * 100 : 0
    } catch {
      return 0
    }
  }
  const [hs300, chinext, star50] = await Promise.all([
    chgOf(SCREENER.MARKET_INDEX_SECID),
    chgOf(SCREENER.CHINEXT_INDEX_SECID),
    chgOf(SCREENER.STAR50_INDEX_SECID),
  ])
  return { hs300, chinext, star50 }
}

/** 信号日 = 各成功票最后 K 线日期的众数(平票取较新;全失败 → 今日上海日)。 */
function signalDate(items: HoldingTAItem[]): string {
  const counts = new Map<string, number>()
  for (const it of items) {
    if (it.error || !it.date) continue
    counts.set(it.date, (counts.get(it.date) ?? 0) + 1)
  }
  let best = ''
  let bestN = 0
  for (const [d, n] of counts) {
    if (n > bestN || (n === bestN && d > best)) {
      best = d
      bestN = n
    }
  }
  return best || todayShanghai()
}

function loadArchiveFile(filename: string): HoldingsTAResult | null {
  try {
    const raw = JSON.parse(readFileSync(join(SCREENER_DIR, filename), 'utf8'))
    return isHoldingsTAResult(raw) ? raw : null
  } catch {
    return null
  }
}

function listArchiveFiles(): string[] {
  try {
    return readdirSync(SCREENER_DIR)
  } catch {
    return []
  }
}

/** 历史存档日期清单(倒序,历史回看下拉用)。 */
export function listHoldingsTaArchiveDates(): string[] {
  return listArchiveFiles()
    .map((f) => (/^holdings-ta-(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1] ?? ''))
    .filter(Boolean)
    .sort()
    .reverse()
}

/** 读指定日期存档(损坏/缺失 → null)。 */
export function loadHoldingsTaArchiveByDate(date: string): HoldingsTAResult | null {
  return loadArchiveFile(`holdings-ta-${date}.json`)
}

function writeArchive(result: HoldingsTAResult): void {
  try {
    const prev = loadHoldingsTaArchiveByDate(result.date)
    if (!shouldReplaceHoldingsArchive(prev, result)) {
      console.log(`[HoldingsTA] 同日档 ${result.date} 成功票数更多,保留旧档不覆盖`)
      return
    }
    // 已有叙事则并入新档(叙事每日一次,数据区更新不应丢它)。
    const merged = result.narrative === null && prev?.narrative ? { ...result, narrative: prev.narrative } : result
    mkdirSync(SCREENER_DIR, { recursive: true })
    writeFileSync(join(SCREENER_DIR, `holdings-ta-${merged.date}.json`), JSON.stringify(merged, null, 2))
    if (merged !== result) result.narrative = merged.narrative
  } catch (err) {
    console.warn('[HoldingsTA] 存档失败(非致命):', err)
  }
}

async function compute(positions: HoldingsTAPosition[]): Promise<HoldingsTAResult> {
  const codes = [...new Set(positions.map((p) => p.code))]
  const [items, benchmarks] = await Promise.all([
    mapLimit(codes, HOLDINGS.CONCURRENCY, async (code): Promise<HoldingTAItem> => {
      try {
        const { name, klines } = await fetchStockKline(code, 101, HOLDINGS.KLINE_COUNT)
        return buildHoldingTAFromBars(code, name || code, klines as Bar[]) ?? errorItem(code, 'K线不足')
      } catch (err) {
        return errorItem(code, err instanceof Error ? err.message : 'K线获取失败')
      }
    }),
    fetchBenchmarks(),
  ])

  // 相对大盘强度:按板块动态换基准(300/301→创业板指、688→科创50,同 screener.relBenchmarkFor 口径)。
  const benchFor = (code: string): number =>
    code.startsWith('300') || code.startsWith('301') ? benchmarks.chinext
      : code.startsWith('688') ? benchmarks.star50
      : benchmarks.hs300
  enrichRelStrength(items.filter((i) => !i.error), benchFor, SCREENER.RELSTR.CRASH_DAY_PCT)

  const date = signalDate(items)
  const settled = isSettledClock(shanghaiClock())

  // 与上一份存档(最近早于信号日)做 delta;漏档日自动回退到再往前最近一档。
  const prevRef = pickPrevArchiveName(listArchiveFiles(), date)
  let prevDate: string | null = null
  if (prevRef) {
    const prevArchive = loadArchiveFile(prevRef.filename)
    if (prevArchive) {
      prevDate = prevRef.date
      const prevByCode = new Map(prevArchive.items.filter((i) => !i.error).map((i) => [i.code, i]))
      for (const it of items) {
        const prev = it.error ? undefined : prevByCode.get(it.code)
        if (prev) it.delta = diffHoldingTA(prev, it, prevRef.date)
      }
    }
  }

  const result: HoldingsTAResult = {
    date,
    generatedAt: new Date().toISOString(),
    settled,
    prevDate,
    benchmarks,
    items,
    narrative: null,
  }

  // 盘后定盘才落盘(盘中半根 K 的量比/Wyckoff 是伪信号);信号日命名天然规避
  // "周五凌晨把周四数据存成周五档"的错标坑。全失败包(0 成功票)不值得写。
  if (settled && items.some((i) => !i.error)) writeArchive(result)
  return result
}

/** 取持仓深度 TA(单槽缓存 + in-flight 去重;持仓集合变化即重算)。 */
export async function fetchHoldingsTA(positions: HoldingsTAPosition[]): Promise<HoldingsTAResult> {
  if (positions.length === 0) {
    return {
      date: todayShanghai(),
      generatedAt: new Date().toISOString(),
      settled: isSettledClock(shanghaiClock()),
      prevDate: null,
      benchmarks: { hs300: 0, chinext: 0, star50: 0 },
      items: [],
      narrative: null,
    }
  }
  const key = codesKey(positions.map((p) => p.code))
  const ttl = isAShareSession() ? LIVE_TTL : CLOSED_TTL
  if (cached && cached.key === key && Date.now() - cached.at < ttl) {
    // 新鲜度修正:盘中算出的 live 值(settled=false)跨过 15:10 会被 12h 长 TTL"追认新鲜",
    // 盘后所有请求都命中它、永远等不到定盘档——时钟已定盘而缓存仍 live 时强制过期重算。
    if (!(cached.result.settled === false && isSettledClock(shanghaiClock()))) return cached.result
  }
  if (inflight && inflight.key === key) return inflight.p
  const p = compute(positions)
    .then((r) => {
      cached = { key, at: Date.now(), result: r }
      return r
    })
    .finally(() => {
      if (inflight?.key === key) inflight = null
    })
  inflight = { key, p }
  return p
}
