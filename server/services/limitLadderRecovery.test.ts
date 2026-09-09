import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KlineBar } from './ashare'
import type { LhbDay } from './lhbHistory'

const memory = vi.hoisted(() => ({ files: new Map<string, string>() }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const key = (path: unknown) => String(path).replaceAll('\\', '/').split('/docs/ladder/')[1]
  return {
    ...actual,
    existsSync: (path: never) => key(path) !== undefined
      ? [...memory.files.keys()].some((name) => name === key(path) || name.startsWith(`${key(path)}/`))
      : actual.existsSync(path),
    readdirSync: (path: never, options: never) => key(path) !== undefined
      ? [...new Set([...memory.files.keys()].filter((name) => name.startsWith(`${key(path)}/`)).map((name) => name.slice(key(path)!.length + 1).split('/')[0]))]
      : actual.readdirSync(path, options),
    readFileSync: (path: never, options: never) => {
      if (key(path) === undefined) return actual.readFileSync(path, options)
      const value = memory.files.get(key(path)!)
      if (value === undefined) throw new Error('ENOENT')
      return value
    },
    mkdirSync: (path: never, options: never) => key(path) === undefined ? actual.mkdirSync(path, options) : undefined,
    writeFileSync: (path: never, data: never, options: never) => key(path) === undefined
      ? actual.writeFileSync(path, data, options) : memory.files.set(key(path)!, String(data)),
    renameSync: (from: never, to: never) => {
      if (key(from) === undefined) return actual.renameSync(from, to)
      memory.files.set(key(to)!, memory.files.get(key(from)!)!)
      memory.files.delete(key(from)!)
    },
  }
})
vi.mock('./lhbHistory', () => ({ buildLhbIndex: vi.fn() }))
vi.mock('./ashare', async (importOriginal) => ({
  ...await importOriginal<typeof import('./ashare')>(), fetchAShareData: vi.fn(), fetchStockKline: vi.fn(),
}))
vi.mock('./hotlist', () => ({ fetchHotList: vi.fn() }))
vi.mock('./kaipanla', () => ({ fetchSentiment: vi.fn(), clearSentimentCache: vi.fn() }))
vi.mock('./kaipanlaLadder', async (importOriginal) => ({
  ...await importOriginal<typeof import('./kaipanlaLadder')>(), fetchKplRealtimeLadder: vi.fn(),
}))

import { fetchAShareData, fetchStockKline } from './ashare'
import { clearSentimentCache } from './kaipanla'
import { fetchHotList } from './hotlist'
import { buildLhbIndex } from './lhbHistory'
import { fetchKplRealtimeLadder } from './kaipanlaLadder'
import { setTradingCalendarForTests } from './tradingCalendar'
import {
  analyzeTechnical, canRecoverLadderArchive, classifyMarketCycle, fetchLimitLadderNextDay, fetchLimitLadderAnalysis,
  LIMIT_LADDER_RULE_VERSION, rankAndClassifyStocks, refreshLimitLadderAnalysis, importLimitLadder,
  type LimitLadderAnalysis, type NormalizedStock,
} from './limitLadder'

const asof = '2026-09-08'
const frozenAt = '2026-09-08T15:31:00+08:00'
const premarket = Date.parse('2026-09-09T08:30:00+08:00')
const prefix = '2026/09/08/'
const lhb: LhbDay = { net: 2e8, instNet: 1e8, instBuy: true, hotNet: 5e7, hotBuy: true }
const missingFlowWarning = '当日龙虎榜席位尚未发布，资金流维度不可用，不取中性分'

