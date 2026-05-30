// Wyckoff Volume-Price Theory Knowledge Base
// 维科夫量价理论知识库

export const wyckoffTheory = {
  name: 'Wyckoff 量价理论',
  description: '通过量价关系分析市场供需，判断主力行为和市场阶段',

  // 四阶段模型
  phases: {
    accumulation: {
      name: '吸筹期（Accumulation）',
      characteristics: [
        '成交量逐渐萎缩',
        '价格在支撑位附近窄幅震荡',
        '出现 Spring（假跌破支撑后快速收回）',
        '供应逐渐被吸收',
      ],
      volumePattern: '成交量萎缩，偶尔出现放量阳线',
      priceAction: '价格在区间内震荡，低点逐渐抬高',
      traderBehavior: '聪明资金在低位悄悄买入',
      entrySignal: 'Spring 出现后放量突破阻力位',
      exitSignal: '无（此阶段是建仓期）',
    },

    markup: {
      name: '标记上涨期（Markup）',
      characteristics: [
        '成交量放大',
        '价格突破阻力位，持续上涨',
        '高点抬高，低点抬高',
        '需求大于供应',
      ],
      volumePattern: '上涨时放量，回调时缩量',
      priceAction: '趋势明确向上，回调浅',
      traderBehavior: '趋势跟随者入场',
      entrySignal: '回调到支撑位时放量反弹',
      exitSignal: '成交量放大但价格无法创新高（放量滞涨）',
    },

    distribution: {
      name: '派发期（Distribution）',
      characteristics: [
        '成交量高位震荡',
        '价格在阻力位附近宽幅震荡',
        '出现 Upthrust（假突破阻力后快速回落）',
        '供应逐渐增加',
      ],
      volumePattern: '成交量放大但价格涨幅有限',
      priceAction: '震荡加剧，出现长上影线',
      traderBehavior: '聪明资金在高位悄悄卖出',
      entrySignal: '无（此阶段应考虑离场）',
      exitSignal: 'Upthrust 出现后跌破支撑位',
    },

    markdown: {
      name: '标记下跌期（Markdown）',
      characteristics: [
        '成交量放大下跌',
        '价格跌破支撑位',
        '高点降低，低点降低',
        '供应大于需求',
      ],
      volumePattern: '下跌时放量，反弹时缩量',
      priceAction: '趋势明确向下，反弹弱',
      traderBehavior: '恐慌抛售',
      entrySignal: '无（此阶段应空仓等待）',
      exitSignal: '成交量萎缩，价格止跌（可能进入吸筹期）',
    },
  },

  // 量价关系
  volumePriceRelationship: [
    {
      pattern: '价涨量增',
      meaning: '趋势健康，需求强劲',
      action: '持有或加仓',
      reliability: 'high',
    },
    {
      pattern: '价涨量缩',
      meaning: '动能减弱，可能见顶',
      action: '警惕，准备减仓',
      reliability: 'medium',
    },
    {
      pattern: '价跌量增',
      meaning: '恐慌抛售，供应增加',
      action: '止损离场',
      reliability: 'high',
    },
    {
      pattern: '价跌量缩',
      meaning: '抛压减弱，可能见底',
      action: '观察，等待反转信号',
      reliability: 'medium',
    },
    {
      pattern: '价平量增',
      meaning: '多空分歧加大，即将变盘',
      action: '等待方向确认',
      reliability: 'medium',
    },
    {
      pattern: '价平量缩',
      meaning: '市场冷清，缺乏方向',
      action: '观望',
      reliability: 'low',
    },
  ],

  // 关键术语
  keyTerms: {
    Spring: '假跌破支撑位后快速收回，是吸筹期结束的信号',
    Upthrust: '假突破阻力位后快速回落，是派发期的信号',
    SignOfStrength: '放量突破阻力位，需求战胜供应',
    SignOfWeakness: '放量跌破支撑位，供应战胜需求',
    Climax: '成交量急剧放大，价格大幅波动，可能是趋势反转点',
    Test: '价格回到关键位置测试供需，成交量是关键',
  },
}

// 分析函数
export function analyzeWyckoffPhase(data: {
  prices: number[]
  volumes: number[]
  highs: number[]
  lows: number[]
}): {
  phase: string
  confidence: number
  analysis: string
  signals: string[]
} {
  const { prices, volumes, highs, lows } = data

  if (prices.length < 10) {
    return {
      phase: 'unknown',
      confidence: 0,
      analysis: '数据不足，无法判断',
      signals: [],
    }
  }

  // 计算趋势
  const recentPrices = prices.slice(-20)
  const priceChange = (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0]

  // 计算成交量趋势
  const recentVolumes = volumes.slice(-20)
  const avgVolume = recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length
  const latestVolume = recentVolumes[recentVolumes.length - 1]
  const volumeRatio = latestVolume / avgVolume

  // 计算波动率
  const recentHighs = highs.slice(-20)
  const recentLows = lows.slice(-20)
  const volatility = recentHighs.reduce((s, h, i) => s + (h - recentLows[i]), 0) / recentHighs.length

  const signals: string[] = []
  let phase = 'unknown'
  let confidence = 0

  // 判断阶段
  if (priceChange > 0.1 && volumeRatio > 1.2) {
    phase = 'markup'
    confidence = 0.8
    signals.push('价涨量增，趋势健康')
  } else if (priceChange > 0.1 && volumeRatio < 0.8) {
    phase = 'markup'
    confidence = 0.6
    signals.push('价涨量缩，动能减弱')
  } else if (priceChange < -0.1 && volumeRatio > 1.2) {
    phase = 'markdown'
    confidence = 0.8
    signals.push('价跌量增，恐慌抛售')
  } else if (priceChange < -0.1 && volumeRatio < 0.8) {
    phase = 'markdown'
    confidence = 0.6
    signals.push('价跌量缩，抛压减弱')
  } else if (Math.abs(priceChange) < 0.05 && volatility < avgVolume * 0.02) {
    phase = 'accumulation'
    confidence = 0.7
    signals.push('价格窄幅震荡，可能在吸筹')
  } else if (Math.abs(priceChange) < 0.05 && volatility > avgVolume * 0.05) {
    phase = 'distribution'
    confidence = 0.7
    signals.push('价格宽幅震荡，可能在派发')
  }

  const phaseNames: Record<string, string> = {
    accumulation: '吸筹期',
    markup: '标记上涨期',
    distribution: '派发期',
    markdown: '标记下跌期',
    unknown: '未知',
  }

  return {
    phase,
    confidence,
    analysis: `当前处于${phaseNames[phase]}，${signals.join('，')}`,
    signals,
  }
}
