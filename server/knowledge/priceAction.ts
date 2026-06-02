// Al Brooks Price Action Knowledge Base
// Al Brooks 价格行为学知识库

export const priceAction = {
  name: 'Al Brooks 价格行为学',
  description: '通过K线形态和价格行为判断市场意图',

  // ═══════════════════════════════════════════════════════════
  // 核心概念
  // ═══════════════════════════════════════════════════════════
  coreConcepts: {
    barByBar: {
      name: '逐K线分析',
      description: '每根K线都是市场的投票，连续的K线构成市场语言',
      principle: '不要预测，要跟随每根K线的信号',
    },
    twoLeggedCorrection: {
      name: '两腿回调',
      description: '健康的回调通常由两腿组成（A-B-C 结构）',
      principle: '在第二腿结束时寻找入场机会',
    },
    signalBar: {
      name: '信号K线',
      description: '提供入场信号的K线，通常是反转K线或突破K线',
      principle: '等待信号K线收盘后再入场',
    },
    entryBar: {
      name: '入场K线',
      description: '在信号K线之后的K线，用于确认入场',
      principle: '入场K线应该朝预期方向发展',
    },
  },

  // ═══════════════════════════════════════════════════════════
  // K线形态（扩充版）
  // ═══════════════════════════════════════════════════════════
  candlePatterns: {
    // ── 反转形态 ─────────────────────────────────────────────
    pinBar: {
      name: 'Pin Bar（针形线）',
      description: '长影线，实体小，表示价格被快速拒绝',
      bullish: '下影线长，表示买方力量强',
      bearish: '上影线长，表示卖方力量强',
      reliability: 'high',
      entry: '在 Pin Bar 收盘价附近入场',
      stopLoss: 'Pin Bar 的影线末端',
      context: '在支撑阻力位附近出现更有效',
    },
    engulfing: {
      name: 'Engulfing（吞没形态）',
      description: '当前K线完全吞没前一根K线',
      bullish: '阳线吞没阴线，看涨',
      bearish: '阴线吞没阳线，看跌',
      reliability: 'high',
      entry: '在吞没线收盘价附近入场',
      stopLoss: '吞没线的影线末端',
      context: '在趋势末端出现更有效',
    },
    reversalBar: {
      name: '反转K线',
      description: '收盘价与开盘方向相反的K线',
      bullish: '低开高收，买方控制',
      bearish: '高开低收，卖方控制',
      reliability: 'medium',
      entry: '在反转K线收盘价附近入场',
      stopLoss: '反转K线的极值点',
      context: '需要后续K线确认',
    },
    doji: {
      name: '十字星',
      description: '开盘价接近收盘价，表示多空平衡',
      meaning: '市场犹豫，可能变盘',
      reliability: 'medium',
      entry: '等待后续K线确认方向',
      stopLoss: '十字星的极值点',
      context: '在趋势末端出现更有效',
    },
    hammer: {
      name: '锤子线',
      description: '下影线长，实体小，位于K线上方',
      meaning: '买方在低位强力反击',
      reliability: 'high',
      entry: '在锤子线收盘价附近入场',
      stopLoss: '锤子线低点下方',
      context: '在下跌趋势末端出现',
    },
    shootingStar: {
      name: '射击之星',
      description: '上影线长，实体小，位于K线下方',
      meaning: '卖方在高位强力反击',
      reliability: 'high',
      entry: '在射击之星收盘价附近入场做空',
      stopLoss: '射击之星高点上方',
      context: '在上涨趋势末端出现',
    },

    // ── 持续形态 ─────────────────────────────────────────────
    insideBar: {
      name: 'Inside Bar（内包线）',
      description: '当前K线完全在前一根K线范围内，表示收敛',
      meaning: '市场在积蓄能量，等待突破',
      reliability: 'medium',
      entry: '突破前一根K线的高点或低点时入场',
      stopLoss: '突破方向的反向端',
      context: '在趋势中出现是持续信号',
    },
    outsideBar: {
      name: 'Outside Bar（外包线）',
      description: '当前K线完全包含前一根K线',
      meaning: '波动加大，方向待定',
      reliability: 'low',
      entry: '等待收盘确认方向',
      stopLoss: '外包线的极值点',
      context: '需要后续K线确认',
    },
    twoBarReversal: {
      name: '两K线反转',
      description: '两根K线组成的反转形态',
      bullish: '先跌后涨，第二根收盘高于第一根高点',
      bearish: '先涨后跌，第二根收盘低于第一根低点',
      reliability: 'high',
      entry: '在第二根K线收盘价附近入场',
      stopLoss: '第一根K线的极值点',
      context: '在支撑阻力位附近出现更有效',
    },

    // ── 双顶双底 ─────────────────────────────────────────────
    doubleTop: {
      name: 'Double Top（双顶）',
      description: '两次触及同一高点后回落',
      meaning: '卖方在该价位强劲',
      reliability: 'medium',
      entry: '跌破颈线时入场做空',
      stopLoss: '双顶高点上方',
      context: '在上涨趋势末端出现',
    },
    doubleBottom: {
      name: 'Double Bottom（双底）',
      description: '两次触及同一低点后反弹',
      meaning: '买方在该价位强劲',
      reliability: 'medium',
      entry: '突破颈线时入场做多',
      stopLoss: '双底下沿下方',
      context: '在下跌趋势末端出现',
    },
    wedge: {
      name: '楔形',
      description: '价格在收敛的趋势线内运行',
      rising: '上升楔形，看跌信号',
      falling: '下降楔形，看涨信号',
      reliability: 'medium',
      entry: '突破趋势线时入场',
      stopLoss: '楔形的极值点',
      context: '通常出现在趋势末端',
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 趋势线与通道
  // ═══════════════════════════════════════════════════════════
  trendLines: {
    uptrendLine: {
      name: '上升趋势线',
      drawing: '连接两个以上低点',
      rule: '价格回踩趋势线是买入机会',
      breakSignal: '跌破趋势线可能反转',
      strength: '测试次数越多越可靠',
    },
    downtrendLine: {
      name: '下降趋势线',
      drawing: '连接两个以上高点',
      rule: '价格反弹到趋势线是卖出机会',
      breakSignal: '突破趋势线可能反转',
      strength: '测试次数越多越可靠',
    },
    channel: {
      name: '通道',
      drawing: '平行的趋势线',
      rule: '在通道内高抛低吸',
      breakSignal: '突破通道线可能加速',
      types: ['上升通道', '下降通道', '水平通道'],
    },
    microChannel: {
      name: '微通道',
      description: '连续3-5根K线没有回调',
      meaning: '趋势强劲，但可能即将回调',
      entry: '等待回调后再入场',
      reliability: 'high',
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 入场信号（扩充版）
  // ═══════════════════════════════════════════════════════════
  entrySignals: [
    {
      signal: '回踩趋势线',
      description: '价格回踩上升趋势线后反弹',
      reliability: 'high',
      entry: '在趋势线附近出现反转K线时入场',
      stopLoss: '趋势线下方',
      target: '前高或通道上沿',
    },
    {
      signal: '突破回踩',
      description: '价格突破阻力位后回踩确认',
      reliability: 'high',
      entry: '回踩不破阻力位时入场',
      stopLoss: '突破位下方',
      target: '下一个阻力位',
    },
    {
      signal: '二次测试',
      description: '价格第二次测试关键位置',
      reliability: 'medium',
      entry: '第二次测试成功时入场',
      stopLoss: '测试位下方',
      target: '前高或前低',
    },
    {
      signal: '两腿回调入场',
      description: '价格完成两腿回调后入场',
      reliability: 'high',
      entry: '第二腿结束出现反转K线时入场',
      stopLoss: '回调低点下方',
      target: '前高',
    },
    {
      signal: '失败的突破',
      description: '价格突破后快速回落',
      reliability: 'high',
      entry: '突破失败后反向入场',
      stopLoss: '突破极值点',
      target: '对侧支撑阻力',
    },
    {
      signal: '高潮反转',
      description: '价格急速上涨/下跌后反转',
      reliability: 'medium',
      entry: '出现反转K线后入场',
      stopLoss: '高潮极值点',
      target: '回调到起点附近',
    },
  ],

  // ═══════════════════════════════════════════════════════════
  // 出场信号（扩充版）
  // ═══════════════════════════════════════════════════════════
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
    {
      signal: '两腿上涨完成',
      description: '上涨完成两腿后可能回调',
      action: '部分止盈或移动止损',
    },
    {
      signal: '高潮顶/底',
      description: '急速上涨/下跌后出现反转信号',
      action: '立即离场',
    },
    {
      signal: '信号K线失败',
      description: '入场后信号K线被突破',
      action: '止损离场',
    },
  ],

  // ═══════════════════════════════════════════════════════════
  // 市场结构
  // ═══════════════════════════════════════════════════════════
  marketStructure: {
    trending: {
      name: '趋势市',
      characteristics: ['高点抬高，低点抬高（上涨）', '高点降低，低点降低（下跌）', '回调浅，趋势强'],
      strategy: '顺势交易，回调入场',
      riskLevel: 'low',
    },
    ranging: {
      name: '震荡市',
      characteristics: ['价格在区间内来回波动', '高点和低点无明显方向', '成交量萎缩'],
      strategy: '高抛低吸，等待突破',
      riskLevel: 'medium',
    },
    breakout: {
      name: '突破市',
      characteristics: ['价格突破关键位置', '成交量放大', '波动加大'],
      strategy: '突破入场，回踩确认',
      riskLevel: 'medium',
    },
    reversal: {
      name: '反转市',
      characteristics: ['趋势线被突破', '出现反转形态', '成交量异常'],
      strategy: '等待确认，反向入场',
      riskLevel: 'high',
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 交易策略
  // ═══════════════════════════════════════════════════════════
  strategies: {
    trendPullback: {
      name: '趋势回踩策略',
      description: '在趋势中等待回踩后入场',
      entry: '回踩到支撑位出现反转K线',
      stopLoss: '回踩低点下方',
      target: '前高或新高',
      winRate: '60-70%',
    },
    breakoutRetest: {
      name: '突破回踩策略',
      description: '价格突破后等待回踩确认',
      entry: '回踩不破突破位时入场',
      stopLoss: '突破位下方',
      target: '突破幅度等距',
      winRate: '55-65%',
    },
    failedBreakout: {
      name: '失败突破策略',
      description: '突破失败后反向入场',
      entry: '突破失败出现反转K线时入场',
      stopLoss: '突破极值点',
      target: '对侧支撑阻力',
      winRate: '60-70%',
    },
    twoLegEntry: {
      name: '两腿回调策略',
      description: '等待两腿回调完成后入场',
      entry: '第二腿结束出现反转K线',
      stopLoss: '回调低点下方',
      target: '前高',
      winRate: '65-75%',
    },
  },
}

// ═══════════════════════════════════════════════════════════
// 分析函数（增强版）
// ═══════════════════════════════════════════════════════════

export function analyzePriceAction(data: {
  opens: number[]
  highs: number[]
  lows: number[]
  closes: number[]
}): {
  patterns: string[]
  signals: string[]
  trendLines: { type: string; slope: number; reliability: number }[]
  marketStructure: string
  analysis: string
  tradingAdvice: string
} {
  const { opens, highs, lows, closes } = data

  if (closes.length < 10) {
    return {
      patterns: [],
      signals: [],
      trendLines: [],
      marketStructure: 'unknown',
      analysis: '数据不足，无法分析',
      tradingAdvice: '等待更多数据',
    }
  }

  const patterns: string[] = []
  const signals: string[] = []
  let tradingAdvice = ''

  // ── 检测 Pin Bar ──────────────────────────────────────────
  const lastIndex = closes.length - 1
  const body = Math.abs(closes[lastIndex] - opens[lastIndex])
  const upperShadow = highs[lastIndex] - Math.max(opens[lastIndex], closes[lastIndex])
  const lowerShadow = Math.min(opens[lastIndex], closes[lastIndex]) - lows[lastIndex]
  const totalRange = highs[lastIndex] - lows[lastIndex]

  if (totalRange > 0) {
    if (lowerShadow > body * 2 && lowerShadow > totalRange * 0.6) {
      patterns.push('Pin Bar（看涨）')
      signals.push('出现看涨 Pin Bar，买方力量强')
      tradingAdvice = '在 Pin Bar 收盘价附近入场，止损设在低点下方'
    }
    if (upperShadow > body * 2 && upperShadow > totalRange * 0.6) {
      patterns.push('Pin Bar（看跌）')
      signals.push('出现看跌 Pin Bar，卖方力量强')
      tradingAdvice = '在 Pin Bar 收盘价附近入场做空，止损设在高点上方'
    }
  }

  // ── 检测 Inside Bar ───────────────────────────────────────
  if (lastIndex > 0) {
    if (highs[lastIndex] < highs[lastIndex - 1] && lows[lastIndex] > lows[lastIndex - 1]) {
      patterns.push('Inside Bar')
      signals.push('出现 Inside Bar，市场收敛等待突破')
      tradingAdvice = '等待突破 Inside Bar 的高点或低点时入场'
    }
  }

  // ── 检测 Engulfing ────────────────────────────────────────
  if (lastIndex > 0) {
    const prevBody = Math.abs(closes[lastIndex - 1] - opens[lastIndex - 1])
    if (body > prevBody * 1.5) {
      if (closes[lastIndex] > opens[lastIndex] && closes[lastIndex - 1] < opens[lastIndex - 1]) {
        patterns.push('看涨吞没')
        signals.push('出现看涨吞没形态')
        tradingAdvice = '在吞没线收盘价附近入场，止损设在低点下方'
      } else if (closes[lastIndex] < opens[lastIndex] && closes[lastIndex - 1] > opens[lastIndex - 1]) {
        patterns.push('看跌吞没')
        signals.push('出现看跌吞没形态')
        tradingAdvice = '在吞没线收盘价附近入场做空，止损设在高点上方'
      }
    }
  }

  // ── 检测两K线反转 ─────────────────────────────────────────
  if (lastIndex > 1) {
    const prev2Body = Math.abs(closes[lastIndex - 2] - opens[lastIndex - 2])
    const prev1Body = Math.abs(closes[lastIndex - 1] - opens[lastIndex - 1])
    const currBody = Math.abs(closes[lastIndex] - opens[lastIndex])

    // 看涨两K线反转
    if (closes[lastIndex - 1] < opens[lastIndex - 1] &&
        closes[lastIndex] > opens[lastIndex] &&
        closes[lastIndex] > highs[lastIndex - 1]) {
      patterns.push('两K线反转（看涨）')
      signals.push('出现看涨两K线反转')
    }

    // 看跌两K线反转
    if (closes[lastIndex - 1] > opens[lastIndex - 1] &&
        closes[lastIndex] < opens[lastIndex] &&
        closes[lastIndex] < lows[lastIndex - 1]) {
      patterns.push('两K线反转（看跌）')
      signals.push('出现看跌两K线反转')
    }
  }

  // ── 检测锤子线和射击之星 ──────────────────────────────────
  if (totalRange > 0) {
    // 锤子线
    if (lowerShadow > body * 2 && upperShadow < body * 0.5 && closes[lastIndex] > opens[lastIndex]) {
      patterns.push('锤子线')
      signals.push('出现锤子线，买方在低位反击')
    }

    // 射击之星
    if (upperShadow > body * 2 && lowerShadow < body * 0.5 && closes[lastIndex] < opens[lastIndex]) {
      patterns.push('射击之星')
      signals.push('出现射击之星，卖方在高位反击')
    }
  }

  // ── 检测微通道 ────────────────────────────────────────────
  if (closes.length >= 5) {
    const last5 = closes.slice(-5)
    let allUp = true
    let allDown = true
    for (let i = 1; i < last5.length; i++) {
      if (last5[i] <= last5[i - 1]) allUp = false
      if (last5[i] >= last5[i - 1]) allDown = false
    }
    if (allUp) {
      patterns.push('上升微通道')
      signals.push('连续5根阳线，趋势强劲但可能回调')
    }
    if (allDown) {
      patterns.push('下降微通道')
      signals.push('连续5根阴线，趋势强劲但可能反弹')
    }
  }

  // ── 趋势线分析 ────────────────────────────────────────────
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

  // ── 市场结构判断 ──────────────────────────────────────────
  let marketStructure = 'ranging'

  if (closes.length >= 10) {
    const recent10 = closes.slice(-10)
    const highPoints: number[] = []
    const lowPoints: number[] = []

    for (let i = 1; i < recent10.length - 1; i++) {
      if (recent10[i] > recent10[i - 1] && recent10[i] > recent10[i + 1]) {
        highPoints.push(recent10[i])
      }
      if (recent10[i] < recent10[i - 1] && recent10[i] < recent10[i + 1]) {
        lowPoints.push(recent10[i])
      }
    }

    if (highPoints.length >= 2 && lowPoints.length >= 2) {
      const highTrend = highPoints[highPoints.length - 1] > highPoints[highPoints.length - 2]
      const lowTrend = lowPoints[lowPoints.length - 1] > lowPoints[lowPoints.length - 2]

      if (highTrend && lowTrend) {
        marketStructure = 'trending_up'
      } else if (!highTrend && !lowTrend) {
        marketStructure = 'trending_down'
      }
    }
  }

  const structureNames: Record<string, string> = {
    trending_up: '上升趋势',
    trending_down: '下降趋势',
    ranging: '震荡市',
    unknown: '未知',
  }

  // ── 生成交易建议 ──────────────────────────────────────────
  if (!tradingAdvice) {
    if (marketStructure === 'trending_up') {
      tradingAdvice = '上升趋势中，等待回调到支撑位入场做多'
    } else if (marketStructure === 'trending_down') {
      tradingAdvice = '下降趋势中，等待反弹到阻力位入场做空'
    } else {
      tradingAdvice = '震荡市中，高抛低吸或等待突破'
    }
  }

  return {
    patterns,
    signals,
    trendLines,
    marketStructure: structureNames[marketStructure],
    analysis: patterns.length > 0
      ? `检测到形态：${patterns.join('、')}。${signals.join('。')}。市场结构：${structureNames[marketStructure]}`
      : `未检测到明显形态。市场结构：${structureNames[marketStructure]}`,
    tradingAdvice,
  }
}