function fixture(version = LIMIT_LADDER_RULE_VERSION) {
  const normalized: NormalizedStock = {
    code: '600001', name: '测试股份', price: 11, changePct: 10, turnoverRate: 8, amount: 5e8,
    circulatingMarketCap: 5e9, firstTime: '094000', lastTime: '145000', openCount: 0,
    consecutiveDays: 1, industry: '机器人', nDayBoards: '1板', themes: ['机器人'], subtheme: '',
    importedRole: '', reason: '', reasonSource: 'none', sealAmount: null, importedOnePrice: null,
    patternHintAvailable: false, onePriceHint: false, tBoardHint: false, isMarginEligible: false, warnings: [],
  }
  const bars: KlineBar[] = Array.from({ length: 130 }, (_, index) => ({
    date: new Date(Date.parse(`${asof}T00:00:00Z`) - (129 - index) * 86400000).toISOString().slice(0, 10),
    open: 10, close: index === 129 ? 11 : 10, high: index === 129 ? 11 : 10.1, low: 9.9,
    volume: 1e7, turnover: 8, amplitude: 2, changePct: index === 129 ? 10 : 0,
    provider: 'test-frozen', providerAt: null, receivedAt: frozenAt, adjustment: 'qfq',
  }))
  const cycle = classifyMarketCycle({ temperature: 55, limitUp: 60, limitDown: 10, breakRate: 20,
    promotionRate: 35, yestLimitPerf: 2, advance: 3000, decline: 1800, maxBoards: 4, ladderContinuity: 100 })
  const stocks = rankAndClassifyStocks({
    asof, stocks: [normalized], themes: [], market: cycle, degraded: true,
    technical: new Map([[normalized.code, analyzeTechnical(bars, normalized.code, asof)]]),
  })
  const eventGate = { generatedAt: frozenAt, coverage: 100, sourceStatus: {}, events: [], hardBlockedCodes: [],
    riskCappedCodes: [], themeAdjustments: {}, marketRisk: 'normal' as const, warnings: [] }
  const roleMap = { maxBoards: 1, spaceLeaderCodes: [], profiles: [], brokenAnchors: [] }
  const analysis: LimitLadderAnalysis = {
    asof, generatedAt: frozenAt, ruleVersion: version, archived: true, revision: 1,
    archiveStage: 'core-settled', formalSignalEligible: false, strategyStatus: 'research',
    stocks, themes: [], firstBoards: stocks, levels: [], nextDayCandidates: [], eventGate, roleMap,
    themeAnchors: [], promotionLanes: [],
    market: { cycle, limitUp: 60, limitDown: 10, breakRate: 20, promotionRate: 35, advance: 3000, decline: 1800, maxBoards: 4 },
    quality: { source: 'eastmoney', sourceDate: asof, sentimentSource: 'derived', sentimentStatus: 'full',
      limitFieldsComplete: true, klineComplete: 1, klineTotal: 1, coreDataComplete: true, degraded: true,
      fundFlowComplete: false, providerAt: null, receivedAt: frozenAt, adjustment: 'qfq', settled: true,
      warnings: [missingFlowWarning] }, warnings: [missingFlowWarning],
  }
  const evidence = {
    asof, generatedAt: frozenAt, ruleVersion: version, qualityRank: 1100, revision: 1,
    providerAt: null, receivedAt: frozenAt, adjustment: 'qfq', settled: true,
    archiveStage: 'core-settled', formalSignalEligible: false,
    ashare: {}, sentiment: {}, kplLadder: null, imported: null,
    limitUpStocks: [normalized], klines: { '600001': bars }, rawKlines: {},
    marketProfiles: { '600001': { circulatingMarketCap: 5e9 } },
    hotList: { eastmoney: [], ths: [] }, promotionLanes: [], themeAnchors: [], roleMap, eventGate,
  } as unknown as Parameters<typeof canRecoverLadderArchive>[1]
  memory.files.set(`${prefix}analysis-${version}.json`, JSON.stringify(analysis))
  memory.files.set(`${prefix}evidence-${version}.json`, JSON.stringify(evidence))
  return { analysis, evidence }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(premarket)
  vi.clearAllMocks()
  memory.files.clear()
  setTradingCalendarForTests({ source: 'test', isTradingDay: (date) => ['2026-09-08', '2026-09-09', '2026-09-10'].includes(date) })
  vi.mocked(buildLhbIndex).mockResolvedValue(new Map([[asof, new Map([['600001', lhb]])]]))
})
afterEach(() => { vi.useRealTimers(); setTradingCalendarForTests(null) })

