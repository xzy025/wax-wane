// Graph Sync — Automatically build graph from trade data
import {
  upsertNode,
  upsertEdge,
  getNodesByType,
  type EntityType,
  type RelationType,
} from './graphSchema'
import type { GraphNode, GraphEdge } from './graphSchema'

// ── Sector Mapping ────────────────────────────────────────

/** Map stock codes to sectors (simplified — can be extended) */
export function inferSector(stockCode: string, stockName: string): string {
  // A-share sector inference based on code prefix
  const code = stockCode.substring(0, 3)

  // Check name-based patterns first
  const nameLower = stockName.toLowerCase()
  if (nameLower.includes('银行') || nameLower.includes('工商') || nameLower.includes('建设')) return '银行'
  if (nameLower.includes('证券') || nameLower.includes('中信建投')) return '证券'
  if (nameLower.includes('保险') || nameLower.includes('平安')) return '保险'
  if (nameLower.includes('白酒') || nameLower.includes('茅台') || nameLower.includes('五粮液')) return '白酒'
  if (nameLower.includes('医药') || nameLower.includes('生物') || nameLower.includes('制药')) return '医药'
  if (nameLower.includes('半导体') || nameLower.includes('芯片') || nameLower.includes('中芯')) return '半导体'
  if (nameLower.includes('新能源') || nameLower.includes('锂电') || nameLower.includes('光伏') || nameLower.includes('宁德')) return '新能源'
  if (nameLower.includes('汽车') || nameLower.includes('比亚迪')) return '汽车'
  if (nameLower.includes('地产') || nameLower.includes('万科') || nameLower.includes('保利')) return '房地产'

  // Code-based fallback
  if (code === '600' || code === '601' || code === '603') return '沪市主板'
  if (code === '000' || code === '001') return '深市主板'
  if (code === '002') return '中小板'
  if (code === '300' || code === '301') return '创业板'
  if (code === '688' || code === '689') return '科创板'
  if (code === '830' || code === '831' || code === '832' || code === '833' ||
      code === '834' || code === '835' || code === '836' || code === '837' ||
      code === '838' || code === '839' || code === '870' || code === '871' ||
      code === '872' || code === '873') return '北交所'

  return '其他'
}

// ── Sync Functions ────────────────────────────────────────

