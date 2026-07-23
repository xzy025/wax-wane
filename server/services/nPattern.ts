// N字运动分析(《N字运动1-4》挥手看天空)· 纯函数,零 IO,可单测。
// 【管理视图·非战法·不进回测】:把日 K 分解为之字波段(zigzag),对进行中的调整段做三维研判——
//   角度:活动段与前段的速度比(%/日,替代依赖图表比例的"角度",见 vol4 江恩四方形讨论)
//   时间:6-8 小波段变盘窗 / 23-25 中期窗 / 持股黄金法则连涨 6-8 天
//   异动:当跌不跌·转强 / 当涨不涨·转弱 / V形反转(阳包阴纠错) / 加速异动(级别扩大)
// 书中定性未定量的阈值(强弱比/横盘带宽等)取工程默认,全部收敛在 config NZI,来源见 docs/n 讲解档。
import { NZI, type NPatternConfig } from '../config/screener'
import { type Bar, atr, r2 } from './screenerRules'

export type NRole = 'F' | 'H'
export type NStrength = 'strong' | 'sym' | 'weak'
export type NGrade = 'A' | 'B' | 'C'

export interface NLeg {
  dir: 'up' | 'down'
  /** 段起止(交易日根数;活动段为已走根数)。 */
  days: number
  fromDate: string
  toDate: string
  fromPrice: number
  toPrice: number
  /** 段涨跌幅%(带符号)。 */
  pct: number
  /** 速度 = |pct| / days(%/日)——"角度"的坐标无关替身。 */
  speed: number
}

export interface NAnomaly {
  type: '抗跌转强' | '滞涨转弱' | 'V形反转' | '加速异动' | '反弹力竭'
  note: string
}

export interface NPatternResult {
  /** 最近完成的波段(旧→新,含活动段,≤MAX_LEGS)。 */
  legs: NLeg[]
  /** 进行中活动段(最后一个 pivot → 最新收盘)。 */
  active: NLeg
  /** 活动段角色:F=反弹(前段跌后升),H=回挡(前段升后跌)。 */
  role: NRole
  /** 结构强弱(持有者视角):F 段快=strong;H 段慢=strong(强势回挡=缓角度,vol3 口径)。 */
  strength: NStrength | null
  /** 活动段速度 / 前段速度。 */
  speedRatio: number | null
  /** 结构分级(F=反弹质量,A级≈近垂直强反弹;H=回挡质量)。 */
  grade: NGrade | null
  /** 活动段当前处于的变盘时间窗(书:小波段/平台 6-8,调整段延伸 11-13,中期 23-25)。 */
  inWindow: '6-8' | '11-13' | '23-25' | null
  /** 持股黄金法则:连续上升 ≥6 天短线风险。 */
  holdRisk: boolean
  /** N字延续确认:F 段已越过前一同向枢轴高点。 */
  nBreak: boolean
  /** 对称投射目标 = 回调低点 + 前升段幅度(仅 F 段且存在完整 N 结构)。 */
  nTarget: number | null
  anomaly: NAnomaly | null
  /** 压缩中文一句话(叙事/前端 title 用)。 */
  note: string
}

interface Pivot {
  idx: number
  kind: 'H' | 'L'
  price: number
}

/** 展示标签:强弱×角色 → 书中六类命名(强势反弹/对称回挡…);strength 缺失退化为 反弹/回挡。 */
export function nStrengthLabel(role: NRole, strength: NStrength | null): string {
  const roleTxt = role === 'F' ? '反弹' : '回挡'
  if (strength === null) return roleTxt
  return strength === 'strong' ? `强势${roleTxt}` : strength === 'weak' ? `弱势${roleTxt}` : `对称${roleTxt}`
}

/**
 * 在线 zigzag(只用截至当根的信息确认枢轴,零前视):高低点折返 ≥ thrPct% 翻转。
 */
