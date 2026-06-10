import { describe, it, expect } from 'vitest'
import {
  buildFundamentalPrompt,
  partitionFundamentals,
  makeDeltaAccumulator,
} from './analysisPrompt'
import type { StockFundamentals } from '../services/ashare'
import type { CnFinanceKnowledge } from './analysisPrompt'

// A realistic East Money fundamentals object: only pe/pb/roe/marketCap/eps/bvps
// come back populated; everything else is 0/未知 (the current data limitation).
function makeFundamentals(overrides: Partial<StockFundamentals> = {}): StockFundamentals {
  return {
    code: '300750',
    name: '宁德时代',
    pe: 18.5,
    pb: 3.2,
    ps: 0,
    roe: 21.4,
    grossMargin: 0,
    netMargin: 0,
    revenueGrowth: 0,
    profitGrowth: 0,
    marketCap: 1_000_000_000_000,
    circulatingMarketCap: 0,
    totalShares: 0,
    circulatingShares: 0,
    eps: 9.7,
    bvps: 56.1,
    industry: '未知',
    region: '未知',
    turnoverRate: 0,
    volumeRatio: 0,
    amplitude: 2.3,
    ...overrides,
  }
}

const KNOWLEDGE: CnFinanceKnowledge = {
  companyProfile: '一页纸速览方法论内容',
  financialStatements: '三表分析方法论内容',
  valuationModels: '估值模型方法论内容',
}

describe('partitionFundamentals', () => {
  it('treats 0 in zero-means-missing numeric fields as missing', () => {
    const { provided, missing } = partitionFundamentals(makeFundamentals())
    const providedText = provided.join('\n')
    expect(providedText).toContain('市盈率 PE(TTM): 18.5')
    expect(providedText).toContain('ROE')
    expect(providedText).toContain('每股净资产 BVPS')
    // 0-valued fields must be reported as missing, not "0"
    expect(missing).toContain('毛利率')
    expect(missing).toContain('营收增长率')
    expect(missing).toContain('市销率 PS')
    expect(providedText).not.toContain('毛利率')
  })

  it('treats 未知 string fields as missing', () => {
    const { missing } = partitionFundamentals(makeFundamentals())
    expect(missing).toContain('所属行业')
    expect(missing).toContain('所属地区')
  })

  it('surfaces a provided string field', () => {
    const { provided, missing } = partitionFundamentals(makeFundamentals({ industry: '电池' }))
    expect(provided.join('\n')).toContain('所属行业: 电池')
    expect(missing).not.toContain('所属行业')
  })
})

describe('buildFundamentalPrompt', () => {
  it('embeds all three methodologies and the no-fabrication rule in system', () => {
    const { system } = buildFundamentalPrompt({ fundamentals: makeFundamentals(), knowledge: KNOWLEDGE })
    expect(system).toContain('一页纸速览方法论内容')
    expect(system).toContain('三表分析方法论内容')
    expect(system).toContain('估值模型方法论内容')
    expect(system).toContain('数据待接入')
    expect(system).toContain('不构成投资建议')
  })

  it('lists missing fields and the code/name in the user prompt', () => {
    const { user } = buildFundamentalPrompt({ fundamentals: makeFundamentals(), knowledge: KNOWLEDGE })
    expect(user).toContain('300750')
    expect(user).toContain('宁德时代')
    expect(user).toContain('毛利率')
    expect(user).toMatch(/已获取 \d+ 项 \/ 待接入 \d+ 项/)
  })
})

describe('makeDeltaAccumulator', () => {
  it('accumulates delta.content across well-formed chunks', () => {
    const acc = makeDeltaAccumulator()
    acc.push('data: ' + JSON.stringify({ choices: [{ delta: { content: '宁德' } }] }) + '\n\n')
    acc.push('data: ' + JSON.stringify({ choices: [{ delta: { content: '时代' } }] }) + '\n\n')
    expect(acc.get()).toBe('宁德时代')
  })

  it('handles chunks split across line boundaries', () => {
    const acc = makeDeltaAccumulator()
    const line = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'AB' } }] }) + '\n\n'
    acc.push(line.slice(0, 10))
    acc.push(line.slice(10))
    expect(acc.get()).toBe('AB')
  })

  it('ignores [DONE] and non-content control frames', () => {
    const acc = makeDeltaAccumulator()
    acc.push('data: ' + JSON.stringify({ choices: [{ delta: { content: 'X' } }] }) + '\n\n')
    acc.push('data: [DONE]\n\n')
    acc.push('data: ' + JSON.stringify({ archived: true }) + '\n\n')
    expect(acc.get()).toBe('X')
  })
})
