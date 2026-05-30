// Dow Theory Knowledge Base
// 道氏理论知识库

export const dowTheory = {
  name: '道氏理论',
  description: '通过趋势分析判断市场方向，是技术分析的基石',

  // 三种趋势
  trends: {
    primary: {
      name: '主要趋势（Primary Trend）',
      duration: '持续1年以上',
      description: '市场的大方向，类似潮汐',
      characteristics: [
        '持续时间长',
        '幅度大',
        '不易被操纵',
        '需要多个信号确认',
      ],
    },
    secondary: {
      name: '次要趋势（Secondary Trend）',
      duration: '持续3周-3个月',
      description: '对主要趋势的调整，类似波浪',
      characteristics: [
        '回调幅度为主要趋势的1/3到2/3',
        '成交量在回调时萎缩',
        '不改变主要趋势方向',
      ],
    },
    minor: {
      name: '短期趋势（Minor Trend）',
      duration: '持续数天',
      description: '日常波动，类似涟漪',
      characteristics: [
        '噪音较多',
        '容易被操纵',
        '不具有预测价值',
      ],
    },
  },

  // 趋势判断规则
  trendRules: [
    {
      rule: '上升趋势',
      condition: '高点抬高 + 低点抬高',
      confirmation: '成交量在上涨时放大',
      action: '持有多头仓位',
    },
    {
      rule: '下降趋势',
      condition: '高点降低 + 低点降低',
      confirmation: '成交量在下跌时放大',
      action: '空仓或做空',
    },
    {
      rule: '横盘整理',
      condition: '高点和低点无明显方向',
      confirmation: '成交量萎缩',
      action: '等待突破方向',
    },
  ],

  // 支撑与阻力
  supportResistance: {
    support: {
      definition: '前低点，买方力量集中区域',
      rule: '测试次数越多，支撑越强',
      breakRule: '跌破后支撑变阻力',
    },
    resistance: {
      definition: '前高点，卖方力量集中区域',
      rule: '测试次数越多，阻力越强',
      breakRule: '突破后阻力变支撑',
    },
  },

  // 趋势确认信号
  confirmationSignals: [
    {
      signal: '指数确认',
      description: '多个指数同时确认趋势',
      reliability: 'high',
    },
    {
      signal: '成交量确认',
      description: '成交量跟随趋势方向变化',
      reliability: 'high',
    },
    {
      signal: '时间确认',
      description: '趋势持续足够长时间',
      reliability: 'medium',
    },
    {
      signal: '幅度确认',
      description: '回调或反弹幅度符合预期',
      reliability: 'medium',
    },
  ],

  // 趋势反转信号
  reversalSignals: [
    {
      signal: '趋势线突破',
      description: '价格突破重要趋势线',
      reliability: 'high',
    },
    {
      signal: '支撑阻力突破',
      description: '价格突破重要支撑或阻力位',
      reliability: 'high',
    },
    {
      signal: '成交量异常',
      description: '成交量急剧放大或萎缩',
      reliability: 'medium',
    },
    {
      signal: '形态完成',
      description: '出现反转形态（头肩、双顶等）',
      reliability: 'medium',
    },
  ],
}

// 分析函数
export function analyzeDowTrend(data: {
  prices: number[]
  highs: number[]
  lows: number[]
  volumes: number[]
}): {
  trend: string
  strength: string
  support: number[]
  resistance: number[]
  analysis: string
  signals: string[]
} {
  const { prices, highs, lows, volumes } = data

  if (prices.length < 20) {
    return {
      trend: 'unknown',
      strength: 'weak',
      support: [],
      resistance: [],
      analysis: '数据不足，无法判断趋势',
      signals: [],
    }
  }

  // 计算趋势
  const recentPrices = prices.slice(-20)
  const priceChange = (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0]

  // 判断高点低点
  const recentHighs = highs.slice(-20)
  const recentLows = lows.slice(-20)

  const highPoints: number[] = []
  const lowPoints: number[] = []

  for (let i = 1; i < recentHighs.length - 1; i++) {
    if (recentHighs[i] > recentHighs[i - 1] && recentHighs[i] > recentHighs[i + 1]) {
      highPoints.push(recentHighs[i])
    }
    if (recentLows[i] < recentLows[i - 1] && recentLows[i] < recentLows[i + 1]) {
      lowPoints.push(recentLows[i])
    }
  }

  // 判断趋势方向
  let trend = 'sideways'
  let strength = 'weak'
  const signals: string[] = []

  if (highPoints.length >= 2 && lowPoints.length >= 2) {
    const highTrend = highPoints[highPoints.length - 1] > highPoints[highPoints.length - 2]
    const lowTrend = lowPoints[lowPoints.length - 1] > lowPoints[lowPoints.length - 2]

    if (highTrend && lowTrend) {
      trend = 'uptrend'
      signals.push('高点抬高，低点抬高')
    } else if (!highTrend && !lowTrend) {
      trend = 'downtrend'
      signals.push('高点降低，低点降低')
    } else {
      trend = 'sideways'
      signals.push('高点低点方向不一致')
    }
  }

  // 判断趋势强度
  const recentVolumes = volumes.slice(-20)
  const avgVolume = recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length
  const volumeTrend = recentVolumes[recentVolumes.length - 1] / avgVolume

  if (Math.abs(priceChange) > 0.15) {
    strength = 'strong'
  } else if (Math.abs(priceChange) > 0.08) {
    strength = 'moderate'
  } else {
    strength = 'weak'
  }

  // 计算支撑阻力
  const support = lowPoints.slice(-3)
  const resistance = highPoints.slice(-3)

  const trendNames: Record<string, string> = {
    uptrend: '上升趋势',
    downtrend: '下降趋势',
    sideways: '横盘整理',
    unknown: '未知',
  }

  const strengthNames: Record<string, string> = {
    strong: '强',
    moderate: '中',
    weak: '弱',
  }

  return {
    trend,
    strength,
    support,
    resistance,
    analysis: `当前处于${trendNames[trend]}，强度${strengthNames[strength]}，${signals.join('，')}`,
    signals,
  }
}
