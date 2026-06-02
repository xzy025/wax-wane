// GraphRAG Schema — PG adjacency list implementation
import pg from 'pg'
import { config } from 'dotenv'

config()

const { Pool } = pg

const pool = new Pool({
  host: process.env.PG_HOST ?? 'localhost',
  port: parseInt(process.env.PG_PORT ?? '5432'),
  database: process.env.PG_DATABASE ?? 'trade_review',
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD ?? 'postgres',
})

// ── Entity Types ──────────────────────────────────────────

export type EntityType =
  | 'TradeGroup'
  | 'Stock'
  | 'Sector'
  | 'Mistake'
  | 'Strategy'
  | 'Theory'
  | 'MarketPhase'
  | 'Lesson'
  | 'Pattern'
  | 'User'
  | 'MacroIndicator'
  | 'NewsEvent'

// ── Relation Types ────────────────────────────────────────

export type RelationType =
  | 'BELONGS_TO'          // TradeGroup → Sector
  | 'INVOLVES'            // TradeGroup → Stock
  | 'HAS_MISTAKE'         // TradeGroup → Mistake
  | 'USED_STRATEGY'       // TradeGroup → Strategy
  | 'OCCURRED_DURING'     // TradeGroup → MarketPhase
  | 'GENERATED'           // TradeGroup → Lesson
  | 'VIOLATES'            // Mistake → Theory
  | 'APPLIES_TO'          // Lesson → Pattern
  | 'LINKED_TO'           // Pattern → Theory
  | 'PRONE_TO'            // User → Mistake
  | 'FOLLOWS'             // User → Strategy
  | 'IN_SECTOR'           // Stock → Sector
  | 'CORRELATED_WITH'     // Sector → Sector
  | 'CHARACTERIZED_BY'    // MarketPhase → MacroIndicator
  | 'AFFECTS'             // NewsEvent → Sector

// ── Node / Edge Types ─────────────────────────────────────

