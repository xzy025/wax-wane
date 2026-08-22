import { Router } from 'express'
import {
  fetchLimitLadderAnalysis,
  fetchLimitLadderNextDay,
  importLimitLadder,
} from '../services/limitLadder'
import { fetchKplLimitReason } from '../services/kaipanlaLadder'
import {
  buildAuctionBrief,
  enrichAuctionBriefWithOvernight,
  polishAuctionBrief,
  readAuctionBriefState,
  readAuctionBriefStateByTradeDate,
  sendServerChanTest,
  type AuctionBriefPhase,
} from '../services/auctionBrief'
import {
  type CrossMarketPhase,
} from '../services/crossMarketMapping'
import { resolveCrossMarketSnapshot } from '../services/crossMarketRuntime'
import { buildAuctionBehaviorResearch } from '../services/auctionBehaviorResearch'

const router = Router()

router.get('/api/ladder/cross-market', async (req, res) => {
  const tradeDate = typeof req.query.tradeDate === 'string' ? req.query.tradeDate : ''
  const phase = typeof req.query.phase === 'string' ? req.query.phase : 'premarket'
  const checkpoint = typeof req.query.checkpoint === 'string' ? req.query.checkpoint : undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    res.status(400).json({ error: 'tradeDate 必须是 YYYY-MM-DD' })
    return
  }
  if (phase !== 'premarket' && phase !== 'auction' && phase !== 'open') {
    res.status(400).json({ error: 'phase 必须是 premarket、auction 或 open' })
    return
  }
  try {
    const snapshot = await resolveCrossMarketSnapshot(tradeDate, phase as CrossMarketPhase)
    if (checkpoint) {
      res.json({ ...snapshot, checkpoint })
      return
    }
    res.json(snapshot)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(502).json({ error: message })
  }
})

// 竞价行为研究:由 L1 录制事件聚合研究标签。只读,sourceTier shadow。
router.get('/api/ladder/auction-behavior', (req, res) => {
  const tradeDate = typeof req.query.tradeDate === 'string' ? req.query.tradeDate : ''
  const rawPhase = typeof req.query.phase === 'string' ? req.query.phase : 'auction'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    res.status(400).json({ error: 'tradeDate 必须是 YYYY-MM-DD' })
    return
  }
  const phase: CrossMarketPhase =
    rawPhase === 'auction' || rawPhase === 'open' ? rawPhase : 'auction'
  try {
    res.json(buildAuctionBehaviorResearch({ tradeDate, phase }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

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

router.get('/api/ladder/next-day', async (req, res) => {
  const signalDate =
    typeof req.query.signalDate === 'string' ? req.query.signalDate : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate)) {
    res.status(400).json({ error: 'signalDate 必须是 YYYY-MM-DD' })
    return
  }
  try {
    res.json(await fetchLimitLadderNextDay(signalDate))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.startsWith('未找到') ? 404 : 500
    res.status(status).json({ error: message })
  }
})

router.get('/api/ladder/auction-brief', (req, res) => {
  const tradeDate = typeof req.query.tradeDate === 'string' ? req.query.tradeDate : ''
  const signalDate = typeof req.query.signalDate === 'string' ? req.query.signalDate : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || signalDate)) {
    res.status(400).json({ error: 'tradeDate 或 signalDate 必须是 YYYY-MM-DD' })
    return
  }
  try {
    res.json(tradeDate ? readAuctionBriefStateByTradeDate(tradeDate) : readAuctionBriefState(signalDate))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/ladder/auction-brief/preview', async (req, res) => {
  const signalDate = typeof req.body?.signalDate === 'string' ? req.body.signalDate : ''
  const phase = req.body?.phase as AuctionBriefPhase | undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate)) {
    res.status(400).json({ error: 'signalDate 必须是 YYYY-MM-DD' })
    return
  }
  if (phase && phase !== 'auction-final' && phase !== 'open-confirmation') {
    res.status(400).json({ error: 'phase 必须是 auction-final 或 open-confirmation' })
    return
  }
  try {
    const [analysis, nextDay] = await Promise.all([
      fetchLimitLadderAnalysis(signalDate),
      fetchLimitLadderNextDay(signalDate),
    ])
    const resolvedPhase =
      phase ?? (nextDay.stage === 'open' || nextDay.stage === 'settled'
        ? 'open-confirmation'
        : 'auction-final')
    const currentAnalysis = resolvedPhase === 'open-confirmation'
      ? await fetchLimitLadderAnalysis().catch(() => undefined)
      : undefined
    const brief = await enrichAuctionBriefWithOvernight(
      buildAuctionBrief({ phase: resolvedPhase, analysis, nextDay }),
      { analysis, nextDay, currentAnalysis },
    ).catch(() => buildAuctionBrief({ phase: resolvedPhase, analysis, nextDay }))
    res.json(req.body?.polish === true ? await polishAuctionBrief(brief) : brief)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.startsWith('未找到') ? 404 : 500
    res.status(status).json({ error: message })
  }
})

router.post('/api/ladder/notifications/serverchan/test', async (_req, res) => {
  try {
    res.json(await sendServerChanTest())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(message.includes('未配置') ? 400 : 502).json({ error: message })
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
