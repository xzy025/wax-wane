import type { ToolModule } from '../types'

export const hybridSearch: ToolModule = {
  schema: {
    name: 'hybridSearch',
    description: '混合搜索：结合向量语义搜索和图关系遍历，找到最相关的交易经验和关联信息。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询，如: "追高的交易", "白酒板块的操作", "Wyckoff 派发期"',
        },
        topK: {
          type: 'string',
          description: '返回结果数量，默认 5',
        },
        graphDepth: {
          type: 'string',
          description: '图遍历深度，默认 2',
        },
      },
      required: ['query'],
    },
  },

  execute: async (args) => {
    const { query, topK, graphDepth } = args

    try {
      // 1. Vector search (existing RAG)
      const ragRes = await fetch(`/api/mcp/rag/search?query=${encodeURIComponent(query as string)}&topK=${topK || 5}`)
      let vectorResults: Array<{ id: string; content: string; score: number; type: string }> = []
      if (ragRes.ok) {
        vectorResults = await ragRes.json()
      }

      // 2. Graph query (find related entities)
      const graphRes = await fetch('/api/mcp/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryType: 'multiHop',
          params: {
            startType: 'TradeGroup',
            startFilter: {},
            hops: [
              { relation: 'HAS_MISTAKE', targetType: 'Mistake' },
              { relation: 'LINKED_TO', targetType: 'Theory' },
            ],
          },
        }),
      })

      let graphResults: unknown = []
      if (graphRes.ok) {
        graphResults = await graphRes.json()
      }

      // 3. Combine results
      return {
        query,
        vectorMatches: vectorResults.length,
        graphConnections: Array.isArray(graphResults) ? graphResults.length : 0,
        vectorResults: vectorResults.slice(0, parseInt(topK as string) || 5),
        graphResults: Array.isArray(graphResults) ? graphResults.slice(0, 5) : [],
        summary: `Found ${vectorResults.length} semantic matches and ${Array.isArray(graphResults) ? graphResults.length : 0} graph connections for "${query}"`,
      }
    } catch (err) {
      return { error: `Hybrid search error: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  },
}