export interface GraphNode {
  id: string
  type: EntityType
  properties: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface GraphEdge {
  id?: number
  source_id: string
  target_id: string
  type: RelationType
  properties?: Record<string, unknown>
  created_at?: string
}

// ── Schema Initialization ─────────────────────────────────

export async function initGraphSchema(): Promise<void> {
  const client = await pool.connect()
  try {
    // Nodes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        properties JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Edges table
    await client.query(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        id SERIAL PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        properties JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(type)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(type)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_graph_edges_source_type ON graph_edges(source_id, type)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_graph_edges_target_type ON graph_edges(target_id, type)
    `)

    // Unique constraint: no duplicate edges of same type between same nodes
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_unique
      ON graph_edges(source_id, target_id, type)
    `)

    console.log('[GraphRAG] Schema initialized successfully')
  } finally {
    client.release()
  }
}

// ── Node CRUD ─────────────────────────────────────────────

export async function upsertNode(node: GraphNode): Promise<void> {
  await pool.query(
    `INSERT INTO graph_nodes (id, type, properties, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       type = EXCLUDED.type,
       properties = EXCLUDED.properties,
       updated_at = NOW()`,
    [node.id, node.type, JSON.stringify(node.properties)],
  )
}

export async function getNode(id: string): Promise<GraphNode | null> {
  const result = await pool.query(
    'SELECT id, type, properties, created_at, updated_at FROM graph_nodes WHERE id = $1',
    [id],
  )
  return result.rows[0] ?? null
}

export async function getNodesByType(type: EntityType): Promise<GraphNode[]> {
  const result = await pool.query(
    'SELECT id, type, properties, created_at, updated_at FROM graph_nodes WHERE type = $1 ORDER BY created_at DESC',
    [type],
  )
  return result.rows
}

export async function deleteNode(id: string): Promise<void> {
  // Edges are CASCADE deleted
  await pool.query('DELETE FROM graph_nodes WHERE id = $1', [id])
}

export async function findNodes(
  type: EntityType,
  filter: Record<string, unknown>,
): Promise<GraphNode[]> {
  const conditions = Object.entries(filter).map(([key, _value], i) => {
    return `properties->>'${key}' = $${i + 2}`
  })
  const sql = `SELECT id, type, properties FROM graph_nodes WHERE type = $1 ${conditions.length ? 'AND ' + conditions.join(' AND ') : ''}`
  const params = [type, ...Object.values(filter)]
  const result = await pool.query(sql, params)
  return result.rows
}

// ── Edge CRUD ─────────────────────────────────────────────

export async function upsertEdge(edge: GraphEdge): Promise<void> {
  await pool.query(
    `INSERT INTO graph_edges (source_id, target_id, type, properties)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_id, target_id, type) DO UPDATE SET
       properties = EXCLUDED.properties`,
    [edge.source_id, edge.target_id, edge.type, JSON.stringify(edge.properties ?? {})],
  )
}

export async function getEdgesFrom(
  sourceId: string,
  relationType?: RelationType,
): Promise<GraphEdge[]> {
  let sql = 'SELECT id, source_id, target_id, type, properties FROM graph_edges WHERE source_id = $1'
  const params: unknown[] = [sourceId]
  if (relationType) {
    sql += ' AND type = $2'
    params.push(relationType)
  }
  const result = await pool.query(sql, params)
  return result.rows
}

export async function getEdgesTo(
  targetId: string,
  relationType?: RelationType,
): Promise<GraphEdge[]> {
  let sql = 'SELECT id, source_id, target_id, type, properties FROM graph_edges WHERE target_id = $1'
  const params: unknown[] = [targetId]
  if (relationType) {
    sql += ' AND type = $2'
    params.push(relationType)
  }
  const result = await pool.query(sql, params)
  return result.rows
}

export async function deleteEdge(
  sourceId: string,
  targetId: string,
  relationType: RelationType,
): Promise<void> {
  await pool.query(
    'DELETE FROM graph_edges WHERE source_id = $1 AND target_id = $2 AND type = $3',
    [sourceId, targetId, relationType],
  )
}

// ── Graph Traversal ───────────────────────────────────────

/** Multi-hop traversal: find nodes connected to a start node */
export async function traverse(
  startId: string,
  options: {
    direction?: 'outgoing' | 'incoming' | 'both'
    relationTypes?: RelationType[]
    depth?: number
    targetTypes?: EntityType[]
  } = {},
): Promise<Array<{ node: GraphNode; edge: GraphEdge; depth: number }>> {
  const {
    direction = 'both',
    relationTypes,
    depth = 2,
    targetTypes,
  } = options

  const results: Array<{ node: GraphNode; edge: GraphEdge; depth: number }> = []
  const visited = new Set<string>()
  const queue: Array<{ nodeId: string; currentDepth: number }> = [{ nodeId: startId, currentDepth: 0 }]

  while (queue.length > 0) {
    const { nodeId, currentDepth } = queue.shift()!
    if (currentDepth >= depth) continue
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    // Get outgoing edges
    if (direction === 'outgoing' || direction === 'both') {
      const edges = await getEdgesFrom(nodeId)
      for (const edge of edges) {
        if (relationTypes && !relationTypes.includes(edge.type)) continue
        const targetNode = await getNode(edge.target_id)
        if (!targetNode) continue
        if (targetTypes && !targetTypes.includes(targetNode.type)) continue

        results.push({ node: targetNode, edge, depth: currentDepth + 1 })
        queue.push({ nodeId: edge.target_id, currentDepth: currentDepth + 1 })
      }
    }

    // Get incoming edges
    if (direction === 'incoming' || direction === 'both') {
      const edges = await getEdgesTo(nodeId)
      for (const edge of edges) {
        if (relationTypes && !relationTypes.includes(edge.type)) continue
        const sourceNode = await getNode(edge.source_id)
        if (!sourceNode) continue
        if (targetTypes && !targetTypes.includes(sourceNode.type)) continue

        results.push({ node: sourceNode, edge, depth: currentDepth + 1 })
        queue.push({ nodeId: edge.source_id, currentDepth: currentDepth + 1 })
      }
    }
  }

  return results
}

/** Find paths between two nodes */
export async function findPaths(
  startId: string,
  endId: string,
  maxDepth: number = 3,
): Promise<Array<Array<{ node: GraphNode; edge: GraphEdge }>>> {
  const paths: Array<Array<{ node: GraphNode; edge: GraphEdge }>> = []

  async function dfs(
    currentId: string,
    path: Array<{ node: GraphNode; edge: GraphEdge }>,
    visited: Set<string>,
  ) {
    if (path.length > maxDepth) return
    if (currentId === endId && path.length > 0) {
      paths.push([...path])
      return
    }

    visited.add(currentId)

    // Try outgoing edges
    const edges = await getEdgesFrom(currentId)
    for (const edge of edges) {
      if (visited.has(edge.target_id)) continue
      const targetNode = await getNode(edge.target_id)
      if (!targetNode) continue

      path.push({ node: targetNode, edge })
      await dfs(edge.target_id, path, visited)
      path.pop()
    }

    visited.delete(currentId)
  }

  await dfs(startId, [], new Set([startId]))
  return paths
}

// ── Statistics ────────────────────────────────────────────

export async function getGraphStats(): Promise<{
  nodeCount: number
  edgeCount: number
  nodesByType: Record<string, number>
  edgesByType: Record<string, number>
}> {
  const [nodeCount, edgeCount, nodesByType, edgesByType] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM graph_nodes'),
    pool.query('SELECT COUNT(*) FROM graph_edges'),
    pool.query('SELECT type, COUNT(*) FROM graph_nodes GROUP BY type'),
    pool.query('SELECT type, COUNT(*) FROM graph_edges GROUP BY type'),
  ])

  return {
    nodeCount: parseInt(nodeCount.rows[0].count),
    edgeCount: parseInt(edgeCount.rows[0].count),
    nodesByType: Object.fromEntries(nodesByType.rows.map((r) => [r.type, parseInt(r.count)])),
    edgesByType: Object.fromEntries(edgesByType.rows.map((r) => [r.type, parseInt(r.count)])),
  }
}

// ── Pool Export ────────────────────────────────────────────

export { pool }
