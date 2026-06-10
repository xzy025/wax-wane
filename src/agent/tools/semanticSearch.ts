import type { ToolModule } from '../types'

export const semanticSearch: ToolModule = {
  schema: {
    name: 'semanticSearch',
    description:
      '语义检索历史交易经验和教训。当用户询问过去的交易模式、相似场景、历史教训、某类错误的经历时使用此工具。返回最相关的交易记录和复盘笔记。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '语义检索查询，如"追高亏损的经历"、"止损不及时的教训"、"新能源板块的交易"',
        },
        type: {
          type: 'string',
          enum: ['trade_group', 'review_note', 'lesson', 'fundamental_report', 'all'],
          description: '检索类型：trade_group(交易记录)、review_note(复盘笔记)、lesson(教训)、fundamental_report(基本面分析存档)、all(全部)',
        },
        topK: {
          type: 'number',
          description: '返回结果数量，默认 5',
        },
      },
      required: ['query'],
    },
  },

  async execute(args) {
    const { query, type = 'all', topK = 5 } = args as {
      query: string
      type?: string
      topK?: number
    }

    const params = new URLSearchParams({ query, type, topK: String(topK) })
    const res = await fetch(`/api/mcp/rag/search?${params}`)

    if (!res.ok) {
      const err = await res.text()
      return { error: `Semantic search failed: ${err}` }
    }

    return res.json()
  },
}