describe('frozen ladder LHB recovery', () => {
  it('adds actual date-specific LHB and a revision without fetching or changing current market inputs', async () => {
    const { analysis, evidence } = fixture()
    const original = memory.files.get(`${prefix}analysis-${LIMIT_LADDER_RULE_VERSION}.json`)
    const result = await refreshLimitLadderAnalysis(asof)
    expect(result.revision).toBe(2)
    expect(result.stocks[0].fundFlow).toMatchObject({ available: true, net: lhb.net, instNet: lhb.instNet })
    expect(result.stocks[0].popularity?.score).toBeGreaterThan(analysis.stocks[0].popularity!.score)
    expect(result.stocks[0].technical).toEqual(analysis.stocks[0].technical)
    expect(result.stocks[0].price).toBe(11)
    expect(result.market).toEqual(analysis.market)
    expect(result.quality.fundFlowComplete).toBe(true)
    expect(result.quality.providerAt).toBeNull()
    expect(result.formalSignalEligible).toBe(false)
    expect(result.strategyStatus).toBe('research')
    expect(result.warnings).not.toContain(missingFlowWarning)
    expect(buildLhbIndex).toHaveBeenCalledWith([asof], { institutional: true, concurrency: 1 })
    for (const fetcher of [fetchAShareData, fetchStockKline, fetchHotList, fetchKplRealtimeLadder]) expect(fetcher).not.toHaveBeenCalled()
    expect(memory.files.get(`${prefix}analysis-${LIMIT_LADDER_RULE_VERSION}.json`)).toBe(original)
    const saved = JSON.parse(memory.files.get(`${prefix}evidence-${LIMIT_LADDER_RULE_VERSION}-r2.json`)!)
    expect(saved.klines).toEqual(evidence.klines)
    expect(saved.generatedAt).toBe(frozenAt)
    expect(saved.enrichmentReceivedAt).toBe(new Date(premarket).toISOString())
    expect(saved.fundFlow['600001']).toEqual(lhb)
    await expect(fetchLimitLadderNextDay(asof)).rejects.toMatchObject({
      code: 'LADDER_FORMAL_INELIGIBLE', reasons: expect.arrayContaining(['缺少K线providerAt', '归档证据缺少providerAt']),
    })
    await expect(fetchLimitLadderNextDay(asof)).rejects.toThrow('冻结K线来源test-frozen未保留可验证的发布时间；补龙虎榜无法恢复此时间证据')
  })

  it('upgrades a timestamp-complete archive to enriched when only LHB was missing', async () => {
    const { analysis, evidence } = fixture()
    const providerAt = '2026-09-08T15:30:00+08:00'
    analysis.quality.providerAt = providerAt
    analysis.quality.degraded = false
    evidence.providerAt = providerAt
    evidence.qualityRank = 2100
    for (const bars of Object.values(evidence.klines)) {
      for (const bar of bars) bar.providerAt = providerAt
    }
    memory.files.set(`${prefix}analysis-${LIMIT_LADDER_RULE_VERSION}.json`, JSON.stringify(analysis))
    memory.files.set(`${prefix}evidence-${LIMIT_LADDER_RULE_VERSION}.json`, JSON.stringify(evidence))

    const result = await refreshLimitLadderAnalysis(asof)

    expect(result).toMatchObject({
      revision: 2, archiveStage: 'enriched', formalSignalEligible: true, strategyStatus: 'research',
      quality: { providerAt, degraded: false, fundFlowComplete: true, archiveStage: 'enriched', formalSignalEligible: true },
    })
    expect(result.stocks[0].fundFlow).toMatchObject({ available: true, net: lhb.net, instNet: lhb.instNet })
    const saved = JSON.parse(memory.files.get(`${prefix}evidence-${LIMIT_LADDER_RULE_VERSION}-r2.json`) ?? '{}')
    expect(saved).toMatchObject({ providerAt, qualityRank: 2100, revision: 2, archiveStage: 'enriched', formalSignalEligible: true })
    expect(saved.klines).toEqual(evidence.klines)
    expect(saved.fundFlow['600001']).toEqual(lhb)
    expect(buildLhbIndex).toHaveBeenCalledWith([asof], { institutional: true, concurrency: 1 })
  })

  it('does not create duplicate or weaker revisions on repeated refreshes', async () => {
    fixture()
    await refreshLimitLadderAnalysis(asof)
    expect((await refreshLimitLadderAnalysis(asof)).revision).toBe(2)
    vi.mocked(buildLhbIndex).mockResolvedValue(new Map([[asof, new Map([['600002', lhb]])]]))
    const result = await refreshLimitLadderAnalysis(asof)
    expect(result.revision).toBe(2)
    expect(result.stocks[0].fundFlow.available).toBe(true)
    expect([...memory.files.keys()].some((key) => key.includes('-r3'))).toBe(false)
  })

  it('archives additional published LHB rows even when the old quality rank is unchanged', async () => {
    fixture()
    await refreshLimitLadderAnalysis(asof)
    vi.mocked(buildLhbIndex).mockResolvedValue(new Map([[asof, new Map([['600001', lhb], ['600002', lhb]])]]))
    expect((await refreshLimitLadderAnalysis(asof)).revision).toBe(3)
    expect((await refreshLimitLadderAnalysis(asof)).revision).toBe(3)
  })

  it('preserves the archive when LHB is still unavailable or the request crosses the cutoff', async () => {
    fixture()
    vi.mocked(buildLhbIndex).mockResolvedValueOnce(new Map())
    expect((await refreshLimitLadderAnalysis(asof)).revision).toBe(1)
    vi.mocked(buildLhbIndex).mockImplementationOnce(async () => {
      vi.setSystemTime(Date.parse('2026-09-09T09:15:00+08:00'))
      return new Map([[asof, new Map([['600001', lhb]])]])
    })
    await expect(refreshLimitLadderAnalysis(asof)).rejects.toThrow('越过允许的时间窗口')
    expect(memory.files.size).toBe(2)
  })

  it('keeps the current intraday refresh on its realtime path', async () => {
    fixture()
    vi.setSystemTime(Date.parse('2026-09-09T10:30:00+08:00'))
    vi.mocked(fetchAShareData).mockRejectedValueOnce(new Error('test realtime source unavailable'))
    vi.mocked(fetchKplRealtimeLadder).mockRejectedValueOnce(new Error('test realtime source unavailable'))
    await expect(refreshLimitLadderAnalysis('2026-09-09')).rejects.toThrow('test realtime source unavailable')
    expect(fetchAShareData).toHaveBeenCalledOnce()
    expect(clearSentimentCache).toHaveBeenCalledOnce()
    expect(buildLhbIndex).not.toHaveBeenCalled()
    expect(memory.files.size).toBe(2)
  })

  it('shares an in-flight current-day scan across GET and refresh, and permits retry after failure', async () => {
    vi.setSystemTime(Date.parse('2026-09-09T10:30:00+08:00'))
    vi.mocked(fetchKplRealtimeLadder).mockRejectedValue(new Error('test ladder source unavailable'))
    let rejectScan!: (reason: Error) => void
    vi.mocked(fetchAShareData).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectScan = reject }))
    const requests = Promise.allSettled([
      refreshLimitLadderAnalysis('2026-09-09'),
      fetchLimitLadderAnalysis('2026-09-09'),
      refreshLimitLadderAnalysis('2026-09-09'),
    ])
    expect(fetchAShareData).toHaveBeenCalledTimes(1)
    rejectScan(new Error('temporary market outage'))
    const results = await requests
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    vi.mocked(fetchAShareData).mockRejectedValueOnce(new Error('retried market source'))
    await expect(fetchLimitLadderAnalysis('2026-09-09')).rejects.toThrow('retried market source')
    expect(fetchAShareData).toHaveBeenCalledTimes(2)
  })

  it.each(['import', 'settlement'] as const)('waits for the old scan then recomputes after %s changes its inputs', async (change) => {
    vi.setSystemTime(Date.parse('2026-09-09T14:59:00+08:00'))
    vi.mocked(fetchKplRealtimeLadder).mockRejectedValue(new Error('test source unavailable'))
    let rejectScan!: (reason: Error) => void
    vi.mocked(fetchAShareData)
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectScan = reject }))
      .mockRejectedValueOnce(new Error('new-context scan'))
    const original = fetchLimitLadderAnalysis('2026-09-09')
    if (change === 'settlement') vi.setSystemTime(Date.parse('2026-09-09T15:31:00+08:00'))
    const updated = change === 'import'
      ? importLimitLadder({ asof: '2026-09-09', stocks: [{ code: '600001', name: '测试', consecutiveDays: 1 }] })
      : refreshLimitLadderAnalysis('2026-09-09')
    const results = Promise.allSettled([original, updated])
    expect(fetchAShareData).toHaveBeenCalledTimes(1)
    rejectScan(new Error('old-context scan'))
    expect(await results).toMatchObject([
      { status: 'rejected', reason: { message: 'old-context scan' } },
      { status: 'rejected', reason: { message: 'new-context scan' } },
    ])
    expect(fetchAShareData).toHaveBeenCalledTimes(2)
  })

  it('protects legacy rule versions before reading new LHB', async () => {
    fixture('limit-ladder-v5')
    await expect(refreshLimitLadderAnalysis(asof)).rejects.toThrow('历史规则版本已冻结')
    expect(buildLhbIndex).not.toHaveBeenCalled()
    expect(memory.files.size).toBe(2)
  })

  it('rejects a stale/future bar or mismatched source date in frozen evidence', () => {
    const { analysis, evidence } = fixture()
    evidence.klines['600001'].at(-1)!.date = '2026-09-09'
    expect(canRecoverLadderArchive(analysis, evidence).reasons).toContain('冻结K线不是分析日完整收盘数据')
    evidence.klines['600001'].at(-1)!.date = asof
    analysis.quality.sourceDate = '2026-09-09'
    expect(canRecoverLadderArchive(analysis, evidence).eligible).toBe(false)
  })

  it('rejects in-session, older, and late-arriving evidence without faking the original clock', async () => {
    const { analysis, evidence } = fixture()
    expect(canRecoverLadderArchive(analysis, evidence, Date.parse('2026-09-08T14:59:00+08:00')).eligible).toBe(false)
    evidence.receivedAt = '2026-09-09T10:00:00+08:00'
    expect(canRecoverLadderArchive(analysis, evidence).eligible).toBe(false)
    vi.setSystemTime(Date.parse('2026-09-09T09:15:00+08:00'))
    await expect(refreshLimitLadderAnalysis(asof)).rejects.toThrow('09:15前补全')
    expect(buildLhbIndex).not.toHaveBeenCalled()
  })
})
