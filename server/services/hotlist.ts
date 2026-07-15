// Hot Stock Rankings
// Sources: 东方财富 + 同花顺 + 龙虎榜 + 淘股吧

import { EM_HEADERS } from '../lib/emHeaders'
import { emFetch } from '../lib/emFetch'
import { createCache, sessionTtl } from '../lib/cache'

export interface HotStock {
  rank: number
  code: string
  name: string
  changePct: number | null
  tags: string[]
  popularityTag?: string
}

export interface DragonTigerStock {
  code: string
  name: string
  changePct: number
  reason: string
  buyAmt: number
  sellAmt: number
  netAmt: number
  explain: string
}

export interface HotListData {
  eastmoney: HotStock[]
  ths: HotStock[]
  dragonTiger: DragonTigerStock[]
}

const hotListCache = createCache<HotListData>({
  name: 'HotList',
  ttl: sessionTtl(60_000, 30 * 60_000),
  fetcher: fetchHotListFresh,
})

export function clearHotListCache() {
  hotListCache.clear()
}

// ── 东方财富 热搜榜 ─────────────────────────────────────

async function fetchEastMoneyHot(): Promise<HotStock[]> {
  try {
    // Step 1: Get hot stock codes
    const url = 'https://emappdata.eastmoney.com/stockrank/getAllCurrentList'
    const res = await emFetch(url, {
      method: 'POST',
      headers: { ...EM_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'appId01', globalId: '786e4c21-70dc-435a-93bb-38', pageNo: 1, pageSize: 10 }),
      timeoutMs: 5000,
    })
    if (!res.ok) {
      console.warn('[HotList] EastMoney step1 (getAllCurrentList) HTTP', res.status)
      return []
    }
    const json = await res.json() as any
    if (!json.data?.length) {
      console.warn('[HotList] EastMoney step1 returned no data')
      return []
    }

    // Step 1 gave us the real ranked codes. Enrich with name/change in step 2,
    // but isolate its failure: push2 is flaky in some environments, and a thrown
    // detail fetch must NOT discard the valid ranking from step 1.
    const secids = json.data.map((d: any) => {
      const code = d.sc?.replace(/^(sh|sz)/i, '') ?? ''
      const prefix = d.sc?.toUpperCase().startsWith('SZ') ? '0' : '1'
      return `${prefix}.${code}`
    }).join(',')

    const detailMap = await fetchEastMoneyDetail(secids)

    return json.data.map((d: any, i: number) => {
      const code = d.sc?.replace(/^(sh|sz)/i, '') ?? ''
      const detail = detailMap[code]
      return {
        rank: i + 1,
        code,
        name: detail?.f14 ?? code,
        changePct: detail?.f3 ?? null,
        tags: [],
      }
    })
  } catch (err) {
    console.warn('[HotList] EastMoney hot search failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/**
 * Fetch name/change details for a comma-separated secids list. Tries push2 then
 * the more reliable push2delay mirror. Always resolves to a (possibly empty) map
 * so the caller's ranking survives even when both hosts are unreachable.
 */
async function fetchEastMoneyDetail(secids: string): Promise<Record<string, any>> {
  const hosts = ['push2.eastmoney.com', 'push2delay.eastmoney.com']
  for (const host of hosts) {
    try {
      const url = `https://${host}/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f2,f3,f12,f14`
      const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 5000 })
      if (!res.ok) continue
      const json = await res.json() as any
      const diff = json.data?.diff ?? []
      if (!diff.length) continue
      const map: Record<string, any> = {}
      for (const d of diff) map[d.f12] = d
      return map
    } catch (err) {
      console.warn(`[HotList] detail fetch via ${host} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return {}
}

// ── 同花顺 热榜 ─────────────────────────────────────────

async function fetchTHSHot(): Promise<HotStock[]> {
  try {
    const url = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour&list_type=normal'
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.10jqka.com.cn/' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const json = await res.json() as any
    const list = json.data?.stock_list ?? json.data ?? []
    if (!Array.isArray(list)) return []
    return list.slice(0, 10).map((d: any, i: number) => ({
      rank: i + 1,
      code: d.code ?? '',
      name: d.name ?? '',
      changePct: d.rise_and_fall ?? null,
      tags: d.tag?.concept_tag ?? [],
      popularityTag: d.tag?.popularity_tag ?? undefined,
    }))
  } catch {
    return []
  }
}

// ── 龙虎榜 ─────────────────────────────────────────────

async function fetchDragonTiger(): Promise<DragonTigerStock[]> {
  try {
    const url = 'http://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=TRADE_DATE,SECURITY_CODE&sortTypes=-1,1&pageSize=10&pageNumber=1&reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=SECURITY_CODE,SECURITY_NAME_ABBR,CHANGE_RATE,EXPLANATION,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,BILLBOARD_NET_AMT,EXPLAIN&source=WEB&client=WEB'

    const res = await emFetch(url, {
      headers: EM_HEADERS,
      timeoutMs: 5000,
    })

    if (!res.ok) return []
    const json = await res.json() as any
    if (!json.result?.data) return []

    return json.result.data.slice(0, 10).map((d: any) => ({
      code: d.SECURITY_CODE,
      name: d.SECURITY_NAME_ABBR,
      changePct: d.CHANGE_RATE ?? 0,
      reason: d.EXPLANATION ?? '',
      buyAmt: d.BILLBOARD_BUY_AMT ?? 0,
      sellAmt: d.BILLBOARD_SELL_AMT ?? 0,
      netAmt: d.BILLBOARD_NET_AMT ?? 0,
      explain: d.EXPLAIN ?? '',
    }))
  } catch {
    return []
  }
}

// ── Main export ─────────────────────────────────────────

export async function fetchHotList(): Promise<HotListData> {
  return hotListCache.get()
}

async function fetchHotListFresh(): Promise<HotListData> {
  console.log('[HotList] Fetching hot stock rankings...')

  const [eastmoney, ths, dragonTiger] = await Promise.allSettled([
    fetchEastMoneyHot(),
    fetchTHSHot(),
    fetchDragonTiger(),
  ])

  const emData = eastmoney.status === 'fulfilled' ? eastmoney.value : []
  const thsData = ths.status === 'fulfilled' ? ths.value : []
  const dtData = dragonTiger.status === 'fulfilled' ? dragonTiger.value : []

  // 三源全空 = 上游全挂。必须 throw 走 createCache 的 serve-stale,而不是
  // 编造 mock 顶替——假龙虎榜金额会被 dailyReview 当真数据写进复盘存档。
  // 部分成功照常返回,空的源由前端各自渲染空态。
  if (emData.length === 0 && thsData.length === 0 && dtData.length === 0) {
    throw new Error('HotList: all upstream sources returned empty')
  }

  return { eastmoney: emData, ths: thsData, dragonTiger: dtData }
}
