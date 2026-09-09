/**
 * Shared vocabulary for market-data availability.  A numeric zero is an
 * observation; unknown data is represented by null together with one of these
 * diagnostics instead of being silently normalised to zero.
 */
export type DataStatus = 'full' | 'degraded' | 'partial' | 'empty' | 'stale' | 'unavailable'

export interface SourceDiagnostic {
  /** Provider or derivation that produced (or failed to produce) the value. */
  source: string
  status: DataStatus
  /** Provider timestamp when the upstream exposes one. */
  providerAt: string | null
  /** Time this application received the observation. */
  receivedAt: string | null
  /** Market/session date the observation describes. */
  asOf: string | null
  /** True only when this is a last-known-good observation. */
  stale: boolean
  warnings: string[]
  missingReasons: string[]
}

/** A diagnostic for one independently fetched component of a larger response. */
export interface DataComponentQuality extends SourceDiagnostic {
  component: string
  /** The value is calculated from source data rather than quoted directly. */
  derived?: boolean
}

/**
 * Reusable response shape for endpoints whose whole payload can be unavailable.
 * PointInTimeEvidence remains the source of truth for payload hashes and
 * adjustment metadata; this envelope intentionally does not duplicate them.
 */
export interface DataEnvelope<T> extends SourceDiagnostic {
  data: T | null
  components?: Record<string, DataComponentQuality>
  /** Optional v1 fields; legacy envelopes remain source-compatible. */
  datasetId?: string
  schemaVersion?: string
  coverage?: number | null
  rawHash?: string | null
  fallbackChain?: string[]
  license?: 'public' | 'authorized' | 'unknown'
  credentialMode?: 'anonymous' | 'configured' | 'unknown'
}

export interface DiagnosticInput {
  source: string
  status: DataStatus
  providerAt?: string | null
  receivedAt?: string | null
  asOf?: string | null
  stale?: boolean
  warnings?: readonly string[]
  missingReasons?: readonly string[]
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

export function createSourceDiagnostic(input: DiagnosticInput): SourceDiagnostic {
  return {
    source: input.source,
    status: input.status,
    providerAt: input.providerAt ?? null,
    receivedAt: input.receivedAt ?? null,
    asOf: input.asOf ?? null,
    stale: input.stale ?? input.status === 'stale',
    warnings: unique(input.warnings),
    missingReasons: unique(input.missingReasons),
  }
}

export function createComponentQuality(
  component: string,
  input: DiagnosticInput & { derived?: boolean },
): DataComponentQuality {
  return {
    component,
    ...createSourceDiagnostic(input),
    ...(input.derived ? { derived: true } : {}),
  }
}

export function unavailableComponent(
  component: string,
  source: string,
  reason: string,
  meta: Omit<DiagnosticInput, 'source' | 'status' | 'missingReasons'> = {},
): DataComponentQuality {
  return createComponentQuality(component, {
    ...meta,
    source,
    status: 'unavailable',
    missingReasons: [reason],
    warnings: [...(meta.warnings ?? []), reason],
  })
}

export function envelopeStatus(components: Iterable<Pick<SourceDiagnostic, 'status'>>): DataStatus {
  const statuses = [...components].map((component) => component.status)
  if (statuses.length === 0 || statuses.every((status) => status === 'unavailable')) return 'unavailable'
  if (statuses.some((status) => status === 'stale')) return 'stale'
  if (statuses.every((status) => status === 'empty' || status === 'unavailable')) return 'empty'
  if (statuses.some((status) => status === 'unavailable' || status === 'degraded' || status === 'partial' || status === 'empty')) return 'degraded'
  return 'full'
}
