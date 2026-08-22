// 日韩市场量化状态向量(阶段 3)。
//
// 东京与韩国市场正常开盘均对应北京时间 08:00;日本存在午休(11:30–12:30 北京),
// 韩国正常连续交易至北京时间 14:30 左右。本模块:
//   - 定义 AsiaMarketSnapshot 契约(供应商无关);
//   - 判定交易时段 / 节假日 / 午休 / 停牌 / 延迟状态;
//   - 只使用检查点前已到达数据,禁止把「没有数据」当中性;
//   - 日本与韩国分别建模,保存 08:00 跳空、08:30、09:00、09:14 路径分项特征;
//   - 数据降级显式进入质量状态,陈旧行情不冒充准时快照。
//
// 首期基础标的:日经225(N225)、TOPIX、KOSPI(KS11)、KOSDAQ。
// 禁止用单只股票临时涨跌替代国家/行业因子。

export type AsiaCheckpoint = 'asia-open' | 'asia-0830' | 'asia-0900' | 'pre-auction'
export type AsiaMarket = 'JP' | 'KR'
export type AsiaSessionStatus = 'open' | 'break' | 'closed' | 'holiday' | 'unknown'
export type AsiaMarketQuality = 'full' | 'degraded' | 'unavailable'

export interface AsiaInstrument {
  symbol: string
  market: AsiaMarket
  sessionStatus: AsiaSessionStatus
  previousClose: number | null
  price: number | null
  returnFromClose: number | null
  return5m: number | null
  return15m: number | null
  return30m: number | null
  realizedVolatility: number | null
}

export interface AsiaMarketSnapshot {
  tradeDate: string
  checkpoint: AsiaCheckpoint
  provider: string
  providerTimestamp: string
  receivedAt: string
  instruments: AsiaInstrument[]
  quality: AsiaMarketQuality
  warnings: string[]
}

export interface AsiaInstrumentInput {
  symbol: string
  market: AsiaMarket
  /** 北京时间 HH:MM:SS,空串表示无时戳 */
  timestamp?: string
  previousClose: number | null
  price: number | null
  /** 检查点时刻的盘中基点(每 5 分钟条) */
  bar: { time: string; price: number }[]
}

const JP_MORNING_OPEN = 8 * 60 // 08:00 北京 = 09:00 东京
const JP_MORNING_CLOSE = 10 * 60 + 30 // 10:30 北京 = 11:30 东京
const JP_AFTERNOON_OPEN = 11 * 60 + 30 // 11:30 北京 = 12:30 东京
const JP_CLOSE_MARKET = 14 * 60 // 14:00 北京 = 15:00 东京
const KR_MORNING_OPEN = 8 * 60 // 08:00 北京 = 09:00 首尔
const KR_CLOSE_MARKET = 14 * 60 + 30 // 14:30 北京 = 15:30 首尔

export function minuteOf(time: string): number | null {
  const match = time.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  return hh <= 23 && mm <= 59 ? hh * 60 + mm : null
}

/**
 * 判定日本 / 韩国指数在给定北京时间分钟下的交易时段。
 * 日本:08:00–10:30、11:30–14:00(北京);10:30–11:30 午休;其余收盘/未开。
 * 韩国:08:00–14:30(北京)连续;其余收盘/未开。
 * 节假日由调用方判定;未识别时返回 closed(非开市时段一律不假设开市)。
 */
export function asiaSessionStatus(
  market: AsiaMarket,
  minutes: number | null,
  holiday?: boolean,
): AsiaSessionStatus {
  if (holiday) return 'holiday'
  if (minutes == null) return 'unknown'
  if (market === 'JP') {
    if (minutes >= JP_MORNING_OPEN && minutes < JP_MORNING_CLOSE) return 'open'
    if (minutes >= JP_MORNING_CLOSE && minutes < JP_AFTERNOON_OPEN) return 'break'
    if (minutes >= JP_AFTERNOON_OPEN && minutes <= JP_CLOSE_MARKET) return 'open'
    return 'closed'
  }
  // KR
  if (minutes >= KR_MORNING_OPEN && minutes <= KR_CLOSE_MARKET) return 'open'
  return 'closed'
}

function clampPct(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100
}

function realizedVolatility(bars: Array<{ time: string; price: number }>): number | null {
  const prices = bars.map((bar) => bar.price).filter(Number.isFinite)
  if (prices.length < 5) return null
  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] <= 0) return null
    returns.push(Math.log(prices[i] / prices[i - 1]))
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length
  return Math.sqrt(variance) * Math.sqrt(365)
}

function intervalReturn(
  bars: Array<{ time: string; price: number }>,
  since: string,
): number | null {
  const span = bars.filter((bar) => bar.time >= since)
  const first = span[0]
  const last = span.at(-1)
  if (!first || !last || !span.length || first.price <= 0) return null
  return ((last.price - first.price) / first.price) * 100
}

