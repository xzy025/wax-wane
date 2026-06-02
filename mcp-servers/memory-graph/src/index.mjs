#!/usr/bin/env node

// Memory + Graph MCP Server
// Provides tools for agent memory management and graph queries

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  host: process.env.PG_HOST ?? 'localhost',
  port: parseInt(process.env.PG_PORT ?? '5432'),
  database: process.env.PG_DATABASE ?? 'trade_review',
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD ?? 'postgres',
})

// ── Tool Definitions ──────────────────────────────────────

const TOOLS = [
  // Memory tools
  {
    name: 'getMemory',
    description: '获取用户的 Agent 记忆（交易画像、改进计划、市场分析）',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: '用户 ID' },
      },
      required: ['userId'],
    },
  },
  {
    name: 'updateTradingProfile',
    description: '更新用户交易画像',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: '用户 ID' },
        profile: { type: 'string', description: '画像数据 JSON' },
      },
      required: ['userId', 'profile'],
    },
  },
  {
    name: 'addImprovementPlan',
    description: '添加改进计划',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: '用户 ID' },
        plan: { type: 'string', description: '计划数据 JSON' },
      },
      required: ['userId', 'plan'],
    },
  },
  {
    name: 'updateConversationSummary',
    description: '更新对话摘要',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: '用户 ID' },
        summary: { type: 'string', description: '对话摘要' },
      },
      required: ['userId', 'summary'],
    },
  },
  // Graph tools
  {
    name: 'graphQuery',
    description: '查询交易关系图，支持多跳推理',
    inputSchema: {
      type: 'object',
      properties: {
        queryType: { type: 'string', description: '查询类型', enum: ['findTradesByMistake', 'findTradesByPhase', 'findRelatedTrades', 'findPatternPath', 'multiHop'] },
        params: { type: 'string', description: '查询参数 JSON' },
      },
      required: ['queryType'],
    },
  },
  {
    name: 'findRelatedTrades',
    description: '找到与指定交易相关联的其他交易',
    inputSchema: {
      type: 'object',
      properties: {
        tradeGroupId: { type: 'string', description: '交易组 ID' },
        relationTypes: { type: 'string', description: '关系类型，逗号分隔' },
      },
      required: ['tradeGroupId'],
    },
  },
  {
    name: 'findPatternPath',
    description: '发现从交易错误到理论框架的推理路径',
    inputSchema: {
      type: 'object',
      properties: {
        mistake: { type: 'string', description: '错误名称' },
      },
      required: ['mistake'],
    },
  },
  {
    name: 'getGraphStats',
    description: '获取图数据库统计信息',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

// ── Memory Handlers ───────────────────────────────────────

async function handleGetMemory(args) {
  const result = await pool.query(
    'SELECT * FROM agent_memory WHERE user_id = $1',
    [args.userId],
  )

  if (result.rows.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          userId: args.userId,
          tradingProfile: { commonMistakes: [], tradingStyle: 'unknown', strengths: [], weaknesses: [], theoryGaps: [] },
          improvementPlans: [],
          marketAnalysis: { wyckoffPhase: 'unknown', dowTrend: 'unknown', sentimentPhase: 'unknown' },
          conversationSummary: '',
        }, null, 2),
      }],
    }
  }

  const row = result.rows[0]
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        userId: row.user_id,
        tradingProfile: JSON.parse(row.trading_profile_json),
        improvementPlans: JSON.parse(row.improvement_plans_json),
        marketAnalysis: JSON.parse(row.market_analysis_json),
        conversationSummary: row.conversation_summary,
      }, null, 2),
    }],
  }
}

async function handleUpdateTradingProfile(args) {
  const profile = JSON.parse(args.profile)
  const now = new Date().toISOString()

  const existing = await pool.query('SELECT id FROM agent_memory WHERE user_id = $1', [args.userId])

  if (existing.rows.length > 0) {
    const current = await pool.query('SELECT * FROM agent_memory WHERE user_id = $1', [args.userId])
    const currentProfile = JSON.parse(current.rows[0].trading_profile_json)
    const merged = { ...currentProfile, ...profile }

    await pool.query(
      'UPDATE agent_memory SET trading_profile_json = $1, last_updated = $2 WHERE user_id = $3',
      [JSON.stringify(merged), now, args.userId],
    )
  } else {
    await pool.query(
      `INSERT INTO agent_memory (id, user_id, trading_profile_json, improvement_plans_json, market_analysis_json, last_updated)
       VALUES ($1, $2, $3, '[]', '{}', $4)`,
      [crypto.randomUUID(), args.userId, JSON.stringify(profile), now],
    )
  }

  return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }
}