export function zigzagPivots(bars: Bar[], thrPct: number): Pivot[] {
  const pivots: Pivot[] = []
  if (bars.length < 2 || thrPct <= 0) return pivots
  const thr = thrPct / 100
  let dir: 0 | 1 | -1 = 0
  let hi = bars[0].high
  let hiIdx = 0
  let lo = bars[0].low
  let loIdx = 0
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]
    if (dir >= 0 && b.high > hi) {
      hi = b.high
      hiIdx = i
    }
    if (dir <= 0 && b.low < lo) {
      lo = b.low
      loIdx = i
    }
    if (dir >= 0 && hi > 0 && b.low <= hi * (1 - thr)) {
      pivots.push({ idx: hiIdx, kind: 'H', price: hi })
      dir = -1
      lo = b.low
      loIdx = i
    } else if (dir <= 0 && lo > 0 && b.high >= lo * (1 + thr)) {
      pivots.push({ idx: loIdx, kind: 'L', price: lo })
      dir = 1
      hi = b.high
      hiIdx = i
    }
  }
  return pivots
}

const mkLeg = (bars: Bar[], fromIdx: number, toIdx: number, fromPrice: number, toPrice: number): NLeg => {
  const days = Math.max(1, toIdx - fromIdx)
  const pct = fromPrice > 0 ? (toPrice / fromPrice - 1) * 100 : 0
  return {
    dir: pct >= 0 ? 'up' : 'down',
    days,
    fromDate: bars[fromIdx].date,
    toDate: bars[toIdx].date,
    fromPrice: r2(fromPrice),
    toPrice: r2(toPrice),
    pct: r2(pct),
    speed: r2(Math.abs(pct) / days),
  }
}

/** 连续收涨天数(截至最后一根)。 */
const consecUpDays = (bars: Bar[]): number => {
  let n = 0
  for (let i = bars.length - 1; i > 0 && bars[i].close > bars[i - 1].close; i--) n++
  return n
}

/**
 * N字运动结构化分析。数据不足(取不出 ≥1 个完成段 + 活动段)→ null,调用方整块不渲染。
 * 只读信号日及之前 K 线,零前视。
 */
