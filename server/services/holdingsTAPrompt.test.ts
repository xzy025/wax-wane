import { describe, it, expect } from 'vitest'
import { buildHoldingsTAFacts, HOLDINGS_TA_SYSTEM_PROMPT } from './holdingsTAPrompt'
import { buildHoldingTAFromBars, type HoldingTAItem, type HoldingsTAResult } from './holdingsTARules'
import type { Bar } from './screenerRules'

function mkBars(n: number): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < n; i++) {
    const c = 10 * Math.pow(1.005, i)
    bars.push({ date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, open: c, close: c, high: c * 1.01, low: c * 0.99, volume: 1000 })
  }
  return bars
}

const base = buildHoldingTAFromBars('600176', '中国巨石', mkBars(300))!

const mkResult = (items: HoldingTAItem[]): HoldingsTAResult => ({
  date: '2026-07-21',
  generatedAt: '2026-07-21T15:20:00.000Z',
  settled: true,
  prevDate: null,
  benchmarks: { hs300: 3.06, chinext: 7.05, star50: 10.73 },
  items,
  narrative: null,
})

describe('buildHoldingsTAFacts', () => {
  it('每票一行 + 组合行 + 基准;error 票整行跳过', () => {
    const err: HoldingTAItem = { ...base, code: '000001', name: '坏票', error: 'K线获取失败' }
    const facts = buildHoldingsTAFacts(mkResult([{ ...base, relStrength: 5.97, counterTrend: false }, err]))
    expect(facts).toContain('中国巨石(600176)')
    expect(facts).toContain('RS+5.97pp')
    expect(facts).not.toContain('坏票')
    expect(facts).toContain('【组合】共1只')
    expect(facts).toContain('沪深300 +3.06%')
    expect(facts).toContain('多头排列')
  })

  it('无 delta 不出现"昨"字样;有 avgCost 才出浮盈', () => {
    const noCost = buildHoldingsTAFacts(mkResult([base]))
    expect(noCost).not.toContain('昨')
    expect(noCost).not.toContain('浮盈')
    const withCost = buildHoldingsTAFacts(mkResult([base]), [{ code: '600176', avgCost: base.close / 1.5 }])
    expect(withCost).toContain('浮盈+50.00%')
  })

  it('delta:评分变化/新增派发/失守收复均线/阶段迁移全部进事实', () => {
    const it_: HoldingTAItem = {
      ...base,
      combo: { ...base.combo, distribution: true },
      delta: {
        prevDate: '2026-07-18',
        score01: -0.21,
        biasChanged: { from: 'demand', to: 'supply' },
        wyckoffChanged: { from: '标记上涨', to: '派发' },
        distributionNew: true,
        maCrossings: ['lost:ma5', 'regain:ma20'],
        trendTemplateChanged: false,
        relStrengthDelta: -2,
        dist52PctDelta: 1.2,
        volRatioDelta: 0.3,
      },
    }
    const facts = buildHoldingsTAFacts(mkResult([it_]))
    expect(facts).toContain('昨-21分')
    expect(facts).toContain('⚠新增派发警报')
    expect(facts).toContain('失守MA5')
    expect(facts).toContain('收复MA20')
    expect(facts).toContain('阶段标记上涨→派发')
  })

  it('全 error → 无持仓段无组合段,只剩日期与指令', () => {
    const err: HoldingTAItem = { ...base, error: '取数失败' }
    const facts = buildHoldingsTAFacts(mkResult([err]))
    expect(facts).not.toContain('【持仓技术面】')
    expect(facts).not.toContain('【组合】')
    expect(facts).toContain('日期:2026-07-21')
  })

  it('system prompt 含硬性规则(不编造/不荐股/字数/格式)', () => {
    expect(HOLDINGS_TA_SYSTEM_PROMPT).toContain('禁止编造')
    expect(HOLDINGS_TA_SYSTEM_PROMPT).toContain('不荐股')
    expect(HOLDINGS_TA_SYSTEM_PROMPT).toContain('400 字')
    expect(HOLDINGS_TA_SYSTEM_PROMPT).toContain('一句话定调')
    expect(HOLDINGS_TA_SYSTEM_PROMPT).toContain('明日观察')
  })
})
