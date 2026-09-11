import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithProxy } from '../lib/llm'
import { fetchAShareData } from './ashare'
import { clearSentimentCache, fetchSentiment } from './kaipanla'

vi.mock('../lib/llm', () => ({ fetchWithProxy: vi.fn() }))
vi.mock('./ashare', () => ({ fetchAShareData: vi.fn() }))

const fullPayload = {
  date: '2026-09-09',
  nums: { ZT: 52, DT: 3, ZBL: 20, SZJS: 3200, XDJS: 2100, yestRase: 2.5 },
}

type ProviderResponse = Awaited<ReturnType<typeof fetchWithProxy>>

function response(payload: unknown): ProviderResponse {
  return { ok: true, json: async () => payload } as ProviderResponse
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T08:00:00Z')) // 16:00 Shanghai, after close
  clearSentimentCache()
  vi.mocked(fetchWithProxy).mockResolvedValue(response(fullPayload))
})

afterEach(() => {
  clearSentimentCache()
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('market sentiment cache recovery', () => {
  it.each([
    { status: 'degraded', nums: { ...fullPayload.nums, yestRase: undefined } },
    { status: 'unavailable', nums: { ZT: 52, DT: 3 } },
  ])('retries a $status result after 60 seconds without probing inside that window', async ({ status, nums }) => {
    vi.mocked(fetchWithProxy).mockResolvedValueOnce(response({ date: fullPayload.date, nums }))
    const partial = await fetchSentiment()
    expect(partial.status).toBe(status)
    expect(partial.yestLimitPerf).toBeNull()

    await vi.advanceTimersByTimeAsync(59_999)
    const cached = await Promise.all([fetchSentiment(), fetchSentiment(), fetchSentiment()])
    cached.forEach((value) => expect(value).toBe(partial))
    expect(fetchWithProxy).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    const recovered = await fetchSentiment()
    expect(recovered).toMatchObject({ source: 'kaipanla', status: 'full', date: '2026-09-09' })
    expect(fetchWithProxy).toHaveBeenCalledTimes(2)
  })

  it('replaces a derived fallback with full provider data after one minute', async () => {
    vi.mocked(fetchWithProxy).mockRejectedValueOnce(new Error('HTTP 503'))
    vi.mocked(fetchAShareData).mockResolvedValue({
      limitUpCount: 52,
      limitDownCount: 3,
      advance: 3200,
      decline: 2100,
    } as Awaited<ReturnType<typeof fetchAShareData>>)

    expect(await fetchSentiment()).toMatchObject({
      source: 'derived', status: 'degraded', breakRate: null, yestLimitPerf: null,
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await fetchSentiment()).toMatchObject({ source: 'kaipanla', status: 'full' })
    expect(fetchWithProxy).toHaveBeenCalledTimes(2)
    expect(fetchAShareData).toHaveBeenCalledTimes(1)
  })

  it('shares the in-flight refresh when degraded data expires', async () => {
    vi.mocked(fetchWithProxy).mockResolvedValueOnce(response({ date: fullPayload.date, nums: { ZT: 52 } }))
    await fetchSentiment()
    await vi.advanceTimersByTimeAsync(60_000)

    let resolveRefresh!: (value: ProviderResponse) => void
    vi.mocked(fetchWithProxy).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    const pending = [fetchSentiment(), fetchSentiment(), fetchSentiment()]
    expect(fetchWithProxy).toHaveBeenCalledTimes(2)
    resolveRefresh(response(fullPayload))
    const results = await Promise.all(pending)
    results.forEach((value) => {
      expect(value.status).toBe('full')
      expect(value).toBe(results[0])
    })
    expect(fetchWithProxy).toHaveBeenCalledTimes(2)
  })

  it('retains full after-close data for 30 minutes', async () => {
    const full = await fetchSentiment()
    expect(full.status).toBe('full')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await fetchSentiment()).toBe(full)
    await vi.advanceTimersByTimeAsync(29 * 60_000 - 1)
    expect(await fetchSentiment()).toBe(full)
    expect(fetchWithProxy).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(await fetchSentiment()).toMatchObject({ status: 'full' })
    expect(fetchWithProxy).toHaveBeenCalledTimes(2)
  })
})