/** Sync a single trade group to the graph */
export async function syncTradeGroupToGraph(group: {
  id: string
  stock_code: string
  stock_name: string
  status: string
  pnl: number
  return_rate?: number
  holding_days?: number
  strategy?: string
  mistakes_json?: string
  opened_at: string
  closed_at?: string
}): Promise<void> {
  // 1. Upsert TradeGroup node
  await upsertNode({
    id: `tg:${group.id}`,
    type: 'TradeGroup',
    properties: {
      name: `${group.stock_name} ${group.strategy ?? ''}`.trim(),
      code: group.stock_code,
      status: group.status,
      pnl: group.pnl,
      returnRate: group.return_rate,
      holdingDays: group.holding_days,
      openedAt: group.opened_at,
      closedAt: group.closed_at,
    },
  })

  // 2. Upsert Stock node
  const stockId = `stock:${group.stock_code}`
  await upsertNode({
    id: stockId,
    type: 'Stock',
    properties: {
      code: group.stock_code,
      name: group.stock_name,
    },
  })

  // 3. Upsert Sector node
  const sectorName = inferSector(group.stock_code, group.stock_name)
  const sectorId = `sector:${sectorName}`
  await upsertNode({
    id: sectorId,
    type: 'Sector',
    properties: { name: sectorName },
  })

  // 4. Create edges
  await upsertEdge({
    source_id: `tg:${group.id}`,
    target_id: stockId,
    type: 'INVOLVES',
  })

  await upsertEdge({
    source_id: `tg:${group.id}`,
    target_id: sectorId,
    type: 'BELONGS_TO',
  })

  await upsertEdge({
    source_id: stockId,
    target_id: sectorId,
    type: 'IN_SECTOR',
  })

  // 5. Create Mistake nodes and edges
  if (group.mistakes_json) {
    try {
      const mistakes = JSON.parse(group.mistakes_json) as string[]
      for (const mistake of mistakes) {
        const mistakeId = `mistake:${mistake}`
        await upsertNode({
          id: mistakeId,
          type: 'Mistake',
          properties: { name: mistake },
        })
        await upsertEdge({
          source_id: `tg:${group.id}`,
          target_id: mistakeId,
          type: 'HAS_MISTAKE',
        })
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // 6. Create Strategy node and edge
  if (group.strategy) {
    const strategyId = `strategy:${group.strategy}`
    await upsertNode({
      id: strategyId,
      type: 'Strategy',
      properties: { name: group.strategy },
    })
    await upsertEdge({
      source_id: `tg:${group.id}`,
      target_id: strategyId,
      type: 'USED_STRATEGY',
    })
  }
}

/** Sync review note to graph (creates Lesson nodes) */
export async function syncReviewNoteToGraph(note: {
  trade_group_id: string
  buy_reason?: string
  sell_reason?: string
  execution_review?: string
  lesson?: string
}): Promise<void> {
  if (note.lesson) {
    const lessonId = `lesson:${note.trade_group_id}`
    await upsertNode({
      id: lessonId,
      type: 'Lesson',
      properties: {
        content: note.lesson,
        tradeGroupId: note.trade_group_id,
      },
    })
    await upsertEdge({
      source_id: `tg:${note.trade_group_id}`,
      target_id: lessonId,
      type: 'GENERATED',
    })
  }
}

/** Sync market phase to graph */
export async function syncMarketPhaseToGraph(phase: {
  date: string
  wyckoffPhase: string
  dowTrend: string
  sentimentPhase: string
}): Promise<void> {
  const phaseId = `phase:${phase.date}`
  await upsertNode({
    id: phaseId,
    type: 'MarketPhase',
    properties: {
      date: phase.date,
      wyckoffPhase: phase.wyckoffPhase,
      dowTrend: phase.dowTrend,
      sentimentPhase: phase.sentimentPhase,
    },
  })
}

/** Link a trade group to a market phase */
export async function linkTradeGroupToPhase(
  tradeGroupId: string,
  phaseDate: string,
): Promise<void> {
  await upsertEdge({
    source_id: `tg:${tradeGroupId}`,
    target_id: `phase:${phaseDate}`,
    type: 'OCCURRED_DURING',
  })
}

/** Sync knowledge base theories to graph */
export async function syncTheoriesToGraph(): Promise<void> {
  const theories = [
    {
      id: 'theory:wyckoff',
      name: 'Wyckoff 量价理论',
      description: '通过成交量和价格关系判断主力行为，识别吸筹/派发阶段',
      phases: ['吸筹期', '标记上涨期', '派发期', '标记下跌期'],
    },
    {
      id: 'theory:dow',
      name: '道氏理论',
      description: '趋势判断的基石理论，识别主要趋势、次要趋势、短期趋势',
      phases: ['主要上升趋势', '主要下降趋势', '横盘整理'],
    },
    {
      id: 'theory:priceaction',
      name: 'Al Brooks 价格行为学',
      description: '基于K线形态和价格行为的交易方法，识别趋势线、支撑阻力、信号K线',
      phases: ['趋势行情', '震荡行情', '突破行情'],
    },
    {
      id: 'theory:ashareboard',
      name: 'A股板学',
      description: 'A股特有的连板接力、龙头战法、情绪周期',
      phases: ['冰点期', '修复期', '高潮期', '退潮期'],
    },
  ]

  for (const theory of theories) {
    await upsertNode({
      id: theory.id,
      type: 'Theory',
      properties: {
        name: theory.name,
        description: theory.description,
        phases: theory.phases,
      },
    })
  }

  // Create LINKED_TO relationships between theories and common patterns
  const patternTheoryLinks = [
    { pattern: '追高买入', theory: 'theory:wyckoff', reason: '派发期追高' },
    { pattern: '扛单不止损', theory: 'theory:dow', reason: '趋势反转信号' },
    { pattern: '频繁交易', theory: 'theory:priceaction', reason: '信号不清晰时交易' },
    { pattern: '过早止盈', theory: 'theory:priceaction', reason: '支撑阻力判断' },
    { pattern: '逆势操作', theory: 'theory:dow', reason: '趋势判断错误' },
  ]

  for (const link of patternTheoryLinks) {
    const patternId = `pattern:${link.pattern}`
    await upsertNode({
      id: patternId,
      type: 'Pattern',
      properties: { name: link.pattern },
    })
    await upsertEdge({
      source_id: patternId,
      target_id: link.theory,
      type: 'LINKED_TO',
      properties: { reason: link.reason },
    })
  }
}

/** Full sync: rebuild entire graph from current data */
export async function fullGraphSync(
  tradeGroups: Array<Record<string, unknown>>,
  reviewNotes: Record<string, Record<string, unknown>>,
): Promise<{
  nodesCreated: number
  edgesCreated: number
}> {
  let nodesCreated = 0
  let edgesCreated = 0

  // 1. Sync theories (always)
  await syncTheoriesToGraph()
  nodesCreated += 4 + 5 // 4 theories + 5 patterns

  // 2. Sync trade groups
  for (const group of tradeGroups) {
    await syncTradeGroupToGraph({
      id: group.id as string,
      stock_code: group.stock_code as string,
      stock_name: group.stock_name as string,
      status: group.status as string,
      pnl: (group.pnl as number) ?? 0,
      return_rate: group.return_rate as number | undefined,
      holding_days: group.holding_days as number | undefined,
      strategy: group.strategy as string | undefined,
      mistakes_json: group.mistakes_json as string | undefined,
      opened_at: group.opened_at as string,
      closed_at: group.closed_at as string | undefined,
    })
    nodesCreated += 3 // TradeGroup + Stock + Sector (approximate)
    edgesCreated += 2 // INVOLVES + BELONGS_TO
  }

  // 3. Sync review notes
  for (const [groupId, note] of Object.entries(reviewNotes)) {
    await syncReviewNoteToGraph({
      trade_group_id: groupId,
      buy_reason: note.buy_reason as string | undefined,
      sell_reason: note.sell_reason as string | undefined,
      execution_review: note.execution_review as string | undefined,
      lesson: note.lesson as string | undefined,
    })
    if (note.lesson) {
      nodesCreated += 1
      edgesCreated += 1
    }
  }

  return { nodesCreated, edgesCreated }
}
