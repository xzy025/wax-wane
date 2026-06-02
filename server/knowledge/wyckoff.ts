// Wyckoff Volume-Price Theory Knowledge Base
// 维科夫量价理论知识库

export const wyckoffTheory = {
  name: 'Wyckoff 量价理论',
  description: '通过量价关系分析市场供需，判断主力行为和市场阶段',

  // ═══════════════════════════════════════════════════════════
  // 核心三定律
  // ═══════════════════════════════════════════════════════════
  threeLaws: {
    supplyDemand: {
      name: '供需定律',
      description: '价格由供需关系决定。需求大于供应则上涨，供应大于需求则下跌。',
      application: '观察成交量与价格变化的关系，判断供需强弱',
    },
    effort: {
      name: '因果定律',
      description: '价格变动（果）需要成交量（因）来确认。有因才有果，无因则无果。',
      application: '突破需要放量确认，无量突破不可信',
    },
    effortVsResult: {
      name: '努力与结果定律',
      description: '成交量代表努力，价格代表结果。努力与结果应一致，不一致则暗示反转。',
      application: '放量但涨幅小 = 努力大但结果小 = 可能见顶',
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 四阶段模型（完整版）
  // ═══════════════════════════════════════════════════════════
  phases: {
    accumulation: {
      name: '吸筹期（Accumulation）',
      description: '聪明资金在低位悄悄建仓，消化抛压',
      characteristics: [
        '成交量逐渐萎缩，卖压减少',
        '价格在支撑位附近窄幅震荡',
        '出现 Spring（假跌破支撑后快速收回）',
        '出现 Test（回踩 Spring 低点不破）',
        '供应逐渐被吸收',
        '出现 Sign of Strength（SOS）放量突破',
      ],
      subPhases: {
        phaseA: {
          name: 'A阶段 - 停止下跌',
          events: ['Preliminary Support (PS)', 'Selling Climax (SC)', 'Automatic Rally (AR)', 'Secondary Test (ST)'],
          description: '恐慌抛售后止跌，初步支撑出现',
        },
        phaseB: {
          name: 'B阶段 - 建仓',
          events: ['价格在区间内震荡', '成交量逐渐减少', '供应被逐步吸收'],
          description: '主力悄悄建仓，消化抛压',
        },
        phaseC: {
          name: 'C阶段 - 测试',
          events: ['Spring（假跌破）', 'Test（回踩确认）', 'Shakeout（洗盘）'],
          description: '最后一次洗盘，确认供应枯竭',
        },
        phaseD: {
          name: 'D阶段 - 突破',
          events: ['Sign of Strength (SOS)', 'Last Point of Support (LPS)', '放量突破阻力'],
          description: '需求战胜供应，价格开始上涨',
        },
      },
      volumePattern: '成交量萎缩，偶尔出现放量阳线',
      priceAction: '价格在区间内震荡，低点逐渐抬高',
      traderBehavior: '聪明资金在低位悄悄买入',
      entrySignal: 'Spring + Test 不破 + 放量突破阻力位',
      exitSignal: '无（此阶段是建仓期）',
      keyIndicators: ['Spring 出现', 'Test 成功', 'SOS 放量突破', 'LPS 回踩不破'],
    },

    markup: {
      name: '标记上涨期（Markup）',
      description: '需求持续大于供应，价格趋势向上',
      characteristics: [
        '成交量放大',
        '价格突破阻力位，持续上涨',
        '高点抬高，低点抬高',
        '需求大于供应',
        '回调浅且缩量',
        '出现 Last Point of Support (LPS)',
      ],
      subPhases: {
        earlyMarkup: {
          name: '早期上涨',
          events: ['突破吸筹区间', '成交量放大', '趋势确认'],
          description: '突破确认，趋势开始',
        },
        midMarkup: {
          name: '中期上涨',
          events: ['健康回调', 'LPS 出现', '继续创新高'],
          description: '趋势延续，回调是买入机会',
        },
        lateMarkup: {
          name: '晚期上涨',
          events: ['成交量异常放大', '涨幅减小', '出现派发迹象'],
          description: '动能减弱，警惕见顶',
        },
      },
      volumePattern: '上涨时放量，回调时缩量',
      priceAction: '趋势明确向上，回调浅',
      traderBehavior: '趋势跟随者入场',
      entrySignal: '回调到支撑位（LPS）时放量反弹',
      exitSignal: '成交量放大但价格无法创新高（放量滞涨）',
      keyIndicators: ['价涨量增', '回调缩量', 'LPS 出现', '持续创新高'],
    },

    distribution: {
      name: '派发期（Distribution）',
      description: '聪明资金在高位悄悄出货，供应逐渐增加',
      characteristics: [
        '成交量高位震荡',
        '价格在阻力位附近宽幅震荡',
        '出现 Upthrust (UTAD)（假突破阻力后快速回落）',
        '出现 Sign of Weakness (SOW)',
        '供应逐渐增加',
        '需求减弱',
      ],
      subPhases: {
        phaseA: {
          name: 'A阶段 - 停止上涨',
          events: ['Preliminary Supply (PSY)', 'Buying Climax (BC)', 'Automatic Reaction (AR)', 'Secondary Test (ST)'],
          description: '疯狂买入后见顶，初步供应出现',
        },
        phaseB: {
          name: 'B阶段 - 出货',
          events: ['价格在区间内震荡', '成交量保持高位', '供应逐步释放'],
          description: '主力悄悄出货，消化需求',
        },
        phaseC: {
          name: 'C阶段 - 测试',
          events: ['Upthrust (UTAD)（假突破）', 'Last Point of Supply (LPSY)', '最后一次冲高'],
          description: '最后一次诱多，确认需求枯竭',
        },
        phaseD: {
          name: 'D阶段 - 跌破',
          events: ['Sign of Weakness (SOW)', '跌破支撑', '放量下跌'],
          description: '供应战胜需求，价格开始下跌',
        },
      },
      volumePattern: '成交量放大但价格涨幅有限',
      priceAction: '震荡加剧，出现长上影线',
      traderBehavior: '聪明资金在高位悄悄卖出',
      entrySignal: '无（此阶段应考虑离场）',
      exitSignal: 'UTAD 出现后跌破支撑位',
      keyIndicators: ['UTAD 假突破', 'SOW 出现', '放量滞涨', '跌破支撑'],
    },

    markdown: {
      name: '标记下跌期（Markdown）',
      description: '供应持续大于需求，价格趋势向下',
      characteristics: [
        '成交量放大下跌',
        '价格跌破支撑位',
        '高点降低，低点降低',
        '供应大于需求',
        '反弹弱且缩量',
        '出现 Last Point of Supply (LPSY)',
      ],
      subPhases: {
        earlyMarkdown: {
          name: '早期下跌',
          events: ['跌破派发区间', '成交量放大', '趋势确认'],
          description: '跌破确认，趋势开始',
        },
        midMarkdown: {
          name: '中期下跌',
          events: ['弱势反弹', 'LPSY 出现', '继续创新低'],
          description: '趋势延续，反弹是卖出机会',
        },
        lateMarkdown: {
          name: '晚期下跌',
          events: ['恐慌抛售（Selling Climax）', '成交量急剧放大', '出现吸筹迹象'],
          description: '恐慌抛售，可能见底',
        },
      },
      volumePattern: '下跌时放量，反弹时缩量',
      priceAction: '趋势明确向下，反弹弱',
      traderBehavior: '恐慌抛售',
      entrySignal: '无（此阶段应空仓等待）',
      exitSignal: '成交量萎缩，价格止跌（可能进入吸筹期）',
      keyIndicators: ['价跌量增', '反弹缩量', 'LPSY 出现', '持续创新低'],
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 量价关系（扩充版）
  // ═══════════════════════════════════════════════════════════
  volumePriceRelationship: [
    {
      pattern: '价涨量增',
      meaning: '趋势健康，需求强劲',
      action: '持有或加仓',
      reliability: 'high',
      context: '上涨趋势中',
    },
    {
      pattern: '价涨量缩',
      meaning: '动能减弱，可能见顶',
      action: '警惕，准备减仓',
      reliability: 'medium',
      context: '上涨末期',
    },
    {
      pattern: '价跌量增',
      meaning: '恐慌抛售，供应增加',
      action: '止损离场',
      reliability: 'high',
      context: '下跌趋势中',
    },
    {
      pattern: '价跌量缩',
      meaning: '抛压减弱，可能见底',
      action: '观察，等待反转信号',
      reliability: 'medium',
      context: '下跌末期',
    },
    {
      pattern: '价平量增',
      meaning: '多空分歧加大，即将变盘',
      action: '等待方向确认',
      reliability: 'medium',
      context: '震荡区间',
    },
    {
      pattern: '价平量缩',
      meaning: '市场冷清，缺乏方向',
      action: '观望',
      reliability: 'low',
      context: '任何阶段',
    },
    {
      pattern: '突破放量',
      meaning: '突破有效，趋势确认',
      action: '顺势入场',
      reliability: 'high',
      context: '关键位置突破',
    },
    {
      pattern: '突破缩量',
      meaning: '突破不可信，可能是假突破',
      action: '等待回踩确认',
      reliability: 'medium',
      context: '关键位置突破',
    },
    {
      pattern: '回调缩量',
      meaning: '抛压减弱，回调健康',
      action: '回调是买入机会',
      reliability: 'high',
      context: '上涨趋势中',
    },
    {
      pattern: '反弹缩量',
      meaning: '需求不足，反弹无力',
      action: '反弹是卖出机会',
      reliability: 'high',
      context: '下跌趋势中',
    },
  ],

  // ═══════════════════════════════════════════════════════════
  // 关键术语（扩充版）
  // ═══════════════════════════════════════════════════════════
  keyTerms: {
    // 吸筹期术语
    PS: 'Preliminary Support - 初步支撑，下跌趋势中首次出现明显支撑',
    SC: 'Selling Climax - 恐慌抛售，成交量急剧放大的下跌，通常是阶段性低点',
    AR: 'Automatic Rally - 自动反弹，SC 后的快速反弹，确定交易区间下沿',
    ST: 'Secondary Test - 二次测试，回踩 SC 低点，成交量应减少',
    Spring: '假跌破支撑位后快速收回，是吸筹期结束的信号',
    Test: '价格回到关键位置测试供需，成交量是关键',
    SOS: 'Sign of Strength - 力量信号，放量突破阻力位，需求战胜供应',
    LPS: 'Last Point of Support - 最后支撑点，回调的低点，是买入机会',

    // 派发期术语
    PSY: 'Preliminary Supply - 初步供应，上涨趋势中首次出现明显抛压',
    BC: 'Buying Climax - 疯狂买入，成交量急剧放大的上涨，通常是阶段性高点',
    AR_down: 'Automatic Reaction - 自动回落，BC 后的快速下跌，确定交易区间上沿',
    ST_down: 'Secondary Test - 二次测试，回踩 BC 高点，成交量应减少',
    UTAD: 'Upthrust After Distribution - 派发后上冲，假突破阻力位后快速回落',
    SOW: 'Sign of Weakness - 弱势信号，放量跌破支撑位，供应战胜需求',
    LPSY: 'Last Point of Supply - 最后供应点，反弹的高点，是卖出机会',

    // 通用术语
    Climax: '成交量急剧放大，价格大幅波动，可能是趋势反转点',
    Effort: '成交量，代表市场参与者的努力程度',
    Result: '价格变动，代表努力的结果',
  },

  // ═══════════════════════════════════════════════════════════
  // 交易策略
  // ═══════════════════════════════════════════════════════════
  strategies: {
    springTrade: {
      name: 'Spring 交易',
      description: '在吸筹期的 Spring 出现后入场',
      entry: 'Spring 后放量反弹，确认 Test 成功',
      stopLoss: 'Spring 低点下方',
      target: '吸筹区间上沿（阻力位）',
      riskReward: '1:2 以上',
      reliability: 'high',
    },
    sosTrade: {
      name: 'SOS 突破交易',
      description: '在 Sign of Strength 出现时入场',
      entry: '放量突破阻力位',
      stopLoss: '突破位下方',
      target: '下一个阻力位',
      riskReward: '1:2 以上',
      reliability: 'high',
    },
    lpsTrade: {
      name: 'LPS 回调交易',
      description: '在上涨趋势中的 LPS 入场',
      entry: '回调到支撑位（LPS）时放量反弹',
      stopLoss: 'LPS 下方',
      target: '前高或新高',
      riskReward: '1:2 以上',
      reliability: 'medium',
    },
    utadShort: {
      name: 'UTAD 做空交易',
      description: '在派发期的 UTAD 出现后做空',
      entry: 'UTAD 后放量下跌，跌破支撑',
      stopLoss: 'UTAD 高点上方',
      target: '下一个支撑位',
      riskReward: '1:2 以上',
      reliability: 'high',
    },
  },
}

// ═══════════════════════════════════════════════════════════
// 分析函数（增强版）
// ═══════════════════════════════════════════════════════════

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
  tradingAdvice: string
} {
  const { prices, volumes, highs, lows } = data

  if (prices.length < 10) {
    return {
      phase: 'unknown',
      confidence: 0,
      analysis: '数据不足，无法判断',
      signals: [],
      tradingAdvice: '等待更多数据',
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

  // 计算成交量趋势（最近5根 vs 之前5根）
  const recent5Vol = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5
  const prev5Vol = volumes.slice(-10, -5).reduce((s, v) => s + v, 0) / 5
  const volumeTrend = recent5Vol / prev5Vol

  const signals: string[] = []
  let phase = 'unknown'
  let confidence = 0
  let tradingAdvice = ''

  // 判断阶段
  if (priceChange > 0.1 && volumeRatio > 1.2) {
    phase = 'markup'
    confidence = 0.8
    signals.push('价涨量增，趋势健康')
    tradingAdvice = '持有或在回调到 LPS 时加仓'
  } else if (priceChange > 0.1 && volumeRatio < 0.8) {
    phase = 'markup'
    confidence = 0.6
    signals.push('价涨量缩，动能减弱')
    tradingAdvice = '警惕放量滞涨，准备减仓'
  } else if (priceChange < -0.1 && volumeRatio > 1.2) {
    phase = 'markdown'
    confidence = 0.8
    signals.push('价跌量增，恐慌抛售')
    tradingAdvice = '空仓等待，不抄底'
  } else if (priceChange < -0.1 && volumeRatio < 0.8) {
    phase = 'markdown'
    confidence = 0.6
    signals.push('价跌量缩，抛压减弱')
    tradingAdvice = '观察是否出现 SC 和 Spring'
  } else if (Math.abs(priceChange) < 0.05 && volatility < avgVolume * 0.02) {
    phase = 'accumulation'
    confidence = 0.7
    signals.push('价格窄幅震荡，可能在吸筹')
    tradingAdvice = '等待 Spring 或 SOS 确认后入场'
  } else if (Math.abs(priceChange) < 0.05 && volatility > avgVolume * 0.05) {
    phase = 'distribution'
    confidence = 0.7
    signals.push('价格宽幅震荡，可能在派发')
    tradingAdvice = '警惕 UTAD，准备离场'
  }

  // 检测努力与结果不一致
  if (volumeTrend > 1.3 && Math.abs(priceChange) < 0.03) {
    signals.push('努力与结果不一致：放量但价格不动')
    confidence = Math.min(confidence + 0.1, 1)
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
    tradingAdvice,
  }
}
