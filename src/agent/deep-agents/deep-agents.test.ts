import { describe, it, expect } from 'vitest'
import { DeepAgentAdapter } from './adapter'
import { isStructuredRequest } from './agent'

// Mock AppState
const mockAppState = {
  trades: [],
  tradeGroups: [],
  reviewNotes: {},
  importBatches: [],
} as never

describe('DeepAgentAdapter', () => {
  it('creates adapter with default config', () => {
    const adapter = new DeepAgentAdapter(mockAppState)
    const config = adapter.getConfig()

    expect(config.enablePlanning).toBe(true)
    expect(config.enableSubAgents).toBe(true)
    expect(config.enableFilesystem).toBe(false)
    expect(config.maxIterations).toBe(10)
  })

  it('creates adapter with custom config', () => {
    const adapter = new DeepAgentAdapter(mockAppState, {
      enablePlanning: false,
      maxIterations: 5,
    })
    const config = adapter.getConfig()

    expect(config.enablePlanning).toBe(false)
    expect(config.maxIterations).toBe(5)
  })

  it('returns tool definitions', () => {
    const adapter = new DeepAgentAdapter(mockAppState)
    const tools = adapter.getToolDefinitions()

    expect(tools.length).toBeGreaterThan(0)
    expect(tools[0]).toHaveProperty('name')
    expect(tools[0]).toHaveProperty('description')
    expect(tools[0]).toHaveProperty('parameters')
  })

  it('returns app state', () => {
    const adapter = new DeepAgentAdapter(mockAppState)
    expect(adapter.getAppState()).toBe(mockAppState)
  })
})

describe('isStructuredRequest', () => {
  it('detects 复盘', () => {
    expect(isStructuredRequest('帮我复盘')).toBe(true)
    expect(isStructuredRequest('一键复盘')).toBe(true)
    expect(isStructuredRequest('每日复盘')).toBe(true)
  })

  it('detects review', () => {
    expect(isStructuredRequest('daily review')).toBe(true)
    expect(isStructuredRequest('Review my trades')).toBe(true)
  })

  it('detects 理论分析', () => {
    expect(isStructuredRequest('帮我理论分析')).toBe(true)
    expect(isStructuredRequest('用理论分析一下')).toBe(true)
  })

  it('detects 帮我复盘', () => {
    expect(isStructuredRequest('帮我复盘一下今天的交易')).toBe(true)
  })

  it('returns false for regular questions', () => {
    expect(isStructuredRequest('今天天气怎么样')).toBe(false)
    expect(isStructuredRequest('我的胜率是多少')).toBe(false)
    expect(isStructuredRequest('你好')).toBe(false)
  })
})

describe('DeepAgents Types', () => {
  it('DeepAgentConfig has correct structure', () => {
    const config: import('./types').DeepAgentConfig = {
      llmId: 'test',
      enablePlanning: true,
      enableSubAgents: true,
      enableFilesystem: false,
      maxIterations: 10,
    }

    expect(config.llmId).toBe('test')
    expect(config.enablePlanning).toBe(true)
  })

  it('DeepAgentResult has correct structure', () => {
    const result: import('./types').DeepAgentResult = {
      content: 'test',
      toolCalls: [],
      duration: 100,
      usedPlanning: false,
    }

    expect(result.content).toBe('test')
    expect(result.duration).toBe(100)
  })
})

describe('AgentLoopV2', () => {
  it('exports runAgentV2', async () => {
    const { runAgentV2 } = await import('../agentLoopV2')
    expect(typeof runAgentV2).toBe('function')
  })
})
