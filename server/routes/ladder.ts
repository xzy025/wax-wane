import { Router } from 'express'
import {
  fetchLimitLadderAnalysis,
  fetchLimitLadderNextDay,
  getLimitLadderAuctionSchedulerStatus,
  importLimitLadder,
  listLimitLadderArchiveDates,
  refreshLimitLadderAnalysis,
  LadderFormalEligibilityError,
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
import { listLadderSentimentQuant, readLadderSentimentQuant } from '../services/ladderSentimentQuant'
import { listTradingDates, tradingCalendarSource, tradingCalendarVersion } from '../services/tradingCalendar'
import { todayShanghai } from '../lib/time'
import { getStrategy } from '../strategy/loader'
import { envelopeForTradingCalendar } from '../market-data/marketDataSource'
import {
  applyManualReviews,
  normalizeManualReviewPayload,
  saveManualReviewPayload,
  validateManualReviewCodes,
} from '../services/nextDayManualReview'

const router = Router()

// Ladder responses are live/settled research snapshots. Do not serve them
// from a stale browser cache during the premarket window.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  next()
})

router.get('/api/ladder/archive-dates', (req, res) => {
  const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30
  const limit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 30
  if (limit < 1 || limit > 200) {
    res.status(400).json({ error: 'limit 必须是 1 到 200 的整数' })
    return
  }
  res.json({ dates: listLimitLadderArchiveDates(limit) })
})

// Trading calendar is independent from the dates for which ladder data exists.
// This keeps an unavailable current day selectable without serving an older archive.
router.get('/api/ladder/trading-dates', (req, res) => {
  const to = typeof req.query.to === 'string' ? req.query.to : undefined
  const from = typeof req.query.from === 'string' ? req.query.from : undefined
  const end = to ?? todayShanghai()
  const start = from ?? (() => {
    const date = new Date(`${end}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() - 90)
    return date.toISOString().slice(0, 10)
  })()
  try {
    const dates = listTradingDates(start, end).sort((a, b) => b.localeCompare(a))
    const source = tradingCalendarSource()
    const version = tradingCalendarVersion()
    res.json({
      dates,
      source,
      version,
      dataQuality: envelopeForTradingCalendar(dates, source, version),
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '交易日历范围无效' })
  }
})

router.get('/api/ladder/auction-scheduler-status', (_req, res) => {
  res.json(getLimitLadderAuctionSchedulerStatus())
})

router.get('/api/ladder/sentiment-quant', async (req, res) => {
  const asof = typeof req.query.asof === 'string' ? req.query.asof : undefined
  const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 30
  if (asof && !/^\d{4}-\d{2}-\d{2}$/.test(asof)) {
    res.status(400).json({ error: 'asof 必须是 YYYY-MM-DD' })
    return
  }
  try {
    if (asof) {
      const snapshot = readLadderSentimentQuant(asof)
      if (!snapshot) {
        res.status(404).json({ error: `未找到${asof}的情绪量化归档` })
        return
      }
      res.json({ snapshots: [snapshot] })
      return
    }
    res.json({ snapshots: listLadderSentimentQuant(limit) })
  } catch (err) {
    const message = err instanceof Error ? err.message : '情绪量化读取失败'
    res.status(500).json({ error: message })
  }
})

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

router.post('/api/ladder/analysis/refresh', async (req, res) => {
  const date = typeof req.body?.date === 'string' ? req.body.date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date 必须是 YYYY-MM-DD' })
    return
  }
  try {
    res.json(await refreshLimitLadderAnalysis(date))
  } catch (err) {
    const message = err instanceof Error ? err.message : '连板归档补全失败'
    res.status(message.startsWith('未找到') ? 404 : 409).json({ error: message })
  }
})

router.get('/api/ladder/first-board-scan', async (req, res) => {
  const tradeDate = typeof req.query.tradeDate === 'string' ? req.query.tradeDate : undefined
  if (tradeDate && !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    res.status(400).json({ error: 'tradeDate 必须是 YYYY-MM-DD' })
    return
  }
  try {
    const scan = getStrategy()?.ladder?.fetchFirstBoardScan
    if (!scan) {
      res.status(503).json({ error: '未安装私有战法层，首板扫描不可用' })
      return
    }
    res.json(await scan(tradeDate ?? todayShanghai()))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(502).json({ error: message })
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
    res.json(applyManualReviews(await fetchLimitLadderNextDay(signalDate)))
  } catch (err) {
    if (err instanceof LadderFormalEligibilityError) {
      res.status(409).json({ error: err.message, code: err.code, reasons: err.reasons })
      return
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.startsWith('未找到') ? 404 : 500
    res.status(status).json({ error: message })
  }
})

router.post('/api/ladder/next-day/manual-review', async (req, res) => {
  try {
    const payload = normalizeManualReviewPayload(req.body)
    const nextDay = await fetchLimitLadderNextDay(payload.signalDate)
    validateManualReviewCodes(payload, nextDay.candidates)
    const frozenPayload = {
      ...payload,
      reviews: payload.reviews.map((review) => {
        const candidate = nextDay.candidates.find((item) => item.code === review.code)
        return {
          ...review,
          automaticScoreSnapshot: review.automaticScoreSnapshot !== undefined
            ? review.automaticScoreSnapshot
            : candidate?.decisionScore ?? candidate?.liveScore ?? candidate?.baseScore ?? null,
          themeLadderScoreSnapshot: review.themeLadderScoreSnapshot !== undefined
            ? review.themeLadderScoreSnapshot
            : candidate?.themeLadder?.score ?? null,
          decisionSnapshotRef: review.decisionSnapshotRef ?? `${payload.signalDate}:${review.code}:next-day-decision`,
        }
      }),
    }
    saveManualReviewPayload(frozenPayload)
    res.json({ ...applyManualReviews(nextDay), manualReviewSaved: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : '人工复核保存失败'
    const status = message.startsWith('未找到') ? 404 : 400
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
