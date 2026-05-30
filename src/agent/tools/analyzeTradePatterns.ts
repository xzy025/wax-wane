import type { ToolModule } from '../types'
import type { TradeGroup } from '../../types'

interface PatternResult {
  name: string
  theory: string
  severity: 'high' | 'medium' | 'low'
  count: number
  description: string
  analysis: string
  affectedTrades: string[]
  suggestion: string
}

export const analyzeTradePatterns: ToolModule = {
  schema: {
    name: 'analyzeTradePatterns',
    description:
      '分析用户交易数据，识别常见行为模式（追高、扛单、频繁交易等），并关联到交易理论框架。' +
      '用于复盘时发现交易问题。',
    parameters: {
      type: 'object',
      properties: {
        patternType: {
          type: 'string',
          enum: ['chasing', 'holding', 'frequent', 'earlyExit', 'contrarian', 'all'],
          description: '模式类型：chasing(追高)、holding(扛单)、frequent(频繁交易)、earlyExit(过早止盈)、contrarian(逆势)、all(全部)',
        },
      },
      required: [],
    },
  },

  async execute(args, state) {
    const { patternType = 'all' } = args as { patternType?: string }
    const { tradeGroups, reviewNotes } = state

    const closedGroups = tradeGroups.filter((g) => g.closed)
    const patterns: PatternResult[] = []

    // 追高买入检测
    if (patternType === 'chasing' || patternType === 'all') {
      const chasingTrades = closedGroups.filter((g) => {
        // 检查买入理由是否包含追高相关关键词
        const note = reviewNotes[g.id]
        const buyReason = note?.buyReason?.toLowerCase() ?? ''
        return buyReason.includes('追高') || buyReason.includes('突破') || g.returnRate < -5
      })

      if (chasingTrades.length > 0) {
        patterns.push({
          name: '追高买入',
          theory: 'wyckoff',
          severity: chasingTrades.length >= 3 ? 'high' : 'medium',
          count: chasingTrades.length,
          description: `${chasingTrades.length} 次在高位追入，平均亏损 ${averageLoss(chasingTrades).toFixed(1)}%`,
          analysis: '根据 Wyckoff 理论，在派发期追高买入风险极高。成交量放大但价格无法创新高是派发信号。',
          affectedTrades: chasingTrades.map((g) => g.id),
          suggestion: '等待吸筹期完成再入场，关注成交量确认。设置买入冷静期：股价当日涨幅 > 3% 时不买入。',
        })
      }
    }

    // 扛单不止损检测
    if (patternType === 'holding' || patternType === 'all') {
      const holdingTrades = closedGroups.filter((g) => {
        const note = reviewNotes[g.id]
        const lesson = note?.lesson?.toLowerCase() ?? ''
        return lesson.includes('止损') || g.returnRate < -10
      })

      if (holdingTrades.length > 0) {
        patterns.push({
          name: '扛单不止损',
          theory: 'dow',
          severity: holdingTrades.length >= 2 ? 'high' : 'medium',
          count: holdingTrades.length,
          description: `${holdingTrades.length} 次亏损超过 10% 才卖出，平均多亏 ${averageExtraLoss(holdingTrades).toFixed(1)}%`,
          analysis: '根据道氏理论，趋势反转后应及时止损。高点降低、低点降低是下降趋势信号。',
          affectedTrades: holdingTrades.map((g) => g.id),
          suggestion: '设置 5% 硬止损，触发后强制执行。关注趋势反转信号：高点降低 + 低点降低。',
        })
      }
    }

    // 频繁交易检测
    if (patternType === 'frequent' || patternType === 'all') {
      const shortTrades = closedGroups.filter((g) => g.days <= 3)

      if (shortTrades.length > closedGroups.length * 0.3 && closedGroups.length >= 5) {
        patterns.push({
          name: '频繁交易',
          theory: 'priceAction',
          severity: shortTrades.length > closedGroups.length * 0.5 ? 'high' : 'medium',
          count: shortTrades.length,
          description: `持仓 ≤3 天的交易占比 ${((shortTrades.length / closedGroups.length) * 100).toFixed(0)}%`,
          analysis: '根据价格行为学，信号不清晰时入场容易被止损。等待明确的形态确认再入场。',
          affectedTrades: shortTrades.map((g) => g.id),
          suggestion: '减少短线操作，等待明确的价格行为信号。设置持仓最少天数：3 天。',
        })
      }
    }

    // 过早止盈检测
    if (patternType === 'earlyExit' || patternType === 'all') {
      const earlyExitTrades = closedGroups.filter((g) => {
        const note = reviewNotes[g.id]
        const sellReason = note?.sellReason?.toLowerCase() ?? ''
        return sellReason.includes('止盈') || (g.returnRate > 0 && g.returnRate < 5)
      })

      if (earlyExitTrades.length > 0) {
        patterns.push({
          name: '过早止盈',
          theory: 'priceAction',
          severity: earlyExitTrades.length >= 3 ? 'high' : 'medium',
          count: earlyExitTrades.length,
          description: `${earlyExitTrades.length} 次盈利交易在 5% 前卖出`,
          analysis: '根据价格行为学，应按支撑阻力位设置止盈，而非固定百分比。',
          affectedTrades: earlyExitTrades.map((g) => g.id),
          suggestion: '使用移动止损而非固定目标价。让利润奔跑，直到出现明确的反转信号。',
        })
      }
    }

    // 逆势操作检测
    if (patternType === 'contrarian' || patternType === 'all') {
      const contrarianTrades = closedGroups.filter((g) => {
        const note = reviewNotes[g.id]
        const buyReason = note?.buyReason?.toLowerCase() ?? ''
        return buyReason.includes('抄底') || buyReason.includes('逆势') || g.returnRate < -3
      })

      if (contrarianTrades.length > 0) {
        patterns.push({
          name: '逆势操作',
          theory: 'dow',
          severity: contrarianTrades.length >= 2 ? 'high' : 'medium',
          count: contrarianTrades.length,
          description: `${contrarianTrades.length} 次在下跌趋势中买入`,
          analysis: '根据道氏理论，不要在下降趋势中抄底。等待趋势反转信号：高点抬高 + 低点抬高。',
          affectedTrades: contrarianTrades.map((g) => g.id),
          suggestion: '等待趋势反转确认再入场。关注多个指数同时确认趋势。',
        })
      }
    }

    return {
      patterns,
      summary: patterns.length > 0
        ? `发现 ${patterns.length} 个问题模式，建议优先改善：${patterns[0].name}`
        : '未发现明显问题模式，继续保持',
    }
  },
}

function averageLoss(trades: TradeGroup[]): number {
  const losers = trades.filter((g) => g.pnl < 0)
  if (losers.length === 0) return 0
  return losers.reduce((s, g) => s + g.returnRate, 0) / losers.length
}

function averageExtraLoss(trades: TradeGroup[]): number {
  // 估算多亏的部分（假设 5% 止损）
  const losers = trades.filter((g) => g.returnRate < -10)
  if (losers.length === 0) return 0
  return losers.reduce((s, g) => s + (g.returnRate + 5), 0) / losers.length
}
