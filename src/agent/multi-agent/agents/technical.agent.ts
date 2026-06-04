import { BaseAgent } from './base.agent'
import { extractStockCode } from '../../utils'
import type { AgentContext } from '../types'

/**
 * Technical Analysis Agent
 * Analyzes stock using K-line data + multiple theory frameworks:
 * - Wyckoff Volume-Price (accumulation/distribution phases)
 * - Dow Theory (trend direction, support/resistance)
 * - Al Brooks Price Action (candle patterns, trend lines)
 * - Volume-price relationship
 */
export class TechnicalAgent extends BaseAgent {
  readonly id = 'technical'
  readonly name = '技术面分析师'
  readonly stepName = '技术面分析'
  protected toolName = 'getStockKline'

  protected getToolArgs(context: AgentContext): Record<string, unknown> {
    const code = extractStockCode(context.userMessage)
    return { stockCode: code, period: 101, count: 60 }
  }

  protected override postProcess(result: unknown, context: AgentContext): string {
    if (typeof result !== 'object' || !result) return String(result)
    const r = result as Record<string, unknown>
    const klines = r.klines as Array<Record<string, number | string>> | undefined
    const name = r.name as string || ''

    if (!klines || klines.length === 0) return '无法获取K线数据'

    const code = extractStockCode(context.userMessage)
    const latest = klines[klines.length - 1]
    const prev5 = klines.slice(-6, -1)
    const prev20 = klines.slice(-21, -1)

    // Extract numeric values
    const latestClose = Number(latest.close) || 0
    const latestOpen = Number(latest.open) || 0
    const latestHigh = Number(latest.high) || 0
    const latestLow = Number(latest.low) || 0
    const latestVolume = Number(latest.volume) || 0
    const latestChangePct = Number(latest.changePct) || 0

    // Calculate basic stats
    const avgVolume5 = prev5.reduce((s, k) => s + (Number(k.volume) || 0), 0) / prev5.length
    const avgVolume20 = prev20.reduce((s, k) => s + (Number(k.volume) || 0), 0) / prev20.length
    const volumeRatio = avgVolume20 > 0 ? avgVolume5 / avgVolume20 : 1

    // Find recent high/low
    const recent20 = klines.slice(-20)
    const high20 = Math.max(...recent20.map(k => Number(k.high) || 0))
    const low20 = Math.min(...recent20.map(k => Number(k.low) || 0))
    const range = high20 - low20
    const position = range > 0 ? ((latestClose - low20) / range * 100).toFixed(1) : 'N/A'

    // Price trend
    const prev5Close = Number(prev5[0]?.close) || latestClose
    const prev20Close = Number(prev20[0]?.close) || latestClose
    const change5d = prev5.length >= 5
      ? ((latestClose - prev5Close) / prev5Close * 100).toFixed(2)
      : 'N/A'
    const change20d = prev20.length >= 20
      ? ((latestClose - prev20Close) / prev20Close * 100).toFixed(2)
      : 'N/A'

    // Candle pattern detection (simplified)
    const body = Math.abs(latestClose - latestOpen)
    const upperShadow = latestHigh - Math.max(latestClose, latestOpen)
    const lowerShadow = Math.min(latestClose, latestOpen) - latestLow
    const isHammer = lowerShadow > body * 2 && upperShadow < body * 0.5
    const isShootingStar = upperShadow > body * 2 && lowerShadow < body * 0.5
    const isDoji = body < (latestHigh - latestLow) * 0.1

    const patterns: string[] = []
    if (isHammer) patterns.push('锤子线（看涨信号）')
    if (isShootingStar) patterns.push('射击之星（看跌信号）')
    if (isDoji) patterns.push('十字星（犹豫信号）')

    // Volume analysis
    const volumeSignal = volumeRatio > 1.5 ? '放量' : volumeRatio < 0.7 ? '缩量' : '平量'

    const parts: string[] = []
    parts.push(`**${name || code}** 技术面分析`)
    parts.push(`- 最新价: ${latestClose}，涨跌: ${latestChangePct}%`)
    parts.push(`- 5日涨跌: ${change5d}%，20日涨跌: ${change20d}%`)
    parts.push(`- 20日区间位置: ${position}%（0%=最低，100%=最高）`)
    parts.push(`- 成交量: ${volumeSignal}（5日/20日均量比: ${volumeRatio.toFixed(2)}）`)
    if (patterns.length > 0) parts.push(`- K线形态: ${patterns.join('、')}`)

    // Wyckoff simplified phase detection
    const trend20 = latestClose > prev20Close ? '上升' : '下降'
    const wyckoffPhase = trend20 === '上升' && volumeRatio > 1.2
      ? '上涨期（放量上涨，健康趋势）'
      : trend20 === '上升' && volumeRatio < 0.8
        ? '上涨末期（缩量上涨，注意见顶）'
        : trend20 === '下降' && volumeRatio > 1.2
          ? '派发期（放量下跌，主力出货）'
          : trend20 === '下降' && volumeRatio < 0.8
            ? '下跌末期/吸筹期（缩量下跌，可能见底）'
            : '横盘整理'
    parts.push(`- Wyckoff阶段判断: ${wyckoffPhase}`)

    // Support/resistance (simplified)
    parts.push(`- 支撑位: ${low20}（20日最低）`)
    parts.push(`- 阻力位: ${high20}（20日最高）`)

    // Summary signal
    let signal = '中性'
    const bullish = (isHammer ? 1 : 0) + (trend20 === '上升' ? 1 : 0) + (volumeRatio > 1.2 && trend20 === '上升' ? 1 : 0)
    const bearish = (isShootingStar ? 1 : 0) + (trend20 === '下降' ? 1 : 0) + (volumeRatio > 1.2 && trend20 === '下降' ? 1 : 0)
    if (bullish > bearish + 1) signal = '偏多'
    else if (bearish > bullish + 1) signal = '偏空'
    parts.push(`- 技术信号: **${signal}**`)

    return parts.join('\n')
  }
}
