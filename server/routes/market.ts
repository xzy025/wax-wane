// Market data routes: cache refresh + A-share/HK/US/hotlist quotes.
import { Router } from 'express'
import { fetchAShareData, clearAShareCache } from '../ashare'
import { fetchHKData, clearHKCache, fetchHKStockQuotes } from '../hk'
import { fetchUSData, clearUSCache, fetchUSStockQuotes } from '../us'
import { fetchHotList, clearHotListCache } from '../hotlist'
import { clearMacroCache } from '../macro'

const router = Router()

// Clear market data caches (for refresh button).
// Pass ?market=ashare|hk|us|hotlist|macro to clear just one market so
// refreshing a single banner doesn't cold-start every upstream fetcher.
const cacheClearers: Record<string, () => void> = {
  ashare: clearAShareCache,
  hk: clearHKCache,
  us: clearUSCache,
  hotlist: clearHotListCache,
  macro: clearMacroCache,
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

export default router
