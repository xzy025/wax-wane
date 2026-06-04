import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAShareData, calcProfitabilityScore } from './useAShareData'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock marketHistory utils
vi.mock('../utils/marketHistory', () => ({
  todayStr: () => '2026-05-29',
  getDay: vi.fn(() => null),
  saveDay: vi.fn(),
}))

describe('calcProfitabilityScore', () => {
  it('returns 0 for zero inputs', () => {
    expect(calcProfitabilityScore(0, 0, 0, 0)).toBe(0)
  })

  it('returns high score for bullish market', () => {
    const score = calcProfitabilityScore(100, 10, 3000, 1000)
    expect(score).toBeGreaterThan(70)
  })

  it('returns low score for bearish market', () => {
    const score = calcProfitabilityScore(10, 100, 1000, 3000)
    expect(score).toBeLessThan(40)
  })

  it('caps limit ratio at 5', () => {
    const score1 = calcProfitabilityScore(100, 10, 2000, 2000)
    const score2 = calcProfitabilityScore(1000, 10, 2000, 2000)
    // Both should be similar since limit ratio is capped
    expect(Math.abs(score1 - score2)).toBeLessThan(5)
  })
})

describe('useAShareData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches data from backend on mount', async () => {
    const mockData = {
      indices: [{ code: '000001', name: '上证指数', price: 3350, changePct: -0.31 }],
      limitUpCount: 65,
      limitDownCount: 12,
      advance: 2800,
      decline: 2100,
      flat: 300,
      promotionRate: 35,
      promotedCount: 21,
      promotionTotal: 60,
      newHighCount: 3,
      newHighStocks: [],
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    })

    const { result } = renderHook(() => useAShareData())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toEqual(mockData)
    expect(result.current.error).toBeNull()
    expect(mockFetch).toHaveBeenCalledWith('/api/ashare', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('uses mock data when API returns empty indices', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ indices: [], limitUpCount: 0 }),
    })

    const { result } = renderHook(() => useAShareData())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Should fall back to mock data
    expect(result.current.data).not.toBeNull()
    expect(result.current.data!.indices.length).toBe(5)
  })

  it('uses mock data on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useAShareData())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Failed to fetch A-share data')
    // Should have mock data as fallback
    expect(result.current.data).not.toBeNull()
  })

  it('refresh function fetches data again', async () => {
    const mockData = {
      indices: [{ code: '000001', name: '上证指数', price: 3350, changePct: -0.31 }],
      limitUpCount: 65,
      limitDownCount: 12,
      advance: 2800,
      decline: 2100,
      flat: 300,
      promotionRate: 35,
      promotedCount: 21,
      promotionTotal: 60,
      newHighCount: 3,
      newHighStocks: [],
    }

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    })

    const { result } = renderHook(() => useAShareData())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Call refresh
    await result.current.refresh()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
})
