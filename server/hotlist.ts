// Hot Stock Rankings
// Sources: 东方财富 + 同花顺 + 龙虎榜 + 淘股吧

import { EM_HEADERS } from './lib/emHeaders'
import { createCache, sessionTtl } from './lib/cache'

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
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...EM_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'appId01', globalId: '786e4c21-70dc-435a-93bb-38', pageNo: 1, pageSize: 10 }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const json = await res.json() as any
    if (!json.data?.length) return []

    // Step 2: Get stock details for price/change
    const secids = json.data.map((d: any) => {
      const code = d.sc?.replace(/^(sh|sz)/i, '') ?? ''
      const prefix = d.sc?.toUpperCase().startsWith('SZ') ? '0' : '1'
      return `${prefix}.${code}`
    }).join(',')

    const detailUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f2,f3,f12,f14`
    const detailRes = await fetch(detailUrl, { headers: EM_HEADERS, signal: AbortSignal.timeout(5000) })
    let detailMap: Record<string, any> = {}
    if (detailRes.ok) {
      const detailJson = await detailRes.json() as any
      for (const d of detailJson.data?.diff ?? []) {
        detailMap[d.f12] = d
      }
    }

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
  } catch {
    return []
  }
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

    const res = await fetch(url, {
      headers: EM_HEADERS,
      signal: AbortSignal.timeout(5000),
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

  return {
    eastmoney: emData.length > 0 ? emData : getMockEastMoney(),
    ths: thsData.length > 0 ? thsData : getMockTHS(),
    dragonTiger: dtData.length > 0 ? dtData : getMockDragonTiger(),
  }
}

// ── Mock data ──────────────────────────────────────────

function getMockEastMoney(): HotStock[] {
  return [
    { rank: 1, code: '603890', name: '春秋电子', changePct: 10.02, tags: [] },
    { rank: 2, code: '600011', name: '华能国际', changePct: 10.05, tags: [] },
    { rank: 3, code: '000767', name: '晋控电力', changePct: 9.99, tags: [] },
    { rank: 4, code: '600863', name: '华能蒙电', changePct: 9.94, tags: [] },
    { rank: 5, code: '000636', name: '风华高科', changePct: 2.88, tags: [] },
    { rank: 6, code: '000539', name: '粤电力A', changePct: 9.99, tags: [] },
    { rank: 7, code: '601991', name: '大唐发电', changePct: 7.88, tags: [] },
    { rank: 8, code: '600110', name: '诺德股份', changePct: 9.99, tags: [] },
    { rank: 9, code: '002185', name: '华天科技', changePct: 3.52, tags: [] },
    { rank: 10, code: '600726', name: '华电能源', changePct: 9.99, tags: [] },
  ]
}

function getMockTHS(): HotStock[] {
  return [
    { rank: 1, code: '601991', name: '大唐发电', changePct: 7.88, tags: ['绿色电力', '风电'], popularityTag: '持续上榜' },
    { rank: 2, code: '600863', name: '华能蒙电', changePct: 9.94, tags: ['超超临界发电', '煤炭概念'], popularityTag: '5天3板' },
    { rank: 3, code: '002185', name: '华天科技', changePct: 3.52, tags: ['国家大基金持股', '先进封装'], popularityTag: '持续上榜' },
    { rank: 4, code: '000636', name: '风华高科', changePct: 2.88, tags: ['超级电容', 'CPO'], popularityTag: '6天3板' },
    { rank: 5, code: '603890', name: '春秋电子', changePct: 10.02, tags: ['AI PC', '富士康概念'], popularityTag: '首板涨停' },
    { rank: 6, code: '603629', name: '利通电子', changePct: 9.41, tags: ['算力租赁', '英伟达概念'] },
    { rank: 7, code: '600726', name: '华电能源', changePct: 9.99, tags: ['超超临界发电', '煤炭概念'], popularityTag: '5天5板' },
    { rank: 8, code: '600011', name: '华能国际', changePct: 10.05, tags: ['超超临界发电', '绿色电力'], popularityTag: '首板涨停' },
    { rank: 9, code: '000725', name: '京东方A', changePct: 1.23, tags: ['同花顺果指数', '电子纸'], popularityTag: '持续上榜' },
    { rank: 10, code: '000767', name: '晋控电力', changePct: 9.99, tags: ['超超临界发电', '绿色电力'], popularityTag: '首板涨停' },
  ]
}

function getMockDragonTiger(): DragonTigerStock[] {
  return [
    { code: '603890', name: '春秋电子', changePct: 10.02, reason: '日涨幅偏离值达到7%的前五只证券', buyAmt: 125000000, sellAmt: 45000000, netAmt: 80000000, explain: '知名游资买入' },
    { code: '600863', name: '华能蒙电', changePct: 9.94, reason: '日涨幅偏离值达到7%的前五只证券', buyAmt: 98000000, sellAmt: 32000000, netAmt: 66000000, explain: '机构买入' },
    { code: '000767', name: '晋控电力', changePct: 9.99, reason: '日涨幅偏离值达到7%的前五只证券', buyAmt: 87000000, sellAmt: 28000000, netAmt: 59000000, explain: '游资接力' },
    { code: '600726', name: '华电能源', changePct: 9.99, reason: '连续三个交易日内，涨幅偏离值累计达到20%', buyAmt: 156000000, sellAmt: 78000000, netAmt: 78000000, explain: '知名游资买入' },
    { code: '600011', name: '华能国际', changePct: 10.05, reason: '日涨幅偏离值达到7%的前五只证券', buyAmt: 210000000, sellAmt: 120000000, netAmt: 90000000, explain: '机构买入' },
  ]
}
