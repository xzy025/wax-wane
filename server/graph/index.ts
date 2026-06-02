// ── GraphRAG Module ───────────────────────────────────────

// Schema
export {
  initGraphSchema,
  upsertNode,
  getNode,
  getNodesByType,
  deleteNode,
  findNodes,
  upsertEdge,
  getEdgesFrom,
  getEdgesTo,
  deleteEdge,
  traverse,
  findPaths,
  getGraphStats,
  type EntityType,
  type RelationType,
  type GraphNode,
  type GraphEdge,
} from './graphSchema'

// Sync
export {
  syncTradeGroupToGraph,
  syncReviewNoteToGraph,
  syncMarketPhaseToGraph,
  linkTradeGroupToPhase,
  syncTheoriesToGraph,
  fullGraphSync,
} from './graphSync'

// Query
export {
  findTradesByMistake,
  findTradesByPhase,
  findRelatedTrades,
  findPatternPath,
  hybridSearch,
  multiHopQuery,
  type GraphQueryResult,
  type HybridSearchResult,
} from './graphQuery'
