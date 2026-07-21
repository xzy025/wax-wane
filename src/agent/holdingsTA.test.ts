import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchHoldingsTA, fetchTaArchiveDates, fetchTaArchive } from './holdingsTA'

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchHoldingsTA', () => {
  const result = { date: '2026-07-21', generatedAt: 'x', settled: true, prevDate: null, benchmarks: { hs300: 0, chinext: 0, star50: 0 }, items: [], narrative: null }

  it('POST 上报持仓,正常 shape 透传', async () => {
    const mock = vi.fn().mockImplementation(() => okJson(result))
    vi.stubGlobal('fetch', mock)
    const r = await fetchHoldingsTA([{ code: '600176', avgCost: 30 }])
    expect(r?.date).toBe('2026-07-21')
    expect(mock).toHaveBeenCalledWith(
      '/api/holdings/ta',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ positions: [{ code: '600176', avgCost: 30 }] }) }),
    )
  })

  it('空持仓不发请求;非200/网络异常/坏shape → null', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    expect(await fetchHoldingsTA([])).toBeNull()
    expect(mock).not.toHaveBeenCalled()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await fetchHoldingsTA([{ code: '600176' }])).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchHoldingsTA([{ code: '600176' }])).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => okJson({ nope: 1 })))
    expect(await fetchHoldingsTA([{ code: '600176' }])).toBeNull()
  })
})

describe('archive fetches', () => {
  it('日期清单透传,失败 → []', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => okJson({ dates: ['2026-07-21', '2026-07-18'] })))
    expect(await fetchTaArchiveDates()).toEqual(['2026-07-21', '2026-07-18'])

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchTaArchiveDates()).toEqual([])
  })

  it('按日期取档,404 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await fetchTaArchive('2026-07-18')).toBeNull()
  })
})
