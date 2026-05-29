import type { ToolModule } from '../types'

export const getIndexTrends: ToolModule = {
  schema: {
    name: 'getIndexTrends',
    description: '获取大盘指数当日分时走势数据（价格、成交量、均价）。用于分析大盘日内走势形态。',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '指数代码，如 000001（上证指数）、399001（深证成指）、399006（创业板指）',
        },
      },
      required: ['code'],
    },
  },

  async execute(args) {
    const { code } = args as { code: string }
    const res = await fetch(`/api/mcp/ashare/trends?code=${code}`)
    if (!res.ok) {
      const err = await res.text()
      return { error: `Failed to fetch trends: ${err}` }
    }
    return res.json()
  },
}
