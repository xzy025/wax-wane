import { BaseAgent } from './base.agent'
import { extractStockCode } from '../../utils'
import type { AgentContext } from '../types'

/**
 * Fundamental Analysis Agent
 * Analyzes stock fundamentals: PE, PB, ROE, market cap, industry.
 */
export class FundamentalAgent extends BaseAgent {
  readonly id = 'fundamental'
  readonly name = '基本面分析师'
  readonly stepName = '基本面分析'
  protected toolName = 'getStockFundamentals'

  protected getToolArgs(context: AgentContext): Record<string, unknown> {
    const code = extractStockCode(context.userMessage)
    return { stockCode: code }
  }

  protected override postProcess(result: unknown): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>

    if (r.error) return `基本面数据获取失败: ${r.error}`

    const name = r.name as string || r.code as string || ''
    const pe = r.pe as number || 0
    const pb = r.pb as number || 0
    const roe = r.roe as number || 0
    const marketCap = r.marketCap as number || 0
    const industry = r.industry as string || '未知'
    const eps = r.eps as number || 0

    const parts: string[] = []
    parts.push(`**${name}** 基本面分析`)
    parts.push(`- 行业: ${industry}`)

    // Market cap formatting
    if (marketCap > 0) {
      const capYi = (marketCap / 100000000).toFixed(1)
      parts.push(`- 总市值: ${capYi}亿`)
    }

    // Valuation
    if (pe > 0) {
      let peLevel = ''
      if (pe < 15) peLevel = '低估'
      else if (pe < 30) peLevel = '合理'
      else if (pe < 60) peLevel = '偏高'
      else peLevel = '高估'
      parts.push(`- 市盈率(PE): ${pe}（${peLevel}）`)
    }

    if (pb > 0) {
      let pbLevel = ''
      if (pb < 1) pbLevel = '破净，可能低估'
      else if (pb < 3) pbLevel = '合理'
      else if (pb < 5) pbLevel = '偏高'
      else pbLevel = '高估'
      parts.push(`- 市净率(PB): ${pb}（${pbLevel}）`)
    }

    // Profitability
    if (roe > 0) {
      let roeLevel = ''
      if (roe > 20) roeLevel = '优秀'
      else if (roe > 15) roeLevel = '良好'
      else if (roe > 10) roeLevel = '一般'
      else roeLevel = '偏低'
      parts.push(`- 净资产收益率(ROE): ${roe}%（${roeLevel}）`)
    }

    if (eps > 0) {
      parts.push(`- 每股收益(EPS): ${eps.toFixed(2)}`)
    }

    // Valuation summary
    let valuationSignal = '中性'
    if (pe > 0 && pe < 30 && roe > 15) valuationSignal = '估值合理，盈利能力强'
    else if (pe > 0 && pe < 15 && roe > 10) valuationSignal = '低估，有投资价值'
    else if (pe > 60 || (pb > 5 && roe < 10)) valuationSignal = '估值偏高，注意风险'
    else if (pe > 0) valuationSignal = '估值中性'

    parts.push(`- 估值判断: **${valuationSignal}**`)

    return parts.join('\n')
  }
}
