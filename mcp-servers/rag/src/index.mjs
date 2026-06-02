#!/usr/bin/env node

// RAG MCP Server
// Provides tools for semantic search, vector sync, and document management

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import pg from 'pg'

const { Pool } = pg

// ── Database Connection ───────────────────────────────────

const pool = new Pool({
  host: process.env.PG_HOST ?? 'localhost',
  port: parseInt(process.env.PG_PORT ?? '5432'),
  database: process.env.PG_DATABASE ?? 'trade_review',
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD ?? 'postgres',
})

// ── Embedding (simple fallback) ───────────────────────────

function simpleEmbed(text, dim = 1536) {
  const vector = new Array(dim).fill(0)
  const tokens = text.match(/[一-鿿]|[a-zA-Z]+/g) || []
  for (const token of tokens) {
    let hash = 0
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) | 0
    }
    vector[Math.abs(hash) % dim] += 1
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0))
  if (norm > 0) vector.forEach((_, i) => vector[i] /= norm)
  return vector
}

// ── Tool Definitions ──────────────────────────────────────

const TOOLS = [
  {
    name: 'semanticSearch',
    description: '语义搜索交易历史和复盘笔记，基于向量相似度匹配',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询文本' },
        topK: { type: 'string', description: '返回结果数量，默认 5' },
        type: { type: 'string', description: '搜索类型: trade_group, review_note, all', enum: ['trade_group', 'review_note', 'all'] },
      },
      required: ['query'],
    },
  },
  {
    name: 'syncTradeGroups',
    description: '同步交易组数据到向量库',
    inputSchema: {
      type: 'object',
      properties: {
        tradeGroups: { type: 'string', description: '交易组数据 JSON 数组' },
        reviewNotes: { type: 'string', description: '复盘笔记 JSON 对象' },
      },
      required: ['tradeGroups'],
    },
  },
  {
    name: 'getDocumentCount',
    description: '获取向量库中的文档数量统计',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'hybridSearch',
    description: '混合搜索：结合向量语义搜索和图关系遍历',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询' },
        topK: { type: 'string', description: '返回数量' },
      },
      required: ['query'],
    },
  },
]

// ── Tool Handlers ─────────────────────────────────────────

async function handleSemanticSearch(args) {
  const query = args.query
  const topK = parseInt(args.topK || '5')
  const type = args.type || 'all'

  const embedding = simpleEmbed(query)

  const results = []

  if (type === 'all' || type === 'trade_group') {
    try {
      const tgResult = await pool.query(`
        SELECT id, stock_code, stock_name, pnl, return_rate, strategy, mistakes_json, status,
               embedding <-> $1::vector AS distance
        FROM trade_groups
        WHERE embedding IS NOT NULL
        ORDER BY distance
        LIMIT $2
      `, [JSON.stringify(embedding), topK])

      results.push(...tgResult.rows.map(r => ({
        type: 'trade_group',
        id: r.id,
        content: `${r.stock_name}(${r.stock_code}) PnL:${r.pnl} 策略:${r.strategy || 'N/A'} 错误:${r.mistakes_json}`,
        score: 1 - parseFloat(r.distance),
      })))
    } catch (err) {
      // Table might not have embeddings
    }
  }

  if (type === 'all' || type === 'review_note') {
    try {
      const rnResult = await pool.query(`
        SELECT id, trade_group_id, buy_reason, sell_reason, execution_review, lesson,
               embedding <-> $1::vector AS distance
        FROM review_notes
        WHERE embedding IS NOT NULL
        ORDER BY distance
        LIMIT $2
      `, [JSON.stringify(embedding), topK])

      results.push(...rnResult.rows.map(r => ({
        type: 'review_note',
        id: r.id,
        tradeGroupId: r.trade_group_id,
        content: `买入:${r.buy_reason || 'N/A'} 卖出:${r.sell_reason || 'N/A'} 教训:${r.lesson || 'N/A'}`,
        score: 1 - parseFloat(r.distance),
      })))
    } catch (err) {
      // Table might not have embeddings
    }
  }

  // Sort by score and limit
  results.sort((a, b) => b.score - a.score)
  const limited = results.slice(0, topK)

  return { content: [{ type: 'text', text: JSON.stringify(limited, null, 2) }] }
}

