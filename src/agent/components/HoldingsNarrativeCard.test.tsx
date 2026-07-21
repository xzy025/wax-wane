import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HoldingsNarrativeCard } from './HoldingsNarrativeCard'
import { zh } from '../../i18n'
import * as holdingsTA from '../holdingsTA'
import type { HoldingsTAResult } from '../holdingsTA'
import type { Translation } from '../../types'

vi.mock('../holdingsTA', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../holdingsTA')>()),
  fetchTaArchiveDates: vi.fn().mockResolvedValue([]),
  fetchTaArchive: vi.fn().mockResolvedValue(null),
}))

const t = zh as Translation
const mockDates = vi.mocked(holdingsTA.fetchTaArchiveDates)
const mockArchive = vi.mocked(holdingsTA.fetchTaArchive)

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

beforeEach(() => {
  mockDates.mockResolvedValue([])
  mockArchive.mockResolvedValue(null)
})

describe('HoldingsNarrativeCard', () => {
  it('ta 为空或无叙事且无历史存档 → 整卡隐藏', async () => {
    const none = render(<HoldingsNarrativeCard ta={null} t={t} />)
    await vi.waitFor(() => expect(mockDates).toHaveBeenCalled())
    expect(none.container.firstChild).toBeNull()
    const noNarr = render(<HoldingsNarrativeCard ta={mkResult({ narrative: null })} t={t} />)
    expect(noNarr.container.firstChild).toBeNull()
  })

  it('折叠态显示定调+日期+盘后tag,点击展开完整 markdown', async () => {
    render(<HoldingsNarrativeCard ta={mkResult()} t={t} />)
    expect(await screen.findByText('组合技术面整体修复')).toBeInTheDocument()
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

  it('历史回看:选日期 → 取档 → 紧凑表+该日叙事', async () => {
    mockDates.mockResolvedValue(['2026-07-21', '2026-07-18'])
    mockArchive.mockResolvedValue(
      mkResult({
        date: '2026-07-18',
        narrative: { tone: '历史定调', markdown: '**一句话定调**:历史定调', generatedAt: 'x' },
        items: [
          {
            code: '600176',
            name: '中国巨石',
            date: '2026-07-18',
            close: 40,
            changePct: -1.2,
            combo: { score01: 0.55, bias: 'neutral', distribution: false, wyckoffPhase: '吸筹', tags: [], note: '' },
            trendTemplateOk: true,
            ma: { ma5: 1, ma10: 1, ma20: 1, ma60: 1, ma250: 1 },
            aboveMa: { ma5: true, ma10: true, ma20: true, ma60: true, ma250: true },
            volRatio: 1,
            breakoutVolRatio: 1,
            hi52: 77,
            dist52Pct: 48,
            rsRaw: 1,
            relStrength: 0.8,
            atr14: 2,
            atrStop: 36,
            pivotHigh250: 77,
            pivots: { r1: 41, r2: 42, s1: 39, s2: 38 },
            delta: null,
          },
        ],
      }),
    )
    render(<HoldingsNarrativeCard ta={mkResult()} t={t} />)
    const select = await screen.findByRole('combobox')
    await userEvent.selectOptions(select, '2026-07-18')
    expect(await screen.findByText('中国巨石')).toBeInTheDocument()
    expect(mockArchive).toHaveBeenCalledWith('2026-07-18')
    expect(screen.getByText(/历史定调/)).toBeInTheDocument()
    expect(screen.getByText('+0.8pp')).toBeInTheDocument()
    // 回到最新
    await userEvent.selectOptions(select, '')
    expect(screen.queryByText('中国巨石')).not.toBeInTheDocument()
  })

  it('无当日叙事但有历史存档 → 卡仍显示(入口保留)', async () => {
    mockDates.mockResolvedValue(['2026-07-18'])
    render(<HoldingsNarrativeCard ta={mkResult({ narrative: null })} t={t} />)
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
    expect(screen.getByText(t.holdings.ta.narrativeTitle)).toBeInTheDocument()
  })
})
