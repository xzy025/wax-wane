import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HoldingTaSection } from './HoldingTaSection'
import { zh } from '../../i18n'
import type { HoldingTAItem } from '../holdingsTA'
import type { Translation } from '../../types'

const t = zh as Translation

function mkItem(overrides: Partial<HoldingTAItem> = {}): HoldingTAItem {
  return {
    code: '600176',
    name: '中国巨石',
    date: '2026-07-21',
    close: 43,
    changePct: 9.03,
    combo: { score01: 0.62, bias: 'demand', distribution: false, wyckoffPhase: '标记上涨', tags: [], note: '标记上涨·需求占优' },
    trendTemplateOk: true,
    ma: { ma5: 45.39, ma10: 50.21, ma20: 59.42, ma60: 46.32, ma250: 24.93 },
    aboveMa: { ma5: false, ma10: false, ma20: false, ma60: false, ma250: true },
    volRatio: 1.09,
    breakoutVolRatio: 1.42,
    hi52: 77.2,
    dist52Pct: 44.3,
    rsRaw: 1.25,
    relStrength: 5.97,
    counterTrend: false,
    atr14: 6.36,
    atrStop: 30.27,
    pivotHigh250: 77.2,
    pivots: { r1: 45.52, r2: 48.03, s1: 38.22, s2: 33.43 },
    delta: null,
    ...overrides,
  }
}

describe('HoldingTaSection', () => {
  it('渲染阶段/多空/技术分/RS/ATR止损档位', () => {
    render(<HoldingTaSection ta={mkItem()} t={t} />)
    expect(screen.getByText('标记上涨')).toBeInTheDocument()
    expect(screen.getByText('需求占优')).toBeInTheDocument()
    expect(screen.getByText('62')).toBeInTheDocument() // score01 0.62 → 62
    expect(screen.getByText('+5.97pp')).toBeInTheDocument()
    expect(screen.getByText('30.27')).toBeInTheDocument()
  })

  it('delta:失守均线/阶段迁移进汇总行,新增派发出警报条', () => {
    const item = mkItem({
      combo: { score01: 0.41, bias: 'supply', distribution: true, wyckoffPhase: '派发', tags: [], note: '' },
      delta: {
        prevDate: '2026-07-18',
        score01: -0.21,
        biasChanged: { from: 'demand', to: 'supply' },
        wyckoffChanged: { from: '标记上涨', to: '派发' },
        distributionNew: true,
        maCrossings: ['lost:ma5'],
        trendTemplateChanged: false,
        relStrengthDelta: -2,
        dist52PctDelta: 1,
        volRatioDelta: 0.3,
      },
    })
    render(<HoldingTaSection ta={item} t={t} />)
    expect(screen.getByText(t.holdings.ta.distributionNew)).toBeInTheDocument()
    expect(screen.getByText(/失守MA5/)).toBeInTheDocument()
    expect(screen.getByText(/标记上涨→派发/)).toBeInTheDocument()
    expect(screen.getByText(/RS-2pp/)).toBeInTheDocument()
  })

  it('次新:多头排列 — 且 MA250 缺值不渲染为站上', () => {
    const item = mkItem({ trendTemplateOk: null, ma: { ...mkItem().ma, ma250: 0 } })
    const { container } = render(<HoldingTaSection ta={item} t={t} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(container.querySelector('.hr-ta-ma--na')).not.toBeNull()
  })

  it('缺省/error 整块不渲染', () => {
    const none = render(<HoldingTaSection t={t} />)
    expect(none.container.firstChild).toBeNull()
    const err = render(<HoldingTaSection ta={mkItem({ error: '取数失败' })} t={t} />)
    expect(err.container.firstChild).toBeNull()
  })
})
