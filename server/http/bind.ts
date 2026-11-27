// Loopback-by-default bind settings shared by the API server and Vite.
// Vite reads server/.env itself so `npm run dev` picks up the same values
// the API loads via dotenv, without copying every secret into the client.

import { readFileSync } from 'node:fs'

/** Published only as a localhost convenience. Never accepted off loopback. */
export const DEV_LOCALHOST_TOKEN = 'wax-wane-dev-localhost'

export const BIND_ENV = 'WAX_WANE_BIND'
export const TOKEN_ENV = 'WAX_WANE_API_TOKEN'

const LOOPBACK_NAMES = new Set(['loopback', 'localhost', '127.0.0.1', '::1'])
const ALL_INTERFACES_NAMES = new Set(['lan', 'all', '0.0.0.0', '::', '::0'])

/**
 * Resolve the listen host.
 * Unset or a loopback name stays on 127.0.0.1.
 * `lan` / `all` / `0.0.0.0` opts into every interface.
 * Any other value is an explicit host (still a non-loopback opt-in).
 */
export function resolveBindHost(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return '127.0.0.1'
  const folded = value.toLowerCase()
  if (LOOPBACK_NAMES.has(folded)) return '127.0.0.1'
  if (ALL_INTERFACES_NAMES.has(folded)) return '0.0.0.0'
  return value
}

export function isLoopbackBind(host: string): boolean {
  const folded = host.trim().toLowerCase()
  return folded === '127.0.0.1' || folded === '::1' || folded === 'localhost'
}

/** TCP peer address, including IPv4-mapped IPv6 (`::ffff:127.0.0.1`). */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const folded = address.trim().toLowerCase().replace(/^::ffff:/, '')
  return folded === '127.0.0.1' || folded === '::1' || folded === 'localhost'
}

/** Read one key from a dotenv file. Missing file or key returns undefined. */
export function readDotEnvValue(filePath: string, name: string): string | undefined {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
  let found: string | undefined
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (key !== name) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    found = value
  }
  return found
}