async function handleSyncTradeGroups(args) {
  const tradeGroups = JSON.parse(args.tradeGroups || '[]')
  const reviewNotes = JSON.parse(args.reviewNotes || '{}')

  let synced = 0

  for (const group of tradeGroups) {
    const text = `${group.name} ${group.code} ${group.strategy || ''} ${group.mistakes?.join(' ') || ''}`
    const embedding = simpleEmbed(text)

    try {
      await pool.query(`
        INSERT INTO trade_groups (id, stock_code, stock_name, opened_at, status, pnl, return_rate, strategy, mistakes_json, embedding, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          embedding = $10::vector,
          updated_at = NOW()
      `, [
        group.id, group.code, group.name, group.opened,
        group.closed ? 'closed' : 'open',
        group.pnl, group.returnRate, group.strategy,
        JSON.stringify(group.mistakes || []),
        JSON.stringify(embedding),
      ])
      synced++
    } catch (err) {
      console.error(`[RAG] Sync failed for ${group.id}:`, err.message)
    }
  }

  // Sync review notes
  for (const [groupId, note] of Object.entries(reviewNotes)) {
    const text = `${note.buyReason || ''} ${note.sellReason || ''} ${note.lesson || ''}`
    const embedding = simpleEmbed(text)

    try {
      await pool.query(`
        INSERT INTO review_notes (id, trade_group_id, buy_reason, sell_reason, execution_review, lesson, embedding, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::vector, NOW(), NOW())
        ON CONFLICT (trade_group_id) DO UPDATE SET
          buy_reason = $3, sell_reason = $4, execution_review = $5, lesson = $6,
          embedding = $7::vector, updated_at = NOW()
      `, [
        `rn-${groupId}`, groupId,
        note.buyReason, note.sellReason, note.executionReview, note.lesson,
        JSON.stringify(embedding),
      ])
    } catch (err) {
      console.error(`[RAG] Sync note failed for ${groupId}:`, err.message)
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ synced, total: tradeGroups.length }),
    }],
  }
}

async function handleGetDocumentCount() {
  try {
    const tgCount = await pool.query('SELECT COUNT(*) FROM trade_groups WHERE embedding IS NOT NULL')
    const rnCount = await pool.query('SELECT COUNT(*) FROM review_notes WHERE embedding IS NOT NULL')

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          tradeGroups: parseInt(tgCount.rows[0].count),
          reviewNotes: parseInt(rnCount.rows[0].count),
          total: parseInt(tgCount.rows[0].count) + parseInt(rnCount.rows[0].count),
        }),
      }],
    }
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: err.message }),
      }],
    }
  }
}

async function handleHybridSearch(args) {
  // Combines semantic search with graph traversal
  const query = args.query
  const topK = parseInt(args.topK || '5')

  // 1. Semantic search
  const semanticResults = await handleSemanticSearch({ query, topK: String(topK) })
  const semantic = JSON.parse(semanticResults.content[0].text)

  // 2. Graph traversal (if available)
  let graphResults = []
  try {
    const graphRes = await pool.query(`
      SELECT n.id, n.type, n.properties
      FROM graph_nodes n
      WHERE n.properties::text ILIKE $1
      LIMIT $2
    `, [`%${query}%`, topK])
    graphResults = graphRes.rows
  } catch {
    // Graph tables might not exist
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        semantic,
        graph: graphResults,
        summary: `Found ${semantic.length} semantic matches and ${graphResults.length} graph nodes`,
      }, null, 2),
    }],
  }
}

// ── Handler Map ───────────────────────────────────────────

const HANDLERS = {
  semanticSearch: handleSemanticSearch,
  syncTradeGroups: handleSyncTradeGroups,
  getDocumentCount: handleGetDocumentCount,
  hybridSearch: handleHybridSearch,
}

// ── Server Setup ──────────────────────────────────────────

const server = new Server(
  { name: 'trade-review-rag', version: '1.0.0' },
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
  console.error('[MCP] RAG Server started')
}

main().catch(console.error)
