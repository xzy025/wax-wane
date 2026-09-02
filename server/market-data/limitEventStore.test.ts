import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LimitEventStore, aggregateLimitEventDay } from './limitEventStore'

let root = ''

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = ''
})

function event(eventType: 'touch' | 'first-seal' | 'reopen' | 'reseal' | 'last-seal' | 'close', at: string, sealAmount: number | null = null) {
  return {
    code: '600103',
    date: '2026-08-28',
    eventType,
    eventAt: at,
    price: 10,
    amount: 100_000_000,
    sealAmount,
    provider: 'fixture',
    providerAt: at,
    receivedAt: at,
    sourceRef: null,
    missingReasons: [],
  } as const
}

describe('historical limit-event store', () => {
  it('appends idempotently and aggregates real event timing', () => {
    root = mkdtempSync(join(tmpdir(), 'trade-review-limit-events-'))
    const store = new LimitEventStore(join(root, 'events.json'))
    const rows = [
      event('touch', '2026-08-28T09:31:00+08:00'),
      event('first-seal', '2026-08-28T09:35:00+08:00'),
      event('reopen', '2026-08-28T10:00:00+08:00'),
      event('reseal', '2026-08-28T10:05:00+08:00'),
      event('last-seal', '2026-08-28T14:00:00+08:00', 5_000_000),
      event('close', '2026-08-28T15:00:00+08:00'),
    ]
    expect(store.append(rows).events).toHaveLength(6)
    expect(store.append(rows).events).toHaveLength(6)
    expect(store.aggregate('600103', '2026-08-28')).toMatchObject({
      firstTouchMinute: 9 * 60 + 31,
      firstSealMinute: 9 * 60 + 35,
      lastSealMinute: 14 * 60,
      reopenCount: 1,
      reopenTotalSeconds: 300,
      quality: 'full',
    })
  })

  it('does not infer zero opens or seal timing from an empty daily event set', () => {
    const result = aggregateLimitEventDay({ code: '600103', date: '2026-08-28', events: [] })
    expect(result.reopenCount).toBeNull()
    expect(result.firstSealMinute).toBeNull()
    expect(result.quality).toBe('unavailable')
    expect(result.missingReasons.join('')).toContain('不能从日K推断')
  })
})
