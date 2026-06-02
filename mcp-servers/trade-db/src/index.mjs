#!/usr/bin/env node

// Trade Database MCP Server
// Provides tools for querying trades, trade groups, and review notes

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
  {
    name: 'queryTrades',
    description: '查询交易记录，支持按股票代码、日期范围、买卖方向筛选',
    inputSchema: {
      type: 'object',
      properties: {
        stock_code: { type: 'string', description: '股票代码' },
        start_date: { type: 'string', description: '开始日期 YYYY-MM-DD' },
        end_date: { type: 'string', description: '结束日期 YYYY-MM-DD' },
        side: { type: 'string', description: '买卖方向: buy, sell', enum: ['buy', 'sell'] },
        limit: { type: 'string', description: '返回数量限制' },
      },
    },
  },
  {
    name: 'getTradeGroups',
    description: '查询交易组，支持按状态和股票代码筛选',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '状态: open, closed', enum: ['open', 'closed'] },
        stock_code: { type: 'string', description: '股票代码' },
      },
    },
  },
  {
    name: 'upsertReviewNote',
    description: '创建或更新复盘笔记',
    inputSchema: {
      type: 'object',
      properties: {
        trade_group_id: { type: 'string', description: '交易组 ID' },
        buy_reason: { type: 'string', description: '买入原因' },
        sell_reason: { type: 'string', description: '卖出原因' },
        execution_review: { type: 'string', description: '执行复盘' },
        lesson: { type: 'string', description: '经验教训' },
      },
      required: ['trade_group_id'],
    },
  },
  {
    name: 'getReviewNote',
    description: '获取指定交易组的复盘笔记',
    inputSchema: {
      type: 'object',
      properties: {
        trade_group_id: { type: 'string', description: '交易组 ID' },
      },
      required: ['trade_group_id'],
    },
  },
]

// ── Tool Handlers ─────────────────────────────────────────

async function handleQueryTrades(args) {
  let sql = 'SELECT * FROM trades WHERE 1=1'
  const params = []
  let i = 1

  if (args.stock_code) { sql += ` AND stock_code = $${i++}`; params.push(args.stock_code) }
  if (args.start_date) { sql += ` AND trade_date >= $${i++}`; params.push(args.start_date) }
  if (args.end_date) { sql += ` AND trade_date <= $${i++}`; params.push(args.end_date) }
  if (args.side) { sql += ` AND side = $${i++}`; params.push(args.side) }
  sql += ' ORDER BY trade_date DESC'
  if (args.limit) { sql += ` LIMIT $${i++}`; params.push(parseInt(args.limit)) }

  const result = await pool.query(sql, params)
  return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] }
}

async function handleGetTradeGroups(args) {
  let sql = 'SELECT * FROM trade_groups WHERE 1=1'
  const params = []
  let i = 1

  if (args.status) { sql += ` AND status = $${i++}`; params.push(args.status) }
  if (args.stock_code) { sql += ` AND stock_code = $${i++}`; params.push(args.stock_code) }
  sql += ' ORDER BY opened_at DESC'

  const result = await pool.query(sql, params)
  return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] }
}

async function handleUpsertReviewNote(args) {
  const now = new Date().toISOString()
  const existing = await pool.query(
    'SELECT id FROM review_notes WHERE trade_group_id = $1',
    [args.trade_group_id],
  )

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE review_notes SET buy_reason = $1, sell_reason = $2, execution_review = $3, lesson = $4, updated_at = $5
       WHERE trade_group_id = $6`,
      [args.buy_reason, args.sell_reason, args.execution_review, args.lesson, now, args.trade_group_id],
    )
  } else {
    await pool.query(
      `INSERT INTO review_notes (id, trade_group_id, buy_reason, sell_reason, execution_review, lesson, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [crypto.randomUUID(), args.trade_group_id, args.buy_reason, args.sell_reason, args.execution_review, args.lesson, now, now],
    )
  }

  return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }
}

async function handleGetReviewNote(args) {
  const result = await pool.query(
    'SELECT * FROM review_notes WHERE trade_group_id = $1',
    [args.trade_group_id],
  )

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result.rows[0] ?? { message: 'No review note found' }, null, 2),
    }],
  }
}

// ── Handler Map ───────────────────────────────────────────

const HANDLERS = {
  queryTrades: handleQueryTrades,
  getTradeGroups: handleGetTradeGroups,
  upsertReviewNote: handleUpsertReviewNote,
  getReviewNote: handleGetReviewNote,
}

// ── Server Setup ──────────────────────────────────────────

const server = new Server(
  { name: 'trade-review-trade-db', version: '1.0.0' },
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
  console.error('[MCP] Trade DB Server started')
}

main().catch(console.error)
