import type { AgentMessage } from './types'
import { estimateTokens } from './contextBuilder'

// ── Compression Strategy Types ────────────────────────────

export interface CompressionConfig {
  /** Maximum tokens for recent messages (default: 3000) */
  maxRecentTokens: number
  /** Maximum number of recent messages to keep in full (default: 6) */
  maxRecentMessages: number
  /** Maximum tokens for a single tool result (default: 800) */
  maxToolResultTokens: number
  /** Maximum total tokens target (default: 4000) */
  targetTokens: number
}

const DEFAULT_CONFIG: CompressionConfig = {
  maxRecentTokens: 3000,
  maxRecentMessages: 6,
  maxToolResultTokens: 800,
  targetTokens: 4000,
}

// ── Tool Result Compression ───────────────────────────────

/** Tool-specific compression rules */
const TOOL_COMPRESSORS: Record<string, (result: unknown) => string> = {
  queryTradeHistory: (result) => {
    if (typeof result !== 'object' || !result) return truncate(JSON.stringify(result), 500)
    const r = result as Record<string, unknown>
    const trades = r.trades as unknown[] | undefined
    if (!Array.isArray(trades)) return truncate(JSON.stringify(result), 500)
    return JSON.stringify({
      totalTrades: trades.length,
      sample: trades.slice(0, 3),
      note: trades.length > 3 ? `...and ${trades.length - 3} more` : undefined,
    })
  },

  semanticSearch: (result) => {
    if (!Array.isArray(result)) return truncate(JSON.stringify(result), 500)
    return JSON.stringify(
      result.slice(0, 3).map((r: Record<string, unknown>) => ({
        content: typeof r.content === 'string' ? r.content.substring(0, 200) : r.content,
        score: r.score,
        type: r.type,
      })),
    )
  },

  getStockQuote: (result) => {
    // Stock quote is small, keep as-is
    return JSON.stringify(result)
  },

  getMarketBreadth: (result) => {
    // Market breadth is small, keep as-is
    return JSON.stringify(result)
  },

  getMacroIndicators: (result) => {
    if (typeof result !== 'object' || !result) return truncate(JSON.stringify(result), 500)
    const r = result as Record<string, unknown>
    // Keep summary fields only
    return JSON.stringify({
      usTreasury10y: r.usTreasury10y,
      gold: r.gold,
      usdIndex: r.usdIndex,
      usdcny: r.usdcny,
      crudeOil: r.crudeOil,
      vix: r.vix,
      summary: typeof r.summary === 'string' ? r.summary.substring(0, 200) : undefined,
    })
  },

  getNewsSummary: (result) => {
    if (!Array.isArray(result)) return truncate(JSON.stringify(result), 500)
    return JSON.stringify(
      result.slice(0, 5).map((r: Record<string, unknown>) => ({
        title: r.title,
        source: r.source,
      })),
    )
  },

  getLimitPool: (result) => {
    if (typeof result !== 'object' || !result) return truncate(JSON.stringify(result), 500)
    const r = result as Record<string, unknown>
    return JSON.stringify({
      count: r.count,
      stocks: Array.isArray(r.stocks) ? r.stocks.slice(0, 10) : r.stocks,
    })
  },
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen) + '...[truncated]'
}

/** Compress a tool result based on tool-specific rules */
export function compressToolResult(toolName: string, result: unknown): string {
  const json = typeof result === 'string' ? result : JSON.stringify(result)

  // Small results: keep as-is
  if (json.length < 500) return json

  // Tool-specific compression
  const compressor = TOOL_COMPRESSORS[toolName]
  if (compressor) return compressor(result)

  // Default: truncate
  return truncate(json, 800)
}

// ── Message History Compression ───────────────────────────

interface CompressedContext {
  /** Summary of older messages (empty if no compression needed) */
  summary: string
  /** Recent messages kept in full */
  recentMessages: AgentMessage[]
  /** Estimated token count of the compressed context */
  estimatedTokens: number
}

/** Score a message's importance for retention */
function scoreMessage(message: AgentMessage, index: number, total: number): number {
  let score = 0

  // System messages always kept (handled separately)
  if (message.role === 'system') return 1000

  // User messages are important
  if (message.role === 'user') score += 40

  // Assistant messages with content are important
  if (message.role === 'assistant' && message.content) score += 30

  // Tool messages: compress based on recency
  if (message.role === 'tool') score += 10

  // Recency bonus: more recent = higher score
  const recencyRatio = index / Math.max(total - 1, 1)
  score += Math.round(recencyRatio * 30)

  // Messages with tool calls are important (show agent reasoning)
  if (message.role === 'assistant' && 'tool_calls' in message && message.tool_calls) {
    score += 20
  }

  return score
}

