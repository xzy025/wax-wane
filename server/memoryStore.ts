// Agent Memory Store - PostgreSQL implementation
import { getAgentMemory, upsertAgentMemory } from './pgDatabase'

export interface AgentMemory {
  id: string
  userId: string
  tradingProfile: {
    commonMistakes: string[]
    tradingStyle: string
    strengths: string[]
    weaknesses: string[]
    theoryGaps: string[]
  }
  improvementPlans: Array<{
    id: string
    focusArea: string
    theory: string
    startDate: string
    status: 'active' | 'completed' | 'abandoned'
    progress: number
    checkInDate: string
  }>
  marketAnalysis: {
    wyckoffPhase: string
    dowTrend: string
    sentimentPhase: string
    lastUpdated: string
  }
  conversationSummary: string
  lastUpdated: string
}

const DEFAULT_MEMORY: Omit<AgentMemory, 'id' | 'userId'> = {
  tradingProfile: {
    commonMistakes: [],
    tradingStyle: 'unknown',
    strengths: [],
    weaknesses: [],
    theoryGaps: [],
  },
  improvementPlans: [],
  marketAnalysis: {
    wyckoffPhase: 'unknown',
    dowTrend: 'unknown',
    sentimentPhase: 'unknown',
    lastUpdated: new Date().toISOString(),
  },
  conversationSummary: '',
  lastUpdated: new Date().toISOString(),
}

export async function getMemory(userId: string): Promise<AgentMemory> {
  const row = await getAgentMemory(userId)

  if (!row) {
    return {
      id: crypto.randomUUID(),
      userId,
      ...DEFAULT_MEMORY,
    }
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    tradingProfile: JSON.parse(row.trading_profile_json as string),
    improvementPlans: JSON.parse(row.improvement_plans_json as string),
    marketAnalysis: JSON.parse(row.market_analysis_json as string),
    conversationSummary: (row.conversation_summary as string) ?? '',
    lastUpdated: row.last_updated as string,
  }
}

export async function saveMemory(memory: AgentMemory): Promise<void> {
  await upsertAgentMemory({
    user_id: memory.userId,
    trading_profile_json: JSON.stringify(memory.tradingProfile),
    improvement_plans_json: JSON.stringify(memory.improvementPlans),
    market_analysis_json: JSON.stringify(memory.marketAnalysis),
    conversation_summary: memory.conversationSummary,
  })
}

export async function updateTradingProfile(
  userId: string,
  profile: Partial<AgentMemory['tradingProfile']>,
): Promise<void> {
  const memory = await getMemory(userId)
  memory.tradingProfile = { ...memory.tradingProfile, ...profile }
  await saveMemory(memory)
}

export async function addImprovementPlan(
  userId: string,
  plan: AgentMemory['improvementPlans'][0],
): Promise<void> {
  const memory = await getMemory(userId)
  memory.improvementPlans.push(plan)
  await saveMemory(memory)
}

export async function updateImprovementPlan(
  userId: string,
  planId: string,
  updates: Partial<AgentMemory['improvementPlans'][0]>,
): Promise<void> {
  const memory = await getMemory(userId)
  const index = memory.improvementPlans.findIndex((p) => p.id === planId)
  if (index !== -1) {
    memory.improvementPlans[index] = { ...memory.improvementPlans[index], ...updates }
    await saveMemory(memory)
  }
}

export async function updateMarketAnalysis(
  userId: string,
  analysis: Partial<AgentMemory['marketAnalysis']>,
): Promise<void> {
  const memory = await getMemory(userId)
  memory.marketAnalysis = {
    ...memory.marketAnalysis,
    ...analysis,
    lastUpdated: new Date().toISOString(),
  }
  await saveMemory(memory)
}

export async function updateConversationSummary(
  userId: string,
  summary: string,
): Promise<void> {
  const memory = await getMemory(userId)
  memory.conversationSummary = summary
  await saveMemory(memory)
}
