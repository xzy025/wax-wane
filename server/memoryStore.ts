// Agent Memory Store - 记住用户的交易习惯和改进计划
import { getDatabase } from './database'

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

export async function initMemoryTable(): Promise<void> {
  const db = await getDatabase()
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      trading_profile_json TEXT NOT NULL,
      improvement_plans_json TEXT NOT NULL,
      market_analysis_json TEXT NOT NULL,
      conversation_summary TEXT,
      last_updated TEXT NOT NULL,
      UNIQUE(user_id)
    )
  `)
}

export async function getMemory(userId: string): Promise<AgentMemory> {
  const db = await getDatabase()
  const result = db.exec('SELECT * FROM agent_memory WHERE user_id = ?', [userId])

  if (result.length === 0 || result[0].values.length === 0) {
    return {
      id: crypto.randomUUID(),
      userId,
      ...DEFAULT_MEMORY,
    }
  }

  const row = result[0].values[0]
  const columns = result[0].columns

  const obj: Record<string, unknown> = {}
  columns.forEach((col, i) => {
    obj[col] = row[i]
  })

  return {
    id: obj.id as string,
    userId: obj.user_id as string,
    tradingProfile: JSON.parse(obj.trading_profile_json as string),
    improvementPlans: JSON.parse(obj.improvement_plans_json as string),
    marketAnalysis: JSON.parse(obj.market_analysis_json as string),
    conversationSummary: (obj.conversation_summary as string) ?? '',
    lastUpdated: obj.last_updated as string,
  }
}

export async function saveMemory(memory: AgentMemory): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  // Check if memory exists
  const existing = db.exec('SELECT id FROM agent_memory WHERE user_id = ?', [memory.userId])

  if (existing.length > 0 && existing[0].values.length > 0) {
    // Update
    db.run(
      `UPDATE agent_memory SET
        trading_profile_json = ?,
        improvement_plans_json = ?,
        market_analysis_json = ?,
        conversation_summary = ?,
        last_updated = ?
      WHERE user_id = ?`,
      [
        JSON.stringify(memory.tradingProfile),
        JSON.stringify(memory.improvementPlans),
        JSON.stringify(memory.marketAnalysis),
        memory.conversationSummary,
        now,
        memory.userId,
      ],
    )
  } else {
    // Insert
    db.run(
      `INSERT INTO agent_memory (id, user_id, trading_profile_json, improvement_plans_json, market_analysis_json, conversation_summary, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        memory.id,
        memory.userId,
        JSON.stringify(memory.tradingProfile),
        JSON.stringify(memory.improvementPlans),
        JSON.stringify(memory.marketAnalysis),
        memory.conversationSummary,
        now,
      ],
    )
  }
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
