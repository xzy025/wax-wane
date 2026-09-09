import { todayShanghai } from '../lib/time'
import {
  callQuickTinyMcpTool,
  type QuickTinyMcpToolCallResult,
} from './quicktinyMcp'
import type { KplRealtimeLadder, KplRealtimeStock } from './kaipanlaLadder'

export const QUICKTINY_LADDER_REPLAY_VERSION = 'quicktiny-ladder-replay-v1'
export const QUICKTINY_LADDER_SOURCE = 'quicktiny'

interface RecordValue {
  [key: string]: unknown
}

export interface QuickTinyLadderFetchOptions {
  date?: string
  ladderToolName?: string
  filterToolName?: string
}

export interface QuickTinyLadderReplayFixture {
  version: typeof QUICKTINY_LADDER_REPLAY_VERSION
  provider: 'quicktiny'
  capturedAt: string
  request: {
    toolName: string
    arguments: Record<string, unknown>
  }
  result: QuickTinyMcpToolCallResult
}

interface MapOptions {
  requestedDate?: string
  source?: string
  capturedAt?: string
  providerAt?: string | null
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeDate(value: unknown): string {
  const raw = text(value)
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeCode(value: unknown): string {
  const digits = text(value).replace(/\D/g, '')
  return digits.slice(-6).padStart(6, '0')
}

function normalizeTime(value: unknown): string {
  const raw = text(value)
  if (!raw) return ''
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.replaceAll(':', '').padEnd(6, '0')
  if (/^\d{1,6}$/.test(raw) && Number(raw) < 240000) return raw.padStart(6, '0')
  const timestamp = finiteNumber(raw)
  if (timestamp == null || timestamp <= 0) return ''
  const seconds = timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(seconds * 1000))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.hour ?? ''}${values.minute ?? ''}${values.second ?? ''}`
}

function splitTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : text(value).split(/[、,，;；|/]/)
  return Array.from(new Set(values.map(text).filter(Boolean)))
}

function extractJsonText(value: unknown): RecordValue | null {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Extract the provider document from either structuredContent or MCP text content. */
export function extractQuickTinyLadderPayload(result: unknown): RecordValue {
  if (!isRecord(result)) throw new Error('[QuickTiny ladder] tools/call result 不是对象')
  const structured = extractJsonText(result.structuredContent)
  if (structured) return structured

  const content = Array.isArray(result.content) ? result.content : []
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index]
    if (!isRecord(block)) continue
    const parsed = extractJsonText(block.text ?? block.json ?? block.data)
    if (parsed) return parsed
  }
  if (isRecord(result.data) || typeof result.success === 'boolean') return result
  throw new Error('[QuickTiny ladder] tools/call 没有可解析的 structuredContent/content JSON')
}

function payloadData(payload: RecordValue): RecordValue {
  if (!isRecord(payload.data)) throw new Error('[QuickTiny ladder] 响应缺少 data 对象')
  return payload.data
}

function payloadRows(data: RecordValue): RecordValue[] {
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.items) ? data.items : []
  return rows.filter(isRecord)
}

function payloadDate(payload: RecordValue, data: RecordValue): string {
  const standard = isRecord(payload.meta) && isRecord(payload.meta.standard) ? payload.meta.standard : null
  const metaTradeDate = isRecord(payload.meta) ? payload.meta.tradeDate : undefined
  return normalizeDate(
    standard?.actualTradeDate ??
      standard?.tradeDate ??
      metaTradeDate ??
      data.date,
  )
}

function providerAtFromPayload(payload: RecordValue): string | null {
  const meta = isRecord(payload.meta) ? payload.meta : null
  const standard = meta && isRecord(meta.standard) ? meta.standard : null
  const freshness = standard && isRecord(standard.dataFreshness) ? standard.dataFreshness : null
  const value = text(freshness?.updatedAt)
  return value || null
}

function schemaQualityWarnings(payload: RecordValue): string[] {
  const meta = isRecord(payload.meta) ? payload.meta : null
  const quality = meta && isRecord(meta.quality) ? meta.quality : null
  const values = [
    ...(Array.isArray(quality?.warnings) ? quality.warnings : []),
    ...(Array.isArray(quality?.missingFields) ? quality.missingFields.map((field) => `缺少字段：${String(field)}`) : []),
    ...(Array.isArray(meta?.qualityWarnings) ? meta.qualityWarnings : []),
  ]
  return Array.from(new Set(values.map(String).map((value) => value.trim()).filter(Boolean)))
}

function mapQuickTinyRow(
  row: RecordValue,
  tier: number,
  missingFields: Set<string>,
): KplRealtimeStock | null {
  const code = normalizeCode(row.code)
  const name = text(row.name)
  if (!/^\d{6}$/.test(code) || code === '000000' || !name) return null

  const consecutiveDays = finiteNumber(row.continueNum ?? row.level)
  if (consecutiveDays == null || consecutiveDays < 1) {
    missingFields.add(`rows[${tier}].continueNum`)
    return null
  }
  const firstTime = normalizeTime(row.firstLimitUpTimeText ?? row.firstLimitUpTime)
  const lastTime = normalizeTime(row.lastLimitUpTimeText ?? row.lastLimitUpTime)
  const tags = splitTags(row.conceptTags)
  const primaryTheme = text(row.primaryTheme) || tags[0] || '其他'
  if (!text(row.primaryTheme)) missingFields.add('rows[].primaryTheme')

  const price = finiteNumber(row.latest ?? row.price)
  const changePct = finiteNumber(row.changeRate ?? row.changePercent)
  const amount = finiteNumber(row.tradingAmount ?? row.tradeAmount)
  const sealAmount = finiteNumber(row.orderAmount)
  const turnoverRate = finiteNumber(row.turnoverRate)
  const amplitude = finiteNumber(row.amplitudePct ?? row.amplitude)
  const openCount = finiteNumber(row.openNum ?? row.openCount)
  const limitUpType = text(row.limitUpType)
  if (price == null) missingFields.add('rows[].latest')
  if (changePct == null) missingFields.add('rows[].changeRate')
  if (!firstTime) missingFields.add('rows[].firstLimitUpTimeText')
  if (amount == null) missingFields.add('rows[].tradingAmount')
  if (sealAmount == null) missingFields.add('rows[].orderAmount')
  if (turnoverRate == null) missingFields.add('rows[].turnoverRate')
  if (amplitude == null) missingFields.add('rows[].amplitudePct')
  if (typeof row.isMarginEligible !== 'boolean') missingFields.add('rows[].isMarginEligible')

  const boardLabel = consecutiveDays === 1 ? '首板' : `${consecutiveDays}连板`
  const themes = Array.from(new Set([primaryTheme, ...tags])).filter(Boolean)
  return {
    code,
    name,
    price: price ?? 0,
    changePct: changePct ?? 0,
    firstTime,
    ...(lastTime ? { lastTime } : {}),
    consecutiveDays,
    nDayBoards: text(row.nDayBoards) || boardLabel,
    primaryTheme,
    themes,
    sealAmount: sealAmount ?? 0,
    amount: amount ?? 0,
    turnoverRate: turnoverRate ?? 0,
    ...(openCount == null ? {} : { openCount: Math.max(0, openCount) }),
    amplitudePct: Math.max(0, amplitude ?? 0),
    isMarginEligible: typeof row.isMarginEligible === 'boolean' ? row.isMarginEligible : false,
    onePriceHint: /一字/.test(limitUpType),
    tBoardHint: /T字|T板/i.test(limitUpType),
    ...(text(row.reasonType) ? { reasonType: text(row.reasonType) } : {}),
    ...(text(row.reasonInfo) ? { reasonInfo: text(row.reasonInfo) } : {}),
    ...(text(row.industry) ? { industry: text(row.industry) } : {}),
    ...(limitUpType ? { limitUpType } : {}),
    ...(finiteNumber(row.actualTurnoverRate) == null ? {} : { actualTurnoverRate: finiteNumber(row.actualTurnoverRate) as number }),
    ...(finiteNumber(row.currencyValue) == null ? {} : { currencyValue: finiteNumber(row.currencyValue) as number }),
    ...(finiteNumber(row.totalMarketCap) == null ? {} : { totalMarketCap: finiteNumber(row.totalMarketCap) as number }),
    ...(finiteNumber(row.actualCurrencyValue) == null ? {} : { actualCurrencyValue: finiteNumber(row.actualCurrencyValue) as number }),
  }
}

/** Map a raw authorized QuickTiny response into the project's ladder contract. */
export function mapQuickTinyLadderPayload(payload: unknown, options: MapOptions = {}): KplRealtimeLadder {
  if (!isRecord(payload)) throw new Error('[QuickTiny ladder] payload 不是对象')
  const document = isRecord(payload.data) ? payload : extractQuickTinyLadderPayload(payload)
  const data = payloadData(document)
  const requestedDate = normalizeDate(options.requestedDate)
  const actualDate = payloadDate(document, data) || requestedDate
  if (!actualDate) throw new Error('[QuickTiny ladder] 响应缺少可验证交易日')
  if (requestedDate && actualDate !== requestedDate) {
    throw new Error(`[QuickTiny ladder] 响应交易日 ${actualDate} 与请求 ${requestedDate} 不一致`)
  }

  const rows = payloadRows(data)
  const missingFields = new Set<string>()
  const stocks = rows
    .map((row, index) => mapQuickTinyRow(row, index, missingFields))
    .filter((stock): stock is KplRealtimeStock => !!stock)
  if (stocks.length !== rows.length) missingFields.add('rows[].code/name/continueNum')

  const pagination = isRecord(data.pagination) ? data.pagination : null
  const declaredTotal = finiteNumber(data.totalStocks ?? data.total ?? pagination?.total)
  const total = declaredTotal ?? stocks.length
  const complete = total === stocks.length
  const warnings = schemaQualityWarnings(document)
  if (total > stocks.length) warnings.push(`QuickTiny 返回 ${stocks.length}/${total} 条，存在分页或 maxRows 截断`)
  if (missingFields.size > 0) warnings.push(`QuickTiny 字段缺失或未提供：${Array.from(missingFields).join('、')}`)
  const standard = isRecord(document.meta) && isRecord(document.meta.standard) ? document.meta.standard : null
  const dataFreshness = standard && isRecord(standard.dataFreshness) ? standard.dataFreshness : null
  const providerAt = options.providerAt ?? providerAtFromPayload(document)
  const dataStatus = stocks.length === 0
    ? total === 0 && complete ? 'empty' as const : 'partial' as const
    : complete && missingFields.size === 0 && dataFreshness?.fallbackUsed !== true
      ? 'full' as const
      : 'degraded' as const

  return {
    date: actualDate,
    stocks,
    complete,
    missingTiers: [],
    dataStatus,
    source: options.source ?? QUICKTINY_LADDER_SOURCE,
    providerAt,
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    fromCache: false,
    cacheAgeMs: 0,
    ...(warnings.length ? { warnings: Array.from(new Set(warnings)) } : {}),
    ...(dataFreshness?.fallbackUsed === true ? { warnings: Array.from(new Set([...(warnings ?? []), 'QuickTiny 标记使用了 fallback，未视为完整实时数据'])) } : {}),
  }
}

function configuredToolName(envName: string, fallback?: string): string {
  const value = (process.env[envName] || fallback || '').trim()
  if (!value) throw new Error(`[QuickTiny ladder] ${envName} 未配置`)
  return value
}

function ladderArguments(date: string): Record<string, unknown> {
  return {
    date,
    detailLevel: 'raw',
    maxRowsPerLevel: 50,
    includeFirstBoard: true,
    includeReasonInfo: true,
    format: 'json',
  }
}

function filterArguments(date: string, page: number): Record<string, unknown> {
  return {
    date,
    page,
    limit: 100,
    sortBy: 'continue_num',
    sortOrder: 'desc',
    detailLevel: 'raw',
    includeFirstBoard: true,
    includeReasonInfo: true,
    format: 'json',
  }
}

function mergePayloads(
  ladderPayload: RecordValue | null,
  filterPayload: RecordValue,
): RecordValue {
  const filterData = payloadData(filterPayload)
  const ladderData = ladderPayload && isRecord(ladderPayload.data) ? ladderPayload.data : null
  const filterRows = payloadRows(filterData)
  const ladderRows = ladderData ? payloadRows(ladderData) : []
  const ladderByCode = new Map(ladderRows.map((row) => [normalizeCode(row.code), row]))
  const rows = filterRows.map((row) => {
    const ladderRow = ladderByCode.get(normalizeCode(row.code))
    return ladderRow ? { ...ladderRow, ...row, reasonInfo: row.reasonInfo ?? ladderRow.reasonInfo } : row
  })
  return {
    ...filterPayload,
    data: {
      ...filterData,
      rows,
      ...(filterData.primaryThemeStats == null && ladderData?.primaryThemeStats != null
        ? { primaryThemeStats: ladderData.primaryThemeStats }
        : {}),
    },
    meta: {
      ...(isRecord(filterPayload.meta) ? filterPayload.meta : {}),
      ...(isRecord(ladderPayload?.meta) && isRecord(ladderPayload.meta.standard)
        ? { standard: ladderPayload.meta.standard }
        : {}),
    },
  }
}

async function fetchFilterPages(
  toolName: string,
  date: string,
  firstResult: QuickTinyMcpToolCallResult,
): Promise<RecordValue> {
  const firstPayload = extractQuickTinyLadderPayload(firstResult)
  const firstData = payloadData(firstPayload)
  const firstRows = payloadRows(firstData)
  const pagination = isRecord(firstData.pagination) ? firstData.pagination : null
  const totalPages = Math.max(1, Math.floor(finiteNumber(pagination?.totalPages) ?? 1))
  if (totalPages === 1) return firstPayload

  const rows = [...firstRows]
  for (let page = 2; page <= totalPages; page += 1) {
    const result = await callQuickTinyMcpTool(toolName, filterArguments(date, page))
    rows.push(...payloadRows(payloadData(extractQuickTinyLadderPayload(result))))
  }
  return {
    ...firstPayload,
    data: { ...firstData, rows },
  }
}

/**
 * Authorized QuickTiny ladder fetch. `limit_up_ladder` supplies ladder context
 * and reason fields; `limit_up_filter` is paged to recover all rows beyond the
 * ladder tool's observed maxRows=40 response budget.
 */
export async function fetchQuickTinyRealtimeLadder(
  options: QuickTinyLadderFetchOptions = {},
): Promise<KplRealtimeLadder> {
  const date = normalizeDate(options.date) || todayShanghai()
  const ladderToolName = configuredToolName('QUICKTINY_LADDER_TOOL_NAME', options.ladderToolName)
  const filterToolName = configuredToolName('QUICKTINY_LADDER_FILTER_TOOL_NAME', options.filterToolName)
  const capturedAt = new Date().toISOString()
  let ladderPayload: RecordValue | null = null
  let ladderError: unknown = null
  try {
    ladderPayload = extractQuickTinyLadderPayload(
      await callQuickTinyMcpTool(ladderToolName, ladderArguments(date)),
    )
  } catch (error) {
    ladderError = error
  }

  let filterPayload: RecordValue | null = null
  let filterError: unknown = null
  try {
    const first = await callQuickTinyMcpTool(filterToolName, filterArguments(date, 1))
    filterPayload = await fetchFilterPages(filterToolName, date, first)
  } catch (error) {
    filterError = error
  }

  if (!filterPayload && !ladderPayload) {
    const details = [ladderError, filterError]
      .filter(Boolean)
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join('；')
    throw new Error(`QuickTiny 梯队工具均不可用${details ? `：${details}` : ''}`)
  }

  const payload = filterPayload ? mergePayloads(ladderPayload, filterPayload) : ladderPayload as RecordValue
  const mapped = mapQuickTinyLadderPayload(payload, {
    requestedDate: date,
    source: QUICKTINY_LADDER_SOURCE,
    capturedAt,
    providerAt: ladderPayload ? providerAtFromPayload(ladderPayload) : providerAtFromPayload(payload),
  })
  const warnings = [...(mapped.warnings ?? [])]
  if (ladderError) warnings.push(`limit_up_ladder 不可用：${ladderError instanceof Error ? ladderError.message : String(ladderError)}`)
  if (filterError) warnings.push(`limit_up_filter 不可用：${filterError instanceof Error ? filterError.message : String(filterError)}`)
  return {
    ...mapped,
    complete: mapped.complete && !filterError,
    ...(warnings.length ? { warnings: Array.from(new Set(warnings)) } : {}),
  }
}

/** Replay a captured MCP result through the exact same mapper used in production. */
export function replayQuickTinyLadder(fixture: QuickTinyLadderReplayFixture): KplRealtimeLadder {
  if (fixture.version !== QUICKTINY_LADDER_REPLAY_VERSION) {
    throw new Error(`[QuickTiny ladder] replay 版本不支持：${fixture.version}`)
  }
  if (fixture.provider !== 'quicktiny') throw new Error('[QuickTiny ladder] replay provider 不支持')
  const requestedDate = normalizeDate(fixture.request.arguments.date)
  return mapQuickTinyLadderPayload(fixture.result, {
    requestedDate,
    source: 'quicktiny-replay',
    capturedAt: fixture.capturedAt,
  })
}
