import type { ToolModule } from '../types'

export const schema = {
  name: 'getStockNews',
  description:
    '获取A股个股最新新闻资讯（来自东方财富）。' +
    '返回新闻标题、时间、来源、摘要。用于消息面分析。',
  parameters: {
    type: 'object' as const,
    properties: {
      stockCode: {
        type: 'string',
        description: '6位股票代码，如 "300750"（宁德时代）',
      },
      count: {
        type: 'number',
        description: '返回新闻数量，默认10',
      },
    },
    required: ['stockCode'],
  },
}

export async function execute(args: Record<string, unknown>): Promise<unknown> {
  const code = typeof args.stockCode === 'string' ? args.stockCode : ''
  const count = typeof args.count === 'number' ? args.count : 10

  if (!code) {
    return { error: 'Stock code is required.' }
  }

  const res = await fetch(`/api/stock/news?code=${code}&count=${count}`)
  if (!res.ok) {
    const text = await res.text()
    return { error: `Failed to fetch news: ${res.status} ${text}` }
  }
  return res.json()
}

export const getStockNews: ToolModule = { schema, execute }
