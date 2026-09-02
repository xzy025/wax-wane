import type { LimitEventRecord, LimitEventType } from './limitEventStore'

/**
 * A backfill row is deliberately event-shaped.  Daily OHLCV is not accepted
 * here because it cannot establish first touch, first seal, reopen, or queue
 * timing without inventing microstructure facts.
 */
export interface LimitEventBackfillObservation {
  date: string
  eventType: LimitEventType
  eventAt?: string | null
  price?: number | null
  amount?: number | null
  sealAmount?: number | null
  providerAt?: string | null
  receivedAt?: string | null
  sourceRef?: string | null
  missingReasons?: string[]
}

export interface LimitEventBackfillInput {
  code: string
  provider: string
  observations: readonly LimitEventBackfillObservation[]
}

export type LimitEventBackfillRow = Omit<LimitEventRecord, 'eventId'>

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * Convert explicit minute/L1 event observations into append-only store rows.
 * Invalid rows are skipped and never replaced with a guessed daily-K event.
 */
export function backfillLimitEvents(args: LimitEventBackfillInput): LimitEventBackfillRow[] {
  return args.observations
    .filter((observation) => validDate(observation.date) && observation.eventType)
    .map((observation) => ({
      code: args.code,
      date: observation.date,
      eventType: observation.eventType,
      eventAt: observation.eventAt ?? null,
      price: observation.price ?? null,
      amount: observation.amount ?? null,
      sealAmount: observation.sealAmount ?? null,
      provider: args.provider,
      providerAt: observation.providerAt ?? null,
      receivedAt: observation.receivedAt ?? null,
      sourceRef: observation.sourceRef ?? null,
      missingReasons: Array.from(new Set(observation.missingReasons ?? [])),
    }))
}