async function handleAddImprovementPlan(args) {
  const plan = JSON.parse(args.plan)
  const now = new Date().toISOString()

  const existing = await pool.query('SELECT * FROM agent_memory WHERE user_id = $1', [args.userId])

  if (existing.rows.length > 0) {
    const plans = JSON.parse(existing.rows[0].improvement_plans_json)
    plans.push(plan)
    await pool.query(
      'UPDATE agent_memory SET improvement_plans_json = $1, last_updated = $2 WHERE user_id = $3',
      [JSON.stringify(plans), now, args.userId],
    )
  } else {
    await pool.query(
      `INSERT INTO agent_memory (id, user_id, trading_profile_json, improvement_plans_json, market_analysis_json, last_updated)
       VALUES ($1, $2, '[]', $3, '{}', $4)`,
      [crypto.randomUUID(), args.userId, JSON.stringify([plan]), now],
    )
  }

  return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }
}

async function handleUpdateConversationSummary(args) {
  const now = new Date().toISOString()

  const existing = await pool.query('SELECT id FROM agent_memory WHERE user_id = $1', [args.userId])

  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE agent_memory SET conversation_summary = $1, last_updated = $2 WHERE user_id = $3',
      [args.summary, now, args.userId],
    )
  } else {
    await pool.query(
      `INSERT INTO agent_memory (id, user_id, trading_profile_json, improvement_plans_json, market_analysis_json, conversation_summary, last_updated)
       VALUES ($1, $2, '[]', '[]', '{}', $3, $4)`,
      [crypto.randomUUID(), args.userId, args.summary, now],
    )
  }

  return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }
}

// ── Graph Handlers ────────────────────────────────────────

