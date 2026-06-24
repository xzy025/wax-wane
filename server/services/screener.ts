// 新高战法选股器服务:全市场 clist 廉价初筛 → 入围者 K 线精筛(纯规则) →
// RS 百分位 + 评分 + 分组 → 缓存 + 按日落盘 docs/screener/YYYY-MM-DD.json。
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createCache, sessionTtl } from '../lib/cache'
import { EM_HEADERS } from '../lib/emHeaders'
import { fetchStockKline, fetchIndexKline } from './ashare'
import { fetchSentiment } from './kaipanla'
import { SCREENER as C, PULLBACK, type ScreenerConfig } from '../config/screener'
import { classify, finalScore, marketRegime, targetRMultFor, type Bar, type Candidate, type MarketRegime } from './screenerRules'
import { classifyPullback, type PullbackCandidate } from './pullbackRules'
import { boardStrengthAsOf } from './rotationRules'
import { resolveStockIndustryBoard } from './rotation'
import { fetchTradingDates } from './moneyflow'
import { buildLhbIndex, lhbFactorFor } from './lhbHistory'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')

/** 龙虎榜加分(近 K 交易日机构/资金净买埋伏)。金额单位:元。 */
export interface LhbConfluence {
  onDays: number // 近 K 日上榜天数
  net: number // 全口径净买入和
  instDays: number // 机构专用净买天数
  instNet: number // 机构专用净买和
  score: number // 0..1 加分
}

/** 板块强弱加分(个股所属行业板块当前 2×2 象限)。 */
export interface BoardConfluence {
  code: string // BKxxxx
  name: string // 板块名
  quadrant: string // hs/ls/hw/lw
  shortChg: number // 近短窗涨幅%
  strong: boolean // 短窗为正(轮动顺风)
  score: number // 0..1 加分
}

export interface ScreenerCandidate extends Candidate {
  code: string
  name: string
  score: number
  /** 龙虎榜加分(无则不存在=该股近 K 日未上榜)。 */
  lhbInst?: LhbConfluence
  /** 板块强弱加分(无则不存在=板块数据不可用)。 */
  board?: BoardConfluence
}

/** 回调二次启动候选(第三组):新高战法外的另一类形态,见 pullbackRules.classifyPullback。 */
export interface PullbackScreenerCandidate extends PullbackCandidate {
  code: string
  name: string
}

export interface ScreenerRegime {
  phase: 'attack' | 'caution' | 'retreat'
  temperature: number
  limitUp: number
  limitDown: number
  breakRate: number
  note: string
  /** 大盘趋势(指数代理):动态目标位的依据。 */
  marketTrend: MarketRegime
  /** 本次扫描据大盘趋势选定的目标位 R 倍数(动态关闭时=固定标量)。 */
  targetRMult: number
}

export interface ScreenerResult {
  asof: string // YYYY-MM-DD
  regime: ScreenerRegime
  breakout: ScreenerCandidate[]
  trigger: ScreenerCandidate[]
  pullback: PullbackScreenerCandidate[] // 第三组:回调二次启动/圆弧底反包
  scanned: number // 新高战法初筛后入围(取K线)只数
  scannedPullback: number // 回调战法初筛(量比榜)入围只数
  universe: number // clist 全市场只数
  truncated: boolean // 是否触及 MAX_KLINE 上限
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

interface Pre {
  code: string
  name: string
  price: number
  amount: number // 成交额(元)
  mom60: number
  vr: number // 量比
}

const CLIST_FIELDS = 'f2,f3,f6,f8,f10,f12,f14,f20,f24,f25'
const CLIST_PZ = 100 // EM 每页上限 100,须翻页
// 多镜像主机轮换:分散负载 + 规避单主机反爬限流(push2delay 通常最宽松)。
const CLIST_HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '82.push2.eastmoney.com']

