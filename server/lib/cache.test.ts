import { describe, it, expect } from 'vitest'
import { createCache } from './cache'

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
