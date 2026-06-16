// Lightweight tracing for the RAG / agent pipeline.
//
// AI systems are probabilistic and multi-step: a single query fans out into
// embedding → vector search → BM25 → fusion → (rerank) → generation, any of
// which can silently degrade. "It ran" is not "it worked". This tracer captures
// per-step spans with timing, status, and attributes (result counts, token
// usage) so we can answer "why did this query get bad results / get slow / cost
// so much" after the fact — the observability half of LLMOps.
//
// The span/trace model deliberately mirrors OpenTelemetry / LangSmith concepts
// (trace = a run, spans = nested operations with kind + attributes), so traces
// could be exported to a real backend later. For now they live in an in-memory
// ring buffer (last N) with optional JSONL persistence.

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type SpanKind =
  | 'retrieval'
  | 'embedding'
  | 'lexical'
  | 'fusion'
  | 'rerank'
  | 'llm'
  | 'tool'
  | 'db'
  | 'http'
  | 'custom'

export type SpanStatus = 'ok' | 'error'

export interface Span {
  id: string
  traceId: string
  parentId?: string
  name: string
  kind: SpanKind
  startMs: number
  endMs?: number
  durationMs?: number
  status: SpanStatus
  attributes: Record<string, unknown>
  error?: string
}

export interface Trace {
  id: string
  name: string
  startMs: number
  endMs?: number
  durationMs?: number
  status: SpanStatus
  attributes: Record<string, unknown>
  spans: Span[]
}

export interface TracerOptions {
  /** Max completed traces kept in memory. Default 100. */
  maxTraces?: number
  /** Injectable monotonic clock (ms). Default Date.now. Tests pass a fake. */
  now?: () => number
  /** Injectable id factory. Default crypto.randomUUID. Tests pass a counter. */
  idFactory?: () => string
  /** If set, completed traces are appended as JSONL to `${persistDir}/traces.jsonl`. */
  persistDir?: string
}

// ── Active (in-flight) handles ─────────────────────────────

export class ActiveSpan {
  constructor(
    readonly span: Span,
    private readonly trace: ActiveTrace,
  ) {}

  setAttributes(attrs: Record<string, unknown>): this {
    Object.assign(this.span.attributes, attrs)
    return this
  }

  end(attrs?: Record<string, unknown>, status: SpanStatus = 'ok'): void {
    if (this.span.endMs !== undefined) return // idempotent
    if (attrs) Object.assign(this.span.attributes, attrs)
    this.span.endMs = this.trace.clock()
    this.span.durationMs = this.span.endMs - this.span.startMs
    this.span.status = status
    this.trace.popSpan(this.span.id)
  }

  fail(error: unknown, attrs?: Record<string, unknown>): void {
    this.span.error = error instanceof Error ? error.message : String(error)
    this.end(attrs, 'error')
  }
}

export class ActiveTrace {
  readonly trace: Trace
  private readonly stack: string[] = [] // span id stack for parent nesting

  constructor(
    trace: Trace,
    readonly clock: () => number,
    private readonly idFactory: () => string,
    private readonly onEnd: (t: Trace) => void,
  ) {
    this.trace = trace
  }

  get id(): string {
    return this.trace.id
  }

  startSpan(name: string, kind: SpanKind = 'custom', attributes: Record<string, unknown> = {}): ActiveSpan {
    const span: Span = {
      id: this.idFactory(),
      traceId: this.trace.id,
      parentId: this.stack[this.stack.length - 1],
      name,
      kind,
      startMs: this.clock(),
      status: 'ok',
      attributes,
    }
    this.trace.spans.push(span)
    this.stack.push(span.id)
    return new ActiveSpan(span, this)
  }

  /** Run `fn` inside a span: auto-ends on success, records error + rethrows on failure. */
  async withSpan<T>(
    name: string,
    kind: SpanKind,
    fn: (span: ActiveSpan) => Promise<T> | T,
    attributes: Record<string, unknown> = {},
  ): Promise<T> {
    const span = this.startSpan(name, kind, attributes)
    try {
      const result = await fn(span)
      span.end()
      return result
    } catch (err) {
      span.fail(err)
      throw err
    }
  }

  setAttributes(attrs: Record<string, unknown>): this {
    Object.assign(this.trace.attributes, attrs)
    return this
  }

  /** Internal: pop a finished span off the parent stack (handles out-of-order ends). */
  popSpan(spanId: string): void {
    const idx = this.stack.lastIndexOf(spanId)
    if (idx !== -1) this.stack.splice(idx, 1)
  }

