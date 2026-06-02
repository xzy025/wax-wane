// Enhanced Memory Store — Extended types and operations
import { getAgentMemory, upsertAgentMemory } from './pgDatabase'

// ── Enhanced Types ────────────────────────────────────────

export interface EnhancedTradingProfile {
  // Existing fields
  commonMistakes: string[]
  tradingStyle: string
  strengths: string[]
  weaknesses: string[]
  theoryGaps: string[]

  // New fields
  preferredSectors: string[]           // 偏好板块
  avgHoldingDays: number               // 平均持仓天数
  riskTolerance: 'low' | 'mid' | 'high'  // 风险偏好
  bestPerformingStrategy: string       // 最赚钱的策略
  worstPerformingStrategy: string      // 最亏钱的策略
  emotionalPatterns: {
    fomoTriggers: string[]             // 追高触发条件
    panicTriggers: string[]            // 恐慌卖出触发
  }
  tradingFrequency: {
    avgTradesPerWeek: number
    highFrequencyPeriods: string[]     // 高频交易的时段
  }
}

export interface KeyDecision {
  date: string
  decision: string                     // "决定减仓茅台"
  reasoning: string                    // "道氏理论显示趋势反转"
  outcome?: string                     // "事后证明正确，避免了5%亏损"
}

export interface ActionItem {
  id: string
  task: string
  deadline?: string
  status: 'pending' | 'done'
  createdAt: string
}

export interface EnhancedConversationMemory {
  summary: string
  keyDecisions: KeyDecision[]
  openQuestions: string[]
  actionItems: ActionItem[]
}

export interface TradeLesson {
  id: string
  date: string
  tradeGroupId: string
  lesson: string
  category: 'entry' | 'exit' | 'position_sizing' | 'timing' | 'risk_management'
  theory: string                       // 关联的理论框架
  timesRecalled: number                // 被召回次数
  createdAt: string
}

export interface TradePattern {
  pattern: string                      // "追高后第二天低开"
  frequency: number                    // 出现次数
  avgLoss: number                      // 平均亏损
  preventionRule: string               // "开盘前设好止损位"
  relatedMistakes: string[]
}

export interface SuccessPattern {
  pattern: string                      // "首板涨停次日低吸"
  frequency: number
  avgGain: number
  conditions: string[]                 // 触发条件
  relatedStrategy: string
}

export interface TradeExperienceMemory {
  lessons: TradeLesson[]
  patterns: TradePattern[]
  successPatterns: SuccessPattern[]
}

export interface MarketPhaseRecord {
  date: string
  wyckoffPhase: string
  dowTrend: string
  sentimentPhase: string
  accuracy?: string                    // 事后验证准确性
}

export interface RegimeChange {
  date: string
  from: string                         // "震荡市"
  to: string                           // "趋势市"
  trigger: string                      // "政策利好"
}

export interface EnhancedMarketMemory {
  current: {
    wyckoffPhase: string
    dowTrend: string
    sentimentPhase: string
  }
  history: MarketPhaseRecord[]
  regimeChanges: RegimeChange[]
}

export interface EnhancedAgentMemory {
  id: string
  userId: string
  tradingProfile: EnhancedTradingProfile
  improvementPlans: Array<{
    id: string
    focusArea: string
    theory: string
    startDate: string
    status: 'active' | 'completed' | 'abandoned'
    progress: number
    checkInDate: string
  }>
  marketAnalysis: EnhancedMarketMemory
  conversationMemory: EnhancedConversationMemory
  tradeExperience: TradeExperienceMemory
  lastUpdated: string
}

// ── Default Values ────────────────────────────────────────

