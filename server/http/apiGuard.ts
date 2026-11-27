// Credential gate for routes that spend money, call paid APIs, or change state.
// Mounted once on the public Express app, so later strategy-overlay routers
// (for example POST /api/screener/scan) are covered without editing that repo.
//
// Loopback + unset WAX_WANE_API_TOKEN accepts the published dev token, and only
// from a direct loopback peer. Any other bind requires a real secret.

import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { DEV_LOCALHOST_TOKEN, isLoopbackAddress, isLoopbackBind } from './bind'

export const MIN_EXPOSED_TOKEN_LENGTH = 16

/** GET/HEAD prefixes that call a paid API or an overlaid strategy surface. */
export const SENSITIVE_READ_PREFIXES = [
  '/api/research/hithink',
  '/api/ops/quicktiny-mcp-probe',
  '/api/screener',
  '/api/rotation',
  '/api/huishou',
] as const

/** Local candidate-file read. Open on loopback only; not a scan or a paid call. */
export const LOOPBACK_PUBLIC_READ_PATHS = new Set(['/api/screener/mcp-universe'])

const SAFE_METHODS = new Set(['GET', 'HEAD'])
const FORWARD_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded']

export interface ApiAuthConfig {
  bindHost: string
  token: string
  /** Published localhost token is the one being enforced. */
  devDefault: boolean
  extraPrefixes: string[]
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export function parseProtectedPrefixes(raw: string | undefined): string[] {
  if (!raw) return []
  const prefixes: string[] = []
  for (const part of raw.split(',')) {
    const prefix = part.trim()
    if (!prefix.startsWith('/')) continue
    if (prefix.includes('?') || prefix.includes(' ')) continue
    prefixes.push(prefix.replace(/\/+$/, '') || '/')
  }
  return prefixes
}

export function resolveApiAuth(options: {
  bindHost: string
  configuredToken: string | undefined
  protectedPrefixes?: string
}): ApiAuthConfig {
  const configured = options.configuredToken?.trim() ?? ''
  if (configured && hasControlCharacter(configured)) {
    throw new Error('WAX_WANE_API_TOKEN 含有控制字符')
  }
  const devDefault = configured.length === 0 || configured === DEV_LOCALHOST_TOKEN
  const token = devDefault ? DEV_LOCALHOST_TOKEN : configured
  if (!isLoopbackBind(options.bindHost)) {
    if (devDefault || token.length < MIN_EXPOSED_TOKEN_LENGTH) {
      throw new Error(
        'WAX_WANE_BIND 不是回环地址时，必须设置长度不少于 16 的 WAX_WANE_API_TOKEN，且不能使用本机开发默认凭证',
      )
    }
  }
  return {
    bindHost: options.bindHost,
    token,
    devDefault,
    extraPrefixes: parseProtectedPrefixes(options.protectedPrefixes),
  }
}

export function tokenEquals(provided: string, expected: string): boolean {
  const left = createHash('sha256').update(provided).digest()
  const right = createHash('sha256').update(expected).digest()
  return timingSafeEqual(left, right)
}

function pathnameOf(path: string): string {
  const bare = path.split('?')[0] || '/'
  if (bare.length > 1 && bare.endsWith('/')) return bare.replace(/\/+$/, '')
  return bare
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Whether this request must present the API token.
 * Non-loopback binds require it for every /api route except the health check,
 * and for every state-changing method on any path the overlay might mount.
 */
export function requiresApiToken(method: string, path: string, auth: ApiAuthConfig): boolean {
  const verb = method.toUpperCase()
  if (verb === 'OPTIONS') return false
  const pathName = pathnameOf(path)
  if (SAFE_METHODS.has(verb) && pathName === '/api/health') return false
  if (!isLoopbackBind(auth.bindHost)) {
    if (pathName === '/api' || pathName.startsWith('/api/')) return true
    return !SAFE_METHODS.has(verb)
  }
  if (SAFE_METHODS.has(verb) && LOOPBACK_PUBLIC_READ_PATHS.has(pathName)) return false
  if (!SAFE_METHODS.has(verb)) return true
  if (SENSITIVE_READ_PREFIXES.some((prefix) => matchesPrefix(pathName, prefix))) return true
  return auth.extraPrefixes.some((prefix) => matchesPrefix(pathName, prefix))
}

export interface AccessProbe {
  method: string
  path: string
  remoteAddress?: string
  headers: Record<string, string | undefined>
}

export function decideApiAccess(
  probe: AccessProbe,
  auth: ApiAuthConfig,
): { ok: true } | { ok: false; error: string } {
  if (!requiresApiToken(probe.method, probe.path, auth)) return { ok: true }
  const presented = presentedTokens(probe.headers)
  const matched = presented.some((value) => tokenEquals(value, auth.token))
  if (!auth.devDefault) {
    return matched ? { ok: true } : { ok: false, error: '缺少或错误的 API 凭证' }
  }
  const forwarded = FORWARD_HEADERS.some((name) => {
    const value = probe.headers[name]
    return typeof value === 'string' && value.trim().length > 0
  })
  if (!isLoopbackAddress(probe.remoteAddress) || forwarded) {
    return {
      ok: false,
      error: '本机开发凭证不能用于转发或非回环连接，请设置 WAX_WANE_API_TOKEN',
    }
  }
  if (matched) return { ok: true }
  return {
    ok: false,
    error:
      '缺少或错误的 API 凭证。本机直接访问请使用请求头 X-Wax-Wane-Token: wax-wane-dev-localhost，或在 server/.env 设置 WAX_WANE_API_TOKEN。npm run dev 由 Vite 代理自动附加。',
  }
}

function presentedTokens(headers: Record<string, string | undefined>): string[] {
  const tokens: string[] = []
  const authorization = headers.authorization?.trim()
  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization)
    if (match) tokens.push(match[1])
  }
  const alternate = headers['x-wax-wane-token']?.trim()
  if (alternate) tokens.push(alternate)
  return tokens
}

function headerString(req: Request, name: string): string | undefined {
  const raw = req.headers[name]
  if (Array.isArray(raw)) return raw[0]
  return raw
}

export function createApiGuard(auth: ApiAuthConfig) {
  return function apiGuard(req: Request, res: Response, next: NextFunction): void {
    const headers: Record<string, string | undefined> = {
      authorization: headerString(req, 'authorization'),
      'x-wax-wane-token': headerString(req, 'x-wax-wane-token'),
      'x-forwarded-for': headerString(req, 'x-forwarded-for'),
      'x-real-ip': headerString(req, 'x-real-ip'),
      forwarded: headerString(req, 'forwarded'),
    }
    const decision = decideApiAccess(
      {
        method: req.method,
        path: req.originalUrl || req.url || req.path,
        remoteAddress: req.socket?.remoteAddress,
        headers,
      },
      auth,
    )
    if (decision.ok) {
      next()
      return
    }
    res.status(401).json({ error: decision.error })
  }
}