function returnSince(bars: Array<{ time: string; price: number }>, minutesAgo: number): number | null {
  if (!bars.length) return null
  const latest = bars.at(-1)
  const latestMinute = minuteOf(latest?.time ?? '')
  if (latestMinute == null) return null
  const sinceMinute = latestMinute - minutesAgo
  if (sinceMinute < 0) return null
  const since = `00:${String(Math.floor(sinceMinute / 60)).padStart(2, '0')}:${String(sinceMinute % 60).padStart(2, '0')}`
  return intervalReturn(bars, since)
}

/**
 * 由输入构建单一标的状态。只使用提供的时戳与条;陈旧或缺失数据显式转 degraded,
 * 禁止空数组当中性。
 */
export function buildAsiaInstrument(
  input: AsiaInstrumentInput,
  opts: {
    checkpointMinute: number | null | undefined
    holiday?: boolean
  },
): AsiaInstrument {
  const timestamp = minuteOf(input.timestamp ?? '')
  const sessionStatus = asiaSessionStatus(input.market, timestamp, opts.holiday)
  const price = input.price
  const previousClose = input.previousClose
  const returnFromClose =
    price == null || previousClose == null || previousClose <= 0
      ? null
      : clampPct(((price - previousClose) / previousClose) * 100)
  return {
    symbol: input.symbol,
    market: input.market,
    sessionStatus,
    previousClose,
    price,
    returnFromClose,
    return5m: returnSince(input.bar, 5),
    return15m: returnSince(input.bar, 15),
    return30m: returnSince(input.bar, 30),
    realizedVolatility: realizedVolatility(input.bar),
  }
}

function asiaQuality(
  instruments: AsiaInstrument[],
  warnings: string[],
  checkpointMinute: number | null | undefined,
): AsiaMarketQuality {
  const usable = instruments.filter(
    (inst) => inst.price != null && (inst.sessionStatus === 'open' || inst.sessionStatus === 'break'),
  )
  if (!usable.length) return 'unavailable'
  const full = instruments.every(
    (inst) => inst.price != null && (inst.sessionStatus === 'open' || inst.sessionStatus === 'break'),
  )
  if (!full && warnings.some((warning) => warning.includes('陈旧'))) return 'degraded'
  return checkpointMinute == null ? 'degraded' : full ? 'full' : 'degraded'
}

/**
 * 构建日韩量化状态向量快照。
 * tradeDate 与 checkpoint 时点由调度器固化;只使用检查点前已到达数据。
 */
export function buildAsiaMarketSnapshot(args: {
  tradeDate: string
  checkpoint: AsiaCheckpoint
  provider: string
  providerTimestamp: string
  receivedAt: string
  instruments: AsiaInstrumentInput[]
  holidays?: Record<AsiaMarket, boolean>
  /** 北京时间分钟;null=无法判定检查点时点(降级) */
  checkpointMinute?: number | null
}): AsiaMarketSnapshot {
  const holidays = args.holidays ?? { JP: false, KR: false }
  const built = args.instruments.map((instrument) =>
    buildAsiaInstrument(instrument, {
      checkpointMinute: args.checkpointMinute,
      holiday: holidays[instrument.market],
    }),
  )
  const warnings: string[] = []
  const jp = built.filter((item) => item.market === 'JP')
  const kr = built.filter((item) => item.market === 'KR')
  if (jp.every((item) => item.price == null)) warnings.push('日本指数行情缺失')
  if (kr.every((item) => item.price == null)) warnings.push('韩国指数行情缺失')
  if (args.checkpointMinute == null) warnings.push('无法判定检查点时点，质量降级')
  if (jp.some((item) => item.sessionStatus === 'holiday')) warnings.push('日本市场节假日休市')
  if (kr.some((item) => item.sessionStatus === 'holiday')) warnings.push('韩国市场节假日休市')
  if (jp.some((item) => item.sessionStatus === 'break')) warnings.push('日本市场午休')
  return {
    tradeDate: args.tradeDate,
    checkpoint: args.checkpoint,
    provider: args.provider,
    providerTimestamp: args.providerTimestamp,
    receivedAt: args.receivedAt,
    instruments: built,
    quality: asiaQuality(built, warnings, args.checkpointMinute),
    warnings,
  }
}

/** 当前应固化的日韩检查点(按北京分钟)。 */
export function asiaCheckpointForMinute(minutes: number | null): AsiaCheckpoint | null {
  if (minutes == null) return null
  if (minutes >= 8 * 60 && minutes < 8 * 60 + 10) return 'asia-open'
  if (minutes >= 8 * 60 + 25 && minutes < 8 * 60 + 40) return 'asia-0830'
  if (minutes >= 8 * 60 + 55 && minutes < 9 * 60 + 10) return 'asia-0900'
  if (minutes >= 9 * 60 + 10 && minutes < 9 * 60 + 15) return 'pre-auction'
  return null
}