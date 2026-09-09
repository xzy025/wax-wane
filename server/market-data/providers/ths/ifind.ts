export type IFindJsonObject = Record<string, unknown>

export interface IFindHttpResponse {
  httpStatus: number
  ok: boolean
  body: unknown
  rawText: string
  jsonParsed: boolean
}

export type IFindFetch = (input: string, init?: RequestInit) => Promise<Response>

export class ThsIFindConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IFindConfigurationError'
  }
}

export interface IFindClient {
  readonly isConfigured: boolean
  ensureAccessToken(): Promise<string>
  request(endpoint: string, body: IFindJsonObject): Promise<IFindHttpResponse>
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ThsIFindConfigurationError(`Invalid IFIND_BASE_URL: ${value}`)
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new ThsIFindConfigurationError('IFIND_BASE_URL must use HTTPS, except for localhost tests')
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
}

function buildUrl(baseUrl: string, endpoint: string): string {
  if (!endpoint || endpoint.includes('://') || endpoint.includes('?')) {
    throw new ThsIFindConfigurationError(`Invalid iFinD endpoint: ${endpoint}`)
  }
  return `${baseUrl}/${endpoint.replace(/^\/+/, '')}`
}

function createAbortSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, dispose: () => clearTimeout(timer) }
}

async function parseResponseBody(response: Response): Promise<{ body: unknown; rawText: string; jsonParsed: boolean }> {
  const rawText = await response.text()
  if (!rawText.trim()) return { body: undefined, rawText, jsonParsed: true }
  try {
    return { body: JSON.parse(rawText) as unknown, rawText, jsonParsed: true }
  } catch {
    return { body: rawText, rawText, jsonParsed: false }
  }
}

function redactSecrets(value: string, secrets: Array<string | undefined>): string {
  return secrets.filter((secret): secret is string => Boolean(secret)).reduce(
    (result, secret) => result.split(secret).join('[REDACTED]'), value,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** iFinD transport only: token refresh and POST protocol stay separate from probe definitions. */
export function createIFindTransport(options: {
  baseUrl: string
  accessToken?: string
  refreshToken?: string
  timeoutMs: number
  requestGapMs?: number
  fetchImpl?: IFindFetch
  sleepImpl?: (ms: number) => Promise<void>
}): IFindClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const timeoutMs = options.timeoutMs
  const requestGapMs = options.requestGapMs ?? 0
  const fetchImpl = options.fetchImpl ?? fetch
  const sleepImpl = options.sleepImpl ?? sleep
  let accessToken = options.accessToken?.trim() || undefined
  let tokenPromise: Promise<string> | undefined
  const isConfigured = Boolean(accessToken || options.refreshToken?.trim())

  const waitGap = async () => {
    if (requestGapMs > 0) await sleepImpl(requestGapMs)
  }

  const ensureAccessToken = async (): Promise<string> => {
    if (accessToken) return accessToken
    if (!options.refreshToken?.trim()) {
      throw new ThsIFindConfigurationError('Missing IFIND_ACCESS_TOKEN or IFIND_REFRESH_TOKEN')
    }
    if (tokenPromise) return tokenPromise
    tokenPromise = (async () => {
      await waitGap()
      const abort = createAbortSignal(timeoutMs)
      try {
        const response = await fetchImpl(buildUrl(baseUrl, 'get_access_token'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            refresh_token: options.refreshToken as string,
          },
          signal: abort.signal,
        })
        const parsed = await parseResponseBody(response)
        const candidate = parsed.body && typeof parsed.body === 'object'
          ? (parsed.body as IFindJsonObject).access_token
            ?? ((parsed.body as IFindJsonObject).data as IFindJsonObject | undefined)?.access_token
          : undefined
        if (!response.ok || typeof candidate !== 'string' || !candidate) {
          throw new Error(redactSecrets(
            `iFinD access token request failed (${response.status}): ${parsed.rawText.slice(0, 300)}`,
            [options.refreshToken, options.accessToken],
          ))
        }
        accessToken = candidate
        return candidate
      } finally {
        abort.dispose()
      }
    })()
    try {
      return await tokenPromise
    } catch (error) {
      tokenPromise = undefined
      throw error
    }
  }

  const request = async (endpoint: string, body: IFindJsonObject): Promise<IFindHttpResponse> => {
    const token = await ensureAccessToken()
    await waitGap()
    const abort = createAbortSignal(timeoutMs)
    try {
      const response = await fetchImpl(buildUrl(baseUrl, endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: token,
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      })
      const parsed = await parseResponseBody(response)
      return {
        httpStatus: response.status,
        ok: response.ok && response.status < 400,
        body: parsed.body,
        rawText: parsed.rawText,
        jsonParsed: parsed.jsonParsed,
      }
    } finally {
      abort.dispose()
    }
  }

  return { isConfigured, ensureAccessToken, request }
}
