// MCP 候选集读取层：把 docs/screener/mcp-universe-<date>.json 暴露给前端选股页。
//
// 定位：影子观察面板，**不是战法、不是买点、未回测、不进评分、不改信号状态**。
// 它回答的是"腾讯自选股/通达信当日事件型候选池里有什么"，与 screener 主链路
// (clist 全市场初筛 + K线精筛) 平行并存，用于覆盖率 diff 与漏票排查。
//
// 之所以独立成接口而不是塞进 ScreenerResult：
//   1) docs/screener/YYYY-MM-DD.json 是正式归档，会被 loadLatestArchive()/实盘战绩
//      回填链路消费。把未评分的 MCP 候选写成正式归档 = 伪造历史，绝对禁止。
//   2) ScreenerResult.regime 为必填，MCP 候选集没有 regime，拼凑会污染前端 stale 判定。
// 文件名前缀 mcp-universe- 保证 parseScreenerArchiveName() 不会误匹配。
import { readdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ARCHIVE_DIR = join(__dirname, '..', '..', 'docs', 'screener')
const ARCHIVE_RE = /^mcp-universe-(\d{4}-\d{2}-\d{2})\.json$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface McpUniverseStock {
  code: string
  name: string
  /** 该票命中的策略 key 列表（跨组去重后的交集证据）。 */
  hits: string[]
}

export interface McpUniverseGroup {
  key: string
  label: string
  mcpStrategy: string
  totalStocks: number
  collected: number
  truncated: boolean
  codes: { code: string; name: string }[]
}

export interface McpUniverseData {
  schemaVersion: string
  provider: string
  asof: string
  generatedAt: string
  purpose: string
  statusNote: string
  coverageNote?: string
  groups: McpUniverseGroup[]
  /** 跨策略去重后的候选池。 */
  union: McpUniverseStock[]
  unionSize: number
  /** 磁盘上可用的日期（新→旧），供前端切换历史。 */
  availableDates: string[]
  /** 命中 ≥2 个策略的交集票（信号更硬，优先看）。 */
  multiHit: McpUniverseStock[]
}

/** 磁盘上的可用日期列表，新的在前。 */
export function listMcpUniverseDates(): string[] {
  let files: string[]
  try {
    files = readdirSync(ARCHIVE_DIR)
  } catch {
    return []
  }
  return files
    .map((f) => ARCHIVE_RE.exec(f)?.[1] ?? null)
    .filter((d): d is string => d != null)
    .sort((a, b) => (a < b ? 1 : -1))
}

interface RawStrategyEntry {
  label?: string
  mcpStrategy?: string
  totalStocks?: number
  collected?: number
  truncated?: boolean
  codes?: { code?: string; name?: string }[]
}

function normalize(
  raw: Record<string, unknown>,
  requestedDate?: string,
): McpUniverseData | null {
  const asof = typeof raw.asof === 'string' ? raw.asof : requestedDate
  if (!asof) return null

  const rawStrategies = (raw.strategies ?? {}) as Record<string, RawStrategyEntry>
  const groups: McpUniverseGroup[] = []
  const hitsByCode = new Map<string, Set<string>>()

  for (const [key, entry] of Object.entries(rawStrategies)) {
    const codes = (entry.codes ?? [])
      .filter((c): c is { code: string; name: string } => typeof c?.code === 'string')
      .map((c) => ({ code: c.code, name: c.name ?? '' }))
    for (const c of codes) {
      const set = hitsByCode.get(c.code) ?? new Set<string>()
      set.add(key)
      hitsByCode.set(c.code, set)
      // 名称补全：同一代码可能在不同策略里一个有名字一个没有。
      if (!c.name) {
        const known = groups.flatMap((g) => g.codes).find((x) => x.code === c.code)
        if (known?.name) c.name = known.name
      }
    }
    groups.push({
      key,
      label: entry.label ?? key,
      mcpStrategy: entry.mcpStrategy ?? '',
      totalStocks: Number(entry.totalStocks ?? codes.length),
      collected: Number(entry.collected ?? codes.length),
      truncated: Boolean(entry.truncated),
      codes,
    })
  }

  // union 优先用文件自带的（保留生成时的顺序），再补上 hits；缺失则自算。
  const rawUnion = Array.isArray(raw.union) ? raw.union : []
  const union: McpUniverseStock[] = rawUnion
    .filter((c): c is { code: string; name?: string } => typeof c?.code === 'string')
    .map((c) => ({
      code: c.code,
      name: c.name ?? '',
      hits: [...(hitsByCode.get(c.code) ?? [])],
    }))

  // union 里可能缺名字（生成脚本只写了 code/name，理论上都有），兜底从各组回填。
  const nameByCode = new Map<string, string>()
  for (const g of groups) for (const c of g.codes) if (c.name) nameByCode.set(c.code, c.name)
  for (const s of union) if (!s.name) s.name = nameByCode.get(s.code) ?? ''

  // 若文件没有 union（老版本），自算。
  if (union.length === 0) {
    for (const [code, set] of hitsByCode) {
      union.push({ code, name: nameByCode.get(code) ?? '', hits: [...set] })
    }
  }

  const multiHit = union.filter((s) => s.hits.length >= 2).sort((a, b) => b.hits.length - a.hits.length)

  return {
    schemaVersion: String(raw.schemaVersion ?? 'unknown'),
    provider: String(raw.provider ?? ''),
    asof,
    generatedAt: String(raw.generatedAt ?? ''),
    purpose: String(raw.purpose ?? 'research'),
    statusNote: String(raw.statusNote ?? ''),
    coverageNote: typeof raw.coverageNote === 'string' ? raw.coverageNote : undefined,
    groups,
    union,
    unionSize: Number(raw.unionSize ?? union.length),
    availableDates: listMcpUniverseDates(),
    multiHit,
  }
}

/** 读取指定日期（或最新一份）的 MCP 候选集。文件缺失/损坏返回 null。 */
export function loadMcpUniverse(date?: string): McpUniverseData | null {
  const dates = listMcpUniverseDates()
  const target = date && DATE_RE.test(date) ? date : dates[0]
  if (!target) return null
  try {
    const raw = JSON.parse(readFileSync(join(ARCHIVE_DIR, `mcp-universe-${target}.json`), 'utf8'))
    return normalize(raw, target)
  } catch (err) {
    console.warn(`[McpUniverse] 读取 mcp-universe-${target}.json 失败:`, err)
    return null
  }
}

/**
 * 供路由使用。磁盘 JSON 由外部脚本每日覆盖写入，读取成本极低（<1ms），
 * 因此不套 createCache —— 缓存反而会让新落盘的当天文件读不到。
 */
export function fetchMcpUniverse(date?: string): McpUniverseData {
  const data = loadMcpUniverse(date)
  if (!data) {
    throw new Error(
      date
        ? `未找到 ${date} 的 MCP 候选集（docs/screener/mcp-universe-${date}.json）`
        : '暂无 MCP 候选集，需先由 WorkBuddy 会话生成 docs/screener/mcp-universe-<date>.json',
    )
  }
  return data
}
