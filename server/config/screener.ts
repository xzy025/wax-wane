// 新高战法选股器 · 固定规则参数(单一可调来源)。
// 阈值起于行业基线(Minervini 趋势模板 / VCP + O'Neil pivot),已用 393 只 A 股、
// 2023-07~2026-06 日线做走查式回测校准(见 docs/screener/backtest-*.json)。
// 校准结论(2026-06-22):CLOSE_STRENGTH 0.66→0.75、STOP_MAX_PCT 8→7 —— 两者增益可叠加,
// 把 breakout 组合期望从 0.10R 提到 0.15R、盈亏因子 1.34→1.57、最大回撤 11.4R→9.4R,
// 仍保留充足候选;HI52_NEAR 对 breakout 无效(趋势模板已强制),RESIST_LOOKBACK=250 优于 120/180。
// 回测脚本:server/backtest/backtestScreener.ts(npm --prefix server run backtest)。

/** 选股器可调参数的结构(回测可注入覆盖版做参数扫描)。 */
export interface ScreenerConfig {
  CLIST_FS: string
  LIQUIDITY_MIN: number
  MCAP_MIN: number
  MOM60_MIN: number
  MAX_KLINE: number
  KLINE_COUNT: number
  MA_FAST: number
  MA_MID: number
  MA_SLOW: number
  MA_LONG: number
  MA_LONG_RISE_LOOKBACK: number
  HI52_NEAR: number
  LO52_MULT: number
  RESIST_LOOKBACK: number
  BASE_LOOKBACK: number
  NEAR_PCT: number
  ATR_FAST: number
  ATR_SLOW: number
  ATR_RATIO_MAX: number
  VOL_FAST: number
  VOL_SLOW: number
  VOL_DRY_MAX: number
  BREAKOUT_VOL: number
  EXT_MAX: number
  CLOSE_STRENGTH: number
  STOP_MAX_PCT: number
  TARGET_MIN_PCT: number
  TARGET_MODE: 'resistance' | 'rmult' | 'measured' | 'atr'
  TARGET_R_MULT: number
  TARGET_ATR_MULT: number
  TARGET_R_DYNAMIC: boolean
  TARGET_R_BY_REGIME: { strong: number; neutral: number; weak: number }
  MARKET_INDEX_SECID: string
  MARKET_MA_FAST: number
  MARKET_MA_SLOW: number
  CONCURRENCY: number
  WEIGHTS: { rs: number; coil: number; trend: number; vol: number; liq: number; lhb?: number; board?: number }
  // ── 龙虎榜 / 板块轮动 加分因子(回测校准,可置 0 关闭)──
  /** 龙虎榜加分回看窗口(交易日):信号日前 K 日机构/资金净买埋伏。 */
  LHB_LOOKBACK_K: number
  /** 龙虎榜加分是否取机构专用席位净买(否=全口径净买,省一半请求)。 */
  LHB_INSTITUTIONAL: boolean
  /** 板块强弱加分的长/短窗(交易日)。 */
  BOARD_LONG_WIN: number
  BOARD_SHORT_WIN: number
}

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
  /** measured 目标位的基底窗口(根):target = pivot + (pivot − 近 BASE_LOOKBACK 根最低)。 */
  BASE_LOOKBACK: 40,
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
  /** 突破日收盘需在当日振幅上 CLOSE_STRENGTH 比例以上。
   *  回测校准:0.66→0.75 显著提升期望/盈亏因子(滤掉收盘乏力的假突破),候选量仍充足。 */
  CLOSE_STRENGTH: 0.75,
  /** 止损封顶:距买价最多 STOP_MAX_PCT%。
   *  回测校准:8→7 收紧止损,盈亏比 0.49→0.54、期望略升、最大回撤下降,胜率仅微降。 */
  STOP_MAX_PCT: 7,
  /** 目标位下限地板 +TARGET_MIN_PCT%(仅 resistance/measured/atr 模式;rmult 不套地板)。 */
  TARGET_MIN_PCT: 10,
  /** 目标位算法:'resistance'=pivot 上方最近历史高点(原始,payoff≈0.5 偏小);
   *  'rmult'=进场 + R_MULT×风险(直接定 R:R,修复 payoff<1);
   *  'measured'=pivot + 基底高度(测量幅度上投);'atr'=进场 + k×ATR(ATR_SLOW)。
   *  回测校准(2026-06-22,见 docs/screener/backtest-*.json):resistance 的 payoff≈0.58、靠 73%
   *  高胜率撑期望(脆);改 rmult 后 payoff 抬到 2.4、期望 0.15R→0.39R、PF 1.57→1.66
   *  (代价:胜率降到~41%、单笔波动变大,但按期望归一的回撤反而更优)。 */
  TARGET_MODE: 'rmult',
  /** rmult 模式的盈亏目标倍数(target 距进场 = R_MULT × 止损距离)。
   *  回测:2.0(PF1.58/回撤最低) ~ 3.0(payoff2.6) 均可,2.5 为 PF 最优折中。 */
  TARGET_R_MULT: 2.5,
  /** atr 模式的 ATR 倍数。 */
  TARGET_ATR_MULT: 5,
  /** 动态目标位:按大盘趋势(指数代理)分环境调 R 倍数。回测验证后开启。 */
  TARGET_R_DYNAMIC: true,
  /** 各大盘环境对应的目标 R 倍数。**逆向**(2026-06 回测发现):大盘弱时仍创新高=真·相对强度龙头,
   *  跑得更远→给更远目标(3.5R);大盘强时人人破位、假突破多→收近(2.0R)。
   *  沪深300 上 期望 0.39R→0.45R、PF 1.66→1.78、最大回撤 18.2R→14.1R(三项全胜)。 */
  TARGET_R_BY_REGIME: { strong: 2.0, neutral: 3.0, weak: 3.5 },
  /** 大盘温度代理指数(完整 secid):沪深300=1.000300 / 创业板指=0.399006 / 中证全指=1.000985。 */
  MARKET_INDEX_SECID: '1.000300',
  /** 大盘趋势判定的均线窗口(收盘 vs MA_FAST/MA_SLOW)。 */
  MARKET_MA_FAST: 20,
  MARKET_MA_SLOW: 50,

  // ── 取数限流 ─────────────────────────────────────────────────────
  CONCURRENCY: 12,

  // ── 评分权重 ─────────────────────────────────────────────────────
  // lhb(龙虎榜机构净买)/ board(板块短期强弱)为外部加分因子;finalScore 按权重和归一,
  // 故新增二者不改变其余因子的相对比例,置 0 即完全关闭。
  // 回测校准(COMBO,393只/2023-07~2026-06):**lhb 已验证强**——突破日前5日有龙虎榜净买入的票
  // 期望 0.58~0.97R(机构) / 0.66R(全口径) vs 未上榜 0.35R、基线 0.39R,故给 0.15。
  // **board 待验证**:90.BK 板块日线接口当前对本机限流(无 Sina 兜底)→ 回测样本=0,暂给小权重 0.05
  // (取不到板块数据时本因子自动中性,不伤分);接口恢复后重跑 COMBO 校准。
  WEIGHTS: { rs: 0.3, coil: 0.25, trend: 0.2, vol: 0.15, liq: 0.1, lhb: 0.15, board: 0.05 },

  // ── 龙虎榜 / 板块轮动 加分因子 ────────────────────────────────────
  LHB_LOOKBACK_K: 5,
  LHB_INSTITUTIONAL: true,
  BOARD_LONG_WIN: 60,
  BOARD_SHORT_WIN: 5,
} as const satisfies ScreenerConfig