async function handleGraphQuery(args) {
  const { queryType, params: paramsStr } = args
  const params = JSON.parse(paramsStr || '{}')

  let result

  switch (queryType) {
    case 'findTradesByMistake': {
      const nodes = await pool.query(
        `SELECT n.* FROM graph_nodes n
         WHERE n.type = 'Mistake' AND n.properties->>'name' = $1`,
        [params.mistake],
      )
      if (nodes.rows.length === 0) { result = []; break }

      const edges = await pool.query(
        `SELECT e.source_id, n.* FROM graph_edges e
         JOIN graph_nodes n ON n.id = e.source_id
         WHERE e.target_id = $1 AND e.type = 'HAS_MISTAKE'`,
        [nodes.rows[0].id],
      )
      result = edges.rows.map(r => ({
        tradeGroup: { id: r.source_id, ...r.properties },
        mistake: params.mistake,
      }))
      break
    }

    case 'findTradesByPhase': {
      const phases = await pool.query(
        `SELECT * FROM graph_nodes WHERE type = 'MarketPhase'`,
      )
      const matchingPhases = phases.rows.filter(p => {
        const props = p.properties
        if (params.phaseType === 'wyckoff') return props.wyckoffPhase === params.phaseValue
        if (params.phaseType === 'dow') return props.dowTrend === params.phaseValue
        if (params.phaseType === 'sentiment') return props.sentimentPhase === params.phaseValue
        return false
      })

      result = []
      for (const phase of matchingPhases) {
        const edges = await pool.query(
          `SELECT n.* FROM graph_edges e
           JOIN graph_nodes n ON n.id = e.source_id
           WHERE e.target_id = $1 AND e.type = 'OCCURRED_DURING'`,
          [phase.id],
        )
        result.push(...edges.rows.map(r => ({ ...r.properties, phaseId: phase.id })))
      }
      break
    }

    case 'findRelatedTrades': {
      const tgId = params.tradeGroupId.startsWith('tg:') ? params.tradeGroupId : `tg:${params.tradeGroupId}`
      const relationTypes = params.relationTypes || ['INVOLVES', 'USED_STRATEGY', 'BELONGS_TO']

      // Get connected nodes
      const connected = await pool.query(
        `SELECT e.target_id, e.type, n.* FROM graph_edges e
         JOIN graph_nodes n ON n.id = e.target_id
         WHERE e.source_id = $1 AND e.type = ANY($2)`,
        [tgId, relationTypes],
      )

      result = []
      for (const conn of connected.rows) {
        // Find other trade groups connected to the same node
        const related = await pool.query(
          `SELECT n.* FROM graph_edges e
           JOIN graph_nodes n ON n.id = e.source_id
           WHERE e.target_id = $1 AND e.type = $2 AND e.source_id != $3`,
          [conn.target_id, conn.type, tgId],
        )
        result.push(...related.rows.map(r => ({
          relatedTg: r.properties,
          sharedAttribute: conn.properties.name || conn.properties.code,
          attributeType: conn.type,
        })))
      }
      break
    }

    case 'findPatternPath': {
      const patternNodes = await pool.query(
        `SELECT * FROM graph_nodes WHERE type = 'Pattern' AND properties->>'name' = $1`,
        [params.mistake],
      )

      result = []
      for (const pattern of patternNodes.rows) {
        const theories = await pool.query(
          `SELECT n.*, e.properties as edge_props FROM graph_edges e
           JOIN graph_nodes n ON n.id = e.target_id
           WHERE e.source_id = $1 AND e.type = 'LINKED_TO'`,
          [pattern.id],
        )
        result.push(...theories.rows.map(t => ({
          mistake: params.mistake,
          theoryName: t.properties.name,
          patternName: pattern.properties.name,
          reason: t.edge_props?.reason,
        })))
      }
      break
    }

    case 'multiHop': {
      // Generic multi-hop query
      const startNodes = await pool.query(
        `SELECT * FROM graph_nodes WHERE type = $1`,
        [params.startType],
      )

      result = startNodes.rows.map(n => ({ startNode: n.properties }))
      break
    }

    default:
      result = { error: `Unknown query type: ${queryType}` }
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

async function handleFindRelatedTrades(args) {
  const tgId = args.tradeGroupId.startsWith('tg:') ? args.tradeGroupId : `tg:${args.tradeGroupId}`
  const relationTypes = args.relationTypes
    ? args.relationTypes.split(',').map(s => s.trim())
    : ['INVOLVES', 'USED_STRATEGY', 'BELONGS_TO']

  const connected = await pool.query(
    `SELECT e.target_id, e.type, n.* FROM graph_edges e
     JOIN graph_nodes n ON n.id = e.target_id
     WHERE e.source_id = $1 AND e.type = ANY($2)`,
    [tgId, relationTypes],
  )

  const results = []
  for (const conn of connected.rows) {
    const related = await pool.query(
      `SELECT n.* FROM graph_edges e
       JOIN graph_nodes n ON n.id = e.source_id
       WHERE e.target_id = $1 AND e.type = $2 AND e.source_id != $3`,
      [conn.target_id, conn.type, tgId],
    )
    results.push(...related.rows.map(r => ({
      relatedTg: r.properties,
      sharedAttribute: conn.properties.name || conn.properties.code,
      attributeType: conn.type,
    })))
  }

  return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
}

async function handleFindPatternPath(args) {
  const patternNodes = await pool.query(
    `SELECT * FROM graph_nodes WHERE type = 'Pattern' AND properties->>'name' = $1`,
    [args.mistake],
  )

  const results = []
  for (const pattern of patternNodes.rows) {
    const theories = await pool.query(
      `SELECT n.*, e.properties as edge_props FROM graph_edges e
       JOIN graph_nodes n ON n.id = e.target_id
       WHERE e.source_id = $1 AND e.type = 'LINKED_TO'`,
      [pattern.id],
    )
    results.push(...theories.rows.map(t => ({
      mistake: args.mistake,
      theoryName: t.properties.name,
      patternName: pattern.properties.name,
      reason: t.edge_props?.reason,
    })))
  }

  return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
}

async function handleGetGraphStats() {
  const nodeCount = await pool.query('SELECT COUNT(*) FROM graph_nodes')
  const edgeCount = await pool.query('SELECT COUNT(*) FROM graph_edges')
  const nodesByType = await pool.query('SELECT type, COUNT(*) FROM graph_nodes GROUP BY type')
  const edgesByType = await pool.query('SELECT type, COUNT(*) FROM graph_edges GROUP BY type')

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        nodeCount: parseInt(nodeCount.rows[0].count),
        edgeCount: parseInt(edgeCount.rows[0].count),
        nodesByType: Object.fromEntries(nodesByType.rows.map(r => [r.type, parseInt(r.count)])),
        edgesByType: Object.fromEntries(edgesByType.rows.map(r => [r.type, parseInt(r.count)])),
      }, null, 2),
    }],
  }
}

// ── Handler Map ───────────────────────────────────────────

const HANDLERS = {
  getMemory: handleGetMemory,
  updateTradingProfile: handleUpdateTradingProfile,
  addImprovementPlan: handleAddImprovementPlan,
  updateConversationSummary: handleUpdateConversationSummary,
  graphQuery: handleGraphQuery,
  findRelatedTrades: handleFindRelatedTrades,
  findPatternPath: handleFindPatternPath,
  getGraphStats: handleGetGraphStats,
}

// ── Server Setup ──────────────────────────────────────────

const server = new Server(
  { name: 'trade-review-memory-graph', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const handler = HANDLERS[name]

  if (!handler) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    }
  }

  try {
    return await handler((args ?? {}))
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }],
      isError: true,
    }
  }
})

// ── Start ─────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] Memory + Graph Server started')
}

main().catch(console.error)
