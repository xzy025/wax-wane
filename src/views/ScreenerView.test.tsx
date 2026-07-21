import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import ScreenerView from './ScreenerView'
import type { Translation } from '../types'
import en from '../i18n/en'
import type { ScreenerResult, ScreenerHookResult, ScreenerRegime, ScreenerCandidate } from '../hooks/useScreener'
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
  stale: false,
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

const breakoutCand = (over: Partial<ScreenerCandidate> = {}): ScreenerCandidate => ({
  group: 'breakout',
  code: '600000',
  name: '测试股',
  price: 10,
  changePct: 2.5,
  pivot: 9.8,
  stopLoss: 9.2,
  target: 12,
  rsRaw: 0.3,
  coil: 0.05,
  volRatio: 2.1,
  atrRatio: 0.9,
  volScore: 0.8,
  distToPivotPct: 1.2,
  dist52Pct: 2.0,
  score: 77,
  signals: { trendOk: true, volDry: false, atrContract: true, breakoutVol: true, pattern: 'VCP' },
  ...over,
}) as ScreenerCandidate // spread Partial<T> 在 exactOptionalPropertyTypes 下需断言收窄

describe('解禁角标(liftBan)', () => {
  it('候选带 liftBan → 卡片右上角显示解禁药丸,tooltip 含日期/占流通比/类型', () => {
    mockUseScreener.mockReturnValue(
      hookResult({
        data: baseResult({
          breakout: [breakoutCand({ liftBan: { date: '2026-07-20', ratioPct: 12.3, type: '首发原股东限售股份' } })],
        }),
      }),
    )
    mockUseScreenerForward.mockReturnValue(fwdResult())

    const { container } = render(<ScreenerView t={t} language="en" />)
    const badge = container.querySelector('.sc-streak.liftban')

    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe(t.screener.card.liftBan)
    const tip = badge?.getAttribute('title') ?? ''
    expect(tip).toContain('2026-07-20')
    expect(tip).toContain('12.3')
    expect(tip).toContain('首发原股东限售股份')
  })

  it('占比 <0.1% 显示 "<0.1" 而非四舍五入成 0.0', () => {
    mockUseScreener.mockReturnValue(
      hookResult({
        data: baseResult({
          breakout: [breakoutCand({ liftBan: { date: '2026-08-01', ratioPct: 0.05, type: '股权激励限售股份' } })],
        }),
      }),
    )
    mockUseScreenerForward.mockReturnValue(fwdResult())

    const { container } = render(<ScreenerView t={t} language="en" />)
    const tip = container.querySelector('.sc-streak.liftban')?.getAttribute('title') ?? ''
    expect(tip).toContain('<0.1')
  })

  it('无 liftBan(窗口内无解禁/旧快照)→ 不渲染角标', () => {
    mockUseScreener.mockReturnValue(hookResult({ data: baseResult({ breakout: [breakoutCand()] }) }))
    mockUseScreenerForward.mockReturnValue(fwdResult())

    const { container } = render(<ScreenerView t={t} language="en" />)
    expect(container.querySelector('.sc-streak.liftban')).toBeNull()
  })
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
