// 新高战法选股器 · 固定规则参数(单一可调来源)。
// 阈值为行业基线(Minervini 趋势模板 / VCP + O'Neil pivot),A股需用历史数据回测校准。
// 见 docs / 计划文件 agent-ui-jolly-clarke.md。

export const SCREENER = {
  // ── Stage 1: 全市场廉价初筛(clist 字段) ─────────────────────────
  /** 全市场选择器:深主板+创业板 + 沪主板+科创。天然不含北交所。 */
  CLIST_FS: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
  /** 今日成交额下限(元),剔除低流动。默认 0.8 亿。 */
  LIQUIDITY_MIN: 80_000_000,
  /** 总市值下限(元)。默认 20 亿。 */
  MCAP_MIN: 2_000_000_000,
  /** 60 日动量下限(%),只留强势。 */
  MOM60_MIN: 0,
  /** 入围 K 线精筛的最大只数(限流上限;超出会 log,不静默截断)。 */
  MAX_KLINE: 600,

  // ── Stage 2: K 线精筛 ────────────────────────────────────────────
  /** 取多少根日 K(需覆盖 MA250 + RS252 + 上行判定)。 */
  KLINE_COUNT: 300,
  MA_FAST: 20,
  MA_MID: 60,
  MA_SLOW: 120,
  MA_LONG: 250,
  /** MA_LONG 上行判定:与 N 根前比较。 */
  MA_LONG_RISE_LOOKBACK: 20,
  /** 距 52 周高:C ≥ HI52_NEAR × 52周高。 */
  HI52_NEAR: 0.85,
  /** 距 52 周低:C ≥ LO52_MULT × 52周低。 */
  LO52_MULT: 1.25,
  /** 阻力位回看窗口(根):用 52 周高作为"新高"突破位——新高战法买的是突破历史阻力,
   *  而非 60 日小高点(强势股早已越过 60 日高点,会导致扳机清单恒为空)。 */
  RESIST_LOOKBACK: 250,
  /** 「即将突破」:0 < 距阻力% ≤ NEAR_PCT。 */
  NEAR_PCT: 5,
  /** VCP 波动收缩:ATR(10)/ATR(50) < ATR_RATIO_MAX。 */
  ATR_FAST: 10,
  ATR_SLOW: 50,
  ATR_RATIO_MAX: 0.85,
  /** 量能未放大(尚未启动):volMA(5)/volMA(50) < VOL_DRY_MAX。 */
  VOL_FAST: 5,
  VOL_SLOW: 50,
  VOL_DRY_MAX: 0.9,
  /** 「今日已突破」放量确认:今日量 ≥ BREAKOUT_VOL × volMA(50)。 */
  BREAKOUT_VOL: 1.8,
  /** 不追高:突破日收盘 ≤ pivot × (1 + EXT_MAX/100)。过度延伸的剔除。 */
  EXT_MAX: 5,
  /** 突破日收盘需在当日振幅上 CLOSE_STRENGTH 比例以上。 */
  CLOSE_STRENGTH: 0.66,
  /** 止损封顶:距买价最多 STOP_MAX_PCT%。 */
  STOP_MAX_PCT: 8,
  /** 目标位至少 +TARGET_MIN_PCT%(无上方阻力时的测算下限)。 */
  TARGET_MIN_PCT: 10,

  // ── 取数限流 ─────────────────────────────────────────────────────
  CONCURRENCY: 12,

  // ── 评分权重 ─────────────────────────────────────────────────────
  WEIGHTS: { rs: 0.3, coil: 0.25, trend: 0.2, vol: 0.15, liq: 0.1 },
} as const
