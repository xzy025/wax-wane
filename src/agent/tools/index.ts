import type { AppState } from '../../store'
import type { ToolDefinition, ToolModule } from '../types'
import { queryTrades } from './queryTrades'
import { getTradeGroups } from './getTradeGroups'
import { calculateMetrics } from './calculateMetrics'
import { findPatterns } from './findPatterns'
import { getRiskAlerts } from './getRiskAlerts'

const toolRegistry: Record<string, ToolModule> = {
  queryTradeHistory: queryTrades,
  getTradeGroupDetail: getTradeGroups,
  calculateMetrics: calculateMetrics,
  findPatternTrades: findPatterns,
  getRiskAlerts: getRiskAlerts,
}

export const toolDefinitions: ToolDefinition[] = Object.values(toolRegistry).map((t) => t.schema)

export function executeTool(name: string, args: Record<string, unknown>, state: AppState): unknown {
  const tool = toolRegistry[name]
  if (!tool) {
    return { error: `Unknown tool: ${name}` }
  }
  try {
    return tool.execute(args, state)
  } catch (err) {
    return {
      error: `Tool execution failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }
  }
}
