// QuickTiny 板块轮动公开页面适配层。
// 页面当前提供三套口径：开盘啦题材、财联社行业、财联社概念。
// 这是外部只读数据源，调用失败时由 rotation.ts 决定是否降级到东方财富。

import { fetchWithProxy } from '../lib/llm'

export type QuickTinySource = 'kpl' | 'industry' | 'cls_concept'
export type QuickTinyResponseSource = 'kpl' | 'cls_industry' | 'cls_concept'
export type QuickTinyQuadrantKey = 'highStrong' | 'lowStrong' | 'highWeak' | 'lowWeak'

export interface QuickTinySectorRow {
  name: string
  todayChange: number
  periodChange: number
  recentChange: number
  recentUpDays?: number
  recentTotalDays?: number
  stockCount?: number
  volumeRatio?: number | null
  positionInRange?: number | null
  positionPctRank?: number | null
}

export interface QuickTinyRotationPayload {
  quadrants: Record<QuickTinyQuadrantKey, QuickTinySectorRow[]>
  meta: {
    source: QuickTinyResponseSource
    sourceLabel: string
    period: number
    strengthPeriod: number
    date: string
    requestedCalendarDate?: string
    sectorCount: number
    volumeAdjusted?: boolean
    volumeProgress?: number
  }
}

export interface QuickTinyStockRow {
  name: string
  code: string
  tsCode?: string
  industry?: string
  close?: number
  todayChange: number
  periodChange?: number
  recentChange?: number
  volumeRatio?: number | null
  positionInRange?: number | null
  amount?: number
  circMv?: number
}

export interface QuickTinyStockQuadrantPayload {
  sectorName: string
  quadrants: Record<QuickTinyQuadrantKey, QuickTinyStockRow[]>
  allStocks: QuickTinyStockRow[]
  meta: {
    source: QuickTinyResponseSource
    sourceLabel: string
    sectorName: string
    period: number
    strengthPeriod: number
    date: string
    stockCount: number
  }
}

export interface QuickTinyStockSectorsPayload {
  stock?: { ts_code?: string; symbol?: string; name?: string; industry?: string }
  results: Array<{
    source: QuickTinyResponseSource | 'theme'
    sourceLabel: string
    sectors: Array<{ name: string; stockCount?: number }>
  }>
}

const DEFAULT_API_BASE = 'https://stock.quicktiny.cn/api'
const REQUEST_TIMEOUT_MS = 25_000

const sourceByCategory = {
  theme: 'kpl',
  industry: 'industry',
  concept: 'cls_concept',
} as const

const responseSourceByCategory = {
  theme: 'kpl',
  industry: 'cls_industry',
  concept: 'cls_concept',
} as const

export function quickTinySourceForCategory(category: keyof typeof sourceByCategory): QuickTinySource {
  return sourceByCategory[category]
}

export function quickTinyResponseSourceForCategory(
  category: keyof typeof responseSourceByCategory,
): QuickTinyResponseSource {
  return responseSourceByCategory[category]
}

export function makeQuickTinyBoardCode(source: QuickTinySource, name: string): string {
  return `qt:${source}:${encodeURIComponent(name)}`
}

export function parseQuickTinyBoardCode(code: string): { source: QuickTinySource; name: string } | null {
  const match = code.match(/^qt:(kpl|industry|cls_concept):(.+)$/)
  if (!match) return null
  try {
    const name = decodeURIComponent(match[2])
    return name ? { source: match[1] as QuickTinySource, name } : null
  } catch {
    return null
  }
}

function apiBase(): string {
  return (process.env.QUICKTINY_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
}

async function fetchJson<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`${apiBase()}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const res = await fetchWithProxy(url.toString(), {
    headers: {
      Accept: 'application/json',
      Referer: 'https://stock.quicktiny.cn/sector-analysis',
      'User-Agent': 'trade-review/0.1 (+sector-rotation)',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`[QuickTiny] ${path} HTTP ${res.status}`)
  return (await res.json()) as T
}

function assertQuadrants(payload: QuickTinyRotationPayload | QuickTinyStockQuadrantPayload): void {
  const q = payload?.quadrants
  if (!q || !Array.isArray(q.highStrong) || !Array.isArray(q.lowStrong) || !Array.isArray(q.highWeak) || !Array.isArray(q.lowWeak)) {
    throw new Error('[QuickTiny] invalid quadrant payload')
  }
}

export async function fetchQuickTinyRotation(
  source: QuickTinySource,
  period: number,
  strengthPeriod: number,
): Promise<QuickTinyRotationPayload> {
  const payload = await fetchJson<QuickTinyRotationPayload>('/sector-analysis/quadrant', {
    source,
    period,
    strengthPeriod,
  })
  assertQuadrants(payload)
  if (!payload.meta?.sourceLabel || !payload.meta?.date) throw new Error('[QuickTiny] missing rotation metadata')
  return payload
}

export async function fetchQuickTinyStockQuadrant(
  source: QuickTinySource,
  sector: string,
  period: number,
  strengthPeriod: number,
): Promise<QuickTinyStockQuadrantPayload> {
  const payload = await fetchJson<QuickTinyStockQuadrantPayload>('/sector-analysis/stock-quadrant', {
    source,
    sector,
    period,
    strengthPeriod,
  })
  assertQuadrants(payload)
  if (!Array.isArray(payload.allStocks)) throw new Error('[QuickTiny] missing constituent list')
  return payload
}

export async function fetchQuickTinyStockSectors(code: string): Promise<QuickTinyStockSectorsPayload> {
  const payload = await fetchJson<QuickTinyStockSectorsPayload>('/sector-analysis/sectors-by-stock', { code })
  if (!Array.isArray(payload.results)) throw new Error('[QuickTiny] invalid stock-sector payload')
  return payload
}