// ════════════════════════════════════════════════════════════════════════
// 回调二次启动 / 圆弧底反包 战法(与新高战法并列的另一类形态)。
// 抓「曾经的领涨龙头 → 深度回调(斐波带) → 圆弧底 → 均线即将金叉 → 异常放量二次启动」。
// 现有趋势模板 `距52周高≤15%` 会把回调票一票否决,故需独立规则。阈值初值待回测校准。
// ════════════════════════════════════════════════════════════════════════
export interface PullbackConfig {
  KLINE_COUNT: number
  MA_LONG: number
  MA_LONG_RISE_LOOKBACK: number
  /** 52 周高/低回看窗口(根)。 */
  PRIOR_HIGH_LOOKBACK: number
  /** 近高点必须落在最近 N 根内(当下龙头,非远古高点)。 */
  RECENT_HIGH_MAX: number
  /** ① 龙头门槛:近高 / 52周低 ≥ 该比(曾翻倍级)。 */
  LEADER_HILO_MIN: number
  /** ① 要求 C > MA_LONG(回调发生在长期上行中,不是崩塌)。 */
  REQUIRE_ABOVE_MA_LONG: boolean
  /** ② 斐波回调深度带:depth=(近高−回调低)/近高 ∈ [MIN,MAX](覆盖 0.382/0.5/0.618)。 */
  RETRACE_MIN: number
  RETRACE_MAX: number
  /** ② 尚未收复:C ≤ 近高×(1−该值),避免追在已回到高位的票。 */
  STILL_BELOW_MIN: number
  /** ③ 调整时间下限(交易日):距近高 ≥ 该值(过滤一日插针)。 */
  CORRECTION_MIN_DAYS: number
  /** ④ 圆弧底:最低点落在 [MIN,MAX] 根前(已确立、开始回弧,但不太陈旧)。 */
  ARC_LOW_MIN_AGO: number
  ARC_LOW_MAX_AGO: number
  /** ④ 自低点回升 ∈ [MIN,MAX](回升太少未启动、太多已错过)。 */
  ARC_RECOVER_MIN: number
  ARC_RECOVER_MAX: number
  /** ④ 收复短均:C ≥ MA(FAST)(价格站回 MA5=转向确认;深跌票上 MA5≥MA10 会严重滞后于放量,故不作硬门槛)。 */
  MA_TURN_FAST: number
  /** ⑤ 均线即将/已金叉 —— **仅评分**(深跌后 MA10 远低于 MA20,硬卡会让本战法对暴跌龙头永不触发)。
   *  MA(X) ≥ MA(Y) 或 距 MA(Y) ≤ CROSS_NEAR 越贴近评分越高。 */
  MA_X: number
  MA_Y: number
  CROSS_NEAR: number
  /** ⑥ 异常放量启动:当日量 ≥ VOL_SPIKE × volMA(VOL_MA) 且收阳。=触发/买点。
   *  回测定论:1.5× 最优(0.21R/PF1.69);2.5× 反转负(巨量=高潮脉冲不跟随)。 */
  VOL_MA: number
  VOL_SPIKE: number
  /** 线上初筛:量比(clist f10)下限。回调票 mom60 常为负会被动量初筛截断,改按"当日放量"
   *  (量比)排序捞"今日二次启动"候选,与本战法触发对齐。仅线上扫描用,不影响回测/纯函数。 */
  PB_VR_MIN: number
  /** 目标位:'measured'=测量到近高(二次启动天然目标);'rmult'=进场+R×风险。 */
  TARGET_MODE: 'measured' | 'rmult'
  TARGET_R_MULT: number
  /** 结构化止损=圆弧底低点;>0 时额外封顶距进场该%(0=不封顶,纯结构)。 */
  STOP_MAX_PCT: number
  /** 评分权重(按权重和归一)。 */
  WEIGHTS: { fib: number; arc: number; cross: number; vol: number; rs: number }
}