const DEFAULT_ENHANCED_PROFILE: EnhancedTradingProfile = {
  commonMistakes: [],
  tradingStyle: 'unknown',
  strengths: [],
  weaknesses: [],
  theoryGaps: [],
  preferredSectors: [],
  avgHoldingDays: 0,
  riskTolerance: 'mid',
  bestPerformingStrategy: '',
  worstPerformingStrategy: '',
  emotionalPatterns: {
    fomoTriggers: [],
    panicTriggers: [],
  },
  tradingFrequency: {
    avgTradesPerWeek: 0,
    highFrequencyPeriods: [],
  },
}

const DEFAULT_CONVERSATION_MEMORY: EnhancedConversationMemory = {
  summary: '',
  keyDecisions: [],
  openQuestions: [],
  actionItems: [],
}

const DEFAULT_TRADE_EXPERIENCE: TradeExperienceMemory = {
  lessons: [],
  patterns: [],
  successPatterns: [],
}

const DEFAULT_MARKET_MEMORY: EnhancedMarketMemory = {
  current: {
    wyckoffPhase: 'unknown',
    dowTrend: 'unknown',
    sentimentPhase: 'unknown',
  },
  history: [],
  regimeChanges: [],
}

// ── Memory Operations ─────────────────────────────────────

export async function getEnhancedMemory(userId: string): Promise<EnhancedAgentMemory> {
  const row = await getAgentMemory(userId)

  if (!row) {
    return {
      id: crypto.randomUUID(),
      userId,
      tradingProfile: DEFAULT_ENHANCED_PROFILE,
      improvementPlans: [],
      marketAnalysis: DEFAULT_MARKET_MEMORY,
      conversationMemory: DEFAULT_CONVERSATION_MEMORY,
      tradeExperience: DEFAULT_TRADE_EXPERIENCE,
      lastUpdated: new Date().toISOString(),
    }
  }

  // Parse existing data with defaults for new fields
  const existingProfile = JSON.parse(row.trading_profile_json as string)
  const existingMarket = JSON.parse(row.market_analysis_json as string)

  return {
    id: row.id as string,
    userId: row.user_id as string,
    tradingProfile: { ...DEFAULT_ENHANCED_PROFILE, ...existingProfile },
    improvementPlans: JSON.parse(row.improvement_plans_json as string),
    marketAnalysis: {
      current: existingMarket.current ?? DEFAULT_MARKET_MEMORY.current,
      history: existingMarket.history ?? [],
      regimeChanges: existingMarket.regimeChanges ?? [],
    },
    conversationMemory: JSON.parse(row.conversation_memory_json as string ?? '{}') ?? DEFAULT_CONVERSATION_MEMORY,
    tradeExperience: JSON.parse(row.trade_experience_json as string ?? '{}') ?? DEFAULT_TRADE_EXPERIENCE,
    lastUpdated: row.last_updated as string,
  }
}

export async function saveEnhancedMemory(memory: EnhancedAgentMemory): Promise<void> {
  await upsertAgentMemory({
    user_id: memory.userId,
    trading_profile_json: JSON.stringify(memory.tradingProfile),
    improvement_plans_json: JSON.stringify(memory.improvementPlans),
    market_analysis_json: JSON.stringify(memory.marketAnalysis),
    conversation_summary: memory.conversationMemory.summary,
  })
}

// ── Trading Profile Updates ───────────────────────────────

export async function updateEnhancedTradingProfile(
  userId: string,
  updates: Partial<EnhancedTradingProfile>,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)
  memory.tradingProfile = { ...memory.tradingProfile, ...updates }
  memory.lastUpdated = new Date().toISOString()
  await saveEnhancedMemory(memory)
}

