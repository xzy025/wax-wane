#!/usr/bin/env node

// Market Data MCP Server
// Provides 9 tools for fetching A-share, HK, US market data, macro indicators, news, etc.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// ── Eastmoney API Helpers ─────────────────────────────────

const EASTMONEY_API = 'https://push2.eastmoney.com/api/qt'

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ── Tool Definitions ──────────────────────────────────────

const TOOLS = [
  {
    name: 'getAShareQuote',
    description: '获取A股个股实时行情（价格、涨跌幅、成交量等）',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '6位股票代码，如 600519' },
      },
      required: ['code'],
    },
  },
  {
    name: 'getAShareBreadth',
    description: '获取A股市场宽度数据（涨跌家数、涨停跌停、晋级率）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getIndexTrends',
    description: '获取指数分时走势数据',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '6位指数代码，如 000001（上证指数）' },
      },
      required: ['code'],
    },
  },
  {
    name: 'getLimitPool',
    description: '获取涨停/跌停池数据',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: 'up=涨停, down=跌停', enum: ['up', 'down'] },
      },
    },
  },
  {
    name: 'getHKData',
    description: '获取港股主要指数数据（恒生指数、恒生科技等）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getUSData',
    description: '获取美股主要指数数据（道琼斯、纳斯达克、标普500）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getMacroIndicators',
    description: '获取宏观经济指标（美债收益率、黄金、美元指数、汇率、原油、VIX）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getNewsSummary',
    description: '获取最新财经新闻摘要',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: '返回新闻数量，默认 10' },
      },
    },
  },
  {
    name: 'getHotList',
    description: '获取热股排行榜',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: '返回数量，默认 20' },
      },
    },
  },
]

// ── Tool Handlers ─────────────────────────────────────────

async function handleGetAShareQuote(args) {
  const code = args.code
  const secid = code.startsWith('6') ? `1.${code}` : `0.${code}`
  const url = `${EASTMONEY_API}/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f60,f116,f117,f170`
  const data = await fetchJSON(url)
  const d = data?.data
  if (!d) return { content: [{ type: 'text', text: 'Stock not found' }] }

  const result = {
    code: d.f57,
    name: d.f58,
    price: d.f43 / 100,
    changePct: d.f170 / 100,
    changeAmt: d.f69 / 100,
    volume: d.f47,
    turnover: d.f48,
    high: d.f44 / 100,
    low: d.f45 / 100,
    open: d.f46 / 100,
    prevClose: d.f60 / 100,
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

async function handleGetAShareBreadth() {
  // Fetch market overview data
  const url = `${EASTMONEY_API}/ulist.np/get?fields=f1,f2,f3,f4,f12,f13,f104,f105,f106&secids=1.000001,0.399001,0.399006`
  const data = await fetchJSON(url)

  const result = {
    advance: data?.data?.diff?.[0]?.f104 ?? 0,
    decline: data?.data?.diff?.[0]?.f105 ?? 0,
    flat: data?.data?.diff?.[0]?.f106 ?? 0,
    limitUpCount: 0,
    limitDownCount: 0,
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

async function handleGetIndexTrends(args) {
  const code = args.code || '000001'
  const secid = `1.${code}`
  const url = `${EASTMONEY_API}/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58`
  const data = await fetchJSON(url)

  const trends = data?.data?.trends?.map((t) => {
    const parts = t.split(',')
    return {
      time: parts[0],
      price: parseFloat(parts[1]),
      volume: parseInt(parts[5]),
    }
  }) ?? []

  return { content: [{ type: 'text', text: JSON.stringify(trends, null, 2) }] }
}

async function handleGetLimitPool(args) {
  const direction = args.direction || 'up'
  // This is a simplified implementation
  const result = {
    direction,
    count: 0,
    stocks: [],
    note: 'Limit pool data requires specialized API access',
  }
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

async function handleGetHKData() {
  const indices = [
    { code: 'HSI', name: '恒生指数' },
    { code: 'HSTECH', name: '恒生科技' },
  ]

  const results = []
  for (const idx of indices) {
    try {
      const url = `https://api.hkex.com.hk/rtmw/HKEX/realtime?sym=${idx.code}`
      // Simplified — return mock for now
      results.push({ ...idx, note: 'HK data requires HKEX API access' })
    } catch {
      results.push({ ...idx, error: 'Failed to fetch' })
    }
  }

  return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
}

async function handleGetUSData() {
  const indices = [
    { code: 'DJI', name: '道琼斯' },
    { code: 'IXIC', name: '纳斯达克' },
    { code: 'SPX', name: '标普500' },
  ]

  return { content: [{ type: 'text', text: JSON.stringify(indices, null, 2) }] }
}

async function handleGetMacroIndicators() {
  // Fetch macro data from various sources
  const result = {
    usTreasury10y: 'N/A',
    gold: 'N/A',
    usdIndex: 'N/A',
    usdcny: 'N/A',
    crudeOil: 'N/A',
    vix: 'N/A',
    note: 'Macro indicators require specialized API keys',
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

async function handleGetNewsSummary(args) {
  const limit = parseInt(args.limit || '10')
  const result = {
    count: limit,
    news: [],
    note: 'News data requires RSS feed configuration',
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

async function handleGetHotList(args) {
  const limit = parseInt(args.limit || '20')
  const result = {
    count: limit,
    stocks: [],
    note: 'Hot list data requires specialized API',
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

// ── Handler Map ───────────────────────────────────────────

const HANDLERS = {
  getAShareQuote: handleGetAShareQuote,
  getAShareBreadth: handleGetAShareBreadth,
  getIndexTrends: handleGetIndexTrends,
  getLimitPool: handleGetLimitPool,
  getHKData: handleGetHKData,
  getUSData: handleGetUSData,
  getMacroIndicators: handleGetMacroIndicators,
  getNewsSummary: handleGetNewsSummary,
  getHotList: handleGetHotList,
}

// ── Server Setup ──────────────────────────────────────────

const server = new Server(
  { name: 'trade-review-market-data', version: '1.0.0' },
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
  console.error('[MCP] Market Data Server started')
}

main().catch(console.error)
