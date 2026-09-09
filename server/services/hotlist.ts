// Hot Stock Rankings
// Sources: 东方财富 + 同花顺 + 龙虎榜 + 淘股吧

import { EM_HEADERS } from '../lib/emHeaders'
import { emFetch } from '../lib/emFetch'
import { createCache, sessionTtl } from '../lib/cache'
import { createComponentQuality, type DataComponentQuality } from '../market-data/dataQuality'
import { fetchThsWebHotList, type ThsWebHotListResult } from '../market-data/providers/ths/web'
import { fetchDragonTiger as fetchCanonicalDragonTiger } from './moneyflow'

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
  sourceStatus: {
    eastmoney: DataComponentQuality
    ths: DataComponentQuality
    dragonTiger: DataComponentQuality
  }
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
      throw new Error(`EastMoney HTTP ${res.status}`)
    }
    const json = await res.json() as any
    if (!json.data?.length) {
      console.warn('[HotList] EastMoney step1 returned no data')
      throw new Error('EastMoney payload contained no ranking data')
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
    throw err
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

// ── 龙虎榜 ─────────────────────────────────────────────

async function fetchDragonTiger(): Promise<DragonTigerStock[]> {
  try {
    const result = await fetchCanonicalDragonTiger(undefined, 1)
    return [...result.buy.slice(0, 5), ...result.sell.slice(0, 5)].map((d) => ({
      code: d.code,
      name: d.name,
      changePct: d.changePct,
      reason: d.reason,
      buyAmt: d.buyAmt,
      sellAmt: d.sellAmt,
      netAmt: d.netAmt,
      explain: '',
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
    fetchThsWebHotList(),
    fetchDragonTiger(),
  ])

  const receivedAt = new Date().toISOString()
  const asOf = receivedAt.slice(0, 10)
  const failure = (result: PromiseSettledResult<unknown>, fallback: string) =>
    result.status === 'rejected'
      ? result.reason instanceof Error ? result.reason.message : String(result.reason)
      : fallback
  const sourceStatus = {
    eastmoney: eastmoney.status === 'fulfilled'
      ? createComponentQuality('eastmoney', { source: 'eastmoney', status: 'full', asOf, receivedAt })
      : createComponentQuality('eastmoney', {
        source: 'eastmoney', status: 'unavailable', asOf, receivedAt,
        warnings: [failure(eastmoney, 'EastMoney unavailable')],
        missingReasons: [failure(eastmoney, 'EastMoney unavailable')],
      }),
    ths: ths.status === 'fulfilled'
      ? createComponentQuality('ths', {
        source: ths.value.source,
        status: ths.value.status,
        providerAt: ths.value.providerAt,
        receivedAt: ths.value.receivedAt,
        asOf: null,
        ...(ths.value.status === 'empty' ? { warnings: ['THS returned a confirmed empty hourly hot list'] } : {}),
      })
      : createComponentQuality('ths', {
        source: 'ths', status: 'unavailable', asOf, receivedAt,
        warnings: [failure(ths, 'THS unavailable')],
        missingReasons: [failure(ths, 'THS unavailable')],
      }),
    dragonTiger: dragonTiger.status === 'fulfilled'
      ? createComponentQuality('dragonTiger', { source: 'dragon-tiger', status: 'full', asOf, receivedAt })
      : createComponentQuality('dragonTiger', {
        source: 'dragon-tiger', status: 'unavailable', asOf, receivedAt,
        warnings: [failure(dragonTiger, 'Dragon tiger unavailable')],
        missingReasons: [failure(dragonTiger, 'Dragon tiger unavailable')],
      }),
  }
  const emData = eastmoney.status === 'fulfilled' ? eastmoney.value : []
  const thsData: HotStock[] = ths.status === 'fulfilled' ? ths.value.data : []
  const dtData = dragonTiger.status === 'fulfilled' ? dragonTiger.value : []

  // All three failed (as distinct from three observed empty lists): retain the
  // cache's last-good response rather than replacing it with an empty success.
  if (eastmoney.status === 'rejected' && ths.status === 'rejected' && dragonTiger.status === 'rejected') {
    throw new Error('HotList: all upstream sources unavailable')
  }

  return { eastmoney: emData, ths: thsData, dragonTiger: dtData, sourceStatus }
}
