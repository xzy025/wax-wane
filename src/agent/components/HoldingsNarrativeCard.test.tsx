import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HoldingsNarrativeCard } from './HoldingsNarrativeCard'
import { zh } from '../../i18n'
import type { HoldingsTAResult } from '../holdingsTA'
import type { Translation } from '../../types'

const t = zh as Translation

function mkResult(overrides: Partial<HoldingsTAResult> = {}): HoldingsTAResult {
  return {
    date: '2026-07-21',
    generatedAt: '2026-07-21T15:20:00.000Z',
    settled: true,
    prevDate: '2026-07-18',
    benchmarks: { hs300: 3.06, chinext: 7.05, star50: 10.73 },
    items: [],
    narrative: { tone: '组合技术面整体修复', markdown: '**一句话定调**:组合技术面整体修复\n\n### 持仓结构\n- 两只均站回5日线', generatedAt: 'x' },
    ...overrides,
  }
}

describe('HoldingsNarrativeCard', () => {
  it('ta 为空或无叙事 → 整卡隐藏', () => {
    const none = render(<HoldingsNarrativeCard ta={null} t={t} />)
    expect(none.container.firstChild).toBeNull()
    const noNarr = render(<HoldingsNarrativeCard ta={mkResult({ narrative: null })} t={t} />)
    expect(noNarr.container.firstChild).toBeNull()
  })

  it('折叠态显示定调+日期+盘后tag,点击展开完整 markdown', async () => {
    render(<HoldingsNarrativeCard ta={mkResult()} t={t} />)
    expect(screen.getByText('组合技术面整体修复')).toBeInTheDocument()
    expect(screen.getByText('2026-07-21')).toBeInTheDocument()
    expect(screen.getByText(t.holdings.ta.settled)).toBeInTheDocument()
    expect(screen.queryByText('两只均站回5日线')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByText('两只均站回5日线')).toBeInTheDocument()
  })

  it('盘中包显示 live tag', () => {
    render(<HoldingsNarrativeCard ta={mkResult({ settled: false })} t={t} />)
    expect(screen.getByText(t.holdings.ta.live)).toBeInTheDocument()
  })
})