export function analyzeNPattern(bars: Bar[], C: NPatternConfig = NZI): NPatternResult | null {
  const n = bars.length
  if (n < 20) return null
  const last = n - 1
  const today = bars[last]
  if (!(today.close > 0)) return null

  // 折返阈值:固定 5% 与 2×ATR% 取大(高波动票自适应放宽,防碎段)。
  const atrPct = today.close > 0 ? (atr(bars, 14, last) / today.close) * 100 : 0
  const thrPct = Math.max(C.SWING_PCT, C.ATR_MULT * atrPct)
  const pivots = zigzagPivots(bars, thrPct)
  if (pivots.length < 2) return null

  // 活动段 = 最后枢轴 → 今收;枢轴恰在今日(折返当根确认)时退一个枢轴,保证活动段非退化。
  let usable = pivots
  if (pivots[pivots.length - 1].idx >= last) usable = pivots.slice(0, -1)
  if (usable.length < 2) return null
  const lastPivot = usable[usable.length - 1]

  const legs: NLeg[] = []
  for (let i = 1; i < usable.length; i++) {
    legs.push(mkLeg(bars, usable[i - 1].idx, usable[i].idx, usable[i - 1].price, usable[i].price))
  }
  const active = mkLeg(bars, lastPivot.idx, last, lastPivot.price, today.close)
  const prev = legs[legs.length - 1] // 活动段的前段(必存在)
  const role: NRole = lastPivot.kind === 'L' ? 'F' : 'H'

  // ── 角度(速度比)──
  const speedRatio = prev.speed > 0 ? r2(active.speed / prev.speed) : null
  let strength: NStrength | null = null
  let grade: NGrade | null = null
  if (speedRatio !== null) {
    if (role === 'F') {
      strength = speedRatio >= C.STRONG_RATIO ? 'strong' : speedRatio <= C.WEAK_RATIO ? 'weak' : 'sym'
      grade = speedRatio >= C.GRADE_A ? 'A' : speedRatio >= C.GRADE_B ? 'B' : 'C'
    } else {
      // 回挡:缓=强势回挡(vol3),急坠(比前升段还快)=危险结构(vol2 失败举例)
      strength = speedRatio <= C.WEAK_RATIO ? 'strong' : speedRatio >= C.STRONG_RATIO ? 'weak' : 'sym'
      const inv = active.speed > 0 ? prev.speed / active.speed : Infinity
      grade = inv >= C.GRADE_A ? 'A' : inv >= C.GRADE_B ? 'B' : 'C'
    }
  }

  // ── 时间 ──
  const inWindow =
    active.days >= C.TIME_LO && active.days <= C.TIME_HI
      ? ('6-8' as const)
      : active.days >= C.EXT_LO && active.days <= C.EXT_HI
        ? ('11-13' as const)
        : active.days >= C.MID_LO && active.days <= C.MID_HI
          ? ('23-25' as const)
          : null
  const holdRisk = consecUpDays(bars) >= C.HOLD_RISK_DAYS

  // ── N字延续与对称投射 ──
  const prevSameDirPivot = usable.length >= 3 ? usable[usable.length - 3] : null
  const nBreak = role === 'F' && prevSameDirPivot !== null && today.close > prevSameDirPivot.price
  let nTarget: number | null = null
  if (role === 'F' && legs.length >= 2) {
    const impulse = legs[legs.length - 2]
    // 完整 N:升(impulse)→ 回挡(prev)未破升段起点 → 活动反弹段
    if (impulse.dir === 'up' && prev.dir === 'down' && lastPivot.price > impulse.fromPrice) {
      nTarget = r2(lastPivot.price * (1 + Math.abs(impulse.pct) / 100))
    }
  }

  // ── 异动(优先级:V反 > 加速 > 抗跌 > 滞涨)──
  const anomaly = detectAnomaly(bars, { role, strength, active, prev, legs, lastPivot, atrPct }, C)

  // ── note ──
  const parts = [
    `${nStrengthLabel(role, strength)}第${active.days}天${inWindow ? `(${inWindow}窗)` : ''}`,
    ...(grade ? [`${grade}级`] : []),
    ...(nBreak ? ['N字延续'] : []),
    ...(anomaly ? [`⚡${anomaly.type}`] : []),
    ...(holdRisk ? ['连涨6+天短线风险'] : []),
  ]

  return {
    legs: [...legs, active].slice(-C.MAX_LEGS),
    active,
    role,
    strength,
    speedRatio,
    grade,
    inWindow,
    holdRisk,
    nBreak,
    nTarget,
    anomaly,
    note: parts.join('·'),
  }
}

interface AnomalyCtx {
  role: NRole
  strength: NStrength | null
  active: NLeg
  prev: NLeg
  legs: NLeg[]
  lastPivot: Pivot
  atrPct: number
}

