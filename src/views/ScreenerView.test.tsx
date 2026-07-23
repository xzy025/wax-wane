import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import ScreenerView from './ScreenerView'
import type { Translation } from '../types'
import en from '../i18n/en'
import type { ScreenerResult, ScreenerHookResult, ScreenerRegime, ScreenerCandidate, AccumScreenerCandidate } from '../hooks/useScreener'
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

const accumCand = (over: Partial<AccumScreenerCandidate> = {}): AccumScreenerCandidate => ({
  group: 'accum',
  code: '300566',
  name: '激智科技',
  price: 17.3,
  changePct: 1.2,
  maRef: 17.1,
  baseVol: 100000,
  avgVolRatio: 2.4,
  burstDays: 5,
  surgeRunDays: 6,
  maSlopePct: 0.8,
  consolDays: 12,
  boxLow: 16.2,
  boxHigh: 18.1,
  breakLevel: 18.1,
  entryTrigger: 18.1,
  stopRef: 16.2,
  targetRef: 21.9,
  posPct: 42,
  winNetChgPct: 3.1,
  vol01: 0.8,
  flat01: 0.7,
  consol01: 0.6,
  tier: 2,
  score: 66,
  reason: 'test',
  ...over,
}) as AccumScreenerCandidate

const renderAccumTab = (cand: AccumScreenerCandidate) => {
  mockUseScreener.mockReturnValue(hookResult({ data: baseResult({ accum: [cand] }) }))
  mockUseScreenerForward.mockReturnValue(fwdResult())
  const utils = render(<ScreenerView t={t} language="en" />)
  fireEvent.click(screen.getByText((text) => text.startsWith(t.screener.tabs.accum)))
  return utils
}

describe('吸筹卡股东户数确认因子(holderNum)', () => {
  it('户数下降 → 筹码集中 chip(ok 高亮),tooltip 含户数/报告期/披露日/户均持股', () => {
    const { container } = renderAccumTab(
      accumCand({
        holderNum: { endDate: '2026-03-31', noticeDate: '2026-04-29', holderNum: 23141, changePct: -7.32, avgHoldShares: 11326 },
      }),
    )
    const chip = container.querySelector('.sc-chip.sc-holder')
    expect(chip).not.toBeNull()
    expect(chip?.classList.contains('ok')).toBe(true)
    expect(chip?.textContent).toContain(t.screener.acCard.holderDown)
    expect(chip?.textContent).toContain('-7.3%')
    const tip = chip?.getAttribute('title') ?? ''
    expect(tip).toContain('23,141')
    expect(tip).toContain('2026-03-31')
    expect(tip).toContain('2026-04-29')
    expect(tip).toContain('11,326')
  })

  it('户数增加 → 中性 chip(无 ok)、带 + 号', () => {
    const { container } = renderAccumTab(
      accumCand({
        holderNum: { endDate: '2026-03-31', noticeDate: '2026-04-30', holderNum: 971956, changePct: 2.03, avgHoldShares: 38457 },
      }),
    )
    const chip = container.querySelector('.sc-chip.sc-holder')
    expect(chip).not.toBeNull()
    expect(chip?.classList.contains('ok')).toBe(false)
    expect(chip?.textContent).toContain(t.screener.acCard.holderUp)
    expect(chip?.textContent).toContain('+2.0%')
  })

  it('无 holderNum(取数失败/旧快照)→ 不渲染 chip', () => {
    const { container } = renderAccumTab(accumCand())
    expect(container.querySelector('.sc-chip.sc-holder')).toBeNull()
  })
})
