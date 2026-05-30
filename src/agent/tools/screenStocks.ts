import type { ToolModule } from '../types'

interface StockCandidate {
  code: string
  name: string
  price: number
  changePct: number
  turnoverRate: number
  amount: number
  reason: string
  model: string
  confidence: 'high' | 'medium' | 'low'
}

export const screenStocks: ToolModule = {
  schema: {
    name: 'screenStocks',
    description:
      '基于云聪老师的交易方法论筛选今日 A 股机会。' +
      '分析涨停股、市场情绪、指数走势，返回候选股票列表。' +
      '用户问"帮我选股"、"今天有什么机会"、"用XX模式选股"时使用。',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          enum: ['2b', 'strongDip', 'firstBoard', 'morningDip', 'all'],
          description: '筛选模式，默认 all',
        },
      },
      required: [],
    },
  },

  async execute(args) {
    const { model = 'all' } = args as { model?: string }

    try {
      // 获取市场数据
      const [breadthRes, limitUpRes, limitDownRes, indicesRes] = await Promise.all([
        fetch('/api/mcp/ashare/breadth'),
        fetch('/api/mcp/ashare/limit-pool?direction=up'),
        fetch('/api/mcp/ashare/limit-pool?direction=down'),
        fetch('/api/mcp/ashare/indices'),
      ])

      const breadth = await breadthRes.json()
      const limitUp = await limitUpRes.json()
      const limitDown = await limitDownRes.json()
      const indices = await indicesRes.json()

      const candidates: StockCandidate[] = []

      // 市场情绪判断
      const limitUpCount = breadth?.limitUpCount ?? 0
      const limitDownCount = breadth?.limitDownCount ?? limitDown?.count ?? 0
      const advance = breadth?.advance ?? 0
      const decline = breadth?.decline ?? 0

      // 情绪判断逻辑
      let sentiment = 'neutral'
      let sentimentDesc = ''
      if (limitUpCount >= 80 && limitDownCount < 20) {
        sentiment = 'very_good'
        sentimentDesc = '市场情绪非常好，适合大胆操作'
      } else if (limitUpCount >= 50 && limitDownCount < 40) {
        sentiment = 'good'
        sentimentDesc = '市场情绪良好，可以操作'
      } else if (limitUpCount < 30 && limitDownCount > 50) {
        sentiment = 'bad'
        sentimentDesc = '市场情绪较差，建议观望或轻仓'
      } else if (limitUpCount < 20 && limitDownCount > 80) {
        sentiment = 'very_bad'
        sentimentDesc = '市场情绪极差，建议空仓等待'
      } else {
        sentiment = 'neutral'
        sentimentDesc = '市场情绪中性，谨慎操作'
      }

      // 涨停股列表
      const limitUpStocks = limitUp?.stocks ?? []
      const limitDownStocks = limitDown?.stocks ?? []

      // 指数数据
      const sseIndex = indices?.find((i: { code: string }) => i.code === '000001')
      const szseIndex = indices?.find((i: { code: string }) => i.code === '399001')
      const chinextIndex = indices?.find((i: { code: string }) => i.code === '399006')

      // === 首板涨停模式 ===
      if (model === 'firstBoard' || model === 'all') {
        // 筛选涨幅接近涨停的股票（9.5% - 10%）
        const nearLimitUp = limitUpStocks.filter((s: { changePct: number }) => {
          return s.changePct >= 9.5 && s.changePct < 10.5
        })

        // 筛选涨停股
        const limitUpCandidates = limitUpStocks.filter((s: { changePct: number }) => {
          return s.changePct >= 19.5 || (s.changePct >= 9.5 && s.changePct <= 10.5)
        })

        for (const stock of limitUpCandidates.slice(0, 8)) {
          const is20cm = stock.code.startsWith('300') || stock.code.startsWith('301') || stock.code.startsWith('688')
          const limitPct = is20cm ? 20 : 10
          const isLimitUp = stock.changePct >= limitPct - 0.5

          candidates.push({
            code: stock.code,
            name: stock.name,
            price: stock.price,
            changePct: stock.changePct,
            turnoverRate: stock.turnoverRate ?? 0,
            amount: stock.amount ?? 0,
            reason: isLimitUp
              ? `涨停 ${stock.changePct.toFixed(1)}%，换手率 ${(stock.turnoverRate ?? 0).toFixed(1)}%，成交额 ${((stock.amount ?? 0) / 100000000).toFixed(2)}亿`
              : `涨幅 ${stock.changePct.toFixed(1)}%，接近涨停`,
            model: '首板涨停',
            confidence: sentiment === 'good' || sentiment === 'very_good' ? 'high' : 'medium',
          })
        }
      }

      // === 2B 模型 ===
      if (model === '2b' || model === 'all') {
        // 从涨停股中找开板的（可能是 2B 形态）
        const openedLimitUp = limitUpStocks.filter((s: { openCount?: number }) => {
          return (s.openCount ?? 0) >= 1
        })

        for (const stock of openedLimitUp.slice(0, 5)) {
          candidates.push({
            code: stock.code,
            name: stock.name,
            price: stock.price,
            changePct: stock.changePct,
            turnoverRate: stock.turnoverRate ?? 0,
            amount: stock.amount ?? 0,
            reason: `涨停开板${stock.openCount ?? 0}次，可能是 2B 形态，换手率 ${(stock.turnoverRate ?? 0).toFixed(1)}%`,
            model: '2B 模型',
            confidence: 'medium',
          })
        }
      }

      // === 强势股低吸 ===
      if (model === 'strongDip' || model === 'all') {
        // 找高换手率的股票（可能是强势股）
        const highTurnover = limitUpStocks
          .filter((s: { turnoverRate?: number }) => (s.turnoverRate ?? 0) > 10)
          .sort((a: { turnoverRate?: number }, b: { turnoverRate?: number }) => (b.turnoverRate ?? 0) - (a.turnoverRate ?? 0))

        for (const stock of highTurnover.slice(0, 5)) {
          candidates.push({
            code: stock.code,
            name: stock.name,
            price: stock.price,
            changePct: stock.changePct,
            turnoverRate: stock.turnoverRate ?? 0,
            amount: stock.amount ?? 0,
            reason: `高换手率 ${(stock.turnoverRate ?? 0).toFixed(1)}%，成交活跃，可能是强势股`,
            model: '强势股低吸',
            confidence: 'medium',
          })
        }
      }

      // === 早盘低吸 ===
      if (model === 'morningDip' || model === 'all') {
        const sseChange = sseIndex?.changePct ?? 0
        const szseChange = szseIndex?.changePct ?? 0

        if (sseChange < -1 || szseChange < -1) {
          // 指数下跌，可能有机会
          candidates.push({
            code: '000001',
            name: '上证指数',
            price: sseIndex?.price ?? 0,
            changePct: sseChange,
            turnoverRate: 0,
            amount: 0,
            reason: `指数下跌 ${Math.abs(sseChange).toFixed(2)}%，关注沪深300成分股低吸机会`,
            model: '早盘低吸',
            confidence: 'medium',
          })
        }
      }

      // 去重
      const seen = new Set<string>()
      const uniqueCandidates = candidates.filter(c => {
        if (seen.has(c.code)) return false
        seen.add(c.code)
        return true
      })

      // 市场概况
      const marketSummary = {
        sentiment,
        sentimentDesc,
        indices: {
          sse: { name: '上证指数', price: sseIndex?.price ?? 0, changePct: sseIndex?.changePct ?? 0 },
          szse: { name: '深证成指', price: szseIndex?.price ?? 0, changePct: szseIndex?.changePct ?? 0 },
          chinext: { name: '创业板指', price: chinextIndex?.price ?? 0, changePct: chinextIndex?.changePct ?? 0 },
        },
        breadth: {
          limitUpCount,
          limitDownCount,
          advance,
          decline,
          adRatio: decline > 0 ? (advance / decline).toFixed(2) : 'N/A',
        },
      }

      // 操作建议
      let advice = ''
      if (sentiment === 'very_bad') {
        advice = '❌ 市场情绪极差，建议空仓等待，不要操作。'
      } else if (sentiment === 'bad') {
        advice = '⚠️ 市场情绪较差，建议观望或极轻仓练习。'
      } else if (sentiment === 'neutral') {
        advice = '⚠️ 市场情绪中性，可以轻仓操作，严格止损。'
      } else if (sentiment === 'good') {
        advice = '✅ 市场情绪良好，可以正常操作，关注以上候选股票。'
      } else {
        advice = '🔥 市场情绪非常好，可以大胆操作，但注意不要追高。'
      }

      return {
        marketSummary,
        candidates: uniqueCandidates,
        totalCandidates: uniqueCandidates.length,
        advice,
        usage: '你可以问："帮我分析XXX股票" 或 "用2B模式选股" 或 "今天适合做什么"',
      }
    } catch (err) {
      return {
        error: `选股失败: ${err instanceof Error ? err.message : 'Unknown error'}`,
        tip: '请确保市场数据服务正常运行。',
      }
    }
  },
}
