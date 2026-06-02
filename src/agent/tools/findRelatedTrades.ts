import type { ToolModule } from '../types'

export const findRelatedTrades: ToolModule = {
  schema: {
    name: 'findRelatedTrades',
    description: '找到与指定交易相关联的其他交易（通过相同股票、策略、板块、错误等关联）。',
    parameters: {
      type: 'object',
      properties: {
        tradeGroupId: {
          type: 'string',
          description: '交易组 ID',
        },
        relationTypes: {
          type: 'string',
          description: '要遍历的关系类型，逗号分隔。可选: INVOLVES,USED_STRATEGY,BELONGS_TO,HAS_MISTAKE',
        },
      },
      required: ['tradeGroupId'],
    },
  },

  execute: async (args) => {
    const { tradeGroupId, relationTypes } = args

    try {
      const res = await fetch('/api/mcp/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryType: 'findRelatedTrades',
          params: {
            tradeGroupId,
            relationTypes: relationTypes
              ? (relationTypes as string).split(',').map((s) => s.trim())
              : ['INVOLVES', 'USED_STRATEGY', 'BELONGS_TO'],
          },
        }),
      })

      if (!res.ok) {
        const err = await res.text()
        return { error: `Query failed: ${err}` }
      }

      const results = await res.json()

      // Format for agent consumption
      if (!Array.isArray(results) || results.length === 0) {
        return { message: '未找到关联交易', results: [] }
      }

      return {
        count: results.length,
        relatedTrades: results.map((r: Record<string, unknown>) => ({
          name: (r.relatedTg as Record<string, unknown>)?.properties
            ? ((r.relatedTg as Record<string, unknown>).properties as Record<string, unknown>).name
            : 'Unknown',
          sharedAttribute: r.sharedAttribute,
          attributeType: r.attributeType,
        })),
      }
    } catch (err) {
      return { error: `Query error: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  },
}
