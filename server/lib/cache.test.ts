import { describe, it, expect } from 'vitest'
import { createCache, isArchiveWindow } from './cache'

// Distinct object identities so toBe() proves exactly which source was served.
const FRESH = { src: 'fresh' }
const DISK = { src: 'disk' }

describe('createCache — durable fallback (disk snapshot)', () => {
  it('seeds a cold cache from fallback without calling the fetcher', async () => {
    let calls = 0
    const c = createCache({
      fetcher: () => {
        calls++
        return Promise.resolve(FRESH)
      },
      ttl: 60_000,
      fallback: () => DISK,
    })
    // First get on a cold cache serves the seed and skips upstream entirely.
    expect(await c.get()).toBe(DISK)
    expect(calls).toBe(0)
  })

  it('serves the fallback when the fetch throws and there is no in-memory value', async () => {
    let calls = 0
    const c = createCache({
      name: 'T',
      fetcher: () => {
        calls++
        return Promise.reject(new Error('upstream down'))
      },
      ttl: 60_000,
      fallback: () => DISK,
    })
    // Cold start → seed serves DISK, no fetch.
    expect(await c.get()).toBe(DISK)
    expect(calls).toBe(0)
    // Forced refresh empties memory; seed is NOT re-armed → fetcher runs and
    // throws → no in-memory value → error fallback serves DISK instead of 500.
    c.clear()
    expect(await c.get()).toBe(DISK)
    expect(calls).toBe(1)
  })

  it('clear() does not re-arm the seed: a forced refresh re-fetches on success', async () => {
    let calls = 0
    const c = createCache({
      fetcher: () => {
        calls++
        return Promise.resolve(FRESH)
      },
      ttl: 60_000,
      fallback: () => DISK,
    })
    expect(await c.get()).toBe(DISK) // seed
    expect(calls).toBe(0)
    c.clear()
    expect(await c.get()).toBe(FRESH) // no re-seed → real fetch (每日扫描)
    expect(calls).toBe(1)
  })

  it('clear() before the first get disarms the seed: a forced refresh fetches', async () => {
    let calls = 0
    const c = createCache({
      fetcher: () => {
        calls++
        return Promise.resolve(FRESH)
      },
      ttl: 60_000,
      fallback: () => DISK,
    })
    c.clear() // forced refresh lands before any passive get (e.g. right after restart)
    expect(await c.get()).toBe(FRESH) // must re-fetch, not serve the stale disk seed
    expect(calls).toBe(1)
  })

  it('serve-stale (in-memory) takes precedence over the disk fallback', async () => {
    let mode: 'ok' | 'down' = 'ok'
    const c = createCache({
      fetcher: () => (mode === 'ok' ? Promise.resolve(FRESH) : Promise.reject(new Error('down'))),
      ttl: 0, // always stale → every get attempts a refetch
      fallback: () => DISK,
    })
    expect(await c.get()).toBe(FRESH) // fetch succeeds, in-memory value = FRESH
    mode = 'down'
    expect(await c.get()).toBe(FRESH) // refetch throws → last good FRESH, not DISK
  })

  it('still rejects when the fetch throws on a cold cache with no fallback', async () => {
    const c = createCache({ fetcher: () => Promise.reject(new Error('boom')), ttl: 60_000 })
    await expect(c.get()).rejects.toThrow('boom')
  })
})

describe('isArchiveWindow — 当日档案落盘窗口(交易日 09:30 起)', () => {
  const at = (day: number, hh: number, mm: number) => ({ day, minutes: hh * 60 + mm })

  it('周末全天拒绝(周日扫描曾产出 2026-07-05 幻影快照)', () => {
    expect(isArchiveWindow(at(6, 22, 49))).toBe(false) // 周六晚
    expect(isArchiveWindow(at(0, 10, 0))).toBe(false) // 周日盘中时段
  })

  it('工作日盘前拒绝(数据仍是上一交易日的)', () => {
    expect(isArchiveWindow(at(5, 1, 53))).toBe(false) // 周五 01:53(review-2026-07-10 坏档时刻)
    expect(isArchiveWindow(at(1, 9, 29))).toBe(false) // 开盘前一分钟
  })

  it('开盘起放行,含盘中/午休/盘后到午夜前', () => {
    expect(isArchiveWindow(at(1, 9, 30))).toBe(true) // 开盘即当日数据
    expect(isArchiveWindow(at(3, 12, 0))).toBe(true) // 午休
    expect(isArchiveWindow(at(5, 17, 1))).toBe(true) // 盘后每日扫描
    expect(isArchiveWindow(at(5, 23, 59))).toBe(true)
  })
})
