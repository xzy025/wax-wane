import { Router } from 'express'
import {
  fetchLimitLadderAnalysis,
  importLimitLadder,
} from '../services/limitLadder'
import { fetchKplLimitReason } from '../services/kaipanlaLadder'

const router = Router()

router.get('/api/ladder/analysis', async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : undefined
  try {
    res.json(await fetchLimitLadderAnalysis(date))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.startsWith('未找到') ? 404 : message.includes('必须') ? 400 : 500
    res.status(status).json({ error: message })
  }
})

router.post('/api/ladder/import', async (req, res) => {
  try {
    res.json(await importLimitLadder(req.body))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(400).json({ error: message })
  }
})

router.get('/api/ladder/reason', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const date = typeof req.query.date === 'string' ? req.query.date : undefined
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'code 必须是6位股票代码' })
    return
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date 必须是 YYYY-MM-DD' })
    return
  }
  try {
    res.json({ detail: await fetchKplLimitReason(code, date) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(502).json({ error: message })
  }
})

export default router