function detectAnomaly(bars: Bar[], ctx: AnomalyCtx, C: NPatternConfig): NAnomaly | null {
  const { role, strength, active, prev, legs, lastPivot, atrPct } = ctx
  const last = bars.length - 1
  const today = bars[last]
  const yst = bars[last - 1]

  // ① V形反转(vol2 纠错模式二):反弹初段速度即大于前跌段 + 阳包阴。
  if (role === 'F' && active.days <= 2 && prev.dir === 'down') {
    const engulf = today.close > today.open && yst.close < yst.open && today.close > yst.open && today.open < yst.close
    if (engulf && prev.speed > 0 && active.speed > prev.speed) {
      return { type: 'V形反转', note: '反转段速度大于前跌段·阳包阴纠错(利润最大段的跟随信号)' }
    }
  }

  // ② 加速异动(vol2 纠错模式一/vol3 涨后加速级别扩大):活动段速度 ≥2× 前同向段均速。
  if (active.days >= 2) {
    const sameDir = legs.filter((l) => l.dir === active.dir).slice(-2)
    if (sameDir.length > 0) {
      const meanSpeed = sameDir.reduce((s, l) => s + l.speed, 0) / sameDir.length
      if (meanSpeed > 0 && active.speed >= C.ACCEL_MULT * meanSpeed) {
        return { type: '加速异动', note: `${active.dir === 'up' ? '涨' : '跌'}后加速·级别扩大(速度${r2(active.speed)}%/日≥${C.ACCEL_MULT}×前均速)` }
      }
    }
  }

  // 横盘观察窗(书:抗跌/抗涨约维持3个周期):近 STALL_BARS 根净变动在 ±带宽内。
  // 极值对照取 stall 窗之前的活动段高低点(拿收盘/枢轴比会被当日影线打穿,判"未创新高/低"必须 bar 级)。
  const s0 = bars[last - C.STALL_BARS]
  if (!s0 || s0.close <= 0) return null
  const netPct = (today.close / s0.close - 1) * 100
  const band = C.STALL_ATR_MULT * atrPct
  const stallStart = last - C.STALL_BARS + 1
  const stallLows = bars.slice(stallStart).map((b) => b.low)
  const stallHighs = bars.slice(stallStart).map((b) => b.high)
  const preStall = bars.slice(lastPivot.idx, stallStart)
  const preLow = preStall.length ? Math.min(...preStall.map((b) => b.low)) : NaN
  const preHigh = preStall.length ? Math.max(...preStall.map((b) => b.high)) : NaN

  // ③ 抗跌转强(当跌不跌,vol3/4):弱势结构把"该跌"的时间窗走完(弱反弹拖过 11-13 延伸窗 /
  //    急坠回挡 6 天后)仍横盘/上抬且不创新低 → 转强。时间口径:6-8 窗内先按皮球见顶法检验(④),
  //    拖过 EXT_LO 仍不跌才算抗跌异动,两者不重叠。
  //    急坠判定用回挡段"跌落相"速度(枢轴→段内最低点),整段均速会被横盘尾巴稀释。
  let steepFallH = false
  if (role === 'H' && Number.isFinite(preLow) && prev.speed > 0 && lastPivot.price > 0) {
    let lowIdx = lastPivot.idx
    let lowV = Infinity
    for (let i = lastPivot.idx + 1; i < stallStart; i++) {
      if (bars[i].low < lowV) {
        lowV = bars[i].low
        lowIdx = i
      }
    }
    const fallDays = Math.max(1, lowIdx - lastPivot.idx)
    const fallSpeed = (Math.abs(lowV / lastPivot.price - 1) * 100) / fallDays
    steepFallH = fallSpeed >= C.STRONG_RATIO * prev.speed
  }
  const shouldFall =
    (role === 'F' && strength === 'weak' && active.days >= C.EXT_LO) ||
    (role === 'H' && steepFallH && active.days >= C.TIME_LO)
  if (
    shouldFall &&
    netPct >= -band &&
    Math.min(...stallLows) >= (role === 'H' ? preLow : lastPivot.price)
  ) {
    return { type: '抗跌转强', note: '当跌不跌·横盘抗跌(不跌反强,留意新行情在约3个周期内展开)' }
  }

  // ④ 反弹力竭(vol4 皮球见顶法:"4天下跌2元,6-8天反弹没有超过这2元,就要见顶了"):
  //    非强势反弹在 6-8 窗内时间已超过前跌段而幅度未收复前跌幅 → 转弱。
  if (
    role === 'F' &&
    prev.dir === 'down' &&
    strength !== 'strong' &&
    active.days >= C.TIME_LO &&
    active.days < C.EXT_LO &&
    active.days >= prev.days &&
    Math.abs(active.pct) < Math.abs(prev.pct)
  ) {
    return {
      type: '反弹力竭',
      note: `前跌${prev.days}天${r2(Math.abs(prev.pct))}%,反弹${active.days}天仅${r2(Math.abs(active.pct))}%·时间超越未过价(皮球见顶法)`,
    }
  }

  // ⑤ 滞涨转弱(当涨不涨):强势位置到时间窗后滞涨不创新高(F=强反弹后滞涨;H=强势回挡拖过窗口该涨不涨)。
  const shouldRise =
    (role === 'F' && strength === 'strong' && active.days >= C.TIME_LO) ||
    (role === 'H' && strength === 'strong' && active.days > C.TIME_HI)
  if (shouldRise && netPct <= band && Number.isFinite(preHigh) && Math.max(...stallHighs) <= preHigh) {
    return { type: '滞涨转弱', note: '当涨不涨·滞涨(应涨未涨,留意转弱)' }
  }

  return null
}
