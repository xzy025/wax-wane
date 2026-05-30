import type { ToolModule } from '../types'

interface StockCandidate {
  code: string
  name: string
  price: number
  changePct: number
  reason: string
  model: string
  confidence: 'high' | 'medium' | 'low'
}

export const screenStocks: ToolModule = {
  schema: {
    name: 'screenStocks',
    description:
      '基于云聪老师的交易方法论筛选股票。' +
      '支持多种模式：2B买入、强势股低吸、首板涨停、早盘低吸。' +
      '结合资金流、板块热点、技术形态进行筛选。',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          enum: ['2b', 'strongDip', 'firstBoard', 'morningDip', 'all'],
          description: '筛选模式：2b(2B买入)、strongDip(强势股低吸)、firstBoard(首板涨停)、morningDip(早盘低吸)、all(全部)',
        },
      },
      required: [],
    },
  },

  async execute(args) {
    const { model = 'all' } = args as { model?: string }

    try {
      // 获取市场数据
      const [breadthRes, limitPoolRes, indicesRes] = await Promise.all([
        fetch('/api/mcp/ashare/breadth'),
        fetch('/api/mcp/ashare/limit-pool?direction=up'),
        fetch('/api/mcp/ashare/indices'),
      ])

      const breadth = await breadthRes.json()
      const limitPool = await limitPoolRes.json()
      const indices = await indicesRes.json()

      const candidates: StockCandidate[] = []

      // 市场情绪判断
      const limitUpCount = breadth?.limitUpCount ?? 0
      const limitDownCount = breadth?.limitDownCount ?? 0
      const advance = breadth?.advance ?? 0
      const decline = breadth?.decline ?? 0
      const marketSentiment = limitUpCount > 50 && limitDownCount < 30 ? 'good' : 'bad'

      // 获取涨停股列表
      const limitUpStocks = limitPool?.stocks ?? []

      // 首板涨停模式筛选
      if (model === 'firstBoard' || model === 'all') {
        if (marketSentiment === 'good') {
          // 筛选首板涨停股
          const firstBoardStocks = limitUpStocks.filter((s: { consecutiveDays?: number }) => {
            return (s.consecutiveDays ?? 0) === 1
          })

          for (const stock of firstBoardStocks.slice(0, 5)) {
            candidates.push({
              code: stock.code,
              name: stock.name,
              price: stock.price,
              changePct: stock.changePct,
              reason: `首板涨停，${stock.industry ?? '未知'}板块，换手率${stock.turnoverRate?.toFixed(1) ?? '0'}%`,
              model: '首板涨停',
              confidence: marketSentiment === 'good' ? 'high' : 'medium',
            })
          }
        }
      }

      // 2B 模型筛选（需要更复杂的技术分析，这里简化处理）
      if (model === '2b' || model === 'all') {
        // 从涨停池中找可能的 2B 候选
        // 实际应该分析个股的 K 线形态
        const potential2B = limitUpStocks.filter((s: { openCount?: number }) => {
          return (s.openCount ?? 0) >= 1 // 开板次数 >= 1，可能是 2B
        })

        for (const stock of potential2B.slice(0, 3)) {
          candidates.push({
            code: stock.code,
            name: stock.name,
            price: stock.price,
            changePct: stock.changePct,
            reason: `可能的 2B 形态，开板${stock.openCount ?? 0}次，${stock.industry ?? '未知'}板块`,
            model: '2B 模型',
            confidence: 'medium',
          })
        }
      }

      // 强势股低吸筛选
      if (model === 'strongDip' || model === 'all') {
        // 从涨停池中找连板后回调的股票
        const strongStocks = limitUpStocks.filter((s: { consecutiveDays?: number }) => {
          return (s.consecutiveDays ?? 0) >= 2 // 连板 >= 2
        })

        for (const stock of strongStocks.slice(0, 3)) {
          candidates.push({
            code: stock.code,
            name: stock.name,
            price: stock.price,
            changePct: stock.changePct,
            reason: `强势股，连板${stock.consecutiveDays ?? 0}天，${stock.industry ?? '未知'}板块`,
            model: '强势股低吸',
            confidence: 'medium',
          })
        }
      }

      // 早盘低吸筛选（沪深300/中证500成分股）
      if (model === 'morningDip' || model === 'all') {
        // 检查指数是否到达关键位置
        const sseIndex = indices?.find((i: { code: string }) => i.code === '000001')
        const indexChange = sseIndex?.changePct ?? 0

        if (indexChange < -1) {
          // 指数下跌，可能有机会
          candidates.push({
            code: '000001',
            name: '上证指数',
            price: sseIndex?.price ?? 0,
            changePct: indexChange,
            reason: `指数下跌${Math.abs(indexChange).toFixed(2)}%，关注沪深300成分股低吸机会`,
            model: '早盘低吸',
            confidence: 'medium',
          })
        }
      }

      // 市场概况
      const marketSummary = {
        sentiment: marketSentiment,
        limitUpCount,
        limitDownCount,
        advance,
        decline,
        adRatio: decline > 0 ? (advance / decline).toFixed(2) : 'N/A',
      }

      return {
        marketSummary,
        candidates,
        totalCandidates: candidates.length,
        advice: marketSentiment === 'bad'
          ? '当前市场情绪较差，建议轻仓或观望，等待市场企稳后再操作。'
          : `当前市场情绪${marketSentiment === 'good' ? '良好' : '一般'}，可以关注以上候选股票。`,
      }
    } catch (err) {
      return {
        error: `Stock screening failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }
    }
  },
}
