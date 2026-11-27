import { describe, expect, it } from 'vitest'
import { DEV_LOCALHOST_TOKEN } from './bind'
import { decideApiAccess, requiresApiToken, resolveApiAuth } from './apiGuard'

const loopback = resolveApiAuth({ bindHost: '127.0.0.1', configuredToken: undefined })
const custom = resolveApiAuth({
  bindHost: '127.0.0.1',
  configuredToken: 'local-custom-token',
})
const exposed = resolveApiAuth({
  bindHost: '0.0.0.0',
  configuredToken: 'lan-secret-value-1',
  protectedPrefixes: '/api/custom, not-a-path',
})

describe('resolveApiAuth', () => {
  it('uses the published dev token only on loopback when unset', () => {
    expect(loopback.devDefault).toBe(true)
    expect(loopback.token).toBe(DEV_LOCALHOST_TOKEN)
  })

  it('refuses to expose the process without a real secret', () => {
    expect(() => resolveApiAuth({ bindHost: '0.0.0.0', configuredToken: undefined })).toThrow(
      /WAX_WANE_API_TOKEN/,
    )
    expect(() =>
      resolveApiAuth({ bindHost: 'lan', configuredToken: DEV_LOCALHOST_TOKEN }),
    ).toThrow(/WAX_WANE_API_TOKEN/)
    expect(() => resolveApiAuth({ bindHost: '0.0.0.0', configuredToken: 'short-secret' })).toThrow(
      /16/,
    )
  })

  it('rejects control characters in a configured token', () => {
    expect(() =>
      resolveApiAuth({ bindHost: '127.0.0.1', configuredToken: 'bad\ntoken-value' }),
    ).toThrow(/控制字符/)
  })
})

describe('requiresApiToken', () => {
  it('protects mutations and paid or overlaid reads on loopback', () => {
    expect(requiresApiToken('POST', '/api/refresh', loopback)).toBe(true)
    expect(requiresApiToken('POST', '/api/screener/scan', loopback)).toBe(true)
    expect(requiresApiToken('PUT', '/api/memory/local', loopback)).toBe(true)
    expect(requiresApiToken('GET', '/api/research/hithink/stock', loopback)).toBe(true)
    expect(requiresApiToken('GET', '/api/ops/quicktiny-mcp-probe', loopback)).toBe(true)
    expect(requiresApiToken('GET', '/api/screener/market-structure', loopback)).toBe(true)
    expect(requiresApiToken('GET', '/api/rotation/tempo', loopback)).toBe(true)
    expect(requiresApiToken('GET', '/api/huishou/research', loopback)).toBe(true)
  })

  it('leaves ordinary local reads and the health check open', () => {
    expect(requiresApiToken('GET', '/api/ashare', loopback)).toBe(false)
    expect(requiresApiToken('GET', '/api/memory/local', loopback)).toBe(false)
    expect(requiresApiToken('GET', '/api/screener/mcp-universe?date=2026-09-18', loopback)).toBe(
      false,
    )
    expect(requiresApiToken('GET', '/api/health', loopback)).toBe(false)
    expect(requiresApiToken('OPTIONS', '/api/agent/chat', loopback)).toBe(false)
  })

  it('requires a credential for API reads once the bind is not loopback', () => {
    expect(requiresApiToken('GET', '/api/ashare', exposed)).toBe(true)
    expect(requiresApiToken('GET', '/api/screener/mcp-universe', exposed)).toBe(true)
    expect(requiresApiToken('GET', '/api/health', exposed)).toBe(false)
    expect(requiresApiToken('GET', '/api/custom/scan', exposed)).toBe(true)
    expect(requiresApiToken('POST', '/overlay/scan', exposed)).toBe(true)
    expect(requiresApiToken('GET', '/overlay/scan', exposed)).toBe(false)
  })

  it('honors extra prefixes on loopback', () => {
    const auth = resolveApiAuth({
      bindHost: '127.0.0.1',
      configuredToken: undefined,
      protectedPrefixes: '/api/custom',
    })
    expect(requiresApiToken('GET', '/api/custom/scan', auth)).toBe(true)
    expect(requiresApiToken('GET', '/api/custom-other', auth)).toBe(false)
  })
})

describe('decideApiAccess', () => {
  it('accepts the dev token from a direct loopback peer', () => {
    const decision = decideApiAccess(
      {
        method: 'POST',
        path: '/api/agent/chat',
        remoteAddress: '::ffff:127.0.0.1',
        headers: { 'x-wax-wane-token': DEV_LOCALHOST_TOKEN },
      },
      loopback,
    )
    expect(decision.ok).toBe(true)
  })

  it('accepts a bearer token', () => {
    const decision = decideApiAccess(
      {
        method: 'POST',
        path: '/api/refresh',
        remoteAddress: '127.0.0.1',
        headers: { authorization: `Bearer ${custom.token}` },
      },
      custom,
    )
    expect(decision.ok).toBe(true)
  })

  it('rejects a missing dev token with the localhost hint', () => {
    const decision = decideApiAccess(
      {
        method: 'POST',
        path: '/api/ladder/import',
        remoteAddress: '127.0.0.1',
        headers: {},
      },
      loopback,
    )
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.error).toContain(DEV_LOCALHOST_TOKEN)
  })

  it('rejects the dev token when the peer is forwarded or not loopback', () => {
    const forwarded = decideApiAccess(
      {
        method: 'POST',
        path: '/api/refresh',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-wax-wane-token': DEV_LOCALHOST_TOKEN,
          'x-forwarded-for': '8.8.8.8',
        },
      },
      loopback,
    )
    const remote = decideApiAccess(
      {
        method: 'POST',
        path: '/api/refresh',
        remoteAddress: '10.0.0.8',
        headers: { 'x-wax-wane-token': DEV_LOCALHOST_TOKEN },
      },
      loopback,
    )
    expect(forwarded.ok).toBe(false)
    expect(remote.ok).toBe(false)
  })

  it('accepts a configured token from a forwarded peer', () => {
    const decision = decideApiAccess(
      {
        method: 'GET',
        path: '/api/ashare',
        remoteAddress: '192.168.1.30',
        headers: {
          authorization: `Bearer ${exposed.token}`,
          'x-forwarded-for': '192.168.1.30',
        },
      },
      exposed,
    )
    expect(decision.ok).toBe(true)
  })

  it('does not reveal the expected token when a custom secret is configured', () => {
    const decision = decideApiAccess(
      {
        method: 'POST',
        path: '/api/refresh',
        remoteAddress: '127.0.0.1',
        headers: { 'x-wax-wane-token': 'wrong-token-value' },
      },
      custom,
    )
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.error).toBe('缺少或错误的 API 凭证')
      expect(decision.error).not.toContain(custom.token)
    }
  })
})
