import { BaseAgent } from './base.agent'
import { extractStockCode } from '../../utils'
import type { AgentContext } from '../types'

/**
 * Stock News Analysis Agent
 * Fetches latest news for a specific stock and analyzes sentiment.
 */
export class StockNewsAgent extends BaseAgent {
  readonly id = 'stock-news'
  readonly name = '个股消息面分析师'
  readonly stepName = '消息面分析'
  protected toolName = 'getStockNews'

  protected getToolArgs(context: AgentContext): Record<string, unknown> {
    const code = extractStockCode(context.userMessage)
    return { stockCode: code, count: 10 }
  }

  protected override postProcess(result: unknown): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>

    if (r.error) return `消息面数据获取失败: ${r.error}`

    const code = r.code as string || ''
    const news = r.news as Array<Record<string, string>> | undefined

    if (!news || news.length === 0) {
      return `**${code}** 消息面分析\n- 近期无重大新闻`
    }

    const parts: string[] = []
    parts.push(`**${code}** 消息面分析`)
    parts.push(`- 近期新闻数量: ${news.length}条`)
    parts.push('')

    // Show top 5 news
    parts.push('**最新资讯:**')
    for (let i = 0; i < Math.min(news.length, 5); i++) {
      const item = news[i]
      const time = item.time ? `（${item.time}）` : ''
      parts.push(`${i + 1}. ${item.title}${time}`)
      if (item.snippet) {
        const snippet = item.snippet.length > 100 ? item.snippet.substring(0, 100) + '...' : item.snippet
        parts.push(`   ${snippet}`)
      }
    }

    // Simple sentiment analysis based on keywords
    const allText = news.map(n => `${n.title || ''} ${n.snippet || ''}`).join(' ')
    const positiveWords = ['利好', '增长', '突破', '创新高', '涨停', '大涨', '盈利', '超预期', '增持', '回购']
    const negativeWords = ['利空', '下跌', '暴跌', '亏损', '减持', '违规', '处罚', '风险', '警示', '退市']

    let positiveCount = 0
    let negativeCount = 0
    for (const word of positiveWords) {
      if (allText.includes(word)) positiveCount++
    }
    for (const word of negativeWords) {
      if (allText.includes(word)) negativeCount++
    }

    let sentiment = '中性'
    if (positiveCount > negativeCount + 2) sentiment = '偏正面'
    else if (positiveCount > negativeCount) sentiment = '略偏正面'
    else if (negativeCount > positiveCount + 2) sentiment = '偏负面'
    else if (negativeCount > positiveCount) sentiment = '略偏负面'

    parts.push('')
    parts.push(`- 消息面情绪: **${sentiment}**（利好词${positiveCount}个，利空词${negativeCount}个）`)

    return parts.join('\n')
  }
}
