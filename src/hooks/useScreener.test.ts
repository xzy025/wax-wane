// 挂载自动重扫:服务端盘中冷启动会种子上一交易日磁盘快照(TTL 窗口内一直返回旧档),
// hook 发现 asof 早于最近交易日须等效替用户点一次「扫描」;失败不循环重试。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScreener, type ScreenerResult } from './useScreener'

vi.mock('../utils/marketHistory', () => ({
  getLastTradingDay: () => '2026-07-08',
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const snap = (asof: string) => ({ asof, universe: 5000, scanned: 600 }) as unknown as ScreenerResult

const getCalls = () => mockFetch.mock.calls.filter(([u]) => String(u) === '/api/screener')
const rescanCalls = () => mockFetch.mock.calls.filter(([u]) => String(u).startsWith('/api/refresh?market=screener'))

describe('useScreener 挂载自动重扫', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('快照早于最近交易日 → 自动 POST /api/refresh 并重拉,拿到今日数据后 stale 归 false', async () => {
    let gets = 0
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith('/api/refresh')) return Promise.resolve({ ok: true })
      gets++
      return Promise.resolve({ ok: true, json: async () => snap(gets === 1 ? '2026-07-07' : '2026-07-08') })
    })

    const { result } = renderHook(() => useScreener())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(rescanCalls()).toHaveLength(1)
    expect(getCalls()).toHaveLength(2)
    expect(result.current.data?.asof).toBe('2026-07-08')
    expect(result.current.stale).toBe(false)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('快照就是最近交易日 → 只有一次 GET,不触发重扫', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith('/api/refresh')) return Promise.resolve({ ok: true })
      return Promise.resolve({ ok: true, json: async () => snap('2026-07-08') })
    })

    const { result } = renderHook(() => useScreener())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(rescanCalls()).toHaveLength(0)
    expect(getCalls()).toHaveLength(1)
    expect(result.current.stale).toBe(false)
  })

  it('自动重扫失败 → error 置位、旧档仍在屏、stale 保持 true、不循环重试', async () => {
    let gets = 0
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith('/api/refresh')) return Promise.resolve({ ok: true })
      gets++
      if (gets === 1) return Promise.resolve({ ok: true, json: async () => snap('2026-07-07') })
      return Promise.resolve({ ok: false, status: 500 })
    })

    const { result } = renderHook(() => useScreener())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(getCalls()).toHaveLength(2) // 首拉 + 一次自动重扫,失败后不再试
    expect(result.current.error).not.toBeNull()
    expect(result.current.data?.asof).toBe('2026-07-07') // last-good 旧档保留
    expect(result.current.stale).toBe(true)
    expect(result.current.loading).toBe(false)

    // 再推进时间也不会偷偷重试
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(getCalls()).toHaveLength(2)
  })
})
