import { describe, expect, it } from 'vitest'
import {
  asiaCheckpointForMinute,
  asiaSessionStatus,
  buildAsiaInstrument,
  buildAsiaMarketSnapshot,
  minuteOf,
  type AsiaCheckpoint,
} from './asiaMarketState'

describe('asia market trading sessions (Beijing time)', () => {
  it('classifies JP sessions including the lunch break', () => {
    expect(asiaSessionStatus('JP', minuteOf('08:00'))).toBe('open')
    expect(asiaSessionStatus('JP', minuteOf('10:00'))).toBe('open')
    expect(asiaSessionStatus('JP', minuteOf('10:30'))).toBe('break')
    expect(asiaSessionStatus('JP', minuteOf('11:00'))).toBe('break')
    expect(asiaSessionStatus('JP', minuteOf('11:30'))).toBe('open')
    expect(asiaSessionStatus('JP', minuteOf('13:59'))).toBe('open')
    expect(asiaSessionStatus('JP', minuteOf('14:01'))).toBe('closed')
    expect(asiaSessionStatus('JP', minuteOf('07:59'))).toBe('closed')
  })

  it('classifies KR sessions as continuous without lunch break', () => {
    expect(asiaSessionStatus('KR', minuteOf('08:00'))).toBe('open')
    expect(asiaSessionStatus('KR', minuteOf('11:00'))).toBe('open')
    expect(asiaSessionStatus('KR', minuteOf('14:30'))).toBe('open')
    expect(asiaSessionStatus('KR', minuteOf('14:31'))).toBe('closed')
    expect(asiaSessionStatus('KR', minuteOf('07:59'))).toBe('closed')
  })

  it('treats holidays and unknown times explicitly', () => {
    expect(asiaSessionStatus('JP', minuteOf('10:00'), true)).toBe('holiday')
    expect(asiaSessionStatus('KR', minuteOf('10:00'), true)).toBe('holiday')
    expect(asiaSessionStatus('JP', null)).toBe('unknown')
    expect(asiaSessionStatus('KR', minuteOf('bad'))).toBe('unknown')
  })
})

describe('asia market state vectors', () => {
  const instrumentInput = (over: Partial<Parameters<typeof buildAsiaInstrument>[0]> = {}) => ({
    symbol: 'N225',
    market: 'JP' as const,
    timestamp: '08:00:05',
    previousClose: 40000,
    price: 40300,
    bar: Array.from({ length: 8 }, (_, index) => ({
      time: `08:00:${String(index * 5).padStart(2, '0')}`,
      price: 40000 + index * 37.5,
    })),
    ...over,
  })

  it('builds a full-quality snapshot with segmented returns', () => {
    const snapshot = buildAsiaMarketSnapshot({
      tradeDate: '2026-08-21',
      checkpoint: 'asia-open',
      provider: 'eastmoney-asia',
      providerTimestamp: '08:00:05',
      receivedAt: '2026-08-21T00:00:05.000Z',
      instruments: [instrumentInput()],
      checkpointMinute: minuteOf('08:00'),
    })
    expect(snapshot.quality).toBe('full')
    expect(snapshot.instruments[0].sessionStatus).toBe('open')
    expect(snapshot.instruments[0].returnFromClose).toBeCloseTo(0.75, 2)
    expect(snapshot.instruments[0].return5m).not.toBeNull()
    expect(snapshot.instruments[0].return15m).not.toBeNull()
    expect(snapshot.instruments[0].return30m).not.toBeNull()
    expect(snapshot.instruments[0].realizedVolatility).not.toBeNull()
  })

  it('returns unavailable when no instrument has a price', () => {
    const snapshot = buildAsiaMarketSnapshot({
      tradeDate: '2026-08-21',
      checkpoint: 'asia-open',
      provider: 'eastmoney-asia',
      providerTimestamp: '08:00:05',
      receivedAt: '2026-08-21T00:00:05.000Z',
      instruments: [
        instrumentInput({ price: null, previousClose: 40000, bar: [] }),
      ],
      checkpointMinute: minuteOf('08:00'),
    })
    expect(snapshot.quality).toBe('unavailable')
    expect(snapshot.warnings.join(' ')).toContain('日本指数行情缺失')
  })

  it('flags a holiday break as degraded and warns per market', () => {
    const snapshot = buildAsiaMarketSnapshot({
      tradeDate: '2026-08-21',
      checkpoint: 'asia-open',
      provider: 'eastmoney-asia',
      providerTimestamp: '08:00:05',
      receivedAt: '2026-08-21T00:00:05.000Z',
      instruments: [instrumentInput()],
      checkpointMinute: minuteOf('08:00'),
      holidays: { JP: true, KR: false },
    })
    expect(snapshot.instruments[0].sessionStatus).toBe('holiday')
    expect(snapshot.quality).toBe('unavailable')
    expect(snapshot.warnings.some((warning) => warning.includes('日本市场节假日'))).toBe(true)
  })

  it('forms distinct JP and KR instruments without compressing into a single number', () => {
    const snapshot = buildAsiaMarketSnapshot({
      tradeDate: '2026-08-21',
      checkpoint: 'asia-0900',
      provider: 'eastmoney-asia',
      providerTimestamp: '09:00:00',
      receivedAt: '2026-08-21T01:00:00.000Z',
      instruments: [
        instrumentInput({ symbol: 'N225', market: 'JP' }),
        instrumentInput({ symbol: 'KS11', market: 'KR', timestamp: '09:00:00' }),
      ],
      checkpointMinute: minuteOf('09:00'),
    })
    expect(snapshot.instruments).toHaveLength(2)
    expect(snapshot.instruments.some((row) => row.market === 'JP')).toBe(true)
    expect(snapshot.instruments.some((row) => row.market === 'KR')).toBe(true)
  })
})

describe('asia checkpoint mapping', () => {
  it('maps Beijing minutes to the four checkpoints', () => {
    const cases: Array<[string, AsiaCheckpoint]> = [
      ['08:00', 'asia-open'],
      ['08:05', 'asia-open'],
      ['08:30', 'asia-0830'],
      ['09:00', 'asia-0900'],
      ['09:14', 'pre-auction'],
    ]
    for (const [time, expected] of cases) {
      expect(asiaCheckpointForMinute(minuteOf(time))).toBe(expected)
    }
    expect(asiaCheckpointForMinute(null)).toBeNull()
    expect(asiaCheckpointForMinute(minuteOf('10:00'))).toBeNull()
  })
})