export const PULLBACK = {
  KLINE_COUNT: 300,
  MA_LONG: 250,
  MA_LONG_RISE_LOOKBACK: 20,
  PRIOR_HIGH_LOOKBACK: 250,
  RECENT_HIGH_MAX: 120,
  LEADER_HILO_MIN: 1.8,
  REQUIRE_ABOVE_MA_LONG: true,
  RETRACE_MIN: 0.3,
  RETRACE_MAX: 0.65,
  STILL_BELOW_MIN: 0.08,
  CORRECTION_MIN_DAYS: 15,
  ARC_LOW_MIN_AGO: 2,
  ARC_LOW_MAX_AGO: 30,
  ARC_RECOVER_MIN: 0.05,
  ARC_RECOVER_MAX: 0.4,
  MA_TURN_FAST: 5,
  MA_X: 10,
  MA_Y: 20,
  CROSS_NEAR: 0.03,
  VOL_MA: 20,
  VOL_SPIKE: 1.5,
  PB_VR_MIN: 1.3,
  TARGET_MODE: 'rmult',
  TARGET_R_MULT: 2.5,
  STOP_MAX_PCT: 0,
  WEIGHTS: { fib: 0.25, arc: 0.25, cross: 0.2, vol: 0.2, rs: 0.1 },
} as const satisfies PullbackConfig
