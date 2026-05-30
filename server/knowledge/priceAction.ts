// Al Brooks Price Action Knowledge Base
// Al Brooks 价格行为学知识库

export const priceAction = {
  name: 'Al Brooks 价格行为学',
  description: '通过K线形态和价格行为判断市场意图',

  // 关键K线形态
  candlePatterns: {
    pinBar: {
      name: 'Pin Bar（针形线）',
      description: '长影线，实体小，表示价格被快速拒绝',
      bullish: '下影线长，表示买方力量强',
      bearish: '上影线长，表示卖方力量强',
      reliability: 'high',
      entry: '在 Pin Bar 收盘价附近入场',
      stopLoss: 'Pin Bar 的影线末端',
    },
    insideBar: {
      name: 'Inside Bar（内包线）',
      description: '当前K线完全在前一根K线范围内，表示收敛',
      meaning: '市场在积蓄能量，等待突破',
      reliability: 'medium',
      entry: '突破前一根K线的高点或低点时入场',
      stopLoss: '突破方向的反向端',
    },
    engulfing: {
      name: 'Engulfing（吞没形态）',
      description: '当前K线完全吞没前一根K线',
      bullish: '阳线吞没阴线，看涨',
      bearish: '阴线吞没阳线，看跌',
      reliability: 'high',
      entry: '在吞没线收盘价附近入场',
      stopLoss: '吞没线的影线末端',
    },
    doubleTop: {
      name: 'Double Top（双顶）',
      description: '两次触及同一高点后回落',
      meaning: '卖方在该价位强劲',
      reliability: 'medium',
      entry: '跌破颈线时入场做空',
      stopLoss: '双顶高点上方',
    },
    doubleBottom: {
      name: 'Double Bottom（双底）',
      description: '两次触及同一低点后反弹',
      meaning: '买方在该价位强劲',
      reliability: 'medium',
      entry: '突破颈线时入场做多',
      stopLoss: '双底下沿下方',
    },
  },

  // 趋势线与通道
  trendLines: {
    uptrendLine: {
      name: '上升趋势线',
      drawing: '连接两个以上低点',
      rule: '价格回踩趋势线是买入机会',
      breakSignal: '跌破趋势线可能反转',
    },
    downtrendLine: {
      name: '下降趋势线',
      drawing: '连接两个以上高点',
      rule: '价格反弹到趋势线是卖出机会',
      breakSignal: '突破趋势线可能反转',
    },
    channel: {
      name: '通道',
      drawing: '平行的趋势线',
      rule: '在通道内高抛低吸',
      breakSignal: '突破通道线可能加速',
    },
  },

  // 入场信号
  entrySignals: [
    {
      signal: '回踩趋势线',
      description: '价格回踩上升趋势线后反弹',
      reliability: 'high',
      entry: '在趋势线附近出现反转K线时入场',
      stopLoss: '趋势线下方',
    },
    {
      signal: '突破回踩',
      description: '价格突破阻力位后回踩确认',
      reliability: 'high',
      entry: '回踩不破阻力位时入场',
      stopLoss: '突破位下方',
    },
    {
      signal: '二次测试',
      description: '价格第二次测试关键位置',
      reliability: 'medium',
      entry: '第二次测试成功时入场',
      stopLoss: '测试位下方',
    },
  ],

  // 出场信号
  exitSignals: [
    {
      signal: '趋势线突破',
      description: '价格跌破上升趋势线',
      action: '减仓或离场',
    },
    {
      signal: '反转形态',
      description: '出现 Pin Bar、Engulfing 等反转形态',
      action: '警惕，准备离场',
    },
    {
      signal: '支撑阻力',
      description: '价格到达重要支撑或阻力位',
      action: '考虑部分止盈',
    },
  ],
}

// 分析函数
export function analyzePriceAction(data: {
  opens: number[]
  highs: number[]
  lows: number[]
  closes: number[]
}): {
  patterns: string[]
  signals: string[]
  trendLines: { type: string; slope: number; reliability: number }[]
  analysis: string
} {
  const { opens, highs, lows, closes } = data

  if (closes.length < 10) {
    return {
      patterns: [],
      signals: [],
      trendLines: [],
      analysis: '数据不足，无法分析',
    }
  }

  const patterns: string[] = []
  const signals: string[] = []

  // 检测 Pin Bar
  const lastIndex = closes.length - 1
  const body = Math.abs(closes[lastIndex] - opens[lastIndex])
  const upperShadow = highs[lastIndex] - Math.max(opens[lastIndex], closes[lastIndex])
  const lowerShadow = Math.min(opens[lastIndex], closes[lastIndex]) - lows[lastIndex]
  const totalRange = highs[lastIndex] - lows[lastIndex]

  if (totalRange > 0) {
    if (lowerShadow > body * 2 && lowerShadow > totalRange * 0.6) {
      patterns.push('Pin Bar（看涨）')
      signals.push('出现看涨 Pin Bar，买方力量强')
    }
    if (upperShadow > body * 2 && upperShadow > totalRange * 0.6) {
      patterns.push('Pin Bar（看跌）')
      signals.push('出现看跌 Pin Bar，卖方力量强')
    }
  }

  // 检测 Inside Bar
  if (lastIndex > 0) {
    if (highs[lastIndex] < highs[lastIndex - 1] && lows[lastIndex] > lows[lastIndex - 1]) {
      patterns.push('Inside Bar')
      signals.push('出现 Inside Bar，市场收敛等待突破')
    }
  }

  // 检测 Engulfing
  if (lastIndex > 0) {
    const prevBody = Math.abs(closes[lastIndex - 1] - opens[lastIndex - 1])
    if (body > prevBody * 1.5) {
      if (closes[lastIndex] > opens[lastIndex] && closes[lastIndex - 1] < opens[lastIndex - 1]) {
        patterns.push('看涨吞没')
        signals.push('出现看涨吞没形态')
      } else if (closes[lastIndex] < opens[lastIndex] && closes[lastIndex - 1] > opens[lastIndex - 1]) {
        patterns.push('看跌吞没')
        signals.push('出现看跌吞没形态')
      }
    }
  }

  // 简单趋势线分析
  const trendLines: { type: string; slope: number; reliability: number }[] = []

  if (closes.length >= 20) {
    const recentCloses = closes.slice(-20)
    const slope = (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses.length

    if (slope > 0) {
      trendLines.push({ type: '上升趋势线', slope, reliability: 0.7 })
    } else if (slope < 0) {
      trendLines.push({ type: '下降趋势线', slope, reliability: 0.7 })
    }
  }

  return {
    patterns,
    signals,
    trendLines,
    analysis: patterns.length > 0
      ? `检测到形态：${patterns.join('、')}。${signals.join('。')}`
      : '未检测到明显形态',
  }
}
