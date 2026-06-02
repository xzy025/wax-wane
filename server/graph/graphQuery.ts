// Graph Query — Hybrid search (vector + graph) and multi-hop reasoning
import {
  getNode,
  getNodesByType,
  traverse,
  findPaths,
  findNodes,
  type EntityType,
  type RelationType,
  type GraphNode,
} from './graphSchema'

// ── Query Types ───────────────────────────────────────────

export interface GraphQueryResult {
  nodes: GraphNode[]
  paths: Array<Array<{ nodeId: string; nodeType: string; properties: Record<string, unknown> }>>
  summary: string
}

export interface HybridSearchResult {
  vectorResults: Array<{ id: string; content: string; score: number; type: string }>
  graphResults: GraphQueryResult
  combinedSummary: string
}

// ── Graph Queries ─────────────────────────────────────────

/**
 * Find all trade groups with a specific mistake.
 * Path: TradeGroup -[HAS_MISTAKE]-> Mistake
 */
export async function findTradesByMistake(
  mistakeName: string,
): Promise<Array<{ tradeGroup: GraphNode; otherMistakes: string[] }>> {
  const mistakeNodes = await findNodes('Mistake', { name: mistakeName })
  if (mistakeNodes.length === 0) return []

  const results: Array<{ tradeGroup: GraphNode; otherMistakes: string[] }> = []

  for (const mistakeNode of mistakeNodes) {
    // Find trade groups pointing to this mistake
    const connected = await traverse(mistakeNode.id, {
      direction: 'incoming',
      relationTypes: ['HAS_MISTAKE'],
      depth: 1,
      targetTypes: ['TradeGroup'],
    })

    for (const { node: tgNode } of connected) {
      // Get other mistakes for this trade group
      const mistakeEdges = await traverse(tgNode.id, {
        direction: 'outgoing',
        relationTypes: ['HAS_MISTAKE'],
        depth: 1,
      })
      const otherMistakes = mistakeEdges
        .map((e) => e.node.properties.name as string)
        .filter((n) => n !== mistakeName)

      results.push({ tradeGroup: tgNode, otherMistakes })
    }
  }

  return results
}

/**
 * Find trades that occurred during a specific market phase.
 * Path: TradeGroup -[OCCURRED_DURING]-> MarketPhase
 */
export async function findTradesByPhase(
  phaseType: 'wyckoff' | 'dow' | 'sentiment',
  phaseValue: string,
): Promise<GraphNode[]> {
  const allPhases = await getNodesByType('MarketPhase')
  const matchingPhases = allPhases.filter((p) => {
    switch (phaseType) {
      case 'wyckoff': return p.properties.wyckoffPhase === phaseValue
      case 'dow': return p.properties.dowTrend === phaseValue
      case 'sentiment': return p.properties.sentimentPhase === phaseValue
      default: return false
    }
  })

  const results: GraphNode[] = []
  for (const phase of matchingPhases) {
    const connected = await traverse(phase.id, {
      direction: 'incoming',
      relationTypes: ['OCCURRED_DURING'],
      depth: 1,
      targetTypes: ['TradeGroup'],
    })
    results.push(...connected.map((c) => c.node))
  }

  return results
}

/**
 * Find related trades through shared attributes.
 * Path: TradeGroup -> Stock/Strategy/Sector <- TradeGroup
 */
export async function findRelatedTrades(
  tradeGroupId: string,
  relationTypes: RelationType[] = ['INVOLVES', 'USED_STRATEGY', 'BELONGS_TO'],
): Promise<Array<{ relatedTg: GraphNode; sharedAttribute: string; attributeType: string }>> {
  const tgId = tradeGroupId.startsWith('tg:') ? tradeGroupId : `tg:${tradeGroupId}`
  const results: Array<{ relatedTg: GraphNode; sharedAttribute: string; attributeType: string }> = []

  // Get connected nodes (Stock, Strategy, Sector)
  const connected = await traverse(tgId, {
    direction: 'outgoing',
    relationTypes,
    depth: 1,
  })

  for (const { node: sharedNode, edge } of connected) {
    // Find other trade groups connected to the same node
    const related = await traverse(sharedNode.id, {
      direction: 'incoming',
      relationTypes: [edge.type],
      depth: 1,
      targetTypes: ['TradeGroup'],
    })

    for (const { node: relatedTg } of related) {
      if (relatedTg.id === tgId) continue // Skip self
      results.push({
        relatedTg,
        sharedAttribute: (sharedNode.properties.name as string) ?? (sharedNode.properties.code as string),
        attributeType: edge.type,
      })
    }
  }

  return results
}

/**
 * Find pattern paths: how a mistake connects to a theory.
 * Path: Mistake <-[HAS_MISTAKE]- TradeGroup ... Pattern -[LINKED_TO]-> Theory
 */