export async function inferTradingProfile(
  userId: string,
  tradeGroups: Array<Record<string, unknown>>,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)

  // Infer preferred sectors
  const sectorCounts = new Map<string, number>()
  for (const group of tradeGroups) {
    const code = group.code as string ?? group.stock_code as string ?? ''
    const name = group.name as string ?? group.stock_name as string ?? ''
    const sector = inferSector(code, name)
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1)
  }
  const sortedSectors = [...sectorCounts.entries()].sort((a, b) => b[1] - a[1])
  memory.tradingProfile.preferredSectors = sortedSectors.slice(0, 5).map(([s]) => s)

  // Infer avg holding days
  const holdingDays = tradeGroups
    .map(g => g.days as number ?? g.holding_days as number ?? 0)
    .filter(d => d > 0)
  if (holdingDays.length > 0) {
    memory.tradingProfile.avgHoldingDays = Math.round(
      holdingDays.reduce((s, d) => s + d, 0) / holdingDays.length
    )
  }

  // Infer risk tolerance from P&L distribution
  const pnls = tradeGroups.map(g => g.pnl as number ?? 0)
  const avgPnl = pnls.reduce((s, p) => s + p, 0) / Math.max(pnls.length, 1)
  const maxLoss = Math.min(...pnls)
  if (maxLoss < -5000) {
    memory.tradingProfile.riskTolerance = 'high'
  } else if (maxLoss > -1000) {
    memory.tradingProfile.riskTolerance = 'low'
  }

  // Infer trading frequency
  if (tradeGroups.length > 0) {
    const dates = tradeGroups.map(g => new Date(g.opened as string ?? g.opened_at as string ?? Date.now()))
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))
    const weeks = Math.max(1, (maxDate.getTime() - minDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
    memory.tradingProfile.tradingFrequency.avgTradesPerWeek = Math.round(tradeGroups.length / weeks)
  }

  // Infer best/worst strategies
  const strategyPnl = new Map<string, { total: number; count: number }>()
  for (const group of tradeGroups) {
    const strategy = group.strategy as string
    if (!strategy) continue
    const existing = strategyPnl.get(strategy) ?? { total: 0, count: 0 }
    existing.total += (group.pnl as number) ?? 0
    existing.count++
    strategyPnl.set(strategy, existing)
  }

  let bestStrategy = ''
  let bestAvg = -Infinity
  let worstStrategy = ''
  let worstAvg = Infinity

  for (const [strategy, { total, count }] of strategyPnl) {
    const avg = total / count
    if (avg > bestAvg) { bestAvg = avg; bestStrategy = strategy }
    if (avg < worstAvg) { worstAvg = avg; worstStrategy = strategy }
  }

  memory.tradingProfile.bestPerformingStrategy = bestStrategy
  memory.tradingProfile.worstPerformingStrategy = worstStrategy

  memory.lastUpdated = new Date().toISOString()
  await saveEnhancedMemory(memory)
}

function inferSector(code: string, name: string): string {
  if (name.includes('银行')) return '银行'
  if (name.includes('证券')) return '证券'
  if (name.includes('白酒') || name.includes('茅台')) return '白酒'
  if (name.includes('医药')) return '医药'
  if (name.includes('半导体') || name.includes('芯片')) return '半导体'
  if (name.includes('新能源') || name.includes('宁德')) return '新能源'
  if (name.includes('汽车') || name.includes('比亚迪')) return '汽车'
  if (name.includes('地产') || name.includes('万科')) return '房地产'
  return '其他'
}

// ── Conversation Memory Updates ───────────────────────────

export async function addKeyDecision(
  userId: string,
  decision: KeyDecision,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)
  memory.conversationMemory.keyDecisions.push(decision)
  memory.lastUpdated = new Date().toISOString()
  await saveEnhancedMemory(memory)
}

export async function addActionItem(
  userId: string,
  actionItem: ActionItem,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)
  memory.conversationMemory.actionItems.push(actionItem)
  memory.lastUpdated = new Date().toISOString()
  await saveEnhancedMemory(memory)
}

export async function completeActionItem(
  userId: string,
  actionItemId: string,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)
  const item = memory.conversationMemory.actionItems.find(i => i.id === actionItemId)
  if (item) {
    item.status = 'done'
    memory.lastUpdated = new Date().toISOString()
    await saveEnhancedMemory(memory)
  }
}

