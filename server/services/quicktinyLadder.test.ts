import replayFixture from '../fixtures/quicktiny-limit-up-filter-replay-v1.json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callQuickTinyMcpTool } from './quicktinyMcp'
import {
  fetchQuickTinyRealtimeLadder,
  mapQuickTinyLadderPayload,
  replayQuickTinyLadder,
  type QuickTinyLadderReplayFixture,
} from './quicktinyLadder'

vi.mock('./quicktinyMcp', () => ({
  callQuickTinyMcpTool: vi.fn(),
}))

const callMock = vi.mocked(callQuickTinyMcpTool)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

describe('QuickTiny authorized ladder mapper', () => {
  it('maps the live filter fields without inventing unavailable metrics', () => {
    const ladder = replayQuickTinyLadder(replayFixture as QuickTinyLadderReplayFixture)
    expect(ladder).toMatchObject({
      date: '2026-09-02',
      source: 'quicktiny-replay',
      providerAt: '2026-09-02T17:13:01.687Z',
      complete: true,
      missingTiers: [],
      coverage: 1,
    })
    expect(ladder.stocks).toHaveLength(2)
    expect(ladder.stocks[0]).toMatchObject({
      code: '003005',
      name: '竞业达',
      price: 20,
      changePct: 10.011,
      firstTime: '092500',
      consecutiveDays: 4,
      nDayBoards: '4连板',
      primaryTheme: 'AI应用',
      themes: ['AI应用'],
      sealAmount: 180729376,
      amount: 87842620,
      turnoverRate: 3.273,
      actualTurnoverRate: 4.22,
      currencyValue: 2683893500,
      totalMarketCap: 4627773820,
      actualCurrencyValue: 2083774913,
      limitUpType: '一字板',
      onePriceHint: true,
      tBoardHint: false,
    })
    expect(ladder.warnings?.join(' ')).toContain('amplitudePct')
    expect(ladder.warnings?.join(' ')).toContain('isMarginEligible')
  })

  it('rejects a response whose actual trade date differs from the requested date', () => {
    const payload = JSON.parse(JSON.stringify((replayFixture as QuickTinyLadderReplayFixture).result)) as Record<string, unknown>
    const structured = payload.structuredContent as { meta: { standard: { actualTradeDate: string } } }
    structured.meta.standard.actualTradeDate = '2026-09-01'
    expect(() => mapQuickTinyLadderPayload(payload, { requestedDate: '2026-09-02' })).toThrow(/交易日 2026-09-01 与请求 2026-09-02 不一致/)
  })

  it('marks pagination truncation as incomplete instead of filling with an old snapshot', () => {
    const payload = JSON.parse(JSON.stringify((replayFixture as QuickTinyLadderReplayFixture).result)) as Record<string, unknown>
    const structured = payload.structuredContent as { data: { total: number } }
    structured.data.total = 3
    const ladder = mapQuickTinyLadderPayload(payload, { requestedDate: '2026-09-02' })
    expect(ladder.complete).toBe(false)
    expect(ladder.coverage).toBeCloseTo(2 / 3)
    expect(ladder.stocks).toHaveLength(2)
    expect(ladder.warnings?.join(' ')).toContain('2/3')
  })
})

describe('QuickTiny authorized ladder fetch', () => {
  it('uses live-schema argument names and merges the full filter page with ladder context', async () => {
    vi.stubEnv('QUICKTINY_LADDER_TOOL_NAME', 'limit_up_ladder')
    vi.stubEnv('QUICKTINY_LADDER_FILTER_TOOL_NAME', 'limit_up_filter')
    callMock.mockImplementation(async (toolName, args) => {
      if (toolName === 'limit_up_ladder') {
        return {
          structuredContent: {
            success: true,
            data: {
              date: '2026-09-02',
              totalStocks: 2,
              rows: [{ code: '003005', reasonInfo: 'authorized reason' }],
            },
            meta: { standard: { actualTradeDate: '2026-09-02', dataFreshness: { updatedAt: '2026-09-02T17:13:01.687Z' } } },
          },
          isError: false,
        }
      }
      expect(args).toMatchObject({
        date: '2026-09-02',
        page: 1,
        limit: 100,
        sortBy: 'continue_num',
        sortOrder: 'desc',
        detailLevel: 'standard',
        includeFirstBoard: false,
        includeReasonInfo: false,
        format: 'json',
      })
      return (replayFixture as QuickTinyLadderReplayFixture).result
    })

    const ladder = await fetchQuickTinyRealtimeLadder({ date: '2026-09-02' })
    expect(ladder.source).toBe('quicktiny')
    expect(ladder.complete).toBe(true)
    expect(ladder.stocks[0].reasonInfo).toBe('authorized reason')
    expect(callMock).toHaveBeenCalledWith('limit_up_ladder', expect.objectContaining({
      date: '2026-09-02',
      maxRowsPerLevel: 50,
    }))
    expect(callMock).toHaveBeenCalledWith('limit_up_filter', expect.objectContaining({
      date: '2026-09-02',
      limit: 100,
    }))
  })

  it('records receive time after the provider timestamp', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T17:13:00.000Z'))
    vi.stubEnv('QUICKTINY_LADDER_TOOL_NAME', 'limit_up_ladder')
    vi.stubEnv('QUICKTINY_LADDER_FILTER_TOOL_NAME', 'limit_up_filter')
    callMock.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-09-02T17:13:02.000Z'))
      return (replayFixture as QuickTinyLadderReplayFixture).result
    })

    const ladder = await fetchQuickTinyRealtimeLadder({ date: '2026-09-02' })

    expect(ladder.providerAt).toBe('2026-09-02T17:13:01.687Z')
    expect(Date.parse(ladder.capturedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(ladder.providerAt ?? ''))
  })
})
