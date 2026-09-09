export const THS_WEB_HOTLIST_URL = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour&list_type=normal'

export interface ThsWebHotStock {
  rank: number
  code: string
  name: string
  changePct: number | null
  tags: string[]
  popularityTag?: string
}

export interface ThsWebHotListResult {
  source: 'ths-web-hotlist'
  status: 'full' | 'empty'
  data: ThsWebHotStock[]
  providerAt: null
  receivedAt: string
}

export type ThsWebFetch = (input: string, init?: RequestInit) => Promise<Response>

export class ThsWebResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThsWebResponseError'
  }
}

type RecordData = Record<string, unknown>

function record(value: unknown): value is RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function tagsFrom(value: unknown): { tags: string[]; popularityTag?: string } {
  if (!record(value)) return { tags: [] }
  return {
    tags: Array.isArray(value.concept_tag) ? value.concept_tag.filter((tag): tag is string => typeof tag === 'string') : [],
    ...(typeof value.popularity_tag === 'string' ? { popularityTag: value.popularity_tag } : {}),
  }
}

export function parseThsWebHotList(payload: unknown): ThsWebHotStock[] {
  const data = record(payload) ? payload.data : undefined
  const list = record(data) ? data.stock_list : data
  if (!Array.isArray(list)) throw new ThsWebResponseError('THS payload missing stock list')
  return list.slice(0, 10).map((entry, index) => {
    if (!record(entry) || typeof entry.code !== 'string' || !/^\d{6}$/.test(entry.code) || typeof entry.name !== 'string') {
      throw new ThsWebResponseError(`THS payload contains an invalid hot-list row at rank ${index + 1}`)
    }
    return {
      rank: index + 1,
      code: entry.code,
      name: entry.name,
      changePct: finiteNumber(entry.rise_and_fall),
      ...tagsFrom(entry.tag),
    }
  })
}

/** The upstream response does not expose a trustworthy list timestamp, so providerAt intentionally stays null. */
export async function fetchThsWebHotList(options: {
  fetchImpl?: ThsWebFetch
  now?: () => Date
} = {}): Promise<ThsWebHotListResult> {
  const response = await (options.fetchImpl ?? fetch)(THS_WEB_HOTLIST_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.10jqka.com.cn/' },
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new ThsWebResponseError(`THS HTTP ${response.status}`)
  const raw = await response.text()
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new ThsWebResponseError('THS response was not valid JSON')
  }
  const data = parseThsWebHotList(payload)
  return {
    source: 'ths-web-hotlist',
    status: data.length ? 'full' : 'empty',
    data,
    providerAt: null,
    receivedAt: (options.now ?? (() => new Date()))().toISOString(),
  }
}
