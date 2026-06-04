// Agent memory routes: base memory store + enhanced memory (lazy-loaded).
import { Router } from 'express'
import {
  getMemory,
  saveMemory,
  updateTradingProfile,
  addImprovementPlan,
  updateImprovementPlan,
  updateMarketAnalysis,
  updateConversationSummary,
} from '../memoryStore'

const router = Router()

// ── Base memory ────────────────────────────────────────────

router.get('/api/memory/:userId', async (req, res) => {
  try {
    const memory = await getMemory(req.params.userId)
    res.json(memory)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.put('/api/memory/:userId', async (req, res) => {
  try {
    const memory = { ...req.body, userId: req.params.userId }
    await saveMemory(memory)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.patch('/api/memory/:userId/profile', async (req, res) => {
  try {
    await updateTradingProfile(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/memory/:userId/plans', async (req, res) => {
  try {
    await addImprovementPlan(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.patch('/api/memory/:userId/plans/:planId', async (req, res) => {
  try {
    await updateImprovementPlan(req.params.userId, req.params.planId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.patch('/api/memory/:userId/market', async (req, res) => {
  try {
    await updateMarketAnalysis(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.patch('/api/memory/:userId/summary', async (req, res) => {
  try {
    await updateConversationSummary(req.params.userId, req.body.summary)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// ── Enhanced memory (lazy-loaded modules) ─────────────────

router.get('/api/memory-enhanced/:userId', async (req, res) => {
  try {
    const { getEnhancedMemory, serializeEnhancedMemory } = await import('../memoryEnhanced')
    const memory = await getEnhancedMemory(req.params.userId)
    res.json({
      ...memory,
      serialized: serializeEnhancedMemory(memory),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.patch('/api/memory-enhanced/:userId/profile', async (req, res) => {
  try {
    const { updateEnhancedTradingProfile } = await import('../memoryEnhanced')
    await updateEnhancedTradingProfile(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/memory-enhanced/:userId/infer-profile', async (req, res) => {
  try {
    const { inferTradingProfile } = await import('../memoryEnhanced')
    const { tradeGroups } = req.body
    await inferTradingProfile(req.params.userId, tradeGroups || [])
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/memory-enhanced/:userId/lessons', async (req, res) => {
  try {
    const { extractLessonsFromReview } = await import('../memoryExtraction')
    const { tradeGroupId, reviewNote } = req.body
    await extractLessonsFromReview(req.params.userId, tradeGroupId, reviewNote)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/memory-enhanced/:userId/patterns', async (req, res) => {
  try {
    const { extractPatternsFromTrades } = await import('../memoryExtraction')
    const { tradeGroups } = req.body
    await extractPatternsFromTrades(req.params.userId, tradeGroups || [])
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/memory-enhanced/:userId/decisions', async (req, res) => {
  try {
    const { addKeyDecision } = await import('../memoryEnhanced')
    await addKeyDecision(req.params.userId, req.body)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.post('/api/memory-enhanced/:userId/actions', async (req, res) => {
  try {
    const { addActionItem } = await import('../memoryEnhanced')
    await addActionItem(req.params.userId, {
      ...req.body,
      id: crypto.randomUUID(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    })
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

router.patch('/api/memory-enhanced/:userId/actions/:actionId', async (req, res) => {
  try {
    const { completeActionItem } = await import('../memoryEnhanced')
    await completeActionItem(req.params.userId, req.params.actionId)
    res.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
