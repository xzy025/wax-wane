// 选股快照的**数据契约**（公开侧）。
//
// 边界来源：公开仓库要在不安装私有战法包的前提下 build + 启动，所以公开侧必须
// 自己知道「快照长什么样」，才能采集、校验、落盘、回读、展示。这些类型原本散在
// 私有侧的 `screenerScan.ts` / `screener.ts`，但它们描述的是**数据结构**而不是
// 战法口径 —— 判定依据是「删掉所有阈值常量后，这些声明还剩不剩东西」，答案是有。
//
// 因此：
//   · 公开侧（本文件）：类型、字段守卫、数据质量门、快照文件的最小结构视图。
//   · 私有侧：`ScreenerResult` 是 `ScreenerSnapshot` 的**超集**（多出各战法候选数组），
//     由私有包定义并实现 `evaluateScreenerQuality` 之上的战法部分。
//
// 刻意**不**公开的东西：`ScreenerResult` 的候选数组元素类型（`*ScreenerCandidate`）。
// 那些类型带战法字段（买点/止损/目标位/评分），属于私有层。公开侧一律按 `unknown[]`
// 处理 —— 公开侧的职责是搬运与展示，不是解释候选内容。

/** 扫描模式：盘中（临时）或盘后（定盘）。 */
export type ScreenerScanMode = 'intraday' | 'close'

/** 信号状态：盘中=provisional，盘后=confirmed。 */
export type ScreenerSignalState = 'provisional' | 'confirmed'

/**
 * 实时报价。免费公开源（东财/新浪/腾讯）统一成这个形状。
 * 这是采集层的产物，与战法无关 —— 天梯、竞价、快照都吃它。
 */
export interface ScreenerLiveQuote {
  code: string
  name: string
  tradeDate: string
  quoteTime: string
  capturedAt: string
  source: 'eastmoney' | 'sina' | 'tencent'
  price: number
  changePct: number
  open: number
  high: number
  low: number
  prevClose: number
  volume: number // 手，与日K口径一致
  amount: number // 元
  volumeRatio?: number
  turnoverRate?: number
  /** 集合竞价指示价；来源不提供或语义无法验证时保持 null。 */
  indicativePrice?: number | null
  /** 集合竞价累计撮合额；当前免费源通常与 amount 同口径。 */
  matchedAmount?: number | null
  bid1Price?: number | null
  bid1Volume?: number | null // 股
  ask1Price?: number | null
  ask1Volume?: number | null // 股
  /** 集合竞价买二/卖二量；用于解码未匹配方向，缺失时保持 null。 */
  bid2Volume?: number | null
  ask2Volume?: number | null
  /** 集合竞价虚拟未匹配方向（买二/卖二量解出；语义不明或连续竞价时为 null）。 */
  unmatchedSide?: 'buy' | 'sell' | 'balanced' | null
  unmatchedAmount?: number | null
  /** 观测到的市场阶段；仅集合竞价窗口（09:15–09:25）内可验证。 */
  marketPhase?: 'auction-cancellable' | 'auction-locked' | 'continuous' | null
  /** 数据来源信任等级：免费公开源固定为 shadow，不进入正式候选升级或历史基线。 */
  sourceTier?: 'shadow' | 'authorized'
  /** 由旧错误语义（bid1-ask1 金额差当未匹配量）派生、尚未验证的字段名。 */
  legacyUnverified?: string[]
}

/** 盘中由报价投影出的合成日线 bar（量按已过交易时间外推）。 */
export interface IntradayBar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  turnover: number
  amplitude: number
  changePct: number
  rawVolume: number
  volumeProjected: true
}

/** 数据质量门的结果。**这是数据侧口径，不是战法口径** —— 判的是行情覆盖率与跨源一致率。 */
export interface ScreenerDataQuality {
  passed: boolean
  sources: string[]
  universeCoverage: number
  quoteCoverage: number
  historyCoverage: number
  crossSourceAgreement: number
  freshQuoteCoverage: number
  warnings: string[]
}

export interface ScreenerQualityInput {
  sources: string[]
  universeCoverage: number
  quoteCoverage: number
  historyCoverage: number
  crossSourceAgreement: number
  freshQuoteCoverage: number
}

/**
 * 快照文件的结构化最小视图。
 *
 * 私有侧的 `ScreenerResult` 是它的超集（多出 breakout/trigger/... 等候选数组），
 * 因此 `ScreenerResult` 可直接赋给本类型。反方向不成立 —— 公开侧读快照时不知道
 * 候选内容，也不需要知道。
 */
export interface ScreenerSnapshot {
  /** 扫描所属日 YYYY-MM-DD。 */
  asof: string
  /** 成功取到的日 K 最后日期众数；旧快照缺失时前端回退 asof。 */
  marketDataAsOf?: string
  /** 最后日 K 等于 marketDataAsOf 的成功取数占比(0~1)。 */
  marketDataCoverage?: number
  /** 行情滞后/混杂，结果仅供参考且禁止落盘。 */
  marketDataDegraded?: boolean
  /** 本次扫描完成时刻(ISO)。 */
  scannedAt?: string
  scanMode?: ScreenerScanMode
  signalState?: ScreenerSignalState
  dataQuality?: ScreenerDataQuality
  /** 大盘环境（内容属私有层，公开侧按不透明对象搬运）。 */
  regime?: unknown
  scanned?: number
  universe?: number
  truncated?: boolean
  /** 取K线成功数(覆盖率证据)。 */
  fetched?: number
  /** 落盘时刻(ISO)。 */
  savedAt?: string
  /** 扫描发生在收盘后(盘后快照)。 */
  closed?: boolean
}

/** 数据质量门。阈值是行情覆盖口径（数据侧），不是买卖门槛。 */
export function evaluateScreenerQuality(input: ScreenerQualityInput): ScreenerDataQuality {
  const warnings: string[] = []
  if (input.universeCoverage < 0.97) warnings.push(`股票池覆盖 ${(input.universeCoverage * 100).toFixed(1)}% < 97%`)
  if (input.quoteCoverage < 0.98) warnings.push(`有效报价覆盖 ${(input.quoteCoverage * 100).toFixed(1)}% < 98%`)
  if (input.freshQuoteCoverage < 0.98) warnings.push(`当日新鲜报价覆盖 ${(input.freshQuoteCoverage * 100).toFixed(1)}% < 98%`)
  if (input.historyCoverage < 0.95) warnings.push(`历史K线覆盖 ${(input.historyCoverage * 100).toFixed(1)}% < 95%`)
  if (input.crossSourceAgreement < 0.95) warnings.push(`跨源一致率 ${(input.crossSourceAgreement * 100).toFixed(1)}% < 95%`)
  return { ...input, passed: warnings.length === 0, warnings }
}
