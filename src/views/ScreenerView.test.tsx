import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import ScreenerView from './ScreenerView'
import type { Translation } from '../types'
import en from '../i18n/en'
import type { ScreenerResult, ScreenerHookResult, ScreenerRegime } from '../hooks/useScreener'
import type { ScreenerForwardHookResult } from '../hooks/useScreenerForward'

const t = en as Translation

const mockUseScreener = vi.fn<() => ScreenerHookResult>()
const mockUseScreenerForward = vi.fn<() => ScreenerForwardHookResult>()

vi.mock('../hooks/useScreener', () => ({
  useScreener: () => mockUseScreener(),
}))
vi.mock('../hooks/useScreenerForward', () => ({
  useScreenerForward: () => mockUseScreenerForward(),
}))

const regime: ScreenerRegime = {
  phase: 'attack',
  temperature: 50,
  limitUp: 30,
  limitDown: 5,
  breakRate: 10,
  note: '',
  marketTrend: 'strong',
  targetRMult: 2,
  marketChgPct: 0.5,
}

const baseResult = (over: Partial<ScreenerResult> = {}): ScreenerResult => ({
  asof: '2026-07-01',
  regime,
  breakout: [],
  trigger: [],
  pullback: [],
  scanned: 600,
  scannedPullback: 600,
  universe: 5534,
  truncated: false,
  ...over,
})

const hookResult = (over: Partial<ScreenerHookResult> = {}): ScreenerHookResult => ({
  data: baseResult(),
  loading: false,
  error: null,
  lastUpdated: new Date('2026-07-01T15:58:18'),
  refresh: vi.fn(),
  ...over,
})

const fwdResult = (over: Partial<ScreenerForwardHookResult> = {}): ScreenerForwardHookResult => ({
  data: null,
  loading: false,
  error: null,
  lastUpdated: null,
  refresh: vi.fn(),
  ...over,
})

describe('ScreenerView 工具栏时间标签', () => {
  it('fromCache=true 且有 savedAt → 显示后端真实生成时间(生成于),不显示客户端"更新于"', () => {
    mockUseScreener.mockReturnValue(
      hookResult({ data: baseResult({ fromCache: true, savedAt: '2026-06-30T17:26:00.000Z' }) }),
    )
    mockUseScreenerForward.mockReturnValue(fwdResult())

    const { container } = render(<ScreenerView t={t} language="en" />)
    const label = container.querySelector('.themes-updated')?.textContent ?? ''

    expect(label).toContain(t.screener.generatedAt)
    expect(label).not.toContain(t.screener.lastUpdated)
    expect(label).toContain(t.screener.cached)
  })

  it('fromCache=false → 保留原有客户端"更新于"时间', () => {
    mockUseScreener.mockReturnValue(hookResult({ data: baseResult({ fromCache: false }) }))
    mockUseScreenerForward.mockReturnValue(fwdResult())

    const { container } = render(<ScreenerView t={t} language="en" />)
    const label = container.querySelector('.themes-updated')?.textContent ?? ''

    expect(label).toContain(t.screener.lastUpdated)
    expect(label).not.toContain(t.screener.generatedAt)
  })

  it('fromCache=true 但缺 savedAt(旧快照)→ 优雅回退到"更新于"', () => {
    mockUseScreener.mockReturnValue(
      hookResult({ data: baseResult({ fromCache: true, savedAt: undefined }) }),
    )
    mockUseScreenerForward.mockReturnValue(fwdResult())

    const { container } = render(<ScreenerView t={t} language="en" />)
    const label = container.querySelector('.themes-updated')?.textContent ?? ''

    expect(label).toContain(t.screener.lastUpdated)
    expect(label).toContain(t.screener.cached)
  })
})
