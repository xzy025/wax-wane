import { useState, useCallback, useRef, useEffect } from 'react'
import { todayStr, getDay, saveDay } from '../utils/marketHistory'

export interface IndexQuote {
  code: string
  name: string
  price: number
  changePct: number
  changeAmt: number
  volume: number
  turnover: number
  high: number
  low: number
  open: number
  prevClose: number
}

export interface NewHighStock {
  code: string
  name: string
  price: number
  changePct: number
}

export interface AShareData {
  indices: IndexQuote[]
  limitUpCount: number
  limitDownCount: number
  advance: number
  decline: number
  flat: number
  promotionRate: number
  promotedCount: number
  promotionTotal: number
  newHighCount: number
  newHighStocks: NewHighStock[]
}

export interface AShareResult {
  data: AShareData | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  refresh: () => void
}

// ── Profitability score ────────────────────────────────────

export function calcProfitabilityScore(
  limitUp: number,
  limitDown: number,
  advance: number,
  decline: number,
): number {
  const limitRatio = limitUp / Math.max(limitDown, 1)
  const adRatio = advance / Math.max(decline, 1)
  const cappedLimit = Math.min(limitRatio, 5)
  const cappedAD = Math.min(adRatio, 5)
  const limitBonus = Math.min(limitUp, 100) / 100
  return Math.round((cappedLimit / 5) * 40 + (cappedAD / 5) * 40 + limitBonus * 20)
}

// ── Mock data ──────────────────────────────────────────────

function getMockData(): AShareData {
  return {
    indices: [
      {
        code: '000001',
        name: '上证指数',
        price: 3350.59,
        changePct: -0.31,
        changeAmt: -10.58,
        volume: 2938192,
        turnover: 358628340000,
        high: 3365.2,
        low: 3340.1,
        open: 3355.0,
        prevClose: 3361.17,
      },
      {
        code: '399001',
        name: '深证成指',
        price: 11121.95,
        changePct: -0.39,
        changeAmt: -43.44,
        volume: 4291266,
        turnover: 502516180000,
        high: 11200.0,
        low: 11080.0,
        open: 11180.0,
        prevClose: 11165.39,
      },
      {
        code: '399006',
        name: '创业板指',
        price: 2175.66,
        changePct: 0.12,
        changeAmt: 2.61,
        volume: 1823456,
        turnover: 210000000000,
        high: 2185.0,
        low: 2165.0,
        open: 2170.0,
        prevClose: 2173.05,
      },
    ],
    limitUpCount: 65,
    limitDownCount: 12,
    advance: 2800,
    decline: 2100,
    flat: 300,
    promotionRate: 35,
    promotedCount: 21,
    promotionTotal: 60,
    newHighCount: 3,
    newHighStocks: [
      { code: '300196', name: '长海股份', price: 23.92, changePct: 3.55 },
      { code: '688001', name: '华兴源创', price: 82.55, changePct: 2.18 },
      { code: '688110', name: '东芯股份', price: 166.6, changePct: 5.02 },
    ],
  }
}

// ── Hook ───────────────────────────────────────────────────

export function useAShareData(date: string = todayStr()): AShareResult {
  const isToday = date === todayStr()

  // Initialize from history if viewing a past date
  const initial = !isToday ? ((getDay(date)?.ashare as AShareData | undefined) ?? null) : null
  const [data, setData] = useState<AShareData | null>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    !isToday && !initial ? 'No data for this date' : null,
  )
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    !isToday && initial ? new Date(getDay(date)?.timestamp ?? Date.now()) : null,
  )
  const fetching = useRef(false)
  const dataRef = useRef(data)
  dataRef.current = data

  // When date changes, load from history or fetch
  useEffect(() => {
    if (!isToday) {
      const entry = getDay(date)
      const historical = entry?.ashare as AShareData | undefined
      setData(historical ?? null)
      setLastUpdated(historical && entry ? new Date(entry.timestamp) : null)
      setError(historical ? null : 'No data for this date')
      setLoading(false)
      return
    }

    // Today: fetch fresh data
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/ashare')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result: AShareData = await res.json()

        if (!result.indices || result.indices.length === 0) {
          const mock = getMockData()
          setData(mock)
          saveDay(date, { ashare: mock })
        } else {
          setData(result)
          saveDay(date, { ashare: result })
        }
        setLastUpdated(new Date())
        setError(null)
      } catch {
        if (!dataRef.current) {
          const mock = getMockData()
          setData(mock)
        }
        setError('Failed to fetch A-share data')
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
      const res = await fetch('/api/ashare')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result: AShareData = await res.json()

      if (!result.indices || result.indices.length === 0) {
        const mock = getMockData()
        setData(mock)
        saveDay(date, { ashare: mock })
      } else {
        setData(result)
        saveDay(date, { ashare: result })
      }
      setLastUpdated(new Date())
      setError(null)
    } catch {
      if (!dataRef.current) {
        const mock = getMockData()
        setData(mock)
      }
      setError('Failed to fetch A-share data')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [date, isToday])

  return { data, loading, error, lastUpdated, refresh }
}
