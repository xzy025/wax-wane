import type { AppState } from '../../store'
import type { ToolDefinition, ToolModule } from '../types'
import { queryTrades } from './queryTrades'
import { getTradeGroups } from './getTradeGroups'
import { calculateMetrics } from './calculateMetrics'
import { findPatterns } from './findPatterns'
import { getRiskAlerts } from './getRiskAlerts'
import { getStockQuote } from './getStockQuote'
import { getMarketBreadth } from './getMarketBreadth'
import { getMacroIndicators } from './getMacroIndicators'
import { getLimitPool } from './getLimitPool'
import { getIndexTrends } from './getIndexTrends'
import { getNewsSummary } from './getNewsSummary'
import { semanticSearch } from './semanticSearch'
import { analyzeWithTheory } from './analyzeWithTheory'
import { analyzeTradePatterns } from './analyzeTradePatterns'
import { generateImprovementPlan } from './generateImprovementPlan'
import { screenStocks } from './screenStocks'
import { graphQuery } from './graphQuery'
import { findRelatedTrades } from './findRelatedTrades'
import { findPatternPath } from './findPatternPath'
import { hybridSearch } from './hybridSearch'
import { runStructuredReview } from './runStructuredReview'
import { runTheoryReview } from './runTheoryReview'
import { getStockKline } from './getStockKline'
import { getStockFundamentals } from './getStockFundamentals'
import { getFundamentalReport } from './getFundamentalReport'
import { searchWeb } from './searchWeb'
import { getStockNews } from './getStockNews'
import { runStockAnalysis } from './runStockAnalysis'

const toolRegistry: Record<string, ToolModule> = {
  queryTradeHistory: queryTrades,
  getTradeGroupDetail: getTradeGroups,
  calculateMetrics: calculateMetrics,
  findPatternTrades: findPatterns,
  getRiskAlerts: getRiskAlerts,
  getStockQuote: getStockQuote,
  getMarketBreadth: getMarketBreadth,
  getMacroIndicators: getMacroIndicators,
  getLimitPool: getLimitPool,
  getIndexTrends: getIndexTrends,
  getNewsSummary: getNewsSummary,
  semanticSearch: semanticSearch,
  analyzeWithTheory: analyzeWithTheory,
  analyzeTradePatterns: analyzeTradePatterns,
  generateImprovementPlan: generateImprovementPlan,
  screenStocks: screenStocks,
  graphQuery: graphQuery,
  findRelatedTrades: findRelatedTrades,
  findPatternPath: findPatternPath,
  hybridSearch: hybridSearch,
  runStructuredReview: runStructuredReview,
  runTheoryReview: runTheoryReview,
  getStockKline: getStockKline,
  getStockFundamentals: getStockFundamentals,
  getFundamentalReport: getFundamentalReport,
  searchWeb: searchWeb,
  getStockNews: getStockNews,
  runStockAnalysis: runStockAnalysis,
}

export const toolDefinitions: ToolDefinition[] = Object.values(toolRegistry).map((t) => t.schema)

export async function executeTool(name: string, args: Record<string, unknown>, state: AppState): Promise<unknown> {
  const tool = toolRegistry[name]
  if (!tool) {
    return { error: `Unknown tool: ${name}` }
  }
  try {
    return await tool.execute(args, state)
  } catch (err) {
    return {
      error: `Tool execution failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }
  }
}
