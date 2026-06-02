import { describe, it, expect } from 'vitest'
import {
  compressToolResult,
  compressMessages,
  TokenAccumulator,
} from './contextCompression'
import type { AgentMessage } from './types'

describe('compressToolResult', () => {
  it('returns small results unchanged', () => {
    const result = { price: 100, volume: 1000 }
    expect(compressToolResult('getStockQuote', result)).toBe(JSON.stringify(result))
  })

  it('truncates large generic results', () => {
    const result = { data: 'x'.repeat(2000) }
    const compressed = compressToolResult('unknownTool', result)
    expect(compressed.length).toBeLessThan(1000)
    expect(compressed).toContain('truncated')
  })

  it('compresses queryTradeHistory by sampling', () => {
    const result = {
      trades: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        stock: `stock-${i}`,
        pnl: i * 100,
      })),
    }
    const compressed = compressToolResult('queryTradeHistory', result)
    const parsed = JSON.parse(compressed)
    expect(parsed.totalTrades).toBe(50)
    expect(parsed.sample).toHaveLength(3)
    expect(parsed.note).toContain('47 more')
  })

  it('compresses semanticSearch to top 3', () => {
    const result = Array.from({ length: 10 }, (_, i) => ({
      content: `Result ${i} with some content that might be long`,
      score: 0.9 - i * 0.05,
      type: 'trade',
    }))
    const compressed = compressToolResult('semanticSearch', result)
    const parsed = JSON.parse(compressed)
    expect(parsed).toHaveLength(3)
  })

  it('compresses getNewsSummary to top 5', () => {
    const result = Array.from({ length: 20 }, (_, i) => ({
      title: `News ${i}`,
      source: 'test',
      content: 'x'.repeat(500),
    }))
    const compressed = compressToolResult('getNewsSummary', result)
    const parsed = JSON.parse(compressed)
    expect(parsed).toHaveLength(5)
    // Should only have title and source, not content
    expect(parsed[0].content).toBeUndefined()
  })

  it('compresses getLimitPool by limiting stocks', () => {
    const result = {
      count: 50,
      stocks: Array.from({ length: 50 }, (_, i) => ({ code: `${i}`, name: `Stock ${i}` })),
    }
    const compressed = compressToolResult('getLimitPool', result)
    const parsed = JSON.parse(compressed)
    expect(parsed.count).toBe(50)
    expect(parsed.stocks).toHaveLength(10)
  })

  it('compresses getMacroIndicators to key fields', () => {
    const result = {
      usTreasury10y: '4.5%',
      gold: 2300,
      usdIndex: 105,
      usdcny: 7.2,
      crudeOil: 80,
      vix: 15,
      summary: 'x'.repeat(500),
      extraField: 'should be removed',
    }
    const compressed = compressToolResult('getMacroIndicators', result)
    const parsed = JSON.parse(compressed)
    expect(parsed.usTreasury10y).toBe('4.5%')
    expect(parsed.gold).toBe(2300)
    expect(parsed.extraField).toBeUndefined()
    expect(parsed.summary.length).toBeLessThanOrEqual(200)
  })
})

describe('compressMessages', () => {
  const makeMessages = (count: number): AgentMessage[] => {
    const messages: AgentMessage[] = []
    for (let i = 0; i < count; i++) {
      if (i % 3 === 0) {
        messages.push({ role: 'user', content: `User message ${i} with some content` })
      } else if (i % 3 === 1) {
        messages.push({ role: 'assistant', content: `Assistant response ${i} with analysis` })
      } else {
        messages.push({
          role: 'tool',
          content: JSON.stringify({ result: `Tool result ${i}`, data: 'x'.repeat(200) }),
          tool_call_id: `call-${i}`,
        })
      }
    }
    return messages
  }

  it('does not compress small message sets', () => {
    const messages = makeMessages(5)
    const result = compressMessages(messages)
    expect(result.summary).toBe('')
    expect(result.recentMessages).toHaveLength(5)
  })

  it('compresses large message sets', () => {
    const messages = makeMessages(30)
    const result = compressMessages(messages, { targetTokens: 100 })
    expect(result.summary).toBeTruthy()
    expect(result.recentMessages.length).toBeLessThan(30)
  })

  it('preserves system messages', () => {
    const messages: AgentMessage[] = [
      { role: 'system', content: 'System prompt' },
      ...makeMessages(20),
    ]
    const result = compressMessages(messages, { targetTokens: 100 })
    const systemMsgs = result.recentMessages.filter((m) => m.role === 'system')
    expect(systemMsgs).toHaveLength(1)
  })

  it('keeps recent messages in full', () => {
    const messages = makeMessages(20)
    const result = compressMessages(messages, {
      targetTokens: 100,
      maxRecentMessages: 6,
    })
    // Recent messages should be the last 6 non-system messages
    expect(result.recentMessages.length).toBeLessThanOrEqual(6 + 1) // +1 for potential system msg
  })

  it('includes summary of older messages', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'What is my win rate?' },
      { role: 'assistant', content: 'Your win rate is 45% based on 20 trades.' },
      { role: 'user', content: 'What are my biggest mistakes?' },
      { role: 'assistant', content: 'Your biggest mistake is chasing highs.' },
      ...makeMessages(20),
    ]
    const result = compressMessages(messages, { targetTokens: 100 })
    expect(result.summary).toContain('win rate')
    expect(result.summary).toContain('mistakes')
  })
})

describe('TokenAccumulator', () => {
  it('accumulates tokens and returns at sentence boundaries', () => {
    const acc = new TokenAccumulator()

    expect(acc.addToken('Hello')).toBeNull()
    expect(acc.addToken(' world.')).toBe('Hello world.')
    expect(acc.addToken('How')).toBeNull()
    expect(acc.addToken(' are you?')).toBe('How are you?')
  })

  it('handles Chinese sentence boundaries', () => {
    const acc = new TokenAccumulator()

    expect(acc.addToken('你好')).toBeNull()
    expect(acc.addToken('世界。')).toBe('你好世界。')
  })

  it('flushes remaining buffer', () => {
    const acc = new TokenAccumulator()

    acc.addToken('Hello')
    acc.addToken(' world')
    const remaining = acc.flush()
    expect(remaining).toBe('Hello world')
  })

  it('tracks all sentences', () => {
    const acc = new TokenAccumulator()

    acc.addToken('First. ')
    acc.addToken('Second. ')
    acc.flush()

    expect(acc.getSentences()).toContain('First.')
    expect(acc.getSentences()).toContain('Second.')
  })
})
