import { describe, expect, it } from 'vitest'
import {
  canArchiveLadderCore,
  canFinalizeLadderArchive,
  canUseLadderAsFormalSignal,
  assertLadderFormalSignal,
  type LimitLadderAnalysis,
} from './limitLadder'

const closeAfterSettlement = Date.parse('2026-08-31T16:00:00+08:00')

function fixture(): {
  analysis: LimitLadderAnalysis
  evidence: Parameters<typeof canArchiveLadderCore>[1]
} {
  const analysis = {
    asof: '2026-08-31',
    stocks: [{ code: '000001' }],
    quality: {
      source: 'eastmoney',
      sourceDate: '2026-08-31',
      sentimentSource: 'derived',
      sentimentStatus: 'full',
      limitFieldsComplete: true,
      klineComplete: 1,
      klineTotal: 1,
      coreDataComplete: true,
      // Optional providerAt and fund-flow enrichment are intentionally absent.
      degraded: true,
      fundFlowComplete: false,
      providerAt: null,
      receivedAt: '2026-08-31T15:20:00+08:00',
      adjustment: 'qfq',
      settled: true,
      warnings: [],
    },
  } as unknown as LimitLadderAnalysis
  const evidence = {
    asof: '2026-08-31',
    receivedAt: '2026-08-31T15:20:00+08:00',
    adjustment: 'qfq',
    settled: true,
    klines: { '000001': [] },
  } as unknown as Parameters<typeof canArchiveLadderCore>[1]
  return { analysis, evidence }
}

describe('limit ladder archive eligibility', () => {
  it('blocks an unarchived current preview without a formal flag and explains its actual data gaps', () => {
    const { analysis } = fixture()
    analysis.archived = false
    analysis.quality.sentimentStatus = 'unavailable'
    analysis.quality.limitFieldsComplete = false
    let error: unknown
    try { assertLadderFormalSignal(analysis) } catch (reason) { error = reason }
    expect(error).toMatchObject({
      code: 'LADDER_FORMAL_INELIGIBLE',
      reasons: expect.arrayContaining(['情绪数据状态为unavailable', '封板时间或板数不完整', '缺少K线providerAt', '缺少对应版本的冻结证据归档']),
    })
    expect((error as Error).message).toContain('正式候选未生成')
    expect((error as Error).message).not.toContain('仅为core-settled')
  })

  it('does not treat a timestamp-complete but unarchived preview as a formal signal', () => {
    const { analysis } = fixture()
    analysis.archived = false
    analysis.quality.degraded = false
    analysis.quality.fundFlowComplete = true
    analysis.quality.providerAt = '2026-08-31T15:20:00+08:00'
    expect(() => assertLadderFormalSignal(analysis)).toThrow('尚未完成合格归档')
    analysis.archived = true
    analysis.formalSignalEligible = true
    expect(() => assertLadderFormalSignal(analysis)).not.toThrow()
  })
  it('archives core settled facts when optional enrichment is unavailable', () => {
    const { analysis, evidence } = fixture()

    expect(canArchiveLadderCore(analysis, evidence, closeAfterSettlement)).toEqual({
      eligible: true,
      reasons: [],
    })
  })

  it('keeps formal next-day signals blocked until enrichment and PIT metadata arrive', () => {
    const { analysis, evidence } = fixture()

    const formal = canUseLadderAsFormalSignal(analysis, evidence, closeAfterSettlement)
    expect(formal.eligible).toBe(false)
    expect(formal.reasons).toEqual(
      expect.arrayContaining([
        '数据质量已降级',
        '资金流证据未发布或不完整',
        '缺少K线providerAt',
        '归档证据缺少providerAt',
      ]),
    )
    expect(canFinalizeLadderArchive(analysis, evidence, closeAfterSettlement)).toEqual(formal)
  })
})
