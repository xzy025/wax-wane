/**
 * Retry policy for the post-market archive pipeline.
 *
 * The policy is deliberately date-scoped: retries belong to the requested
 * Shanghai trading date and never silently roll over to a newer date.
 */

export const SETTLEMENT_ARCHIVE_START_MINUTES = 15 * 60 + 10
export const SETTLEMENT_ARCHIVE_DEADLINE_MINUTES = 23 * 60 + 30

/**
 * Backoff after each failed job attempt. Transport retries stay in emFetch or
 * the provider adapter; these delays are for the whole archive job only.
 */
export const SETTLEMENT_ARCHIVE_RETRY_DELAYS_MS = [
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  20 * 60_000,
  30 * 60_000,
  60 * 60_000,
] as const

/** Maximum time allowed for one bounded pipeline attempt. */
export const SETTLEMENT_ARCHIVE_ATTEMPT_TIMEOUT_MS = 3 * 60_000

/** Maximum time allowed for one independent pipeline step. */
export const SETTLEMENT_ARCHIVE_STEP_TIMEOUT_MS = 90_000

export function settlementDeadlineAt(tradeDate: string): number {
  return Date.parse(`${tradeDate}T23:30:00+08:00`)
}

export function settlementRetryDelayMs(attempt: number): number {
  const index = Math.max(0, Math.trunc(attempt) - 1)
  return SETTLEMENT_ARCHIVE_RETRY_DELAYS_MS[
    Math.min(index, SETTLEMENT_ARCHIVE_RETRY_DELAYS_MS.length - 1)
  ]
}

/**
 * Returns null when another attempt would start at or after the same-day
 * deadline. `attempt` is one-based and denotes the attempt that just failed.
 */
export function settlementNextRetryAt(
  tradeDate: string,
  attempt: number,
  nowMs: number,
): number | null {
  const next = nowMs + settlementRetryDelayMs(attempt)
  const deadline = settlementDeadlineAt(tradeDate)
  return Number.isFinite(deadline) && next < deadline ? next : null
}

