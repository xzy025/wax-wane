import type { ToolModule } from '../types'

export const generateImprovementPlan: ToolModule = {
  schema: {
    name: 'generateImprovementPlan',
    description:
      '基于交易模式分析结果，生成个性化改进计划。' +
      '计划包含具体行动项、目标指标和跟踪日期。',
    parameters: {
      type: 'object',
      properties: {
        focusArea: {
          type: 'string',
          description: '重点改善领域，如"追高买入"、"扛单不止损"',
        },
        theory: {
          type: 'string',
          enum: ['wyckoff', 'dow', 'priceAction', 'ashareBoard'],
          description: '关联的理论框架',
        },
        currentWinRate: {
          type: 'number',
          description: '当前胜率',
        },
        currentAvgLoss: {
          type: 'number',
          description: '当前平均亏损',
        },
      },
      required: ['focusArea'],
    },
  },

  async execute(args, state) {
    const { focusArea, theory, currentWinRate, currentAvgLoss } = args as {
      focusArea: string
      theory?: string
      currentWinRate?: number
      currentAvgLoss?: number
    }

    const { tradeGroups, reviewNotes } = state
    const closedGroups = tradeGroups.filter((g) => g.closed)

    // 计算当前指标
    const winRate = currentWinRate ?? (closedGroups.length > 0
      ? (closedGroups.filter((g) => g.pnl > 0).length / closedGroups.length) * 100
      : 0)
    const avgLoss = currentAvgLoss ?? (closedGroups.length > 0
      ? closedGroups.filter((g) => g.pnl < 0).reduce((s, g) => s + g.returnRate, 0) /
        Math.max(closedGroups.filter((g) => g.pnl < 0).length, 1)
      : 0)

    // 根据 focusArea 生成改进计划
    const plans: Record<string, {
      theory: string
      currentBehavior: string
      targetBehavior: string
      actionItems: string[]
      targetWinRate: number
      targetAvgLoss: number
    }> = {
      '追高买入': {
        theory: 'wyckoff',
        currentBehavior: '在派发期高位追入，成交量放大但价格无法创新高',
        targetBehavior: '等待吸筹期完成再入场，关注成交量确认',
        actionItems: [
          '学习 Wyckoff 四阶段识别，关注成交量变化',
          '设置买入冷静期：股价当日涨幅 > 3% 时不买入',
          '买入前写下买入理由，标注当前 Wyckoff 阶段',
          '使用限价单而非市价单',
        ],
        targetWinRate: winRate + 10,
        targetAvgLoss: avgLoss + 2,
      },
      '扛单不止损': {
        theory: 'dow',
        currentBehavior: '趋势反转后未及时止损，亏损扩大',
        targetBehavior: '关注趋势反转信号，及时止损',
        actionItems: [
          '设置 5% 硬止损，触发后强制执行',
          '学习道氏理论趋势判断：高点降低 + 低点降低 = 下降趋势',
          '每日检查持仓是否触及止损位',
          '止损后记录原因，避免情绪化操作',
        ],
        targetWinRate: winRate + 5,
        targetAvgLoss: -5,
      },
      '频繁交易': {
        theory: 'priceAction',
        currentBehavior: '信号不清晰时入场，容易被止损',
        targetBehavior: '等待明确的价格行为信号再入场',
        actionItems: [
          '学习 Al Brooks 价格行为学，识别明确信号',
          '设置持仓最少天数：3 天',
          '交易前写下入场信号和预期',
          '减少盯盘频率，避免情绪化操作',
        ],
        targetWinRate: winRate + 8,
        targetAvgLoss: avgLoss + 1,
      },
      '过早止盈': {
        theory: 'priceAction',
        currentBehavior: '按固定百分比止盈，错过后续涨幅',
        targetBehavior: '按支撑阻力位设置止盈，让利润奔跑',
        actionItems: [
          '学习价格行为学的支撑阻力位识别',
          '使用移动止损而非固定目标价',
          '设置止盈规则：跌破趋势线或出现反转形态时止盈',
          '记录每次止盈后的走势，分析是否过早',
        ],
        targetWinRate: winRate + 5,
        targetAvgLoss: avgLoss + 1,
      },
      '逆势操作': {
        theory: 'dow',
        currentBehavior: '在下降趋势中抄底，亏损',
        targetBehavior: '等待趋势反转确认再入场',
        actionItems: [
          '学习道氏理论趋势判断',
          '入场前确认：高点抬高 + 低点抬高',
          '关注多个指数同时确认趋势',
          '下降趋势中空仓等待',
        ],
        targetWinRate: winRate + 10,
        targetAvgLoss: avgLoss + 2,
      },
    }

    const plan = plans[focusArea] ?? {
      theory: theory ?? 'general',
      currentBehavior: '需要进一步分析',
      targetBehavior: '改善交易纪律',
      actionItems: [
        '记录每次交易的入场理由',
        '设置止损止盈规则',
        '定期复盘交易表现',
      ],
      targetWinRate: winRate + 5,
      targetAvgLoss: avgLoss + 1,
    }

    // 计算 check-in 日期（7天后）
    const checkInDate = new Date()
    checkInDate.setDate(checkInDate.getDate() + 7)

    return {
      plan: {
        focusArea,
        theory: plan.theory,
        currentBehavior: plan.currentBehavior,
        targetBehavior: plan.targetBehavior,
        actionItems: plan.actionItems,
        metrics: {
          currentWinRate: Math.round(winRate * 10) / 10,
          targetWinRate: Math.round(plan.targetWinRate * 10) / 10,
          currentAvgLoss: Math.round(avgLoss * 10) / 10,
          targetAvgLoss: Math.round(plan.targetAvgLoss * 10) / 10,
        },
        checkInDate: checkInDate.toISOString().split('T')[0],
        status: 'active',
        progress: 0,
      },
    }
  },
}
