import { describe, it, expect } from 'vitest'
import { PipelineContext } from './pipeline/context'
import type { AgentResult } from './types'

describe('PipelineContext', () => {
  it('stores and retrieves results', () => {
    const ctx = new PipelineContext('test message', 'zh')

    const result: AgentResult = {
      agentId: 'test',
      agentName: 'Test Agent',
      stepName: 'step1',
      content: 'result content',
      success: true,
      duration: 100,
    }

    ctx.addResult(result)

    expect(ctx.getStepResult('step1')).toBe('result content')
    expect(ctx.hasStep('step1')).toBe(true)
    expect(ctx.hasStep('step2')).toBe(false)
  })

  it('returns all results as object', () => {
    const ctx = new PipelineContext('test', 'zh')

    ctx.addResult({
      agentId: 'a1', agentName: 'A1', stepName: '宏观面分析',
      content: 'macro data', success: true, duration: 50,
    })
    ctx.addResult({
      agentId: 'a2', agentName: 'A2', stepName: '消息面分析',
      content: 'news data', success: true, duration: 50,
    })

    const all = ctx.getAllResults()
    expect(all['宏观面分析']).toBe('macro data')
    expect(all['消息面分析']).toBe('news data')
  })

  it('tracks step count', () => {
    const ctx = new PipelineContext('test', 'zh')

    ctx.addResult({
      agentId: 'a1', agentName: 'A1', stepName: 's1',
      content: 'ok', success: true, duration: 50,
    })
    ctx.addResult({
      agentId: 'a2', agentName: 'A2', stepName: 's2',
      content: '', success: false, error: 'fail', duration: 50,
    })

    expect(ctx.getStepCount()).toBe(2)
    expect(ctx.getSuccessCount()).toBe(1)
  })

  it('generates summary', () => {
    const ctx = new PipelineContext('test', 'zh')

    ctx.addResult({
      agentId: 'a1', agentName: 'A1', stepName: 'Step1',
      content: 'content1', success: true, duration: 50,
    })
    ctx.addResult({
      agentId: 'a2', agentName: 'A2', stepName: 'Step2',
      content: 'content2', success: true, duration: 50,
    })

    const summary = ctx.getSummary()
    expect(summary).toContain('## Step1')
    expect(summary).toContain('content1')
    expect(summary).toContain('## Step2')
    expect(summary).toContain('content2')
  })

  it('does not store failed results', () => {
    const ctx = new PipelineContext('test', 'zh')

    ctx.addResult({
      agentId: 'a1', agentName: 'A1', stepName: 's1',
      content: '', success: false, error: 'fail', duration: 50,
    })

    expect(ctx.hasStep('s1')).toBe(false)
    expect(ctx.getStepResult('s1')).toBeUndefined()
  })
})

describe('Multi-Agent Orchestrators', () => {
  it('StructuredReviewOrchestrator has correct agents', async () => {
    const { StructuredReviewOrchestrator } = await import('./orchestrators/structured-review.orchestrator')
    const orch = new StructuredReviewOrchestrator()
    expect(orch).toBeDefined()
  })

  it('TheoryReviewOrchestrator has correct agents', async () => {
    const { TheoryReviewOrchestrator } = await import('./orchestrators/theory-review.orchestrator')
    const orch = new TheoryReviewOrchestrator()
    expect(orch).toBeDefined()
  })
})

describe('Sub-Agents', () => {
  it('MacroAnalystAgent has correct properties', async () => {
    const { MacroAnalystAgent } = await import('./agents/macro.agent')
    const agent = new MacroAnalystAgent()
    expect(agent.id).toBe('macro-analyst')
    expect(agent.name).toBe('宏观分析师')
    expect(agent.stepName).toBe('宏观面分析')
  })

  it('NewsAnalystAgent has correct properties', async () => {
    const { NewsAnalystAgent } = await import('./agents/news.agent')
    const agent = new NewsAnalystAgent()
    expect(agent.id).toBe('news-analyst')
  })

  it('MarketAnalystAgent has correct properties', async () => {
    const { MarketAnalystAgent } = await import('./agents/market.agent')
    const agent = new MarketAnalystAgent()
    expect(agent.id).toBe('market-analyst')
  })

  it('SectorAnalystAgent has correct properties', async () => {
    const { SectorAnalystAgent } = await import('./agents/sector.agent')
    const agent = new SectorAnalystAgent()
    expect(agent.id).toBe('sector-analyst')
  })

  it('TradeReviewerAgent has correct properties', async () => {
    const { TradeReviewerAgent } = await import('./agents/trade-reviewer.agent')
    const agent = new TradeReviewerAgent()
    expect(agent.id).toBe('trade-reviewer')
  })

  it('WyckoffAgent has correct properties', async () => {
    const { WyckoffAgent } = await import('./agents/wyckoff.agent')
    const agent = new WyckoffAgent()
    expect(agent.id).toBe('wyckoff')
  })

  it('DowAgent has correct properties', async () => {
    const { DowAgent } = await import('./agents/dow.agent')
    const agent = new DowAgent()
    expect(agent.id).toBe('dow')
  })

  it('AlBrooksAgent has correct properties', async () => {
    const { AlBrooksAgent } = await import('./agents/albrooks.agent')
    const agent = new AlBrooksAgent()
    expect(agent.id).toBe('albrooks')
  })

  it('SentimentAgent has correct properties', async () => {
    const { SentimentAgent } = await import('./agents/sentiment.agent')
    const agent = new SentimentAgent()
    expect(agent.id).toBe('sentiment')
  })

  it('SynthesizerAgent has correct properties', async () => {
    const { SynthesizerAgent } = await import('./agents/synthesizer.agent')
    const agent = new SynthesizerAgent()
    expect(agent.id).toBe('synthesizer')
  })
})
