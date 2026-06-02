import type { SubAgent, AgentContext, AgentResult } from '../types'

/**
 * Synthesizer Agent
 * Combines results from multiple theory agents into a unified analysis.
 */
export class SynthesizerAgent implements SubAgent {
  readonly id = 'synthesizer'
  readonly name = '综合分析师'
  readonly stepName = '综合分析'

  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now()

    try {
      const results = context.results

      const wyckoff = results['wyckoff'] ?? '未分析'
      const dow = results['dow'] ?? '未分析'
      const priceAction = results['priceAction'] ?? '未分析'
      const sentiment = results['sentiment'] ?? '未分析'

      // Build synthesis
      const parts: string[] = []

      parts.push('## 理论综合分析')
      parts.push('')
      parts.push(`### Wyckoff 量价理论`)
      parts.push(wyckoff)
      parts.push('')
      parts.push(`### 道氏理论`)
      parts.push(dow)
      parts.push('')
      parts.push(`### Al Brooks 价格行为`)
      parts.push(priceAction)
      parts.push('')
      parts.push(`### A股情绪周期`)
      parts.push(sentiment)
      parts.push('')

      // Cross-theory analysis
      parts.push('### 跨理论综合判断')
      parts.push('')

      // Check for consensus
      const theories = [
        { name: 'Wyckoff', analysis: wyckoff },
        { name: '道氏', analysis: dow },
        { name: '价格行为', analysis: priceAction },
        { name: '情绪', analysis: sentiment },
      ]

      const bullishSignals = theories.filter(t =>
        t.analysis.includes('上涨') || t.analysis.includes('上升') || t.analysis.includes('吸筹') || t.analysis.includes('修复')
      )
      const bearishSignals = theories.filter(t =>
        t.analysis.includes('下跌') || t.analysis.includes('下降') || t.analysis.includes('派发') || t.analysis.includes('退潮')
      )

      if (bullishSignals.length > bearishSignals.length) {
        parts.push('**综合判断**: 偏多 — 多个理论框架显示积极信号')
        parts.push(`积极信号: ${bullishSignals.map(t => t.name).join(', ')}`)
      } else if (bearishSignals.length > bullishSignals.length) {
        parts.push('**综合判断**: 偏空 — 多个理论框架显示消极信号')
        parts.push(`消极信号: ${bearishSignals.map(t => t.name).join(', ')}`)
      } else {
        parts.push('**综合判断**: 中性 — 理论框架信号分歧，建议观望')
      }

      return {
        agentId: this.id,
        agentName: this.name,
        stepName: this.stepName,
        content: parts.join('\n'),
        success: true,
        duration: Date.now() - startTime,
      }
    } catch (err) {
      return {
        agentId: this.id,
        agentName: this.name,
        stepName: this.stepName,
        content: '',
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        duration: Date.now() - startTime,
      }
    }
  }
}
