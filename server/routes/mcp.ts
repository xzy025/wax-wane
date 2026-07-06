// MCP-style data routes: A-share trends/quote/breadth/limit-pool/indices,
// stock kline/fundamentals/news, web search, news feed, macro, RAG, GraphRAG.
import { Router } from 'express'
import {
  fetchAShareData,
  fetchStockQuote,
  fetchIndexTrends,
  fetchStockKline,
  fetchStockFundamentals,
} from '../services/ashare'
import { searchWeb, searchStockNews } from '../services/webSearch'
import { fetchNewsFeed } from '../services/news'
import { fetchMacroData } from '../services/macro'
import { searchSimilar, getDocumentCount } from '../rag/vectorStore'
import { hybridSearch } from '../rag/hybridSearch'
import { syncTradeGroups, resetAndSyncAll } from '../rag/ragSync'
import { tracer } from '../observability/tracer'

const router = Router()

// ── A-share market data ──────────────────────────────────

router.get('/api/mcp/ashare/trends', async (req, res) => {
  const code = req.query.code as string | undefined
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'Missing or invalid ?code= (6-digit stock/index code)' })
    return
  }
  try {
    const data = await fetchIndexTrends(code)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.get('/api/mcp/ashare/quote', async (req, res) => {
  const code = req.query.code as string | undefined
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'Missing or invalid ?code= (6-digit stock code)' })
    return
  }
  try {
    const quote = await fetchStockQuote(code)
    if (!quote) {
      res.status(404).json({ error: `Stock ${code} not found` })
      return
    }
    res.json(quote)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Stock K-line history
router.get('/api/stock/kline', async (req, res) => {
  const code = req.query.code as string | undefined
  const period = parseInt(req.query.period as string) || 101
  const count = parseInt(req.query.count as string) || 30
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'Missing or invalid ?code= (6-digit stock code)' })
    return
  }
  try {
    const data = await fetchStockKline(code, period, count)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Stock fundamentals
router.get('/api/stock/fundamentals', async (req, res) => {
  const code = req.query.code as string | undefined
  if (!code || !/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'Missing or invalid ?code= (6-digit stock code)' })
    return
  }
  try {
    const data = await fetchStockFundamentals(code)
    if (!data) {
      res.status(404).json({ error: `Stock ${code} not found` })
      return
    }
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Stock news search
router.get('/api/stock/news', async (req, res) => {
  const code = req.query.code as string | undefined
  const count = parseInt(req.query.count as string) || 10
  if (!code) {
    res.status(400).json({ error: 'Missing ?code= parameter' })
    return
  }
  try {
    const data = await searchStockNews(code, count)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Web search proxy
router.get('/api/web/search', async (req, res) => {
  const query = req.query.q as string | undefined
  const count = parseInt(req.query.count as string) || 5
  if (!query) {
    res.status(400).json({ error: 'Missing ?q= parameter' })
    return
  }
  try {
    const data = await searchWeb(query, count)
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.get('/api/mcp/ashare/breadth', async (_req, res) => {
  try {
    const data = await fetchAShareData()
    res.json({
      advance: data.advance,
      decline: data.decline,
      flat: data.flat,
      limitUpCount: data.limitUpCount,
      limitDownCount: data.limitDownCount,
      promotionRate: data.promotionRate,
      promotedCount: data.promotedCount,
      promotionTotal: data.promotionTotal,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.get('/api/mcp/ashare/limit-pool', async (req, res) => {
  const direction = (req.query.direction as string) ?? 'up'
  if (direction !== 'up' && direction !== 'down') {
    res.status(400).json({ error: '?direction= must be "up" or "down"' })
    return
  }
  try {
    const data = await fetchAShareData()
    const stocks = direction === 'up' ? data.limitUpStocks : data.limitDownStocks
    const count = direction === 'up' ? data.limitUpCount : data.limitDownCount
    res.json({ count, stocks })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.get('/api/mcp/ashare/indices', async (_req, res) => {
  try {
    const data = await fetchAShareData()
    res.json(data.indices)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── News (RSS) ──────────────────────────────────────────

router.get('/api/mcp/news/summary', async (_req, res) => {
  try {
    const items = await fetchNewsFeed()
    res.json(items)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── Macro data ───────────────────────────────────────────

router.get('/api/mcp/macro/indicators', async (_req, res) => {
  try {
    const data = await fetchMacroData()
    res.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── RAG (Vector Search) ─────────────────────────────────

router.get('/api/mcp/rag/status', async (_req, res) => {
  try {
    const count = await getDocumentCount()
    res.json({ status: 'ok', documentCount: count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.get('/api/mcp/rag/search', async (req, res) => {
  const { query, type, topK } = req.query
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'Missing ?query= parameter' })
    return
  }
  try {
    const k = topK ? parseInt(topK as string, 10) : 5
    const results = await searchSimilar(query, k, type as string)
    res.json(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// Hybrid retrieval: dense + BM25 + RRF (+ optional rerank). See rag/hybridSearch.ts.
router.get('/api/mcp/rag/hybrid-search', async (req, res) => {
  const { query, type, topK, rerank } = req.query
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'Missing ?query= parameter' })
    return
  }
  try {
    const k = topK ? parseInt(topK as string, 10) : 5
    const result = await hybridSearch(query, {
      topK: k,
      type: type as string | undefined,
      useRerank: rerank === '1' || rerank === 'true',
    })
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/mcp/rag/sync', async (req, res) => {
  const { tradeGroups, reviewNotes, reset } = req.body
  if (!tradeGroups || !Array.isArray(tradeGroups)) {
    res.status(400).json({ error: 'Missing tradeGroups array in body' })
    return
  }
  try {
    const result = reset
      ? await resetAndSyncAll(tradeGroups, reviewNotes || {})
      : await syncTradeGroups(tradeGroups, reviewNotes || {})
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── GraphRAG ──────────────────────────────────────────────

router.post('/api/mcp/graph/sync', async (req, res) => {
  const { tradeGroups, reviewNotes } = req.body
  if (!tradeGroups || !Array.isArray(tradeGroups)) {
    res.status(400).json({ error: 'Missing tradeGroups array in body' })
    return
  }
  try {
    const { fullGraphSync } = await import('../graph/graphSync')
    const result = await fullGraphSync(tradeGroups, reviewNotes || {})
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.get('/api/mcp/graph/stats', async (_req, res) => {
  try {
    const { getGraphStats } = await import('../graph/graphSchema')
    const stats = await getGraphStats()
    res.json(stats)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/mcp/graph/query', async (req, res) => {
  const { queryType, params } = req.body
  try {
    const graphQuery = await import('../graph/graphQuery')
    let result: unknown

    switch (queryType) {
      case 'findTradesByMistake':
        result = await graphQuery.findTradesByMistake(params.mistake)
        break
      case 'findTradesByPhase':
        result = await graphQuery.findTradesByPhase(params.phaseType, params.phaseValue)
        break
      case 'findRelatedTrades':
        result = await graphQuery.findRelatedTrades(params.tradeGroupId, params.relationTypes)
        break
      case 'findPatternPath':
        result = await graphQuery.findPatternPath(params.mistake)
        break
      case 'multiHop':
        result = await graphQuery.multiHopQuery(params.startType, params.startFilter, params.hops)
        break
      default:
        res.status(400).json({ error: `Unknown query type: ${queryType}` })
        return
    }

    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── Observability (RAG/agent traces) ──────────────────────

router.get('/api/mcp/obs/traces', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20
  res.json(tracer.getRecentTraces(limit))
})

router.get('/api/mcp/obs/stats', (_req, res) => {
  res.json(tracer.getStats())
})

router.get('/api/mcp/obs/traces/:id', (req, res) => {
  const trace = tracer.getTrace(req.params.id)
  if (!trace) {
    res.status(404).json({ error: `Trace ${req.params.id} not found` })
    return
  }
  res.json(trace)
})

export default router