/** Build a summary from older messages */
function buildSummary(messages: AgentMessage[]): string {
  const parts: string[] = []

  // Extract key user questions
  const userMessages = messages.filter((m) => m.role === 'user')
  if (userMessages.length > 0) {
    const questions = userMessages
      .map((m) => (typeof m.content === 'string' ? m.content.substring(0, 100) : ''))
      .filter(Boolean)
    if (questions.length > 0) {
      parts.push(`用户提问: ${questions.join('; ')}`)
    }
  }

  // Extract key assistant findings
  const assistantMessages = messages.filter((m) => m.role === 'assistant' && m.content)
  if (assistantMessages.length > 0) {
    const findings = assistantMessages
      .slice(-2)  // Last 2 assistant messages
      .map((m) => (typeof m.content === 'string' ? m.content.substring(0, 150) : ''))
      .filter(Boolean)
    if (findings.length > 0) {
      parts.push(`分析要点: ${findings.join('; ')}`)
    }
  }

  // Extract tool names used
  const toolMessages = messages.filter((m) => m.role === 'tool')
  if (toolMessages.length > 0) {
    const toolNames = [...new Set(toolMessages.map((m) => (m as Record<string, unknown>).name as string).filter(Boolean))]
    if (toolNames.length > 0) {
      parts.push(`已调用工具: ${toolNames.join(', ')}`)
    }
  }

  return parts.join('\n')
}

/**
 * Compress message history using layered strategy:
 * - Layer 1: System prompt (always kept, handled by caller)
 * - Layer 2: Summary of older messages
 * - Layer 3: Recent messages in full
 * - Layer 4: Current task context (handled by caller)
 */
export function compressMessages(
  messages: AgentMessage[],
  config: Partial<CompressionConfig> = {},
): CompressedContext {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Separate system messages (always keep)
  const systemMessages = messages.filter((m) => m.role === 'system')
  const nonSystemMessages = messages.filter((m) => m.role !== 'system')

  // If within limits, no compression needed
  const totalTokens = nonSystemMessages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return sum + estimateTokens(content)
  }, 0)

  if (totalTokens <= cfg.targetTokens) {
    return {
      summary: '',
      recentMessages: messages,
      estimatedTokens: totalTokens,
    }
  }

  // Score and sort messages
  const scored = nonSystemMessages.map((msg, i) => ({
    message: msg,
    score: scoreMessage(msg, i, nonSystemMessages.length),
    index: i,
  }))

  // Keep recent messages in full
  const recentCount = Math.min(cfg.maxRecentMessages, nonSystemMessages.length)
  const recentMessages = nonSystemMessages.slice(-recentCount)
  const olderMessages = nonSystemMessages.slice(0, -recentCount)

  // Build summary from older messages
  const summary = buildSummary(olderMessages)

  // Estimate final token count
  const summaryTokens = estimateTokens(summary)
  const recentTokens = recentMessages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return sum + estimateTokens(content)
  }, 0)

  return {
    summary,
    recentMessages: [...systemMessages, ...recentMessages],
    estimatedTokens: summaryTokens + recentTokens,
  }
}

// ── Streaming Token Compression ───────────────────────────

/** Accumulate streamed tokens and compress at boundaries */
export class TokenAccumulator {
  private buffer = ''
  private sentences: string[] = []

  /** Add a token, return compressed output if a sentence boundary is found */
  addToken(token: string): string | null {
    this.buffer += token

    // Check for sentence boundaries
    const match = this.buffer.match(/[^.!?。！？\n]*[.!?。！？\n]/)
    if (match) {
      const sentence = match[0].trim()
      this.buffer = this.buffer.substring(match[0].length)
      if (sentence) {
        this.sentences.push(sentence)
        return sentence
      }
    }

    return null
  }

  /** Flush remaining buffer */
  flush(): string {
    const remaining = this.buffer.trim()
    this.buffer = ''
    if (remaining) {
      this.sentences.push(remaining)
    }
    return remaining
  }

  /** Get all accumulated sentences */
  getSentences(): string[] {
    return [...this.sentences]
  }

  /** Get full accumulated text */
  getFullText(): string {
    return this.sentences.join('') + this.buffer
  }
}
