import { describe, it, expect, beforeEach } from 'vitest'
import { Tracer } from './tracer'

// Deterministic clock + id factory so timing/ids are assertable.
let clockVal = 0
let idCounter = 0
const makeTracer = (opts: { maxTraces?: number } = {}) =>
  new Tracer({
    now: () => clockVal,
    idFactory: () => `id${++idCounter}`,
    maxTraces: opts.maxTraces,
  })

beforeEach(() => {
  clockVal = 0
  idCounter = 0
})

describe('Tracer span timing', () => {
  it('computes span and trace durations from the clock', () => {
    const tracer = makeTracer()
    clockVal = 100
    const trace = tracer.startTrace('run')
    clockVal = 110
    const span = trace.startSpan('dense', 'retrieval')
    clockVal = 150
    span.end({ count: 3 })
    clockVal = 160
    trace.end()

    expect(trace.trace.spans[0].durationMs).toBe(40)
    expect(trace.trace.spans[0].attributes.count).toBe(3)
    expect(trace.trace.durationMs).toBe(60)
    expect(trace.trace.status).toBe('ok')
  })

  it('end is idempotent', () => {
    const tracer = makeTracer()
    const trace = tracer.startTrace('run')
    const span = trace.startSpan('x')
    clockVal = 5
    span.end()
    clockVal = 999
    span.end() // no-op
    expect(span.span.durationMs).toBe(5)
  })
})

describe('Tracer span nesting', () => {
  it('assigns parentId from the active span stack', () => {
    const tracer = makeTracer()
    const trace = tracer.startTrace('run')
    const a = trace.startSpan('a')
    const b = trace.startSpan('b')
    expect(b.span.parentId).toBe(a.span.id)
    b.end()
    const c = trace.startSpan('c')
    expect(c.span.parentId).toBe(a.span.id) // b popped, a is top again
    c.end()
    a.end()
    const d = trace.startSpan('d')
    expect(d.span.parentId).toBeUndefined() // stack empty after LIFO ends
  })

  it('withSpan records errors and rethrows', async () => {
    const tracer = makeTracer()
    const trace = tracer.startTrace('run')
    await expect(
      trace.withSpan('boom', 'custom', async () => {
        throw new Error('kaboom')
      }),
    ).rejects.toThrow('kaboom')
    const span = trace.trace.spans.find((s) => s.name === 'boom')!
    expect(span.status).toBe('error')
    expect(span.error).toBe('kaboom')
    trace.end()
    expect(trace.trace.status).toBe('error') // a failed span marks the trace failed
  })
})

describe('Tracer ring buffer', () => {
  it('evicts the oldest trace beyond maxTraces', () => {
    const tracer = makeTracer({ maxTraces: 2 })
    tracer.startTrace('t1').end()
    tracer.startTrace('t2').end()
    tracer.startTrace('t3').end()
    const recent = tracer.getRecentTraces(10)
    expect(recent.map((t) => t.name)).toEqual(['t3', 't2']) // newest first, t1 evicted
  })

  it('getTrace finds by id, returns undefined for misses', () => {
    const tracer = makeTracer()
    const trace = tracer.startTrace('run')
    trace.end()
    expect(tracer.getTrace(trace.id)?.name).toBe('run')
    expect(tracer.getTrace('nope')).toBeUndefined()
  })
})

describe('Tracer stats', () => {
  it('aggregates per-span latency and total tokens', () => {
    const tracer = makeTracer()
    const trace = tracer.startTrace('run')
    const dense = trace.startSpan('dense', 'retrieval')
    clockVal = 10
    dense.end({ totalTokens: 50 })
    const llm = trace.startSpan('llm', 'llm')
    clockVal = 30
    llm.end({ totalTokens: 100 })
    trace.end()

    const stats = tracer.getStats()
    expect(stats.traceCount).toBe(1)
    expect(stats.totalTokens).toBe(150)
    const denseStat = stats.spans.find((s) => s.name === 'dense')!
    expect(denseStat.avgMs).toBe(10)
    expect(denseStat.errorCount).toBe(0)
    const llmStat = stats.spans.find((s) => s.name === 'llm')!
    expect(llmStat.avgMs).toBe(20)
  })
})