export async function addOpenQuestion(
  userId: string,
  question: string,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)
  if (!memory.conversationMemory.openQuestions.includes(question)) {
    memory.conversationMemory.openQuestions.push(question)
    memory.lastUpdated = new Date().toISOString()
    await saveEnhancedMemory(memory)
  }
}

// ── Trade Experience Updates ──────────────────────────────

export async function addTradeLesson(
  userId: string,
  lesson: Omit<TradeLesson, 'id' | 'timesRecalled' | 'createdAt'>,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)

  // Check for duplicate
  const existing = memory.tradeExperience.lessons.find(
    l => l.lesson === lesson.lesson && l.tradeGroupId === lesson.tradeGroupId
  )
  if (existing) return

  memory.tradeExperience.lessons.push({
    ...lesson,
    id: crypto.randomUUID(),
    timesRecalled: 0,
    createdAt: new Date().toISOString(),
  })

  memory.lastUpdated = new Date().toISOString()
  await saveEnhancedMemory(memory)
}

export async function recallTradeLesson(
  userId: string,
  lessonId: string,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)
  const lesson = memory.tradeExperience.lessons.find(l => l.id === lessonId)
  if (lesson) {
    lesson.timesRecalled++
    memory.lastUpdated = new Date().toISOString()
    await saveEnhancedMemory(memory)
  }
}

export async function addTradePattern(
  userId: string,
  pattern: TradePattern,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)

  const existing = memory.tradeExperience.patterns.find(p => p.pattern === pattern.pattern)
  if (existing) {
    existing.frequency += pattern.frequency
    existing.avgLoss = (existing.avgLoss + pattern.avgLoss) / 2
  } else {
    memory.tradeExperience.patterns.push(pattern)
  }

  memory.lastUpdated = new Date().toISOString()
  await saveEnhancedMemory(memory)
}

export async function addSuccessPattern(
  userId: string,
  pattern: SuccessPattern,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)

  const existing = memory.tradeExperience.successPatterns.find(p => p.pattern === pattern.pattern)
  if (existing) {
    existing.frequency += pattern.frequency
    existing.avgGain = (existing.avgGain + pattern.avgGain) / 2
  } else {
    memory.tradeExperience.successPatterns.push(pattern)
  }

  memory.lastUpdated = new Date().toISOString()
  await saveEnhancedMemory(memory)
}

// ── Market Memory Updates ─────────────────────────────────

export async function addMarketPhaseRecord(
  userId: string,
  record: MarketPhaseRecord,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)

  // Update current
  memory.marketAnalysis.current = {
    wyckoffPhase: record.wyckoffPhase,
    dowTrend: record.dowTrend,
    sentimentPhase: record.sentimentPhase,
  }

  // Add to history (keep last 30 days)
  memory.marketAnalysis.history.unshift(record)
  if (memory.marketAnalysis.history.length > 30) {
    memory.marketAnalysis.history = memory.marketAnalysis.history.slice(0, 30)
  }

  memory.lastUpdated = new Date().toISOString()
  await saveEnhancedMemory(memory)
}

export async function addRegimeChange(
  userId: string,
  change: RegimeChange,
): Promise<void> {
  const memory = await getEnhancedMemory(userId)
  memory.marketAnalysis.regimeChanges.push(change)
  memory.lastUpdated = new Date().toISOString()
  await saveEnhancedMemory(memory)
}

// ── Memory Serialization ──────────────────────────────────

