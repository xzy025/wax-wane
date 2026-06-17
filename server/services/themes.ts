// 板块对比数据：读注册表 → 批量取成分股实时行情 + 涨停池 + 海外龙头行情 → 回填 + 算 summary。
import { createCache, sessionTtl } from '../lib/cache'
import { fetchThemeQuotes, toSecids } from './emQuotes'
import { fetchAShareData } from './ashare'
import { THEMES, type PeerMarket } from '../config/themes'

export interface ThemeRow {
  code: string
  name: string
  label: string
  price: number
  changePct: number
  pe: number | null
  pb: number | null
  marketCap: number
  chg60: number | null
  chgYtd: number | null
  found: boolean
  limitUp: boolean // 今日是否涨停（命中涨停池）
  boards: number // 连板数（首板=1；不在池=0）
}

export interface ThemeSummary {
  count: number // 取到行情的成分数
  avgChangePct: number // 今日平均涨跌%
  upCount: number
  downCount: number
  leader: { name: string; code: string; changePct: number } | null // 领涨
  divergencePct: number // 内部分歧度 = 领涨涨幅 − 领跌涨幅
  limitUpCount: number // 涨停成分数
  maxBoards: number // 最高连板数（无涨停=0）
}

/** 海外可比龙头一行：只需名称+市场+价+涨跌（跨市场不取 PE/PB/市值）。 */
export interface PeerRow {
  market: PeerMarket
  code: string
  name: string
  nameEn: string
  label?: string
  price: number
  changePct: number
  found: boolean // 是否取到实时行情（false → 仅对照，前端价格显示「—」）
}

export interface ThemeBlock {
  id: string
  name: string
  nameEn: string
  blurb: string
  summary: ThemeSummary
  constituents: ThemeRow[]
  peers: PeerRow[]
}

const themesCache = createCache<ThemeBlock[]>({
  name: 'Themes',
  ttl: sessionTtl(60_000, 30 * 60_000),
  fetcher: fetchThemesFresh,
})

export function clearThemesCache() {
  themesCache.clear()
}

export function fetchThemes(): Promise<ThemeBlock[]> {
  return themesCache.get()
}

/** 板块 summary 计算（纯函数，无网络，便于单测）。 */
export function computeThemeSummary(rows: ThemeRow[]): ThemeSummary {
  const live = rows.filter((r) => r.found)
  const avgChangePct = live.length ? live.reduce((s, r) => s + r.changePct, 0) / live.length : 0
  const leader = live.length ? live.reduce((a, b) => (b.changePct > a.changePct ? b : a)) : null
  const divergencePct = live.length
    ? Math.max(...live.map((r) => r.changePct)) - Math.min(...live.map((r) => r.changePct))
    : 0

  return {
    count: live.length,
    avgChangePct,
    upCount: live.filter((r) => r.changePct > 0).length,
    downCount: live.filter((r) => r.changePct < 0).length,
    leader: leader ? { name: leader.name, code: leader.code, changePct: leader.changePct } : null,
    divergencePct,
    limitUpCount: rows.filter((r) => r.limitUp).length,
    maxBoards: rows.reduce((m, r) => Math.max(m, r.boards), 0),
  }
}

/**
 * 海外龙头 → 东财 secid（纯函数，便于单测）。市场由 config 显式给出，不做格式推断
 * （韩股 6 位代码会与 A 股深市格式冲突，必须靠 market 区分）。
 *   US → 105/106/107 三市场扇出（东财静默丢弃不存在的）
 *   HK → 116. + 5 位补零
 *   KR/JP/TW → 东财 push2/ulist 的 secid 前缀尚未确认，暂返回空 = 不取实时价（前端显示「—」）。
 *     一旦确认前缀，在此返回对应 secid 即可点亮，无需改其它代码。
 */
export function peerSecid(market: PeerMarket, code: string): string[] {
  const c = code.trim().toUpperCase()
  switch (market) {
    case 'US':
      return [`105.${c}`, `106.${c}`, `107.${c}`]
    case 'HK':
      return [`116.${c.padStart(5, '0')}`]
    case 'KR':
    case 'JP':
    case 'TW':
      return []
  }
}

/** 归一化代码用于行情回填匹配：纯数字去前导零，否则转大写。 */
function normCode(s: string): string {
  return /^\d+$/.test(s) ? String(Number(s)) : s.trim().toUpperCase()
}

async function fetchThemesFresh(): Promise<ThemeBlock[]> {
  // De-dupe codes across themes; one batch quote call serves everything.
  const allCodes = Array.from(new Set(THEMES.flatMap((t) => t.constituents.map((c) => c.code))))
  const secids = allCodes.flatMap(toSecids)
  // Overseas peers (US/HK reachable via EM; KR/JP/TW yield no secid → reference-only).
  const allPeers = THEMES.flatMap((t) => t.peers ?? [])
  const peerSecids = Array.from(new Set(allPeers.flatMap((p) => peerSecid(p.market, p.code))))

  // Constituent quotes, limit-up pool, and peer quotes run in parallel. Every fetch
  // is wrapped in .catch so a single upstream outage (e.g. EastMoney unreachable)
  // degrades that slice gracefully instead of 500-ing the whole 板块 tab.
  const [quotes, ashare, peerQuotes] = await Promise.all([
    fetchThemeQuotes(secids).catch((e) => {
      console.warn('[Themes] constituent quotes unavailable:', e)
      return []
    }),
    fetchAShareData().catch((e) => {
      console.warn('[Themes] limit pool unavailable:', e)
      return null
    }),
    peerSecids.length
      ? fetchThemeQuotes(peerSecids).catch((e) => {
          console.warn('[Themes] peer quotes unavailable:', e)
          return []
        })
      : Promise.resolve([]),
  ])
  const byCode = new Map(quotes.map((q) => [q.code, q]))
  // Limit-pool codes are bare 6-digit strings, same format as constituent codes.
  const limitMap = new Map((ashare?.limitUpStocks ?? []).map((s) => [s.code, s]))
  const peerByCode = new Map(peerQuotes.map((q) => [normCode(q.code), q]))

  return THEMES.map((theme) => {
    const constituents: ThemeRow[] = theme.constituents.map((c) => {
      const q = byCode.get(c.code)
      const lu = limitMap.get(c.code)
      return {
        code: c.code,
        name: q?.name || c.code,
        label: c.label,
        price: q?.price ?? 0,
        changePct: q?.changePct ?? 0,
        pe: q?.pe ?? null,
        pb: q?.pb ?? null,
        marketCap: q?.marketCap ?? 0,
        chg60: q?.chg60 ?? null,
        chgYtd: q?.chgYtd ?? null,
        found: !!q,
        limitUp: !!lu,
        boards: lu ? lu.consecutiveDays + 1 : 0,
      }
    })

    const peers: PeerRow[] = (theme.peers ?? []).map((p) => {
      const q = peerByCode.get(normCode(p.code))
      return {
        market: p.market,
        code: p.code,
        name: p.name,
        nameEn: p.nameEn,
        label: p.label,
        price: q?.price ?? 0,
        changePct: q?.changePct ?? 0,
        found: !!q,
      }
    })

    return {
      id: theme.id,
      name: theme.name,
      nameEn: theme.nameEn,
      blurb: theme.blurb,
      summary: computeThemeSummary(constituents),
      constituents,
      peers,
    }
  })
}
