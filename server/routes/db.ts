// Database routes: trades, trade groups, review notes, import batches.
import { Router } from 'express'
import {
  insertImportBatch,
  insertTrade,
  getTrades,
  insertTradeGroup,
  getTradeGroups,
  upsertReviewNote,
  getReviewNote,
} from '../pgDatabase'

const router = Router()

router.get('/api/db/trades', async (req, res) => {
  try {
    const { stock_code, start_date, end_date, side, limit } = req.query
    const trades = await getTrades({
      stock_code: stock_code as string,
      start_date: start_date as string,
      end_date: end_date as string,
      side: side as 'buy' | 'sell',
      limit: limit ? parseInt(limit as string, 10) : undefined,
    })
    res.json(trades)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/db/trades', async (req, res) => {
  try {
    await insertTrade(req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.get('/api/db/trade-groups', async (req, res) => {
  try {
    const { status, stock_code } = req.query
    const groups = await getTradeGroups({
      status: status as 'open' | 'closed',
      stock_code: stock_code as string,
    })
    res.json(groups)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/db/trade-groups', async (req, res) => {
  try {
    await insertTradeGroup(req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.get('/api/db/review-notes/:groupId', async (req, res) => {
  try {
    const note = await getReviewNote(req.params.groupId)
    res.json(note)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.put('/api/db/review-notes/:groupId', async (req, res) => {
  try {
    await upsertReviewNote({ trade_group_id: req.params.groupId, ...req.body })
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/db/import-batches', async (req, res) => {
  try {
    await insertImportBatch(req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
