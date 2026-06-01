import { useState, useCallback, useRef, useEffect } from 'react'
import { todayStr, getDay, saveDay } from '../utils/marketHistory'

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
  taoguba: HotStock[]
  dragonTiger: DragonTigerStock[]
}

export interface HotListResult {
  data: HotListData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

function getMockData(): HotListData {
  return {
    eastmoney: [
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
    ],
    ths: [
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
    ],
    taoguba: [
      { rank: 1, code: '603890', name: '春秋电子', changePct: 10.02, tags: ['AI PC'], popularityTag: '龙头' },
      { rank: 2, code: '600863', name: '华能蒙电', changePct: 9.94, tags: ['电力'], popularityTag: '5天3板' },
      { rank: 3, code: '000767', name: '晋控电力', changePct: 9.99, tags: ['电力'], popularityTag: '跟风' },
      { rank: 4, code: '600726', name: '华电能源', changePct: 9.99, tags: ['电力'], popularityTag: '5天5板' },
      { rank: 5, code: '600011', name: '华能国际', changePct: 10.05, tags: ['电力'], popularityTag: '首板' },
      { rank: 6, code: '603629', name: '利通电子', changePct: 9.41, tags: ['算力'], popularityTag: '连板' },
      { rank: 7, code: '002185', name: '华天科技', changePct: 3.52, tags: ['封装'], popularityTag: '趋势' },
      { rank: 8, code: '000636', name: '风华高科', changePct: 2.88, tags: ['被动元件'], popularityTag: '趋势' },
      { rank: 9, code: '601991', name: '大唐发电', changePct: 7.88, tags: ['电力'], popularityTag: '跟风' },
      { rank: 10, code: '600110', name: '诺德股份', changePct: 9.99, tags: ['铜箔'], popularityTag: '首板' },
    ],
    dragonTiger: [
      { code: '603890', name: '春秋电子', changePct: 10.02, reason: '日涨幅偏离值达到7%的前五只证券', buyAmt: 125000000, sellAmt: 45000000, netAmt: 80000000, explain: '知名游资买入' },
      { code: '600863', name: '华能蒙电', changePct: 9.94, reason: '日涨幅偏离值达到7%的前五只证券', buyAmt: 98000000, sellAmt: 32000000, netAmt: 66000000, explain: '机构买入' },
      { code: '000767', name: '晋控电力', changePct: 9.99, reason: '日涨幅偏离值达到7%的前五只证券', buyAmt: 87000000, sellAmt: 28000000, netAmt: 59000000, explain: '游资接力' },
      { code: '600726', name: '华电能源', changePct: 9.99, reason: '连续三个交易日内，涨幅偏离值累计达到20%', buyAmt: 156000000, sellAmt: 78000000, netAmt: 78000000, explain: '知名游资买入' },
      { code: '600011', name: '华能国际', changePct: 10.05, reason: '日涨幅偏离值达到7%的前五只证券', buyAmt: 210000000, sellAmt: 120000000, netAmt: 90000000, explain: '机构买入' },
    ],
  }
}

export function useHotList(date: string = todayStr()): HotListResult {
  const isToday = date === todayStr()

  const cachedEntry = getDay(date)
  const cachedData = cachedEntry?.hotlist as HotListData | undefined
  const [data, setData] = useState<HotListData | null>(cachedData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    cachedData && cachedEntry ? new Date(cachedEntry.timestamp) : null,
  )
  const fetching = useRef(false)
  const dataRef = useRef(data)
  dataRef.current = data

  useEffect(() => {
    const entry = getDay(date)
    const cached = entry?.hotlist as HotListData | undefined

    if (cached && cached.eastmoney?.length > 0) {
      setData(cached)
      setLastUpdated(entry ? new Date(entry.timestamp) : null)
      setError(null)
      setLoading(false)
      return
    }

    if (!isToday) {
      const mock = getMockData()
      setData(mock)
      setLastUpdated(null)
      setError(null)
      setLoading(false)
      return
    }

    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/hotlist')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result: HotListData = await res.json()

        if (!result.eastmoney?.length && !result.ths?.length) {
          const mock = getMockData()
          setData(mock)
          saveDay(date, { hotlist: mock })
        } else {
          setData(result)
          saveDay(date, { hotlist: result })
        }
        setLastUpdated(new Date())
        setError(null)
      } catch {
        if (!dataRef.current) {
          const mock = getMockData()
          setData(mock)
          saveDay(date, { hotlist: mock })
        }
        setError('Failed to fetch hot list')
      } finally {
        setLoading(false)
        fetching.current = false
      }
    })()
  }, [date, isToday])

  const refresh = useCallback(async () => {
    if (!isToday || fetching.current) return
    fetching.current = true
    setLoading(true)
    try {
      const res = await fetch('/api/hotlist')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result: HotListData = await res.json()

      if (!result.eastmoney?.length && !result.ths?.length) {
        const mock = getMockData()
        setData(mock)
        saveDay(date, { hotlist: mock })
      } else {
        setData(result)
        saveDay(date, { hotlist: result })
      }
      setLastUpdated(new Date())
      setError(null)
    } catch {
      if (!dataRef.current) {
        const mock = getMockData()
        setData(mock)
      }
      setError('Failed to fetch hot list')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isToday])

  return { data, loading, error, lastUpdated, refresh }
}