export function serializeEnhancedMemory(memory: EnhancedAgentMemory): string {
  const parts: string[] = []

  // Trading Profile
  parts.push('## 用户画像')
  const p = memory.tradingProfile
  if (p.tradingStyle !== 'unknown') parts.push(`- 交易风格：${p.tradingStyle}`)
  if (p.preferredSectors.length > 0) parts.push(`- 偏好板块：${p.preferredSectors.join('、')}`)
  if (p.avgHoldingDays > 0) parts.push(`- 平均持仓：${p.avgHoldingDays} 天`)
  if (p.riskTolerance !== 'mid') parts.push(`- 风险偏好：${p.riskTolerance}`)
  if (p.commonMistakes.length > 0) parts.push(`- 常见问题：${p.commonMistakes.join('、')}`)
  if (p.strengths.length > 0) parts.push(`- 优势：${p.strengths.join('、')}`)
  if (p.weaknesses.length > 0) parts.push(`- 弱项：${p.weaknesses.join('、')}`)
  if (p.bestPerformingStrategy) parts.push(`- 最佳策略：${p.bestPerformingStrategy}`)
  if (p.worstPerformingStrategy) parts.push(`- 最差策略：${p.worstPerformingStrategy}`)
  if (p.emotionalPatterns.fomoTriggers.length > 0) {
    parts.push(`- FOMO 触发：${p.emotionalPatterns.fomoTriggers.join('、')}`)
  }
  if (p.emotionalPatterns.panicTriggers.length > 0) {
    parts.push(`- 恐慌触发：${p.emotionalPatterns.panicTriggers.join('、')}`)
  }

  // Active improvement plans
  const activePlans = memory.improvementPlans.filter(p => p.status === 'active')
  if (activePlans.length > 0) {
    parts.push('')
    parts.push('## 当前改进计划')
    for (const plan of activePlans) {
      parts.push(`- ${plan.focusArea}（${plan.theory}）：进度 ${plan.progress}%`)
    }
  }

  // Conversation memory
  const conv = memory.conversationMemory
  if (conv.keyDecisions.length > 0) {
    parts.push('')
    parts.push('## 关键决策')
    for (const d of conv.keyDecisions.slice(-5)) {
      parts.push(`- ${d.date}: ${d.decision} — ${d.reasoning}`)
    }
  }
  if (conv.actionItems.filter(i => i.status === 'pending').length > 0) {
    parts.push('')
    parts.push('## 待办事项')
    for (const item of conv.actionItems.filter(i => i.status === 'pending')) {
      parts.push(`- [ ] ${item.task}${item.deadline ? ` (${item.deadline})` : ''}`)
    }
  }

  // Trade experience
  const exp = memory.tradeExperience
  if (exp.lessons.length > 0) {
    parts.push('')
    parts.push('## 交易经验')
    const topLessons = [...exp.lessons].sort((a, b) => b.timesRecalled - a.timesRecalled).slice(0, 5)
    for (const l of topLessons) {
      parts.push(`- ${l.lesson}（${l.category}，被召回 ${l.timesRecalled} 次）`)
    }
  }
  if (exp.patterns.length > 0) {
    parts.push('')
    parts.push('## 失败模式')
    for (const p of exp.patterns.slice(0, 3)) {
      parts.push(`- ${p.pattern}：频率 ${p.frequency}，平均亏损 ${p.avgLoss}，预防：${p.preventionRule}`)
    }
  }
  if (exp.successPatterns.length > 0) {
    parts.push('')
    parts.push('## 成功模式')
    for (const p of exp.successPatterns.slice(0, 3)) {
      parts.push(`- ${p.pattern}：频率 ${p.frequency}，平均收益 ${p.avgGain}`)
    }
  }

  // Market analysis
  if (memory.marketAnalysis.current.wyckoffPhase !== 'unknown') {
    parts.push('')
    parts.push('## 当前市场状态')
    parts.push(`- Wyckoff：${memory.marketAnalysis.current.wyckoffPhase}`)
    parts.push(`- 道氏：${memory.marketAnalysis.current.dowTrend}`)
    parts.push(`- 情绪：${memory.marketAnalysis.current.sentimentPhase}`)
  }

  // Conversation summary
  if (conv.summary) {
    parts.push('')
    parts.push('## 上次对话摘要')
    parts.push(conv.summary)
  }

  return parts.join('\n')
}