  end(attrs?: Record<string, unknown>): Trace {
    if (this.trace.endMs !== undefined) return this.trace // idempotent
    if (attrs) Object.assign(this.trace.attributes, attrs)
    this.trace.endMs = this.clock()
    this.trace.durationMs = this.trace.endMs - this.trace.startMs
    this.trace.status = this.trace.spans.some((s) => s.status === 'error') ? 'error' : 'ok'
    this.onEnd(this.trace)
    return this.trace
  }
}

// ── Stats ──────────────────────────────────────────────────

export interface SpanStat {
  name: string
  kind: SpanKind
  count: number
  errorCount: number
  avgMs: number
  p50Ms: number
  p95Ms: number
}

export interface TracerStats {
  traceCount: number
  errorTraceCount: number
  avgTraceMs: number
  totalTokens: number
  spans: SpanStat[]
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

// ── Tracer ─────────────────────────────────────────────────

export class Tracer {
  private readonly maxTraces: number
  private readonly clock: () => number
  private readonly idFactory: () => string
  private readonly persistDir?: string
  private readonly traces: Trace[] = [] // newest last

  constructor(options: TracerOptions = {}) {
    this.maxTraces = options.maxTraces ?? 100
    this.clock = options.now ?? Date.now
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID())
    this.persistDir = options.persistDir
  }

  startTrace(name: string, attributes: Record<string, unknown> = {}): ActiveTrace {
    const trace: Trace = {
      id: this.idFactory(),
      name,
      startMs: this.clock(),
      status: 'ok',
      attributes,
      spans: [],
    }
    return new ActiveTrace(trace, this.clock, this.idFactory, (t) => this.record(t))
  }

  private record(trace: Trace): void {
    this.traces.push(trace)
    while (this.traces.length > this.maxTraces) this.traces.shift()
    this.persist(trace)
  }

  private persist(trace: Trace): void {
    if (!this.persistDir) return
    try {
      mkdirSync(this.persistDir, { recursive: true })
      appendFileSync(join(this.persistDir, 'traces.jsonl'), JSON.stringify(trace) + '\n')
    } catch {
      // Persistence is best-effort; never let it break a request.
    }
  }

  /** Most recent traces, newest first. */
  getRecentTraces(limit = 20): Trace[] {
    return this.traces.slice(-limit).reverse()
  }

  getTrace(id: string): Trace | undefined {
    return this.traces.find((t) => t.id === id)
  }

  clear(): void {
    this.traces.length = 0
  }

  /** Aggregate latency/error/token stats across retained traces. */
  getStats(): TracerStats {
    const byName = new Map<string, { kind: SpanKind; durations: number[]; errors: number }>()
    let totalTokens = 0
    let errorTraceCount = 0
    let traceDurationSum = 0

    for (const trace of this.traces) {
      if (trace.status === 'error') errorTraceCount++
      traceDurationSum += trace.durationMs ?? 0
      for (const span of trace.spans) {
        const key = `${span.kind}:${span.name}`
        const bucket = byName.get(key) ?? { kind: span.kind, durations: [], errors: 0 }
        if (span.durationMs !== undefined) bucket.durations.push(span.durationMs)
        if (span.status === 'error') bucket.errors++
        byName.set(key, bucket)
        const tokens = span.attributes.totalTokens
        if (typeof tokens === 'number') totalTokens += tokens
      }
    }

    const spans: SpanStat[] = [...byName.entries()].map(([key, b]) => {
      const sorted = [...b.durations].sort((x, y) => x - y)
      const sum = sorted.reduce((a, c) => a + c, 0)
      return {
        name: key.slice(key.indexOf(':') + 1),
        kind: b.kind,
        count: b.durations.length || b.errors,
        errorCount: b.errors,
        avgMs: sorted.length ? Math.round((sum / sorted.length) * 100) / 100 : 0,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
      }
    })

    return {
      traceCount: this.traces.length,
      errorTraceCount,
      avgTraceMs: this.traces.length ? Math.round((traceDurationSum / this.traces.length) * 100) / 100 : 0,
      totalTokens,
      spans,
    }
  }
}

// ── App-wide singleton ─────────────────────────────────────
// Persists to disk only when OBS_TRACE_DIR is set (off by default).

export const tracer = new Tracer({
  maxTraces: parseInt(process.env.OBS_MAX_TRACES ?? '100', 10),
  persistDir: process.env.OBS_TRACE_DIR || undefined,
})
