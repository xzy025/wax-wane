import type { ToolModule } from '../types'

export const analyzeWithTheory: ToolModule = {
  schema: {
    name: 'analyzeWithTheory',
    description:
      '基于经典交易理论（Wyckoff、道氏理论、价格行为学、A股情绪周期）分析当前市场状态。' +
      '用于复盘时判断市场阶段、趋势方向、交易信号。',
    parameters: {
      type: 'object',
      properties: {
        analysisType: {
          type: 'string',
          enum: ['wyckoff', 'dow', 'priceAction', 'ashareBoard', 'all'],
          description: '分析类型：wyckoff(量价阶段)、dow(趋势)、priceAction(价格形态)、ashareBoard(情绪周期)、all(全部)',
        },
        stockCode: {
          type: 'string',
          description: '股票代码，用于获取个股数据进行分析',
        },
      },
      required: ['analysisType'],
    },
  },

  async execute(args) {
    const { analysisType, stockCode } = args as {
      analysisType: string
      stockCode?: string
    }

    try {
      // 获取市场数据
      const [breadthRes, limitPoolRes] = await Promise.all([
        fetch('/api/mcp/ashare/breadth'),
        fetch('/api/mcp/ashare/limit-pool?direction=up'),
      ])

      const breadth = await breadthRes.json()
      const limitPool = await limitPoolRes.json()

      // 获取指数分时数据（用于价格行为分析）
      let trendsData = null
      if (analysisType === 'priceAction' || analysisType === 'all') {
        const trendsRes = await fetch('/api/mcp/ashare/trends?code=000001')
        trendsData = await trendsRes.json()
      }

      // 获取个股数据
      let stockData = null
      if (stockCode) {
        const stockRes = await fetch(`/api/mcp/ashare/quote?code=${stockCode}`)
        stockData = await stockRes.json()
      }

      const result: Record<string, unknown> = {}

      // Wyckoff 分析
      if (analysisType === 'wyckoff' || analysisType === 'all') {
        const prices = trendsData?.trends?.map((t: { price: number }) => t.price) ?? []
        const volumes = trendsData?.trends?.map((t: { volume: number }) => t.volume) ?? []

        // 简化的 Wyckoff 分析
        const priceChange = prices.length > 1
          ? (prices[prices.length - 1] - prices[0]) / prices[0]
          : 0
        const avgVolume = volumes.length > 0
          ? volumes.reduce((s: number, v: number) => s + v, 0) / volumes.length
          : 0
        const latestVolume = volumes[volumes.length - 1] ?? 0
        const volumeRatio = avgVolume > 0 ? latestVolume / avgVolume : 1

        let phase = 'unknown'
        let phaseAnalysis = ''

        if (priceChange > 0.01 && volumeRatio > 1.2) {
          phase = 'markup'
          phaseAnalysis = '价涨量增，处于标记上涨期，趋势健康'
        } else if (priceChange > 0.01 && volumeRatio < 0.8) {
          phase = 'markup'
          phaseAnalysis = '价涨量缩，动能减弱，可能接近派发期'
        } else if (priceChange < -0.01 && volumeRatio > 1.2) {
          phase = 'markdown'
          phaseAnalysis = '价跌量增，处于标记下跌期，恐慌抛售'
        } else if (priceChange < -0.01 && volumeRatio < 0.8) {
          phase = 'markdown'
          phaseAnalysis = '价跌量缩，抛压减弱，可能接近吸筹期'
        } else if (Math.abs(priceChange) < 0.005) {
          phase = 'accumulation'
          phaseAnalysis = '价格窄幅震荡，可能处于吸筹期'
        } else {
          phase = 'distribution'
          phaseAnalysis = '价格宽幅震荡，可能处于派发期'
        }

        result.wyckoff = {
          phase,
          volumePattern: volumeRatio > 1.2 ? 'confirmation' : volumeRatio < 0.8 ? 'divergence' : 'neutral',
          analysis: phaseAnalysis,
          signals: [phaseAnalysis],
        }
      }

      // 道氏理论分析
      if (analysisType === 'dow' || analysisType === 'all') {
        const prices = trendsData?.trends?.map((t: { price: number }) => t.price) ?? []
        const priceChange = prices.length > 1
          ? (prices[prices.length - 1] - prices[0]) / prices[0]
          : 0

        let trend = 'sideways'
        let trendAnalysis = ''

        if (priceChange > 0.01) {
          trend = 'uptrend'
          trendAnalysis = '短期上升趋势，高点抬高，低点抬高'
        } else if (priceChange < -0.01) {
          trend = 'downtrend'
          trendAnalysis = '短期下降趋势，高点降低，低点降低'
        } else {
          trend = 'sideways'
          trendAnalysis = '横盘整理，等待方向确认'
        }

        result.dowTheory = {
          trend,
          trendStrength: Math.abs(priceChange) > 0.02 ? 'strong' : Math.abs(priceChange) > 0.01 ? 'moderate' : 'weak',
          supportResistance: {
            support: [],
            resistance: [],
          },
          analysis: trendAnalysis,
          signals: [trendAnalysis],
        }
      }

      // 价格行为分析
      if (analysisType === 'priceAction' || analysisType === 'all') {
        const trends = trendsData?.trends ?? []
        const patterns: string[] = []
        const signals: string[] = []

        if (trends.length > 5) {
          // 检测简单的形态
          const lastPrice = trends[trends.length - 1]?.price ?? 0
          const prevPrice = trends[trends.length - 2]?.price ?? 0
          const priceDiff = (lastPrice - prevPrice) / prevPrice

          if (priceDiff > 0.005) {
            patterns.push('阳线')
            signals.push('价格上涨，买方力量强')
          } else if (priceDiff < -0.005) {
            patterns.push('阴线')
            signals.push('价格下跌，卖方力量强')
          }

          // 检测趋势
          const firstPrice = trends[0]?.price ?? 0
          const trendChange = (lastPrice - firstPrice) / firstPrice

          if (trendChange > 0.01) {
            signals.push('日内趋势向上')
          } else if (trendChange < -0.01) {
            signals.push('日内趋势向下')
          }
        }

        result.priceAction = {
          patterns,
          signals,
          trendLines: [],
          analysis: patterns.length > 0
            ? `检测到形态：${patterns.join('、')}。${signals.join('。')}`
            : '未检测到明显形态',
        }
      }

      // A股情绪周期分析
      if (analysisType === 'ashareBoard' || analysisType === 'all') {
        const limitUpCount = breadth?.limitUpCount ?? limitPool?.count ?? 0
        const limitDownCount = breadth?.limitDownCount ?? 0
        const advance = breadth?.advance ?? 0
        const decline = breadth?.decline ?? 0
        const promotionRate = breadth?.promotionRate ?? 0

        // 计算连板高度（从涨停池中获取）
        const stocks = limitPool?.stocks ?? []
        const maxBoardHeight = stocks.reduce((max: number, s: { consecutiveDays?: number }) => {
          return Math.max(max, s.consecutiveDays ?? 0)
        }, 0)

        let phase = 'unknown'
        let phaseAnalysis = ''
        const strategies: string[] = []

        if (maxBoardHeight <= 3 && limitUpCount < 30) {
          phase = 'icePoint'
          phaseAnalysis = '情绪处于冰点期，连板高度低，涨停家数少'
          strategies.push('空仓等待，观察首板股')
        } else if (maxBoardHeight >= 3 && maxBoardHeight <= 4 && limitUpCount >= 30 && limitUpCount <= 60) {
          phase = 'recovery'
          phaseAnalysis = '情绪处于修复期，连板高度回升，涨停家数恢复'
          strategies.push('可以参与首板和2板')
        } else if (maxBoardHeight >= 5 && limitUpCount > 100) {
          phase = 'climax'
          phaseAnalysis = '情绪处于高潮期，连板高度高，涨停家数多'
          strategies.push('参与龙头，但要控制仓位')
        } else if (maxBoardHeight > 4 && promotionRate < 30) {
          phase = 'retreat'
          phaseAnalysis = '情绪处于退潮期，高位股分歧'
          strategies.push('减仓，参与补涨')
        } else {
          phaseAnalysis = `连板高度${maxBoardHeight}板，涨停${limitUpCount}家，情绪中性`
        }

        result.ashareBoard = {
          sentimentPhase: phase,
          leaderStock: stocks[0]?.name ?? '无',
          boardHeight: maxBoardHeight,
          limitUpCount,
          limitDownCount,
          advance,
          decline,
          promotionRate,
          analysis: phaseAnalysis,
          strategies,
        }
      }

      return result
    } catch (err) {
      return {
        error: `Theory analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }
    }
  },
}
