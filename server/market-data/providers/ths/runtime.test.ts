import { describe, expect, it } from 'vitest'
import { HithinkRequestError, type HithinkFetch } from '../../hithinkFinanceClient'
import { readHithinkConnectionConfigFromEnv, readHithinkResearchConfigFromEnv, type HithinkConnectionConfig } from './config'
import { createThsRuntime } from './runtime'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response
}

function connection(overrides: Partial<HithinkConnectionConfig> = {}): HithinkConnectionConfig {
  return {
    baseUrl: 'https://fuyao.aicubes.cn',
    apiKey: 'test-key',
    timeoutMs: 1_000,
    requestGapMs: 0,
    maxRetries: 0,
    maxConcurrent: 2,
    maxQueue: 10,
    cacheTtlMs: 60_000,
    cacheMaxEntries: 10,
    ...overrides,
  }
}

describe('THS shared runtime', () => {
  it('separates reusable connection settings from research sample validation', () => {
    const env = { HITHINK_FINANCE_START_DATE: 'not-a-date', HITHINK_FINANCE_REQUEST_GAP_MS: '0' }
    expect(readHithinkConnectionConfigFromEnv(env).requestGapMs).toBe(0)
    expect(() => readHithinkResearchConfigFromEnv(env)).toThrow('HITHINK_FINANCE_START_DATE')
  })

  it('coalesces equivalent requests across consumers and keeps parameters isolated', async () => {
    const requests: string[] = []
    const fetchImpl: HithinkFetch = async (input) => {
      requests.push(input)
      return response({ code: 0, data: { item: [{ thscode: '600519.SH' }] } })
    }
    const runtime = createThsRuntime({ connection: connection(), fetchImpl })
    const [first, second, different] = await Promise.all([
      runtime.get('/api/test', { b: 2, a: 1 }),
      runtime.get('/api/test', { a: 1, b: 2 }),
      runtime.get('/api/test', { a: 2, b: 1 }),
    ])
    expect(first.data).toEqual(second.data)
    expect(different.data).toEqual(first.data)
    expect(requests).toHaveLength(2)
    expect(runtime.diagnostics()).toMatchObject({ cacheEntries: 2, pendingEntries: 0, cacheHits: 0, cacheMisses: 2 })
  })

  it('paces the initial attempt and retries through one runtime gate', async () => {
    const slept: number[] = []
    let calls = 0
    const runtime = createThsRuntime({
      connection: connection({ requestGapMs: 17, maxRetries: 1 }),
      sleepImpl: async (ms) => { slept.push(ms) },
      fetchImpl: async () => {
        calls += 1
        return calls === 1 ? response({ code: 4001, data: null }) : response({ code: 0, data: { item: [] } })
      },
    })
    await runtime.get('/api/test')
    expect(calls).toBe(2)
    expect(slept).toEqual([17, 250, 17])
  })

  it('releases failed requests instead of leaving a permanent pending lock', async () => {
    let calls = 0
    const runtime = createThsRuntime({
      connection: connection(),
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) throw new Error('network failed')
        return response({ code: 0, data: { item: [] } })
      },
    })
    await expect(runtime.get('/api/test')).rejects.toBeInstanceOf(HithinkRequestError)
    await expect(runtime.get('/api/test')).resolves.toMatchObject({ ok: true })
    expect(runtime.diagnostics().pendingEntries).toBe(0)
  })
})
