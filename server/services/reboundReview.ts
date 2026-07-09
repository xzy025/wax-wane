// 反攻日复盘卡装配层:检测「连跌数日后放量大阳反攻」并列出两类先锋 + 券商板块佐证。
// 挂 dailyReview 的 reboundDay section(allSettled 单源失败该段消失,不拖垮整卡);
// 回测裁决(2026-07-10,见 REBOUND config 注记)=样本不足不接战法,本卡为最终形态,纯复盘不给买点。
//
// 降级矩阵:指数 kline 挂 → throw → 上层收敛 reboundDay:null(卡片整体不渲染);
// 涨停池走 Sina 兜底(fbt 全空) → fbtAvailable:false,名单照出、无时间轴;
// 涨幅榜/个股K线挂 → resilient:[];板块宇宙挂 → brokerage:null。
import { createCache, sessionTtl } from '../lib/cache'
import { EM_HEADERS } from '../lib/emHeaders'
import { todayShanghai } from '../lib/time'
import { fetchIndexKline, fetchAShareData, fetchStockKline, type LimitStock } from './ashare'
import { REBOUND, SCREENER, type ReboundConfig } from '../config/screener'
import {
  detectReversalDay,
  declineWindow,
  classifyReboundResilient,
  type ReversalSignal,
  type DeclineWindow,
} from './reboundRules'
import { type Bar } from './screenerRules'
import { fetchBoardUniverse, fetchBoardConstituents, rankTopMovers, type BoardMeta } from './rotation'

const CLOSED_TTL = 12 * 3_600_000 // 盘后长 TTL,同 structure/review
const IDX_BARS = 40 // 判据只要 DOWN_WINDOW+VOL_BASE_WIN+余量

/** 先锋(长电型):涨停池直通字段,按首次封板时间排时间轴。 */
export interface ReboundPioneer {
  code: string
  name: string
  changePct: number
  firstTime: string // HHMMSS 数字串;Sina 兜底池为空串
  lastTime: string
  openCount: number // 炸板次数
  consecutiveDays: number // 连板数(Sina 兜底=0)
  industry: string
  turnoverRate: number
  amount: number
}

/** 抗跌领涨(东山型):连跌窗累计相对强度证据 + 反攻日量价。 */
export interface ReboundResilient {
  code: string
  name: string
  changePct: number // 反攻日涨幅%
  volRatio: number // 反攻日量比(前 VOL_BASE_WIN 日均量)
  cumRelPct: number // 连跌窗累计相对强度(pp)
  counterTrendDays: number // 窗内逆势红盘天数
  stockChgPct: number // 窗内个股累计涨跌%
  indexChgPct: number // 窗内指数累计涨跌%
}

export interface ReboundSection {
  detected: boolean
  signal: ReversalSignal | null
  secondaryChgPct: number | null // 创业板指当日(佐证,不参与判据)
  window: DeclineWindow | null // 连跌窗(卡片标题「连跌N日 −x.x%」用)
  pioneers: ReboundPioneer[] // fbt 升序时间轴
  fbtAvailable: boolean // false=Sina 兜底池,无封板时间
  resilient: ReboundResilient[] // cumRelPct 降序
  brokerage: {
    code: string
    name: string
    todayChg: number
    topMovers: { code: string; name: string; changePct: number }[]
  } | null
}

const EMPTY: Omit<ReboundSection, 'detected'> = {
  signal: null,
  secondaryChgPct: null,
  window: null,
  pioneers: [],
  fbtAvailable: false,
  resilient: [],
  brokerage: null,
}

/** 先锋榜纯装配(可单测):剔除高位连板(连板>PIONEER_LB_MAX;Sina 兜底 lbc=0 不受影响),
 *  有 fbt 按封板时间升序(时间轴),无 fbt(兜底源)按 连板数降序、成交额降序。 */
export function buildPioneers(
  stocks: LimitStock[],
  C: ReboundConfig = REBOUND,
): { pioneers: ReboundPioneer[]; fbtAvailable: boolean } {
  const eligible = stocks.filter((s) => s.consecutiveDays <= C.PIONEER_LB_MAX)
  const fbtAvailable = eligible.some((s) => s.firstTime !== '' && s.firstTime !== '0')
  const sorted = [...eligible].sort((a, b) => {
    if (fbtAvailable) {
      const fa = a.firstTime ? a.firstTime.padStart(6, '0') : '999999'
      const fb = b.firstTime ? b.firstTime.padStart(6, '0') : '999999'
      if (fa !== fb) return fa.localeCompare(fb)
    } else if (a.consecutiveDays !== b.consecutiveDays) {
      return b.consecutiveDays - a.consecutiveDays
    }
    return b.amount - a.amount
  })
  return {
    pioneers: sorted.slice(0, C.PIONEER_MAX).map((s) => ({
      code: s.code,
      name: s.name,
      changePct: s.changePct,
      firstTime: s.firstTime,
      lastTime: s.lastTime,
      openCount: s.openCount,
      consecutiveDays: s.consecutiveDays,
      industry: s.industry,
      turnoverRate: s.turnoverRate,
      amount: s.amount,
    })),
    fbtAvailable,
  }
}

/** 券商板块定位纯函数(可单测):行业板块宇宙里按名字匹配「证券/券商」。 */
export function pickBrokerageBoard(boards: BoardMeta[]): BoardMeta | null {
  return boards.find((b) => b.name.includes('证券') || b.name.includes('券商')) ?? null
}

/** 有界并发(同 rotation 私有实现;3 行不值得抽公共库)。 */
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

const CLIST_HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '82.push2.eastmoney.com']

