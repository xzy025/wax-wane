import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isLoopbackAddress,
  isLoopbackBind,
  readDotEnvValue,
  resolveBindHost,
} from './bind'

describe('resolveBindHost', () => {
  it('defaults to IPv4 loopback', () => {
    expect(resolveBindHost(undefined)).toBe('127.0.0.1')
    expect(resolveBindHost('')).toBe('127.0.0.1')
    expect(resolveBindHost('  localhost ')).toBe('127.0.0.1')
    expect(resolveBindHost('::1')).toBe('127.0.0.1')
  })

  it('treats lan/all as an explicit all-interfaces opt-in', () => {
    expect(resolveBindHost('lan')).toBe('0.0.0.0')
    expect(resolveBindHost('ALL')).toBe('0.0.0.0')
    expect(resolveBindHost('0.0.0.0')).toBe('0.0.0.0')
  })

  it('preserves an explicit host', () => {
    expect(resolveBindHost('192.168.1.20')).toBe('192.168.1.20')
    expect(isLoopbackBind('192.168.1.20')).toBe(false)
    expect(isLoopbackBind('127.0.0.1')).toBe(true)
  })
})

describe('isLoopbackAddress', () => {
  it('accepts IPv4, IPv6 and mapped loopback peers', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.20')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })
})

describe('local defaults stay off the public interfaces', () => {
  it('does not force Vite or the Windows launcher onto 0.0.0.0', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      scripts: { dev: string; preview: string }
    }
    const launcher = readFileSync(new URL('../../scripts/start-trade-review.ps1', import.meta.url), 'utf8')
    const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
    expect(pkg.scripts.dev).not.toContain('0.0.0.0')
    expect(pkg.scripts.preview).not.toContain('0.0.0.0')
    expect(launcher).not.toContain('0.0.0.0')
    expect(ci).toContain('refactor/split-public-private')
    expect(ci).toContain('main')
    expect(ci).toMatch(/pull_request:/)
  })
})

describe('readDotEnvValue', () => {
  it('reads the last assignment and ignores comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wax-env-'))
    const file = join(dir, '.env')
    writeFileSync(
      file,
      ['# WAX_WANE_BIND=lan', 'WAX_WANE_BIND=127.0.0.1', 'WAX_WANE_API_TOKEN="quoted secret"'].join(
        '\n',
      ),
    )
    expect(readDotEnvValue(file, 'WAX_WANE_BIND')).toBe('127.0.0.1')
    expect(readDotEnvValue(file, 'WAX_WANE_API_TOKEN')).toBe('quoted secret')
    expect(readDotEnvValue(file, 'MISSING')).toBeUndefined()
    expect(readDotEnvValue(join(dir, 'nope'), 'WAX_WANE_BIND')).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