export async function findPatternPath(
  mistakeName: string,
): Promise<Array<{
  mistake: string
  theory: string
  theoryName: string
  patternName: string
  tradeCount: number
}>> {
  const results: Array<{
    mistake: string
    theory: string
    theoryName: string
    patternName: string
    tradeCount: number
  }> = []

  // Find the mistake node
  const mistakeNodes = await findNodes('Mistake', { name: mistakeName })
  if (mistakeNodes.length === 0) return results

  // Find patterns linked to this mistake (via pattern name matching)
  const patternNodes = await getNodesByType('Pattern')
  for (const pattern of patternNodes) {
    if (pattern.properties.name === mistakeName) {
      // Find theories linked to this pattern
      const connected = await traverse(pattern.id, {
        direction: 'outgoing',
        relationTypes: ['LINKED_TO'],
        depth: 1,
        targetTypes: ['Theory'],
      })

      // Count trades with this mistake
      const trades = await findTradesByMistake(mistakeName)

      for (const { node: theoryNode, edge } of connected) {
        results.push({
          mistake: mistakeName,
          theory: theoryNode.id,
          theoryName: theoryNode.properties.name as string,
          patternName: pattern.properties.name as string,
          tradeCount: trades.length,
        })
      }
    }
  }

  return results
}

/**
 * Hybrid search: combine vector similarity with graph traversal.
 * 1. Vector search finds semantically similar documents
 * 2. Graph traversal finds related entities through relationships
 */
export async function hybridSearch(
  query: string,
  vectorSearchFn: (query: string, topK: number) => Promise<Array<{ id: string; content: string; score: number; type: string }>>,
  options: {
    vectorTopK?: number
    graphDepth?: number
    relationTypes?: RelationType[]
  } = {},
): Promise<HybridSearchResult> {
  const { vectorTopK = 5, graphDepth = 2, relationTypes } = options

  // 1. Vector search
  const vectorResults = await vectorSearchFn(query, vectorTopK)

  // 2. Extract entity IDs from vector results
  const entityIds = vectorResults
    .map((r) => r.id)
    .filter(Boolean)

  // 3. Graph traversal from found entities
  const graphNodes: GraphNode[] = []
  const graphPaths: Array<Array<{ nodeId: string; nodeType: string; properties: Record<string, unknown> }>> = []

  for (const entityId of entityIds) {
    try {
      // Try to find the node in the graph
      const node = await getNode(entityId)
      if (!node) continue

      // Traverse from this node
      const connected = await traverse(entityId, {
        direction: 'both',
        relationTypes,
        depth: graphDepth,
      })

      graphNodes.push(...connected.map((c) => c.node))

      // Build path representation
      for (const { node: connectedNode, edge, depth } of connected) {
        graphPaths.push([
          { nodeId: entityId, nodeType: node.type, properties: node.properties },
          { nodeId: connectedNode.id, nodeType: connectedNode.type, properties: connectedNode.properties },
        ])
      }
    } catch {
      // Entity not in graph, skip
    }
  }

  // 4. Deduplicate graph nodes
  const uniqueNodes = new Map<string, GraphNode>()
  for (const node of graphNodes) {
    if (!uniqueNodes.has(node.id)) {
      uniqueNodes.set(node.id, node)
    }
  }

  // 5. Build summary
  const summaryParts: string[] = []
  summaryParts.push(`Found ${vectorResults.length} vector matches`)
  summaryParts.push(`Found ${uniqueNodes.size} related graph entities`)

  const nodeTypes = new Map<string, number>()
  for (const node of uniqueNodes.values()) {
    nodeTypes.set(node.type, (nodeTypes.get(node.type) ?? 0) + 1)
  }
  for (const [type, count] of nodeTypes) {
    summaryParts.push(`  - ${type}: ${count}`)
  }

  return {
    vectorResults,
    graphResults: {
      nodes: Array.from(uniqueNodes.values()),
      paths: graphPaths,
      summary: summaryParts.join('\n'),
    },
    combinedSummary: `Hybrid search for "${query}":\n${summaryParts.join('\n')}`,
  }
}

/**
 * Multi-hop reasoning: answer complex questions by traversing the graph.
 * Example: "我在 Wyckoff 派发期犯了哪些错误？"
 */
export async function multiHopQuery(
  startType: EntityType,
  startFilter: Record<string, unknown>,
  hops: Array<{ relation: RelationType; targetType: EntityType }>,
): Promise<Array<GraphNode[]>> {
  // Find start nodes
  const startNodes = await findNodes(startType, startFilter)
  if (startNodes.length === 0) return []

  const allPaths: Array<GraphNode[]> = []

  for (const startNode of startNodes) {
    let currentNodes = [startNode]
    const path: GraphNode[] = [startNode]

    for (const hop of hops) {
      const nextNodes: GraphNode[] = []

      for (const currentNode of currentNodes) {
        const connected = await traverse(currentNode.id, {
          direction: 'outgoing',
          relationTypes: [hop.relation],
          depth: 1,
          targetTypes: [hop.targetType],
        })
        nextNodes.push(...connected.map((c) => c.node))
      }

      if (nextNodes.length === 0) break
      currentNodes = nextNodes
      path.push(...nextNodes)
    }

    if (path.length > 1) {
      allPaths.push(path)
    }
  }

  return allPaths
}