/** 全市场当日涨幅榜前 100(东山型候选池;fid=f3 降序一页足够,LEAD_CHG_MIN 会再砍一刀)。 */
async function fetchTopGainers(): Promise<{ code: string; name: string; changePct: number }[]> {
  for (const host of CLIST_HOSTS) {
    const url =
      `https://${host}/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3` +
      `&fs=${encodeURIComponent(SCREENER.CLIST_FS)}&fields=f12,f14,f3`
    try {
      const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`clist HTTP ${res.status}`)
      const json = (await res.json()) as any
      const diff = (json?.data?.diff ?? []) as Record<string, unknown>[]
      if (diff.length) {
        return diff
          .map((d) => ({
            code: String(d.f12 ?? ''),
            name: String(d.f14 ?? ''),
            changePct: Number(d.f3) || 0,
          }))
          .filter((x) => x.code && x.name)
      }
    } catch {
      /* 试下一个镜像 */
    }
  }
  return []
}

async function computeReboundSection(): Promise<ReboundSection> {
  // 判据指数挂 → throw,交给 dailyReview 的 allSettled 收敛为 null(该 section 消失,整卡照常)。
  const idxBars = await fetchIndexKline(REBOUND.INDEX_SECID, IDX_BARS)
  const signal = detectReversalDay(idxBars, REBOUND)
  // 严格「当日」语义:信号日必须=上海今日。涨停池/涨幅榜/板块都是实时"今天"的数据,
  // 若指数源尾根滞后(次日早盘 Sina 未含当日bar/周末),沿用旧信号会把昨日事件配上今日名单
  // ——跨日错配比漏展示更糟。反攻日当晚的完整区块由 review-<date>.json 归档持久保存。
  if (!signal || signal.date !== todayShanghai()) return { detected: false, ...EMPTY }
  const window = declineWindow(idxBars, REBOUND)

  // 副指数佐证(仅展示,挂了省略)
  let secondaryChgPct: number | null = null
  try {
    const sec = await fetchIndexKline(REBOUND.SECONDARY_SECID, 5)
    if (sec.length >= 2) {
      const [prev, last] = [sec[sec.length - 2], sec[sec.length - 1]]
      if (last.date === signal.date && prev.close > 0) {
        secondaryChgPct = Math.round(((last.close - prev.close) / prev.close) * 10000) / 100
      }
    }
  } catch {
    /* 佐证省略 */
  }

  // 先锋榜(长电型):涨停池 fbt 时间轴。fetchAShareData 自带缓存与 Sina 兜底。
  let pioneers: ReboundPioneer[] = []
  let fbtAvailable = false
  let limitCodes = new Set<string>()
  try {
    const ash = await fetchAShareData()
    limitCodes = new Set(ash.limitUpStocks.map((s) => s.code))
    const built = buildPioneers(ash.limitUpStocks, REBOUND)
    pioneers = built.pioneers
    fbtAvailable = built.fbtAvailable
  } catch {
    /* pioneers 留空,卡片显示提示行 */
  }

  // 抗跌领涨榜(东山型):涨幅榜候选 → 个股K线(腾讯兜底,不依赖 push2his)→ classifier 同回测口径。
  let resilient: ReboundResilient[] = []
  if (window) {
    try {
      const gainers = (await fetchTopGainers())
        .filter((g) => g.changePct >= REBOUND.LEAD_CHG_MIN && !limitCodes.has(g.code) && !g.name.includes('ST'))
        .slice(0, REBOUND.RESIL_CANDIDATES)
      const hits = await mapLimit(gainers, 10, async (g) => {
        try {
          const { klines } = await fetchStockKline(g.code, 101, REBOUND.DOWN_WINDOW + REBOUND.VOL_BASE_WIN + 20)
          if (!klines.length || klines[klines.length - 1].date !== signal.date) return null // 停牌/慢源错日剔除
          const hit = classifyReboundResilient(klines as Bar[], g.code, idxBars, window, REBOUND)
          if (!hit) return null
          return {
            code: g.code,
            name: g.name,
            changePct: hit.chgPct,
            volRatio: hit.volRatio,
            cumRelPct: hit.cumRelPct,
            counterTrendDays: hit.counterTrendDays,
            stockChgPct: hit.stockChgPct,
            indexChgPct: hit.indexChgPct,
          } satisfies ReboundResilient
        } catch {
          return null
        }
      })
      resilient = hits
        .filter((x): x is ReboundResilient => x != null)
        .sort((a, b) => b.cumRelPct - a.cumRelPct)
        .slice(0, REBOUND.RESIL_MAX)
    } catch {
      /* resilient 留空 */
    }
  }

  // 券商佐证(牛市旗手)
  let brokerage: ReboundSection['brokerage'] = null
  try {
    const board = pickBrokerageBoard(await fetchBoardUniverse('industry'))
    if (board) {
      const members = await fetchBoardConstituents(board.code)
      brokerage = {
        code: board.code,
        name: board.name,
        todayChg: board.todayChg,
        topMovers: rankTopMovers(members, 5).map(({ code, name, changePct }) => ({ code, name, changePct })),
      }
    }
  } catch {
    /* brokerage 省略 */
  }

  return { detected: true, signal, secondaryChgPct, window, pioneers, fbtAvailable, resilient, brokerage }
}

const reboundCache = createCache<ReboundSection>({
  name: 'ReboundDay',
  ttl: sessionTtl(120_000, CLOSED_TTL),
  fetcher: computeReboundSection,
})

export function fetchReboundSection(): Promise<ReboundSection> {
  return reboundCache.get()
}

export function clearReboundCache(): void {
  reboundCache.clear()
}
