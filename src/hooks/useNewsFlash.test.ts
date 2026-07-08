// 回归:superseded 请求的失败必须被 seq guard 丢弃,不许把 error 盖在更新的数据上。
// (曾复现:刷新的 GET 超时晚于 30s 轮询成功返回,error banner 盖住新数据。)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNewsFlash } from './useNewsFlash'

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const flashData = (tag: string) => ({
  asof: tag,
  items: [{ id: tag, time: '2026-07-07T10:00:00', title: tag, summary: '', source: 'eastmoney', important: false, stocks: [] }],
  sources: { eastmoney: true, sina: true },
})

describe('useNewsFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('首拉成功后 30s 轮询静默换数据', async () => {
    let getCount = 0
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith('/api/refresh')) return Promise.resolve({ ok: true })
      getCount++
      return Promise.resolve({ ok: true, json: async () => flashData(getCount === 1 ? 'A' : 'B') })
    })

    const { result } = renderHook(() => useNewsFlash())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.data?.asof).toBe('A')
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(result.current.data?.asof).toBe('B')
    expect(result.current.error).toBeNull()
  })

  it('首拉失败报错,下一轮轮询成功后自动清除', async () => {
    let getCount = 0
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith('/api/refresh')) return Promise.resolve({ ok: true })
      getCount++
      if (getCount === 1) return Promise.resolve({ ok: false, status: 502 })
      return Promise.resolve({ ok: true, json: async () => flashData('recovered') })
    })

    const { result } = renderHook(() => useNewsFlash())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.error).toBe('flash-load-failed')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(result.current.data?.asof).toBe('recovered')
    expect(result.current.error).toBeNull()
  })

  it('superseded 的刷新超时不覆盖轮询拉回的新数据(竞态回归)', async () => {
    let getCount = 0
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).startsWith('/api/refresh')) return Promise.resolve({ ok: true })
      getCount++
      if (getCount === 1) return Promise.resolve({ ok: true, json: async () => flashData('A-initial') })
      if (getCount === 2)
        // 刷新的 GET:一直挂起,直到 fetchWithTimeout 的 15s abort
        return new Promise((_, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      return Promise.resolve({ ok: true, json: async () => flashData('B-fresh-from-interval') })
    })

    // t=0 挂载,首拉成功
    const { result } = renderHook(() => useNewsFlash())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.data?.asof).toBe('A-initial')

    // t=20s:点刷新 → POST ok,GET(#2) 挂起,15s 后才 abort
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    let refreshResult: Promise<boolean>
    act(() => {
      refreshResult = result.current.refresh()
    })

    // t=30s:30s 轮询 → load(false) → GET #3 成功 → 新数据上屏,刷新的 load 已过期
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(result.current.data?.asof).toBe('B-fresh-from-interval')

    // t=35s:刷新的 GET abort → 过期失败被丢弃,不许污染屏上状态
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(result.current.data?.asof).toBe('B-fresh-from-interval')
    expect(result.current.error).toBeNull()
    await expect(refreshResult!).resolves.toBe(true)
    expect(result.current.loading).toBe(false)
  })
})
