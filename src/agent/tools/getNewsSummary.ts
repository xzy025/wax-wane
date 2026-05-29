import type { ToolModule } from '../types'

export const getNewsSummary: ToolModule = {
  schema: {
    name: 'getNewsSummary',
    description: '获取当日消息面汇总，来自配置的微信公众号 RSS 源。返回最新的新闻标题和摘要。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  async execute() {
    const res = await fetch('/api/mcp/news/summary')
    if (!res.ok) {
      const err = await res.text()
      return { error: `Failed to fetch news: ${err}` }
    }
    return res.json()
  },
}
