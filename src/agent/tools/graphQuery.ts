import type { ToolModule } from '../types'

export const graphQuery: ToolModule = {
  schema: {
    name: 'graphQuery',
    description: '查询交易关系图，支持多跳推理。可以查找交易与错误、理论、板块、市场阶段之间的关系。',
    parameters: {
      type: 'object',
      properties: {
        queryType: {
          type: 'string',
          description: '查询类型',
          enum: ['findTradesByMistake', 'findTradesByPhase', 'findRelatedTrades', 'findPatternPath', 'multiHop'],
        },
        params: {
          type: 'string',
          description: '查询参数 JSON 字符串',
        },
      },
      required: ['queryType'],
    },
  },

  execute: async (args) => {
    const { queryType, params: paramsStr } = args
    let params: Record<string, unknown>

    try {
      params = paramsStr ? JSON.parse(paramsStr as string) : {}
    } catch {
      return { error: 'Invalid params JSON' }
    }

    try {
      const res = await fetch('/api/mcp/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryType, params }),
      })

      if (!res.ok) {
        const err = await res.text()
        return { error: `Graph query failed: ${err}` }
      }

      return await res.json()
    } catch (err) {
      return { error: `Graph query error: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  },
}
