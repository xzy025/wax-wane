import { existsSync } from 'node:fs'
import { readAtomicJson, writeAtomicJson } from '../lib/atomicJsonStore'
import { hashPayload } from './pointInTime'

export const LIMIT_EVENT_STORE_SCHEMA = 'limit-event-history-v1' as const

export type LimitEventType = 'touch' | 'first-seal' | 'reopen' | 'reseal' | 'last-seal' | 'close'

export interface LimitEventRecord {
  eventId: string
  code: string
  date: string
  eventType: LimitEventType
  eventAt: string | null
  price: number | null
  amount: number | null
  sealAmount: number | null
  provider: string
  providerAt: string | null
  receivedAt: string | null
  sourceRef: string | null
  missingReasons: readonly string[]
}

export interface LimitEventArchive {
  schemaVersion: typeof LIMIT_EVENT_STORE_SCHEMA
  featureVersion: string
  events: LimitEventRecord[]
}

export interface LimitEventDayAggregate {
  code: string
  date: string
  firstTouchMinute: number | null
  firstSealMinute: number | null
  lastSealMinute: number | null
  reopenCount: number | null
  reopenTotalSeconds: number | null
  maxOpenSeconds: number | null
  sealDurationSeconds: number | null
  sealAmount: number | null
  missingReasons: string[]
  quality: 'full' | 'partial' | 'unavailable'
}

function minuteOf(value: string | null): number | null {
  if (!value) return null
  const match = value.match(/T(\d{2}):(\d{2})/) ?? value.match(/^(\d{2})(\d{2})/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour * 60 + minute
}

function secondsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const a = Date.parse(start)
  const b = Date.parse(end)
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : null
}

function eventSort(a: LimitEventRecord, b: LimitEventRecord): number {
  return a.date.localeCompare(b.date) || (a.eventAt ?? '').localeCompare(b.eventAt ?? '') || a.eventId.localeCompare(b.eventId)
}

export function createLimitEventId(event: Omit<LimitEventRecord, 'eventId'>): string {
  return hashPayload(event).slice(0, 32)
}

export function aggregateLimitEventDay(args: {
  code: string
  date: string
  events: readonly LimitEventRecord[]
}): LimitEventDayAggregate {
  const events = args.events.filter((event) => event.code === args.code && event.date === args.date).sort(eventSort)
  const touches = events.filter((event) => event.eventType === 'touch')
  const firstSeals = events.filter((event) => event.eventType === 'first-seal')
  const lastSeals = events.filter((event) => event.eventType === 'last-seal')
  const reopens = events.filter((event) => event.eventType === 'reopen')
  const reseals = events.filter((event) => event.eventType === 'reseal')
  const missingReasons = Array.from(new Set(events.flatMap((event) => event.missingReasons)))
  const firstTouchMinute = minuteOf(touches[0]?.eventAt ?? null)
  const firstSealMinute = minuteOf(firstSeals[0]?.eventAt ?? null)
  const lastSeal = lastSeals.at(-1)
  const lastSealMinute = minuteOf(lastSeal?.eventAt ?? null)
  const openDurations = reopens.map((event, index) => secondsBetween(event.eventAt, reseals[index]?.eventAt)).filter((value): value is number => value != null)
  const sealDurationSeconds = secondsBetween(lastSeal?.eventAt ?? null, events.find((event) => event.eventType === 'close')?.eventAt ?? null)
  if (!events.length) missingReasons.push('无历史涨停事件记录；不能从日K推断首封/炸板/封单')
  if (!firstSealMinute) missingReasons.push('缺少历史首封事件')
  if (!lastSealMinute) missingReasons.push('缺少历史终封事件')
  if (!events.some((event) => event.eventType === 'reopen')) missingReasons.push('缺少历史开板事件；不等于开板次数为0')
  if (!lastSeal?.sealAmount) missingReasons.push('缺少终封封单快照')
  const quality = !events.length
    ? 'unavailable'
    : missingReasons.length === 0
      ? 'full'
      : 'partial'
  return {
    code: args.code,
    date: args.date,
    firstTouchMinute,
    firstSealMinute,
    lastSealMinute,
    reopenCount: events.length ? reopens.length : null,
    reopenTotalSeconds: openDurations.length ? openDurations.reduce((sum, value) => sum + value, 0) : null,
    maxOpenSeconds: openDurations.length ? Math.max(...openDurations) : null,
    sealDurationSeconds,
    sealAmount: lastSeal?.sealAmount ?? null,
    missingReasons: Array.from(new Set(missingReasons)),
    quality,
  }
}

export class LimitEventStore {
  readonly path: string
  readonly featureVersion: string

  constructor(path: string, featureVersion = LIMIT_EVENT_STORE_SCHEMA) {
    this.path = path
    this.featureVersion = featureVersion
  }

  read(): LimitEventArchive {
    return readAtomicJson<LimitEventArchive>(this.path, {
      validate: (value): value is LimitEventArchive =>
        !!value && typeof value === 'object' &&
        (value as LimitEventArchive).schemaVersion === LIMIT_EVENT_STORE_SCHEMA &&
        Array.isArray((value as LimitEventArchive).events),
    }) ?? { schemaVersion: LIMIT_EVENT_STORE_SCHEMA, featureVersion: this.featureVersion, events: [] }
  }

  append(events: readonly Omit<LimitEventRecord, 'eventId'>[]): LimitEventArchive {
    const existing = this.read()
    const byId = new Map(existing.events.map((event) => [event.eventId, event]))
    for (const input of events) {
      const event = { ...input, eventId: createLimitEventId(input) }
      if (!byId.has(event.eventId)) byId.set(event.eventId, event)
    }
    const next: LimitEventArchive = {
      schemaVersion: LIMIT_EVENT_STORE_SCHEMA,
      featureVersion: this.featureVersion,
      events: Array.from(byId.values()).sort(eventSort),
    }
    writeAtomicJson(this.path, next)
    return next
  }

  aggregate(code: string, date: string): LimitEventDayAggregate {
    return aggregateLimitEventDay({ code, date, events: this.read().events })
  }

  exists(): boolean {
    return existsSync(this.path)
  }
}