/** 取 clist 第 pn 页;镜像主机轮换 + 失败重试一次(东财限流容错)。 */
async function fetchClistPage(pn: number, attempt = 0): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  // 起始主机按页号轮换,失败再依次试其余主机。
  for (let i = 0; i < CLIST_HOSTS.length; i++) {
    const host = CLIST_HOSTS[(pn + i) % CLIST_HOSTS.length]
    const url =
      `https://${host}/api/qt/clist/get?pn=${pn}&pz=${CLIST_PZ}&po=1&np=1&fltt=2&invt=2&fid=f3` +
      `&fs=${encodeURIComponent(C.CLIST_FS)}&fields=${CLIST_FIELDS}`
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

/** Stage 1: 全市场 clist 翻页取数 + 廉价初筛。
 *  同一份 clist 产出两个切片:新高战法(按 60 日动量,mom60≥0)、回调战法(按量比,vr≥PB_VR_MIN)。
 *  回调票 mom60 常为负→不能用动量榜,改用量比榜(当日放量=二次启动触发,与该战法对齐)。 */
async function prefilter(): Promise<{ rows: Pre[]; pullbackRows: Pre[]; universe: number }> {
  const first = await fetchClistPage(1)
  const total = first.total || first.rows.length
  const pages = Math.min(Math.ceil(total / CLIST_PZ), 60) // 安全上限 6000 只
  const diff: Record<string, unknown>[] = [...first.rows]
  // 顺序翻页 + 小延迟,避免并发突发触发东财 clist 反爬限流;某页失败则用已取到的优雅降级。
  for (let pn = 2; pn <= pages; pn++) {
    await new Promise((r) => setTimeout(r, 120))
    try {
      const page = await fetchClistPage(pn)
      if (page.rows.length === 0) break
      diff.push(...page.rows)
    } catch {
      console.warn(`[Screener] clist 第 ${pn} 页失败,使用已取 ${diff.length} 只继续`)
      break
    }
  }
  const universe = diff.length

  // 廉价基础过滤(ST/流动/市值),两战法共用。
  const base: Pre[] = []
  for (const d of diff) {
    const code = String(d.f12 ?? '')
    const name = String(d.f14 ?? '')
    const price = num(d.f2)
    const amount = num(d.f6)
    const mcap = num(d.f20)
    const mom60 = num(d.f24)
    const vr = num(d.f10)
    if (!code || price <= 0) continue
    if (/ST|退/i.test(name)) continue // 剔除 ST/*ST/退市整理
    if (amount < C.LIQUIDITY_MIN) continue // 低流动
    if (mcap < C.MCAP_MIN) continue // 小市值
    base.push({ code, name, price, amount, mom60, vr })
  }
  // 新高战法:留强势(mom60≥0),按 60 日动量排序(不掺量比——量比高会埋没"缩量待发"的扳机候选)。
  const rows = base.filter((p) => p.mom60 >= C.MOM60_MIN).sort((a, b) => b.mom60 - a.mom60)
  // 回调战法:不筛动量(回调票常为负),按当日量比(放量=二次启动触发)降序,量比达标者入围。
  const pullbackRows = base.filter((p) => p.vr >= PULLBACK.PB_VR_MIN).sort((a, b) => b.vr - a.vr)
  return { rows, pullbackRows, universe }
}

/** 并集中的一只票:标记其所属切片(可同属两者,虽几乎互斥)。 */
interface UnionStock {
  p: Pre
  nh: boolean // 新高切片
  pb: boolean // 回调切片
}

/** Stage 2: 对一只票取一次 K 线,按所属切片跑 新高(classify) 与/或 回调(classifyPullback)。
 *  两战法 KLINE_COUNT 一致(300),故单次取数即可覆盖。cfg 可注入(动态目标位 R 倍数)。 */
async function confirmUnion(
  u: UnionStock,
  cfg: ScreenerConfig,
  stats: { fetched: number },
): Promise<{ nh: (ScreenerCandidate & { liqAmount: number }) | null; pb: PullbackScreenerCandidate | null }> {
  try {
    const { klines } = await fetchStockKline(u.p.code, 101, cfg.KLINE_COUNT)
    if (!klines || klines.length < cfg.MA_LONG + cfg.MA_LONG_RISE_LOOKBACK + 1) return { nh: null, pb: null }
    stats.fetched++ // 取到足量K线(数据源健康度);match 与否是另一回事
    const bars = klines as Bar[]
    let nh: (ScreenerCandidate & { liqAmount: number }) | null = null
    let pb: PullbackScreenerCandidate | null = null
    if (u.nh) {
      const cand = classify(bars, cfg)
      if (cand) nh = { ...cand, code: u.p.code, name: u.p.name, score: 0, liqAmount: u.p.amount }
    }
    if (u.pb) {
      const cand = classifyPullback(bars, PULLBACK)
      if (cand) pb = { ...cand, code: u.p.code, name: u.p.name }
    }
    return { nh, pb }
  } catch {
    return { nh: null, pb: null }
  }
}

/** 取大盘趋势(指数代理)→ 动态目标位 R 倍数。失败兜底中性/固定标量。 */
async function resolveMarketTarget(): Promise<{ marketTrend: MarketRegime; targetRMult: number }> {
  try {
    const idx = await fetchIndexKline(C.MARKET_INDEX_SECID, C.MARKET_MA_SLOW + 10)
    const marketTrend = marketRegime(idx.map((b) => b.close))
    return { marketTrend, targetRMult: targetRMultFor(marketTrend) }
  } catch {
    return { marketTrend: 'neutral', targetRMult: targetRMultFor('neutral') }
  }
}

/** 有界并发。 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
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

/** 给候选挂上「龙虎榜机构净买」+「板块强弱」加分(best-effort:失败/取不到数据则该因子缺省=中性,不伤分)。
 *  仅对入围的 ~30 候选取增量数据:龙虎榜近 K 日索引(一次,全候选共享)+ 个股行业板块当前强弱。 */
async function enrichConfluence(cands: (ScreenerCandidate & { liqAmount: number })[]): Promise<void> {
  if (cands.length === 0) return
  // ① 龙虎榜:近 K 交易日机构/资金净买
  try {
    const dates = await fetchTradingDates() // 降序(最近在前)
    const win = dates.slice(0, C.LHB_LOOKBACK_K + 1)
    if (win.length) {
      const lhbIndex = await buildLhbIndex(win, { institutional: C.LHB_INSTITUTIONAL, concurrency: 4 })
      for (const c of cands) {
        const f = lhbFactorFor(c.code, win, lhbIndex)
        if (f.onDays > 0) {
          c.lhbInst = { onDays: f.onDays, net: f.netSum, instDays: f.instDays, instNet: f.instNetSum, score: f.score01 }
        }
      }
    }
  } catch (err) {
    console.warn('[Screener] 龙虎榜加分取数失败(忽略):', err instanceof Error ? err.message : err)
  }
  // ② 板块强弱:个股→行业板块→板块日线→当前 2×2 强弱(同板块 closes 缓存复用)
  try {
    const closesByBk = new Map<string, number[]>()
    await mapLimit(cands, 6, async (c) => {
      const { bk, name } = await resolveStockIndustryBoard(c.code)
      if (!bk) return
      let closes = closesByBk.get(bk)
      if (!closes) {
        try {
          const bars = await fetchIndexKline(`90.${bk}`, C.BOARD_LONG_WIN + 30)
          closes = bars.map((b) => b.close)
        } catch {
          closes = []
        }
        closesByBk.set(bk, closes)
      }
      if (closes.length === 0) return
      const s = boardStrengthAsOf(closes, closes.length - 1, C.BOARD_LONG_WIN, C.BOARD_SHORT_WIN)
      if (s) c.board = { code: bk, name, quadrant: s.quadrant, shortChg: s.shortChg, strong: s.strong, score: s.score01 }
    })
  } catch (err) {
    console.warn('[Screener] 板块加分取数失败(忽略):', err instanceof Error ? err.message : err)
  }
}

function buildRegime(s: {
  temperature?: number
  limitUp?: number
  limitDown?: number
  breakRate?: number
}): ScreenerRegime {
  const temperature = num(s.temperature)
  const limitUp = num(s.limitUp)
  const limitDown = num(s.limitDown)
  const breakRate = num(s.breakRate)
  let phase: ScreenerRegime['phase']
  let note: string
  if (temperature >= 60 && breakRate < 30) {
    phase = 'attack'
    note = '情绪偏暖、破板率可控,题材友好——可正常打突破'
  } else if (temperature <= 40 || breakRate >= 40) {
    phase = 'retreat'
    note = '情绪退潮/破板率高——降仓,突破假信号多,谨慎或观望'
  } else {
    phase = 'caution'
    note = '情绪中性——小仓优选龙头突破,严格止损'
  }
  // marketTrend/targetRMult 先给安全默认,由 fetchScreenerFresh 取指数后回填。
  return { phase, temperature, limitUp, limitDown, breakRate, note, marketTrend: 'neutral', targetRMult: C.TARGET_R_MULT }
}

function todayStr(): string {
  // 用 Shanghai 日期作为存档键
  const now = new Date()
  const sh = new Date(now.getTime() + now.getTimezoneOffset() * 60_000 + 8 * 3_600_000)
  return `${sh.getFullYear()}-${String(sh.getMonth() + 1).padStart(2, '0')}-${String(sh.getDate()).padStart(2, '0')}`
}

async function fetchScreenerFresh(): Promise<ScreenerResult> {
  const asof = todayStr()
  const t0 = Date.now()

  // Regime(尽力而为,失败给中性)
  let regime: ScreenerRegime
  try {
    regime = buildRegime((await fetchSentiment()) as Record<string, number>)
  } catch {
    regime = {
      phase: 'caution', temperature: 0, limitUp: 0, limitDown: 0, breakRate: 0,
      note: '情绪数据暂不可用', marketTrend: 'neutral', targetRMult: C.TARGET_R_MULT,
    }
  }

  // 大盘趋势 → 动态目标位 R(逆向:弱市新高=龙头给更远目标)。回填 regime + 注入扫描 cfg。
  const { marketTrend, targetRMult } = await resolveMarketTarget()
  regime.marketTrend = marketTrend
  regime.targetRMult = targetRMult
  const scanCfg: ScreenerConfig = { ...C, TARGET_R_MULT: targetRMult }

  const { rows, pullbackRows, universe } = await prefilter()
  const truncated = rows.length > C.MAX_KLINE
  const nhSurvivors = rows.slice(0, C.MAX_KLINE)
  const pbSurvivors = pullbackRows.slice(0, C.MAX_KLINE)
  // 两切片并集去重(同一只只取一次 K 线),记录所属切片。
  const unionMap = new Map<string, UnionStock>()
  for (const p of nhSurvivors) unionMap.set(p.code, { p, nh: true, pb: false })
  for (const p of pbSurvivors) {
    const e = unionMap.get(p.code)
    if (e) e.pb = true
    else unionMap.set(p.code, { p, nh: false, pb: true })
  }
  const union = [...unionMap.values()]
  if (truncated) console.log(`[Screener] 新高初筛 ${rows.length} 只 > 上限 ${C.MAX_KLINE},截断`)
  console.log(
    `[Screener] 全市场 ${universe} → 新高入围 ${nhSurvivors.length} / 回调入围 ${pbSurvivors.length} → 并集取K线 ${union.length};大盘 ${marketTrend} → 目标 ${targetRMult}R`,
  )

  const stats = { fetched: 0 }
  const confirmed = await mapLimit(union, C.CONCURRENCY, (u) => confirmUnion(u, scanCfg, stats))
  const enriched = confirmed
    .map((r) => r.nh)
    .filter((x): x is ScreenerCandidate & { liqAmount: number } => x != null)
  const pullback = confirmed
    .map((r) => r.pb)
    .filter((x): x is PullbackScreenerCandidate => x != null)
    .sort((a, b) => b.score - a.score)

  // 龙虎榜机构 + 板块强弱 加分(仅对新高入围候选;best-effort)
  await enrichConfluence(enriched)

  // RS 百分位(在入围集内)+ 流动性归一 + 外部加分 → 评分
  const rs = enriched.map((c) => c.rsRaw).sort((a, b) => a - b)
  const rsRank = (v: number) => (rs.length <= 1 ? 1 : rs.filter((x) => x <= v).length / rs.length)
  for (const c of enriched) {
    const liq01 = clamp01(Math.log10(Math.max(c.liqAmount, 1) / C.LIQUIDITY_MIN) / 2)
    c.score = finalScore(c, rsRank(c.rsRaw), liq01, C, { lhb01: c.lhbInst?.score, board01: c.board?.score })
  }

  const strip = ({ liqAmount: _liq, ...rest }: ScreenerCandidate & { liqAmount: number }) => rest
  const breakout = enriched
    .filter((c) => c.group === 'breakout')
    .sort((a, b) => b.score - a.score)
    .map(strip)
  const trigger = enriched
    .filter((c) => c.group === 'trigger')
    .sort((a, b) => b.score - a.score)
    .map(strip)

  const result: ScreenerResult = {
    asof,
    regime,
    breakout,
    trigger,
    pullback,
    scanned: nhSurvivors.length,
    scannedPullback: pbSurvivors.length,
    universe,
    truncated,
  }

  // 完成日志:取K线成功率(fetched/union 偏低=数据源不健康,真·卡顿信号)+ 命中数 + 耗时。
  console.log(
    `[Screener] 完成:取K线 ${stats.fetched}/${union.length} 成功 → 命中 突破 ${breakout.length} / 扳机 ${trigger.length} / 回调 ${pullback.length},耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )

  // 按日落盘(无DB也可回看);失败不影响返回
  try {
    mkdirSync(SCREENER_DIR, { recursive: true })
    writeFileSync(join(SCREENER_DIR, `${asof}.json`), JSON.stringify(result, null, 2))
  } catch (err) {
    console.warn('[Screener] 存档失败(非致命):', err)
  }

  return result
}

const screenerCache = createCache<ScreenerResult>({
  name: 'Screener',
  ttl: sessionTtl(120_000, 30 * 60_000),
  fetcher: fetchScreenerFresh,
})

export function fetchScreener(): Promise<ScreenerResult> {
  return screenerCache.get()
}

export function clearScreenerCache(): void {
  screenerCache.clear()
}
