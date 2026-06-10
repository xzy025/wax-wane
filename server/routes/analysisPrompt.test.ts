import { describe, it, expect } from 'vitest'
import {
  buildFundamentalPrompt,
  partitionFundamentals,
  makeDeltaAccumulator,
  renderProfileBlock,
  renderHistoryBlock,
  renderHoldersBlock,
} from './analysisPrompt'
import type { StockFundamentals } from '../services/ashare'
import type { CompanyProfile, AnnualFinancials, TopHolders } from '../services/f10'
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
    debtRatio: 0,
    ...overrides,
  }
}

const PROFILE: CompanyProfile = {
  orgName: '宁德时代新能源科技股份有限公司',
  industryEM: '电力设备-电池-锂电池',
  industryCSRC: '制造业-电气机械和器材制造业',
  actualHolder: '曾毓群',
  chairman: '曾毓群',
  employees: 185839,
  province: '福建',
  regAddress: '中国福建省宁德市蕉城区漳湾镇新港路2号',
  listingDate: '2018-06-11',
  foundDate: '2011-12-16',
  mainBusiness: '从事动力电池、储能电池的研发、生产、销售',
}

const HISTORY: AnnualFinancials[] = [
  {
    year: 2025,
    revenue: 423701834000,
    revenueYoy: 17.04,
    netProfit: 72201282000,
    netProfitYoy: 42.28,
    deductedProfit: 64507864000,
    deductedProfitYoy: 43.37,
    roeWeighted: 24.91,
    grossMargin: 26.27,
    netMargin: 18.12,
    debtRatio: 61.94,
    eps: 16.14,
    bps: 73.87,
    ocfPerShare: 29.19,
    rdExpense: 22146581000,
  },
]

const HOLDERS: TopHolders = {
  endDate: '2026-03-31',
  holders: [
    { rank: 1, name: '厦门瑞庭投资有限公司', ratio: 22.45 },
    { rank: 2, name: '香港中央结算有限公司', ratio: 16.68 },
  ],
  totalRatio: 39.13,
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

  it('omits F10 sections when no data is passed', () => {
    const { user } = buildFundamentalPrompt({ fundamentals: makeFundamentals(), knowledge: KNOWLEDGE })
    expect(user).not.toContain('## 公司资料')
    expect(user).not.toContain('## 近年年报核心财务')
    expect(user).not.toContain('## 前十大股东')
  })

  it('embeds profile, history table and holders when provided', () => {
    const { user } = buildFundamentalPrompt({
      fundamentals: makeFundamentals(),
      knowledge: KNOWLEDGE,
      profile: PROFILE,
      history: HISTORY,
      holders: HOLDERS,
    })
    expect(user).toContain('## 公司资料（数据源：东方财富 F10）')
    expect(user).toContain('实际控制人: 曾毓群')
    expect(user).toContain('## 近年年报核心财务（数据源：东方财富 F10）')
    expect(user).toContain('| 2025 | 4237.0 |')
    expect(user).toContain('## 前十大股东（截至 2026-03-31）')
    expect(user).toContain('厦门瑞庭投资有限公司: 22.45%')
  })
})

describe('renderProfileBlock', () => {
  it('renders provided fields and omits empty ones', () => {
    const block = renderProfileBlock({ ...PROFILE, regAddress: '', mainBusiness: '' })
    expect(block).toContain('- 实际控制人: 曾毓群')
    expect(block).toContain('- 员工总数: 185839 人')
    expect(block).toContain('- 上市日期: 2018-06-11')
    expect(block).not.toContain('注册地')
    expect(block).not.toContain('主营业务')
  })

  it('returns empty string for null', () => {
    expect(renderProfileBlock(null)).toBe('')
    expect(renderProfileBlock(undefined)).toBe('')
  })
})

describe('renderHistoryBlock', () => {
  it('renders a markdown table with 亿-scaled money columns', () => {
    const block = renderHistoryBlock(HISTORY)
    expect(block).toContain('| 年份 |')
    expect(block).toContain('| 2025 | 4237.0 | 17.04 | 722.0 |')
    expect(block).toContain('| 16.14 | 221.5 |') // EPS + 研发(亿)
  })

  it('returns empty string for empty input', () => {
    expect(renderHistoryBlock([])).toBe('')
    expect(renderHistoryBlock(null)).toBe('')
  })
})

describe('renderHoldersBlock', () => {
  it('lists ranked holders and the total ratio', () => {
    const block = renderHoldersBlock(HOLDERS)
    expect(block).toContain('1. 厦门瑞庭投资有限公司: 22.45%')
    expect(block).toContain('2. 香港中央结算有限公司: 16.68%')
    expect(block).toContain('已披露股东合计持股: 39.13%')
  })

  it('returns empty string for null/empty', () => {
    expect(renderHoldersBlock(null)).toBe('')
    expect(renderHoldersBlock({ endDate: '2026-03-31', holders: [], totalRatio: 0 })).toBe('')
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
