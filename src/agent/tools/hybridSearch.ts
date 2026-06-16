import type { ToolModule } from '../types'

interface HybridResult {
  id: string
  text: string
  score: number
  fusedScore?: number
  ranks?: { dense?: number; lexical?: number }
  metadata?: { type?: string }
}

export const hybridSearch: ToolModule = {
  schema: {
    name: 'hybridSearch',
    description:
      '混合搜索：结合向量语义检索(dense)、BM25 关键词检索(lexical)的 RRF 融合，并叠加图关系遍历，找到最相关的交易经验和关联信息。',
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
    const { query, topK } = args
    const k = parseInt(topK as string, 10) || 5

    try {
      // 1. Vector + lexical hybrid retrieval (RRF fusion). Falls back to the
      //    dense-only endpoint if the hybrid route is unavailable (older server).
      let vectorResults: HybridResult[] = []
      let retrieval: Record<string, unknown> | undefined
      const hybridRes = await fetch(
        `/api/mcp/rag/hybrid-search?query=${encodeURIComponent(query as string)}&topK=${k}`,
      )
      if (hybridRes.ok) {
        const data = await hybridRes.json()
        vectorResults = (data.results ?? []) as HybridResult[]
        retrieval = data.meta
      } else {
        const ragRes = await fetch(
          `/api/mcp/rag/search?query=${encodeURIComponent(query as string)}&topK=${k}`,
        )
        if (ragRes.ok) vectorResults = await ragRes.json()
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
      const graphCount = Array.isArray(graphResults) ? graphResults.length : 0
      return {
        query,
        vectorMatches: vectorResults.length,
        graphConnections: graphCount,
        retrieval, // { denseCount, lexicalCount, fusedCount, reranked, traceId, tookMs }
        vectorResults: vectorResults.slice(0, k).map((r) => ({
          id: r.id,
          content: r.text,
          score: r.score,
          fusedScore: r.fusedScore,
          ranks: r.ranks,
          type: r.metadata?.type,
        })),
        graphResults: Array.isArray(graphResults) ? graphResults.slice(0, 5) : [],
        summary: `Found ${vectorResults.length} fused matches (${retrieval ? `dense ${retrieval.denseCount} + lexical ${retrieval.lexicalCount}` : 'dense-only'}) and ${graphCount} graph connections for "${query}"`,
      }
    } catch (err) {
      return { error: `Hybrid search error: ${err instanceof Error ? err.message : 'Unknown'}` }
    }
  },
}
