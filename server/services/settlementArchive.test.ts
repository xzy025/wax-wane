import { describe, expect, it } from 'vitest'
import {
  isSettledArchiveWindowAt,
  runSettledArchivePipeline,
  type SettlementArchiveDeps,
} from './settlementArchive'

const date = '2026-08-31'

function depsFor(archives = new Set<string>()): SettlementArchiveDeps {
  const result = (name: string) => async () => {
    archives.add(name)
    return { asof: date } as never
  }
  return {
    hasScreenerArchive: () => archives.has('screener'),
    hasStructureArchive: () => archives.has('structure'),
    hasTempoArchive: () => archives.has('tempo'),
    hasReviewArchive: () => archives.has('review'),
    hasForwardArchive: () => archives.has('forward'),
    hasLadderArchive: () => archives.has('ladder'),
    scanScreener: result('screener'),
    fetchMarketStructure: result('structure'),
    fetchRotationTempo: result('tempo'),
    fetchDailyReview: result('review'),
    fetchScreenerForward: result('forward'),
    fetchLimitLadderAnalysis: result('ladder'),
    fetchLimitLadderNextDay: async () => undefined,
    listLimitLadderArchiveDates: () => [],
    loadPromotionInputs: () => [],
    buildPromotionReview: () => ({}) as never,
    writePromotionReview: () => undefined,
    syncDailyJournal: () => ({ written: false, action: 'skipped', reason: 'narrative-unavailable', path: '' }),
  }
}

describe('settled archive pipeline', () => {
  it('materializes the required archive chain and remains safe to rerun', async () => {
    const archives = new Set<string>()
    const first = await runSettledArchivePipeline(date, depsFor(archives))
    expect(first.action).toBe('completed')
    expect([...archives]).toEqual(['ladder', 'screener', 'structure', 'tempo', 'review', 'forward'])
    expect(first.steps.find((step) => step.name === 'promotion-review')?.status).toBe('skipped')

    const second = await runSettledArchivePipeline(date, depsFor(archives))
    expect(second.action).toBe('completed')
    expect(second.steps.filter((step) => step.status === 'skipped').length).toBeGreaterThanOrEqual(6)
  })

  it('does not generate forward results when the formal screener archive failed', async () => {
    const deps = depsFor()
    let forwardCalled = false
    deps.scanScreener = async () => ({ asof: '2026-08-30' }) as never
    deps.fetchScreenerForward = async () => {
      forwardCalled = true
      return { asof: date } as never
    }
    const result = await runSettledArchivePipeline(date, deps)
    expect(result.action).toBe('partial')
    expect(forwardCalled).toBe(false)
    expect(result.steps.find((step) => step.name === 'forward')).toMatchObject({
      status: 'skipped',
      reason: '选股正式归档缺失，禁止生成错标 forward',
    })
  })

  it('refreshes historical promotion statistics even when today has no valid ladder archive', async () => {
    const deps = depsFor()
    let promotionWritten = false
    deps.fetchLimitLadderAnalysis = async () => ({ asof: '2026-08-30' }) as never
    deps.loadPromotionInputs = () => [{}] as never
    deps.buildPromotionReview = () => ({}) as never
    deps.writePromotionReview = () => { promotionWritten = true }
    const result = await runSettledArchivePipeline(date, deps)
    expect(result.steps.find((step) => step.name === 'ladder')?.status).toBe('failed')
    expect(result.steps.find((step) => step.name === 'promotion-review')).toMatchObject({ status: 'completed' })
    expect(promotionWritten).toBe(true)
  })

  it('opens only after the settled checkpoint on a trading weekday', () => {
    expect(isSettledArchiveWindowAt(Date.parse('2026-08-31T15:09:59+08:00'))).toBe(false)
    expect(isSettledArchiveWindowAt(Date.parse('2026-08-31T15:10:00+08:00'))).toBe(true)
    expect(isSettledArchiveWindowAt(Date.parse('2026-08-29T15:10:00+08:00'))).toBe(false)
  })
})
