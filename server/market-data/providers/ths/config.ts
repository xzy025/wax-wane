import {
  HITHINK_DEFAULT_BASE_URL,
  HITHINK_DEFAULT_MAX_RETRIES,
  HITHINK_DEFAULT_REQUEST_GAP_MS,
  HITHINK_DEFAULT_TIMEOUT_MS,
  HithinkConfigurationError,
  validateDate,
  validateStockCodes,
} from '../../hithinkFinanceClient'

export const HITHINK_DEFAULT_MAX_CONCURRENT = 1
export const HITHINK_DEFAULT_CACHE_TTL_MS = 60_000
export const HITHINK_DEFAULT_CACHE_MAX_ENTRIES = 100

export interface HithinkConnectionConfig {
  baseUrl: string
  apiKey?: string
  timeoutMs: number
  requestGapMs: number
  maxRetries: number
  maxConcurrent: number
  maxQueue: number
  cacheTtlMs: number
  cacheMaxEntries: number
}

export interface HithinkResearchConfig {
  codes: string[]
  indexCode: string
  tradeDate?: string
  startDate: string
  endDate: string
}

export interface HithinkProviderConfig {
  connection: HithinkConnectionConfig
  research: HithinkResearchConfig
}

function optionalEnv(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name]?.trim()
  return value || undefined
}

function parseNonNegativeInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HithinkConfigurationError(`${name} must be a non-negative integer`)
  }
  return parsed
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HithinkConfigurationError(`${name} must be a positive integer`)
  }
  return parsed
}

function parseCsv(value: string | undefined): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []
}

function todayShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

function defaultStartDate(endDate: string): string {
  const end = new Date(`${endDate}T00:00:00.000Z`)
  end.setUTCFullYear(end.getUTCFullYear() - 1)
  return end.toISOString().slice(0, 10)
}

function normalizeBaseUrl(value: string | undefined): string {
  const candidate = value ?? HITHINK_DEFAULT_BASE_URL
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new HithinkConfigurationError(`Invalid HITHINK_FINANCE_BASE_URL: ${candidate}`)
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new HithinkConfigurationError('HITHINK_FINANCE_BASE_URL must use HTTPS, except for localhost tests')
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
}

function validateIndexCode(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!/^\d{6}\.(TI|SH|SZ)$/.test(normalized)) {
    throw new HithinkConfigurationError(`Invalid HITHINK_FINANCE_INDEX_CODE: ${value}`)
  }
  return normalized
}

/** Reads only connection and runtime controls. Research sample settings are intentionally ignored. */
export function readHithinkConnectionConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HithinkConnectionConfig {
  return {
    baseUrl: normalizeBaseUrl(optionalEnv('HITHINK_FINANCE_BASE_URL', env)),
    apiKey: optionalEnv('HITHINK_FINANCE_API_KEY', env),
    timeoutMs: parsePositiveInt(optionalEnv('HITHINK_FINANCE_TIMEOUT_MS', env), HITHINK_DEFAULT_TIMEOUT_MS, 'HITHINK_FINANCE_TIMEOUT_MS'),
    requestGapMs: parseNonNegativeInt(optionalEnv('HITHINK_FINANCE_REQUEST_GAP_MS', env), HITHINK_DEFAULT_REQUEST_GAP_MS, 'HITHINK_FINANCE_REQUEST_GAP_MS'),
    maxRetries: parseNonNegativeInt(optionalEnv('HITHINK_FINANCE_MAX_RETRIES', env), HITHINK_DEFAULT_MAX_RETRIES, 'HITHINK_FINANCE_MAX_RETRIES'),
    maxConcurrent: parsePositiveInt(optionalEnv('HITHINK_FINANCE_MAX_CONCURRENT', env), HITHINK_DEFAULT_MAX_CONCURRENT, 'HITHINK_FINANCE_MAX_CONCURRENT'),
    maxQueue: parsePositiveInt(optionalEnv('HITHINK_FINANCE_MAX_QUEUE', env), 100, 'HITHINK_FINANCE_MAX_QUEUE'),
    cacheTtlMs: parsePositiveInt(optionalEnv('HITHINK_FINANCE_CACHE_TTL_MS', env), HITHINK_DEFAULT_CACHE_TTL_MS, 'HITHINK_FINANCE_CACHE_TTL_MS'),
    cacheMaxEntries: parsePositiveInt(optionalEnv('HITHINK_FINANCE_CACHE_MAX_ENTRIES', env), HITHINK_DEFAULT_CACHE_MAX_ENTRIES, 'HITHINK_FINANCE_CACHE_MAX_ENTRIES'),
  }
}

/** Reads probe/sample parameters separately from the reusable connection config. */
export function readHithinkResearchConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HithinkResearchConfig {
  const endDate = validateDate(optionalEnv('HITHINK_FINANCE_END_DATE', env), 'HITHINK_FINANCE_END_DATE') ?? todayShanghai()
  const startDate = validateDate(optionalEnv('HITHINK_FINANCE_START_DATE', env), 'HITHINK_FINANCE_START_DATE') ?? defaultStartDate(endDate)
  if (startDate > endDate) throw new HithinkConfigurationError('HITHINK_FINANCE_START_DATE must not be after HITHINK_FINANCE_END_DATE')
  const configuredCodes = parseCsv(optionalEnv('HITHINK_FINANCE_CODES', env))
  return {
    codes: validateStockCodes(configuredCodes.length ? configuredCodes : ['000001.SZ', '600519.SH']),
    indexCode: validateIndexCode(optionalEnv('HITHINK_FINANCE_INDEX_CODE', env) ?? '886042.TI'),
    tradeDate: validateDate(optionalEnv('HITHINK_FINANCE_TRADE_DATE', env), 'HITHINK_FINANCE_TRADE_DATE'),
    startDate,
    endDate,
  }
}

export function readHithinkProviderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HithinkProviderConfig {
  return {
    connection: readHithinkConnectionConfigFromEnv(env),
    research: readHithinkResearchConfigFromEnv(env),
  }
}
