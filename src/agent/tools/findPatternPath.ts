import type { ToolModule } from '../types'

export const findPatternPath: ToolModule = {
  schema: {
    name: 'findPatternPath',
    description: '发现从交易错误到理论框架的推理路径。例如：追高买入 → Wyckoff 派发期。',
    parameters: {
      type: 'object',
      properties: {
        mistake: {
          type: 'string',
          description: '错误名称，如: 追高买入, 扛单不止损, 频繁交易, 过早止盈, 逆势操作',
        },
      },
      required: ['mistake'],
    },
  },

  execute: async (args) => {
    const { mistake } = args

    try {
      const res = await fetch('/api/mcp/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryType: 'findPatternPath',
          params: { mistake },
        }),
      })

      if (!res.ok) {
        const err = await res.text()
        return { error: `Query failed: ${err}` }
      }

      const results = await res.json()

      if (!Array.isArray(results) || results.length === 0) {
        return {
          message: `未找到 "${mistake}" 的理论路径`,
          suggestion: '可能需要先在复盘中标记错误，或同步知识库',
          results: [],
        }
      }

      return {
        mistake,
        paths: results.map((r: Record<string, unknown>) => ({
          theory: r.theoryName,
          pattern: r.patternName,
          relatedTrades: r.tradeCount,
          explanation: `${mistake} → ${r.patternName} → ${r.theoryName}`,
        })),
        summary: `"${mistake}" 与 ${results.length} 个理论框架关联，涉及 ${results.reduce((s: number, r: Record<string, unknown>) => s + ((r.tradeCount as number) ?? 0), 0)} 笔交易`,
      }
    } catch (err) {
      return { error: `Query error: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  },
}
