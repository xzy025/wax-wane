import type { ToolModule } from '../types'

export const schema = {
  name: 'searchWeb',
  description:
    '联网搜索最新资讯。用于获取A股市场新闻、个股分析、行业动态、政策影响等信息。' +
    '当用户询问市场动态、个股新闻、行业分析时使用。',
  parameters: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词，如 "宁德时代 最新分析"、"A股 消费电子板块"',
      },
      count: {
        type: 'number',
        description: '返回结果数量，默认5',
      },
    },
    required: ['query'],
  },
}

export async function execute(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query : ''
  const count = typeof args.count === 'number' ? args.count : 5

  if (!query) {
    return { error: 'Search query is required.' }
  }

  const res = await fetch(`/api/web/search?q=${encodeURIComponent(query)}&count=${count}`)
  if (!res.ok) {
    const text = await res.text()
    return { error: `Search failed: ${res.status} ${text}` }
  }
  return res.json()
}

export const searchWeb: ToolModule = { schema, execute }
