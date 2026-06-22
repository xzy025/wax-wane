// Market data routes: cache refresh + A-share/HK/US/hotlist quotes.
import { Router } from 'express'
import { fetchAShareData, clearAShareCache, fetchHighs, clearHighsCache } from '../services/ashare'
import { fetchHKData, clearHKCache, fetchHKStockQuotes } from '../services/hk'
import { fetchUSData, clearUSCache, fetchUSStockQuotes } from '../services/us'
import { fetchHotList, clearHotListCache } from '../services/hotlist'
import { fetchSentiment, clearSentimentCache } from '../services/kaipanla'
import { clearMacroCache } from '../services/macro'
import { clearThemesCache } from '../services/themes'
import { clearScreenerCache } from '../services/screener'
import { fetchDragonTiger, fetchTradingDates, clearMoneyFlowCache } from '../services/moneyflow'

const router = Router()

// Clear market data caches (for refresh button).
// Pass ?market=ashare|hk|us|hotlist|macro to clear just one market so
// refreshing a single banner doesn't cold-start every upstream fetcher.
const cacheClearers: Record<string, () => void> = {
  ashare: clearAShareCache,
  highs: clearHighsCache,
  hk: clearHKCache,
  us: clearUSCache,
  hotlist: clearHotListCache,
  sentiment: clearSentimentCache,
  macro: clearMacroCache,
  themes: clearThemesCache,
  moneyflow: clearMoneyFlowCache,
  screener: clearScreenerCache,
}

router.post('/api/refresh', (req, res) => {
  const market = req.query.market as string | undefined
  if (market && cacheClearers[market]) {
    cacheClearers[market]()
  } else {
    for (const clear of Object.values(cacheClearers)) clear()
  }
  res.json({ ok: true })
})

// A-share market data
router.get('/api/ashare', async (_req, res) => {
  try {
    const data = await fetchAShareData()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Hong Kong market data
router.get('/api/hk', async (_req, res) => {
  try {
    const data = await fetchHKData()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// HK individual stock quotes
router.get('/api/hk/quote', async (req, res) => {
  const codes = (req.query.codes as string)?.split(',').filter(Boolean) ?? []
  if (codes.length === 0) {
    res.json({ quotes: [] })
    return
  }
  try {
    const quotes = await fetchHKStockQuotes(codes)
    res.json({ quotes })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// US market data
router.get('/api/us', async (_req, res) => {
  try {
    const data = await fetchUSData()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// US individual stock quotes
router.get('/api/us/quote', async (req, res) => {
  const codes = (req.query.codes as string)?.split(',').filter(Boolean) ?? []
  if (codes.length === 0) {
    res.json({ quotes: [] })
    return
  }
  try {
    const quotes = await fetchUSStockQuotes(codes)
    res.json({ quotes })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Hot stock rankings
router.get('/api/hotlist', async (_req, res) => {
  try {
    const data = await fetchHotList()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// 龙虎榜：净买入/卖出个股 + 主要营业部 + 概念标签。
//   ?date=YYYY-MM-DD 可选（缺省=最近交易日）；?window=1|3|5（当日/3日/5日，缺省 1）。
router.get('/api/moneyflow', async (req, res) => {
  const date = (req.query.date as string | undefined)?.trim() || undefined
  const window = Number(req.query.window) || 1
  try {
    const data = await fetchDragonTiger(date, window)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// 最近交易日列表（供前端日历屏蔽非交易日）。
router.get('/api/moneyflow/dates', async (_req, res) => {
  try {
    const dates = await fetchTradingDates()
    res.json({ dates })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Prior-high / 52-week-high analysis (expensive kline scan — separate endpoint)
router.get('/api/highs', async (_req, res) => {
  try {
    const data = await fetchHighs()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Market sentiment thermometer (开盘啦)
router.get('/api/sentiment', async (_req, res) => {
  try {
    const data = await fetchSentiment()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
