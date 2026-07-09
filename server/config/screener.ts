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
  CHINEXT_INDEX_SECID: string
  STAR50_INDEX_SECID: string
  MARKET_MA_FAST: number
  MARKET_MA_SLOW: number
  CONCURRENCY: number
  WEIGHTS: { rs: number; coil: number; trend: number; vol: number; liq: number; lhb?: number; board?: number; ta?: number }
  // ── 龙虎榜 / 板块轮动 加分因子(回测校准,可置 0 关闭)──
  /** 龙虎榜加分回看窗口(交易日):信号日前 K 日机构/资金净买埋伏。 */
  LHB_LOOKBACK_K: number
  /** 龙虎榜加分是否取机构专用席位净买(否=全口径净买,省一半请求)。 */
  LHB_INSTITUTIONAL: boolean
  /** 板块强弱加分的长/短窗(交易日)。 */
  BOARD_LONG_WIN: number
  BOARD_SHORT_WIN: number
  // ── 加仓参考 + 临界观察组 ──
  /** 加仓参考短均线窗口(5=回踩5日线)。 */
  ADD_MA: number
  /** 金字塔加仓 R 倍数:突破组加仓点 = 介入 + ADD_R_MULT×风险(默认 +1R,高于介入)。 */
  ADD_R_MULT: number
  /** 浮盈达此 R 数时止损上移保本(展示提示 + 回测撮合)。 */
  BREAKEVEN_AT_R: number
  /** 跟踪止损均线窗口(+2R 后跌破此均线离场)。 */
  TRAIL_MA: number
  /** 扳机组试探仓结构止损:max(MA20, close×(1−此%/100)),盘整区故更紧。 */
  STARTER_STOP_PCT: number
  /** 临界观察组开关(突破/扳机近失的「放量逼近·待确认」票)。 */
  WATCH_ENABLE: boolean
  /** 突破近失容差:已站上前高但 breakoutVolRatio ≥ BREAKOUT_VOL − 此值 即收入临界观察。 */
  WATCH_VOL_MARGIN: number
  /** 放量逼近带:距前高 ≤ NEAR_PCT + 此值(逼近前高)。 */
  WATCH_NEAR_EXTRA: number
  /** 放量逼近需真·放量(volMA5/50 ≥ 此值),滤掉只是"不缩量"的普通趋势票。 */
  WATCH_VOL_HOT: number
  /** 临界观察组展示上限(按评分截断,避免空档票过多刷屏)。 */
  WATCH_MAX: number
  // ── 相对大盘强度(RS)──
  /** 本次扫描的大盘(沪深300)当日涨跌幅%,由 fetchScreenerFresh 注入(回测逐日注入);未注入=0。 */
  MARKET_CHG_PCT?: number
  /** 相对强度参数:CRASH_DAY_PCT=大盘当日涨跌幅 ≤ 此值算「明显下跌日」(逆势强判据);
   *  COUNTER_BOOST=逆势强候选的展示评分加成倍数(仅影响监控/临界观察的排序与截断,非买点门槛)。 */
  RELSTR: { CRASH_DAY_PCT: number; COUNTER_BOOST: number }
  /** Part B:突破组收强门槛「相对大盘自适应」开关——暴跌日逆势红盘+站上MA5 视同收强达标。
   *  默认 false(行为不变),仅回测过线后才置 true 接 live。 */
  RS_ADAPTIVE_CLOSE: boolean
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
   *  沪深300 上 期望 0.39R→0.45R、PF 1.66→1.78、最大回撤 18.2R→14.1R(三项全胜)。
   *
   *  REGIMEBUCKET 复裁记录(2026-07-04,REGIMEBUCKET=1,突破族4战法 pooled n=1027,判据预写于
   *  backtestScreener.runRegimeBucket 注释):**不上环境闸门**——四个候选闸门(指数MA弱/宽度弱/
   *  中性×横盘/弱∨横盘)的被拦桶期望全为正(0.09~0.16R),判据①(拦截桶≤−0.10R)不满足;最优 G4
   *  也只 Δ+0.04R 且砍掉 33% 交易。实盘 2026-06-22~07-03(caution)全灭不能归因于这些可回测口径,
   *  继续在实盘战绩 regime 切片攒证据。⚠ 顺带发现:pooled 口径下 idxMA weak 桶(0.09R)是三桶最弱,
   *  与本注释"弱市新高最强"(breakout-only/close<MA50/n≈46)口径不同、不构成翻案,但提示该逆向映射
   *  的证据偏薄,后续可用 REGIME=1 段复验。 */
  TARGET_R_BY_REGIME: { strong: 2.0, neutral: 3.0, weak: 3.5 },
  /** 大盘温度代理指数(完整 secid):沪深300=1.000300 / 创业板指=0.399006 / 中证全指=1.000985。 */
  MARKET_INDEX_SECID: '1.000300',
  /** 双创专属基准:300/301 开头(创业板)用创业板指、688 开头(科创板)用科创50,其余仍用沪深300。
   *  仅供「相对大盘强度」(逆势强)因子动态选基准;不影响 MARKET_INDEX_SECID(大盘温度/regime/targetRMult
   *  仍锚沪深300,其余战法回测基线按此校准,不动)。 */
  CHINEXT_INDEX_SECID: '0.399006', // 创业板指(与 ashare.ts INDEX_SECIDS 一致)
  STAR50_INDEX_SECID: '1.000688', // 科创50(上交所,secid 前缀 1)
  /** 大盘趋势判定的均线窗口(收盘 vs MA_FAST/MA_SLOW)。 */
  MARKET_MA_FAST: 20,
  MARKET_MA_SLOW: 50,

  // ── 取数限流 ─────────────────────────────────────────────────────
  CONCURRENCY: 12,

  // ── 评分权重 ─────────────────────────────────────────────────────
  // lhb(龙虎榜机构净买)/ board(板块短期强弱)为外部加分因子;finalScore 按权重和归一,
  // 故新增二者不改变其余因子的相对比例,置 0 即完全关闭。
  // **lhb 复裁翻案(2026-07-04,修正 COMBO 窗口前视后重跑;旧证据作废)**:旧结论"lhb 已验证强
  // (0.58~0.97R机构/0.66R全口径)"的窗口含信号日当天——龙虎榜盘后才公布,信号日收盘入场时不可见,
  // 属前视。修正窗口为信号日**前** 5 日后(backtest/calendar.ts):
  //   · 全口径净买>0:0.66R → **0.03R(n25)≈基线 0.08R,增益=前视伪影,edge 不存在**;
  //   · 机构多日:n=0(原 0.97R/n9 基本靠信号日当天的榜,修正后整桶消失);
  //   · 机构净买(≥1日):**0.71R/PF2.32/胜率50% 幸存且更强,但 n=14/覆盖率仅 6%**(样本瘦,
  //     不满足 n≥30 完全保留线;方向另有实盘战绩切片佐证——lhb=inst 是 breakout 唯一接近打平的桶)。
  //   → 权重 0.15 降 0.05(方向存活给小权重,样本攒厚后可复议);"真edge在LHB机构净买"的旧表述
  //     修正为"机构净买或有真edge(样本瘦),全口径净买无edge"。UI 另设「机构确认」展示子层(不动分数)。
  // **board 待验证**:90.BK 板块日线接口当前对本机限流(无 Sina 兜底)→ 回测样本=0,暂给小权重 0.05
  // (取不到板块数据时本因子自动中性,不伤分);接口恢复后重跑 COMBO 校准。
  // ta(技术分析组合:Wyckoff+道氏+AlBrooks 量价,见 services/technicalScore)外部加分因子。
  // 回测校准(TA=1,293只,pooled breakout/highdiv/volbreak 成交按信号日 TA bias 分桶):**单调成立**——
  //   需求 demand 0.20R/PF1.30/n421 > 中性 neutral 0.11R/PF1.16/n186 > 供给 supply −0.94R/0%胜率/n5。
  //   demand vs neutral 差 +0.09R(样本足,可靠);distribution=是 −0.94R(n5,现有战法收强过滤已挡掉大部分,
  //   但一旦混入即灾难)→ 故 distribution 降档+⚠ 作安全栏。据此 ta=0.1(0 时 finalScore 等价旧版)。
  WEIGHTS: { rs: 0.3, coil: 0.25, trend: 0.2, vol: 0.15, liq: 0.1, lhb: 0.05, board: 0.05, ta: 0.1 },

  // ── 龙虎榜 / 板块轮动 加分因子 ────────────────────────────────────
  LHB_LOOKBACK_K: 5,
  LHB_INSTITUTIONAL: true,
  BOARD_LONG_WIN: 60,
  BOARD_SHORT_WIN: 5,

  // ── 加仓参考 + 临界观察组(「放量逼近」空档:趋势完美但两组都未收的临门一脚票)──
  /** 加仓点参考短均线:5 日线(MA5,仅作参考量,不再作为推荐加仓点)。 */
  ADD_MA: 5,
  /** 金字塔顺势加:浮盈 +1R 再加,加仓点高于介入——只给走出来的赢家加注,契合 33%胜率/2.22盈亏比系统。 */
  ADD_R_MULT: 1.0,
  /** +1R 移保本、+2R 跌破 MA(TRAIL_MA) 跟踪。管理规则,卡片以提示呈现、回测撮合验证。 */
  BREAKEVEN_AT_R: 1,
  TRAIL_MA: 10,
  /** 扳机组试探仓止损:max(MA20, close×0.95)。未突破的盘整区,结构天然紧。 */
  STARTER_STOP_PCT: 5,
  WATCH_ENABLE: true,
  /** 已突破但放量差一丝(如晶方 1.80× vs 1.8×):breakoutVolRatio ≥ 1.8 − 0.25 = 1.55× 即收。 */
  WATCH_VOL_MARGIN: 0.25,
  /** 放量逼近(如大族 距前高 2.6%):距前高 ≤ 5 + 2 = 7%。 */
  WATCH_NEAR_EXTRA: 2,
  /** 真·放量门槛:volMA5/50 ≥ 1.2(大族 1.83 过;只是"不缩量"的普通趋势票 0.9~1.2 被排除)。 */
  WATCH_VOL_HOT: 1.2,
  /** 临界观察至多展示 40 只(按评分),空档票天然多,截断避免刷屏。 */
  WATCH_MAX: 40,
  // ── 相对大盘强度(RS)──
  /** 大盘当日涨跌幅(扫描时注入,默认未注入=0)。 */
  MARKET_CHG_PCT: 0,
  /** CRASH_DAY_PCT=−1.5:大盘当日 ≤ −1.5% 算「明显下跌日」,逆势收红=逆势强;COUNTER_BOOST=1.15 展示加分。 */
  RELSTR: { CRASH_DAY_PCT: -1.5, COUNTER_BOOST: 1.15 },
  /** Part B 自适应收强开关:**回测裁决=未过线,保持 false**。RS=1 回测(293只/2023-07~2026-06):
   *  baseline 0.08R/PF1.11/回撤14.78R → adaptive 0.04R/PF1.05/回撤18.21R(全面劣化);
   *  逆势新增子样本(暴跌日弱收盘突破升入,n=10)**期望 −0.63R、止损率 90%**——长上影逆势红盘本质是
   *  冲高回落/出货,作"买点"是灾难。结论:逆势红盘是【抗跌的相对强度观察】(已做成 A 因子/监控),
   *  **不是买入信号**;故 live 突破组门槛不动。逻辑+回测保留(env RS=1)供未来不同口径再探。 */
  RS_ADAPTIVE_CLOSE: false,
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

// ════════════════════════════════════════════════════════════════════════
// 打板情绪·连板分歧低吸 战法(第四类形态,见 services/divergenceRules.ts)。
// 抓「连板/连续新高 → 分歧日(触板未封/高振幅砸盘) → 没崩(收盘站当日均价=弱转强)」的低吸点。
// 两组:① lianban 连板分歧(连板后首日分歧) ② pullback2 回调二波分歧(二次启动途中分歧确认)。
// ⚠ 超短(T+1)赔率游戏,阈值初值待回测校准;主力净流入暂缺,用 连板+分歧+VWAP+量价 近似。
// ════════════════════════════════════════════════════════════════════════
export interface DivergenceConfig {
  KLINE_COUNT: number
  /** 判定所需最少 K 线根数(连板回看 + 二波回看)。 */
  MIN_BARS: number
  /** ① 连板分歧:今日之前的连板数下限(2=2连板后首日分歧)。 */
  MIN_BOARDS: number
  /** 分歧日振幅下限(%):未封板但振幅≥此值=多空分歧(触板未封也单独算分歧)。 */
  AMP_DIVERGE: number
  /** 没崩:收盘较当日最高回撤上限(%)。超过=尾盘跳水视为崩。 */
  COLLAPSE_MAX: number
  /** 没崩:当日跌幅下限保护(%),今日跌超此值视为走弱不取。 */
  DOWN_MAX: number
  /** 量比近似的均量窗口(交易日,不含今日)。 */
  VOL_MA: number
  /** 尾盘低吸区下沿:均价×(1−此%/100)。 */
  BUY_BAND: number
  /** 止损:昨收×(1−此%/100)下方(破位走人)。 */
  STOP_BELOW: number
  /** 换手率风险线(%):超过提示"换手过大抛压重"(有 turnoverRate 时)。 */
  TURNOVER_HOT: number
  /** ② 回调二波:二次启动涨停须落在最近 N 根内。 */
  PB2_LOOKBACK: number
  /** ② 回调二波:启动前需有过回调(距 PB2_HIGH_LOOKBACK 根高点回撤≥此比)。 */
  PB2_RETRACE: number
  PB2_HIGH_LOOKBACK: number
  /** 评分权重(按权重和归一)。 */
  WEIGHTS: { w2s: number; nocollapse: number; boards: number; vol: number }
}

export const DIVERGENCE = {
  KLINE_COUNT: 120,
  MIN_BARS: 70,
  MIN_BOARDS: 2,
  AMP_DIVERGE: 8,
  COLLAPSE_MAX: 6,
  DOWN_MAX: 6,
  VOL_MA: 5,
  BUY_BAND: 1.5,
  STOP_BELOW: 3,
  TURNOVER_HOT: 25,
  PB2_LOOKBACK: 10,
  PB2_RETRACE: 0.15,
  PB2_HIGH_LOOKBACK: 60,
  WEIGHTS: { w2s: 0.4, nocollapse: 0.25, boards: 0.2, vol: 0.15 },
} as const satisfies DivergenceConfig

// 连续新高·分歧低吸(纯 OHLCV,见 services/divergenceRules.classifyHighDivergence)。
// 强势股连续新高后的「缩量十字星·守 MA5」洗盘日 = 低吸介入点。不依赖成交额/VWAP/分时,故可回测。
// 回测校准(HIGHDIV=1,293只/2023-07~2026-06,持到目标):期望 0.19R、胜率 39.5%、PF 1.30、
// 盈亏比 1.99、n=266 —— 全面优于突破基线 0.08R(2.4×)。最优旋钮:R_MULT=2、STOP_MAX=7、DRY 0.6~0.7。
export interface HighDivConfig {
  MIN_BARS: number
  NH_LOOKBACK: number // 新高回看窗口(根)
  NH_RECENT: number // 新高须在近 N 根内刷新
  DRY: number // 缩量上限:今日量/昨量 ≤ 此值
  DRY_FLOOR: number // 缩量下限:今日量/昨量 ≥ 此值(要有承接,非干涸)
  DOJI: number // 十字星实体率上限 |收−开|/(高−低)
  MIN_AMP: number // 分歧日振幅下限%(要有波动才算分歧)
  DOWN: number // 当日跌幅下限保护%(跌超此值=走弱不取)
  RETR: number // 距新高回撤上限%(深了是变盘非分歧)
  STOP_MAX: number // 止损封顶距进场%
  R_MULT: number // 目标 = 进场 + R_MULT×风险
  EXHAUST_WICK: number // 创新高日上影/振幅 上限(超过疑似滞涨)
  EXHAUST_VOL: number // 创新高日量/均量 上限(配合长上影=巨量出货,排除)
  VOL_MA: number // 均量窗口
  /** 今日换手率风险线(%):线上 clist f8 超过此值→降 tier + 标注"换手过大·抛压重"(仅线上,不进回测)。 */
  TURNOVER_HOT: number
  /** 打分因子权重(按权重和归一):整理天数 / 十字星程度 / 下影承接 / MA5未拐头。 */
  WEIGHTS: { consol: number; doji: number; lowerWick: number; ma5slope: number }
}

export const HIGHDIV = {
  MIN_BARS: 70,
  NH_LOOKBACK: 60,
  NH_RECENT: 3,
  DRY: 0.7,
  DRY_FLOOR: 0.3,
  DOJI: 0.3,
  MIN_AMP: 2,
  DOWN: 5,
  RETR: 8,
  STOP_MAX: 7, // 回测校准:5→7 期望 0.12→0.14R、PF 1.19→1.23(更宽止损少被洗)
  R_MULT: 2,
  EXHAUST_WICK: 0.5,
  EXHAUST_VOL: 3,
  VOL_MA: 5,
  TURNOVER_HOT: 15,
  WEIGHTS: { consol: 0.35, doji: 0.25, lowerWick: 0.2, ma5slope: 0.2 },
} as const satisfies HighDivConfig

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

// 放量新高 / 资金驱动突破(纯 OHLCV,见 services/volBreakoutRules.classifyVolBreakout)。
// 刚翻上来、中期均线未理顺(完整多头排列不过)的强势股,靠持续大幅放量突破中期平台、创新高
// (如 600141 兴发集团:今日新高 + 连续 9-10 日放量 2-3×,但 MA60<MA120 被趋势模板否)。
// 放宽到短期多头 MA5>MA21(上行)。⚠ 正期望与否待 VOLBREAK=1 回测裁决,过线(期望>0.08R、PF>1.3、样本足)才上线。
export interface VolBreakConfig {
  MIN_BARS: number
  MA_FAST: number // 短均(5)
  MA_SLOW: number // 长均(21)
  RISE_LOOKBACK: number // MA21 上行比较的回看根数
  BASE_LOOKBACK: number // 基准均量窗口(放量启动前)
  VOL_WIN: number // 放量观察窗(根)
  MIN_VOL_DAYS: number // 窗内达标天数下限(成交量 ≥ VOL_MULT×基准)
  VOL_AVG_WIN: number // 均量验证窗
  VOL_MULT: number // 放量倍数(今量/基准)
  BREAKOUT_LOOKBACK: number // 突破中期平台:创近此根新高(排除今日)
  REQUIRE_52W_NEAR: boolean // 收紧:要求贴近 52 周高(默认 false)
  CLOSE_STRENGTH: number // 收盘强度下限 (收−低)/(高−低)
  EXT_MAX_PCT: number // 收盘距 MA5 上限%(防垂直拉升后追高)
  LIMITUP_MAX: number // 连板上限(软门槛,买不到的妖股剔除)
  STOP_MAX_PCT: number // 止损封顶距进场%
  R_MULT: number // 目标 = 进场 + R_MULT×风险
  /** 打分因子权重(按权重和归一):放量天数 / 均量倍数 / 收盘强度 / MA21 斜率。 */
  WEIGHTS: { burst: number; volRatio: number; closeStrong: number; slope: number }
}

// 回测校准(VOLBREAK=1,293只/2023-07~2026-06,HOLD=20):BREAKOUT_LOOKBACK 是关键杠杆——
//   =120(中期平台)期望仅 0.02R/PF1.02(劣于突破基线 0.08R);=250(真·52周新高)期望 0.23R/
//   PF1.36/胜率35.9%/n128/回撤10.3R(优于突破基线 2.9× 且超分歧 0.19R)。故 edge 在「资金驱动的
//   真·52周新高突破(中期均线可未理顺)」,非中期平台突破。⚠ 单窗口、非完全单调(120 异常低),
//   有过拟合风险;MIN_BARS=260 确保 250 日新高为真。一键回退:BREAKOUT_LOOKBACK 调回 120。
export const VOLBREAK = {
  MIN_BARS: 260,
  MA_FAST: 5,
  MA_SLOW: 21,
  RISE_LOOKBACK: 10,
  BASE_LOOKBACK: 60,
  VOL_WIN: 12,
  MIN_VOL_DAYS: 8,
  VOL_AVG_WIN: 10,
  VOL_MULT: 2,
  BREAKOUT_LOOKBACK: 250,
  REQUIRE_52W_NEAR: false,
  CLOSE_STRENGTH: 0.5,
  EXT_MAX_PCT: 15,
  LIMITUP_MAX: 2,
  STOP_MAX_PCT: 8,
  R_MULT: 2.5,
  WEIGHTS: { burst: 0.4, volRatio: 0.3, closeStrong: 0.2, slope: 0.1 },
} as const satisfies VolBreakConfig

// ════════════════════════════════════════════════════════════════════════
// 趋势新高 战法(第八类,见 services/trendNewHighRules.classifyTrendNewHigh)。
// 与「突破/放量新高」互补:突破战法是「捕捉刚突破那一刻」并主动拦截追高(notExtended),
// 故已走出来、远离平台、持续创新高的趋势中军(如 600176 中国巨石)反而进不了任何桶。
// 本战法专收这类:完整多头排列(复用 trendTemplate)+ 贴近/站上 52 周高 + 近期持续创新高。
// 价格口径(非突破口径),纯 OHLCV。作发现型观察清单上线;阈值由 TRENDNEW=1 回测裁决/微调。
export interface TrendNewConfig {
  MIN_BARS: number // 趋势模板需 ≥ MA_LONG(250)+RISE_LOOKBACK(20)+1=271
  NEAR_HIGH_PCT: number // 距 52 周高上限%(贴近/站上)
  RECENT_WIN: number // 持续创新高观察窗(根)
  NH_LOOKBACK: number // 滚动新高回看窗(创"近此根新高"才算新高日)
  MIN_NH_DAYS: number // 观察窗内创新高天数下限(排除一次性脉冲)
  MA_REF: number // 参考均线(止损/追高 guard)
  CLOSE_STRENGTH: number // 收盘强度下限 (收−低)/(高−低)
  EXT_MAX_PCT: number // 收盘距 MA_REF 上限%(追高 guard,防垂直顶;比突破口径(5)宽)
  STOP_MAX_PCT: number // 止损封顶距进场%
  R_MULT: number // 目标 = 进场 + R_MULT×风险
  LIMITUP_MAX: number // 连板上限(软门槛,买不到的妖股剔除)
  /** 打分因子权重(按权重和归一):持续新高度 / 相对强度 / 收盘强度 / 贴高度。 */
  WEIGHTS: { nh: number; rs: number; closeStrong: number; near: number }
}

// 阈值经 TRENDNEW=1 走查回测裁决(SAMPLE=300/KLINE=700,2023-07~2026-06):
//  默认 0.22R/PF1.39(n533),远超突破基线 0.08R、优于分歧 0.19R,与放量新高 0.27R 同档。
//  扫描两处显著加成且已采纳:① EXT_MAX_PCT 30→15(追高 guard 收紧是最大杠杆,0.22→0.29R/PF1.55)——
//  数据推翻"宽松 guard"假设:趋势中军在「未过度脱离 MA20」时介入才有 edge;② NH_LOOKBACK 60→40
//  (近期新高比长回看更重要,0.22→0.24R)。两处组合复测 0.28R/PF1.52/n415、最大回撤反降(24.9→17.7R),
//  确认非过拟合。HOLD=40 期望更高(0.30R)印证趋势跟随需放长。结论:过线上线(介于放量新高 0.27R 与突破整理 0.45R)。
export const TRENDNEW = {
  MIN_BARS: 271,
  NEAR_HIGH_PCT: 5,
  RECENT_WIN: 20,
  NH_LOOKBACK: 40,
  MIN_NH_DAYS: 3,
  MA_REF: 20,
  CLOSE_STRENGTH: 0.4,
  EXT_MAX_PCT: 15,
  STOP_MAX_PCT: 8,
  R_MULT: 2,
  LIMITUP_MAX: 2,
  WEIGHTS: { nh: 0.4, rs: 0.3, closeStrong: 0.15, near: 0.15 },
} as const satisfies TrendNewConfig

// ════════════════════════════════════════════════════════════════════════
// 趋势中军·监控清单(发现型视图,非战法,见 services/trendLeaderRules.classifyTrendLeader)。
// 是趋势新高(第8战法)的【放宽超集·纯监控】:同样要 完整多头排列 + 持续创新高 + 连续站上 MA5,
// 但放宽收强/追高/贴高这些"买点质量"门槛,让已脱离 MA20 的强势龙头(京东方/士兰微/中国巨石)看得见。
// 【监控·非买点·未回测】——以下阈值是【展示/纳入口径】,不是交易门槛,故不进回测、无期望声明。
export interface TrendWatchConfig {
  MIN_BARS: number // 趋势模板需 ≥ 271
  RECENT_WIN: number // 持续创新高观察窗(根)
  NH_LOOKBACK: number // 滚动新高回看窗
  MIN_NH_DAYS: number // 观察窗内创新高天数下限
  MA_REF: number // 参考均线(偏离度/回踩位)
  MA5_HOLD_MIN: number // 连续站上 MA5 天数下限(持续性)
  EXT_MAX_PCT: number // 距 MA_REF 偏离上限%(宽松,只滤垂直顶;远宽于趋势新高的 15)
  LIMITUP_MAX: number // 连板上限(软门槛,妖股剔除)
  MAX: number // 清单容量上限
  /** 趋势质量打分权重(按权重和归一):相对强度 / 持续新高度 / 站上MA5持续性 / 贴高度。 */
  WEIGHTS: { rs: number; nh: number; ma5hold: number; near: number }
}

export const TRENDWATCH = {
  MIN_BARS: 271,
  RECENT_WIN: 20,
  NH_LOOKBACK: 40,
  MIN_NH_DAYS: 3,
  MA_REF: 20,
  MA5_HOLD_MIN: 3,
  EXT_MAX_PCT: 40,
  LIMITUP_MAX: 2,
  MAX: 40,
  WEIGHTS: { rs: 0.35, nh: 0.3, ma5hold: 0.2, near: 0.15 },
} as const satisfies TrendWatchConfig

// ════════════════════════════════════════════════════════════════════════
// 资金流共振·机构调研 战法(第六类,见 services/fundResonanceRules.classifyFundResonance)。
// 来源:用户转述的「杭州高手」量化短线 —— 净流入排名∩成交量排名 top200 + 机构周调研 + 放量高开,
//   持股平均 3 天、容量小。其核心因子「主力净流入排名」东财不给免费历史(数据墙,同连板VWAP),
//   故拆成两层:① 实盘 live 用 主力净流入(f62)∩成交额 选池(env 门控,未回测,见 services/fundFlow);
//   ② 此处是**可回测子集**——把"资金涌入"用纯 OHLCV 的「放量 + 短期多头强势」代理,叠加可回溯的
//   「机构近 N 日调研」事件(RPT_ORG_SURVEYNEW 历史可取),验证这套代理本身有没有正期望。
// 入场=信号日收盘(EOD,与其他战法一致);持有 HOLD≈3 日(time-exit 捕捉"持股平均三天")。
// ⚠ surveyOrgs 由调用方按信号日窗口算好后传入(rule 保持纯函数可单测)。正期望与否由 FUNDRES=1 回测裁决。
export interface FundResConfig {
  MIN_BARS: number
  MA_FAST: number // 短均(5)
  MA_MID: number // 中均(20)
  RISE_LOOKBACK: number // MA_FAST 上行比较回看根数
  VOL_MA: number // 放量基准均量窗(根)
  VOL_MULT: number // 成交量因子:今量 ≥ VOL_MULT×均量(放量=资金涌入代理)
  SURVEY_LOOKBACK: number // 机构调研事件窗(交易日):信号日前 N 日内有调研
  SURVEY_MIN_ORGS: number // 该窗内最少调研机构家数(0=不要求调研,纯放量强势)
  REQUIRE_GAP_UP: boolean // 是否硬要求信号日高开
  GAP_MIN_PCT: number // 高开下限%:今开/昨收−1 ≥ 此值
  MOM_MIN_PCT: number // 近 MA_MID 日动量下限%(短线强势)
  CLOSE_STRENGTH: number // 收盘强度下限 (收−低)/(高−低)
  EXT_MAX_PCT: number // 收盘距 MA_FAST 上限%(防垂直拉升追高)
  STOP_MAX_PCT: number // 止损封顶距进场%(短线较紧)
  R_MULT: number // 目标 = 进场 + R_MULT×风险
  HOLD: number // 持股目标交易日数(time-exit;线上展示用,回测由 HOLD_FR 控制)
  LIMITUP_MAX: number // 连板上限(软门槛,买不到的妖股剔除)
  /** 打分因子权重(按权重和归一):调研强度 / 放量倍数 / 短期动量 / 收盘强度。 */
  WEIGHTS: { survey: number; volRatio: number; mom: number; closeStrong: number }
}

// 回测校准(FUNDRES=1,293只/2023-07~2026-06,HOLD=3,对照突破基线 0.08R/PF1.11):
//   基线初值(VOL_MULT1.8/SL10/min1)即过线 0.14R/PF1.48/n157。三处增益已据数锁定:
//   ① 机构调研因子真有增量(图里"机构调研"值钱):不要求调研 0.09R/PF1.25 → ≥1家 0.14R/PF1.48
//      → ≥3家 0.17R/PF1.63;分桶 orgs≥6 最强 0.17R/PF1.67(调研越多期望越高,高端尤显)。
//   ② 放量是主引擎(图里"成交量因子"):VOL_MULT 1.8→2.2→2.6 = 0.14R→0.24R→0.28R、PF 1.48→1.94→2.08。
//      取 2.2(0.24R/PF1.94/n83):期望×1.7、回撤 8.6R→4.1R,样本仍足。
//   ③ **调研窗复裁翻案(2026-07-04,披露日防前视修正 edc19dd 之后重扫;"5 完胜"是修正前旧结论)**:
//      按 noticeDate(披露日)计调研后,SURVEY_LOOKBACK 5→0.25R/PF1.96/n32、10→0.29R/PF2.03/n60、
//      **20→0.29R/PF2.10/n110(采纳:期望并列最高、PF/n 双优、胜率57%)**、30→0.21R 回落。
//      机理:披露平均滞后 1 天+长尾,窗口太短会把"调研发生但尚未披露"的票误判为无调研;20 日窗
//      吃满披露长尾、样本×3.4。(HOLD=10 扫描显示 0.39R 更高,但改持有期动图里"持股3天"的纪律
//      且 n=32 太瘦,先不动、留观察。)
//   ④ ⚠ "高开"同日过滤是负的:REQUIRE_GAP_UP=true → −0.06R/PF0.84(信号日收盘进=追在已跳空冲高的票)。
//      图里"加高开"是**次日开盘触发**(不同机制),故 false;次日高开介入留作实盘晨间执行规则。
//   ⑤ HOLD=3 验证图里"持股平均三天":0.14R;加长到5/10更高但回撤陡升,守 3 日纪律。
//   ⑥ **入场方式五臂对照 + 止损扫参(2026-07-06,simulateEntry 重锚+入场日撮合口径)**:
//      入场:close(当日收盘)0.29R/PF2.10/n110 完胜 nextOpen(次日开盘)0.19R/PF1.56/n110(−0.10R,
//      隔夜跳空吃掉入场优势);「高开=次日触发」假说被否——gapUp1(次日高开≥1%才进)0.02R/n24、
//      gapUp2 0.30R 但 n=12 远低样本闸(≥60)→ **当日收盘进=最优入场,维持**(✓parity:close 臂精确复现基线)。
//      止损:STOP 4/5/6/8 = 0.42/0.31/0.29/0.22R 单调递增(紧止损快速淘汰弱票),PF 2.23/1.96/2.10/2.03,
//      n 恒 110(STOP 不影响信号集)→ **采纳 STOP_MAX_PCT 6→4:0.29→0.42R,目标达成率 15%→31%**。
//      HOLD 复核(close×STOP4):3→0.42R、5→0.51R/PF2.29/胜率58%(更高,回撤 7.06→8.27R 温和);
//      沿⑤"持股3天"在案纪律**暂不动 HOLD,留观察**(想吃满趋势段可改 5,一行换)。
//   **当前锁定组合(VOL_MULT2.2+min1+LOOKBACK20+STOP4)实测:0.42R/PF2.22/胜率55%/回撤7.07R/n110**
//   (历史:STOP6 时代 0.29R/PF2.10;LOOKBACK=5 时代 0.26R/PF2.08/n53,升级线见③⑥)
//   —— 超分歧 0.19R、超放量新高 0.27R,现全战法第二(仅次 bhold-confirm 0.45R)。⚠ 样本仍偏瘦
//   (全市场×17≈300笔/年,图里本就"容量小"),增益为三个单调轴的叠加 → 过拟合风险可控但非零;
//   想要更多候选可 VOL_MULT 退 2.0。一键关调研要求:SURVEY_MIN_ORGS=0(退化为纯放量强势 0.09R)。
export const FUNDRES = {
  MIN_BARS: 70,
  MA_FAST: 5,
  MA_MID: 20,
  RISE_LOOKBACK: 5,
  VOL_MA: 5,
  VOL_MULT: 2.2, // 校准:1.8→2.2(期望 0.14→0.24R、PF 1.48→1.94、回撤 8.6→4.1R)
  SURVEY_LOOKBACK: 20, // 复裁 2026-07-04:5→20(披露日口径下 0.25→0.29R/PF2.10/n32→110,见上方注释③)
  SURVEY_MIN_ORGS: 1,
  REQUIRE_GAP_UP: false,
  GAP_MIN_PCT: 1,
  MOM_MIN_PCT: 0,
  CLOSE_STRENGTH: 0.5,
  EXT_MAX_PCT: 12,
  STOP_MAX_PCT: 4, // 校准 2026-07-06:6→4(0.29→0.42R/PF2.22,4/5/6/8 单调递增非单格尖峰,见注释⑥)
  R_MULT: 2,
  HOLD: 3, // 守"持股3天"纪律(⑤);STOP4 下 HOLD5=0.51R 更高,留观察(⑥)
  LIMITUP_MAX: 2,
  WEIGHTS: { survey: 0.35, volRatio: 0.3, mom: 0.2, closeStrong: 0.15 },
} as const satisfies FundResConfig

// ════════════════════════════════════════════════════════════════════════
// 突破整理·延续 战法(第七类,纯 OHLCV,见 services/breakoutHoldRules.classifyBreakoutHold)。
// 来源:用户给精测电子(300567)截图——「放量大阳线过前高 → 1~2根阳线/十字星整理 → 高低点双抬」。
//   现有「今日已突破」按设计只抓突破当天(精测今日量1.23×/收强0.55→落临界观察),抓不到"突破后小K线整理"。
//   本战法专抓这种延续:近 MAX_CONSOL 日内有「放量大阳线突破前高(pole 杆)」,其后 1~2 根小实体
//   (十字星/小阳)整理且 高点抬高+低点抬高+守住突破位 = 强势不回吐 → 介入续涨。
// ⚠ 正期望与否待 BHOLD=1 回测裁决,过线(期望>0.08R、PF>1.3、样本足)才上线。
export interface BreakoutHoldConfig {
  MIN_BARS: number
  POLE_BREAK_LOOKBACK: number // pole 突破"前高"的回看窗(根):pole 收盘 > 此窗内最高
  POLE_BODY_MIN: number // 大阳线最小实体涨幅%((收−开)/开)
  POLE_VOL_MULT: number // 放量倍数(pole 量 / pole 前 POLE_VOL_MA 日均量)
  POLE_VOL_MA: number // pole 放量基准均量窗
  MAX_CONSOL: number // 整理小K线最多根数(用户:1~2)
  DOJI_BODY_MAX: number // 整理日小实体上限 |收−开|/(高−低)
  CONSOL_VOL_MAX: number // 整理日量上限(整理量/pole量;缩量整理,软门槛偏宽)
  REQUIRE_HIGHER_HIGH: boolean // 高点抬高(每根整理日 高≥前一根高)
  REQUIRE_HIGHER_LOW: boolean // 低点抬高(每根整理日 低≥前一根低)
  HOLD_ABOVE_BREAK: boolean // 整理低点须守在被突破"前高"之上(不回吐进箱体)
  EXT_MAX_PCT: number // 整理日收盘距 pole 收盘上限%(防整理期已大幅脱离 pole 再追)
  CONFIRM_WINDOW: number // 确认入场窗口(交易日):整理日后 N 日内突破整理高点(trigger)才介入,否则放弃
  STOP_MAX_PCT: number // 止损封顶距进场%
  R_MULT: number // 目标 = 进场 + R_MULT×风险
  LIMITUP_MAX: number // 连板上限(软门槛,买不到的妖股剔除)
  /** 打分因子权重(按权重和归一):pole 放量 / pole 实体 / 整理紧凑(实体越小越高) / 抬升幅度。 */
  WEIGHTS: { poleVol: number; poleBody: number; tight: number; stepUp: number }
}

// 回测校准(BHOLD=1,293只/2023-07~2026-06,HOLD=10,对照突破基线 0.08R/PF1.11):
//   **入场机制是命门**——整理日收盘进(close) 0.17R/PF1.26(止损率61%,被洗);改「次日突破整理高点
//   trigger 确认进」(confirm,旗形突破确认) → **0.45R/PF1.90/胜率49%/回撤6.1R/n55**(止损率49%、回撤
//   15.8→6.1R),confirm vs close +0.28R。**为所有战法最高期望**(>资金流0.42R/放量新高0.27R/分歧0.19R)。
//   旋钮(confirm 入场扫描):① POLE_VOL_MULT 2.2(放量大阳,1.8→2.2 = 0.06→0.26R)② POLE_BREAK_LOOKBACK
//   **=10 最优**(0.45R/PF1.90/n55;=20 是异常低点 0.26R,=40/60 也 0.41/0.56R → 真信号在 0.4R+,20 才是坑)
//   ③ DOJI_BODY_MAX=0.5(0.3 太紧负、0.6 稀释)④ CONFIRM_WINDOW 1~3 都行(≈0.25~0.30R)⑤ R_MULT 2.5 payoff
//   更高(0.36R)但 2 更稳。⚠ 用 confirm 入场后「高低点双抬(HH/HL)」对期望已不敏感(确认入场本身已滤假启动),
//   但保留=贴合用户描述的形态。⚠ POLE_BREAK_LOOKBACK 非单调有过拟合风险;一键放宽结构:HH/HL=false。
//   ⚠ 本战法**信号日=整理日,实战次日突破 trigger 才介入**(回测即此口径);live 卡片以 trigger 为介入触发位。
export const BHOLD = {
  MIN_BARS: 70,
  POLE_BREAK_LOOKBACK: 10,
  POLE_BODY_MIN: 7,
  POLE_VOL_MULT: 2.2,
  POLE_VOL_MA: 10,
  MAX_CONSOL: 2,
  DOJI_BODY_MAX: 0.5,
  CONSOL_VOL_MAX: 1.0,
  REQUIRE_HIGHER_HIGH: true,
  REQUIRE_HIGHER_LOW: true,
  HOLD_ABOVE_BREAK: true,
  EXT_MAX_PCT: 8,
  CONFIRM_WINDOW: 3,
  STOP_MAX_PCT: 7,
  R_MULT: 2,
  LIMITUP_MAX: 2,
  WEIGHTS: { poleVol: 0.35, poleBody: 0.25, tight: 0.2, stepUp: 0.2 },
} as const satisfies BreakoutHoldConfig

// 突破整理·观察(超集,非战法):BHOLD 只放宽 POLE_VOL_MULT(2.2→1.5),其余7道硬门槛原样不变。
// 【监控·非买点·未回测】只为形态吻合但放量不足确认线的候选提供可见性,不进任何评分/回测口径。
// 来源:精测电子(300567)2026-06-24 实测——pole 实体+18.73%✓、突破前高✓,但量比仅1.63×<2.2×,
// 是唯一不过的门槛(整理日高低点抬升/十字星/守突破位/EXT_MAX_PCT 全部吻合,验证过 consolN=1 场景)。
export const BHOLD_WATCH = { ...BHOLD, POLE_VOL_MULT: 1.5 } as const satisfies BreakoutHoldConfig

// ════════════════════════════════════════════════════════════════════════
// 突破次日回踩 战法(第八类,纯 OHLCV,见 services/breakoutPullbackRules.classifyBreakoutPullback)。
// 来源:用户「突破生命周期」拆分——① 今日首次突破(screenerRules firstBreakout) → ② 突破后首次回踩(本战法)
//   → ③ 突破后持续守MA5(复用第7战法 breakoutHold)。本战法抓「近 PB_MAX_AGO 日放量突破前高 → 守住突破位 →
//   今日首次回踩(下跌日)且收盘站回 MA5/前高之上」的低吸点。
// ⚠ 正期望与否待 PBREAK=1 回测裁决,过线(期望>0.08R、PF>1.3、样本足)才上线;不过线照 BHOLD 经验改确认入场再测。
export interface BreakoutPullbackConfig {
  MIN_BARS: number
  BREAK_LOOKBACK: number // 突破"前高"的回看窗(根):突破日收盘 > 此窗内最高
  VOL_MA: number // 突破日放量基准均量窗
  VOL_MULT: number // 突破日放量倍数(突破日量/前均量)
  PB_MAX_AGO: number // 突破日最多在今日前 N 日内(回踩窗)
  HOLD_TOL: number // 守突破位容差:回踩段最低 ≥ 前高×(1−HOLD_TOL)(不回吐进箱体)
  MA_FAST: number // 回踩支撑均线(5)
  TOUCH_TOL: number // 今日低点触及 MA5 的容差(low ≤ MA5×(1+TOUCH_TOL))=回踩到位(软评分)
  CLOSE_ABOVE_MA: boolean // 今日收盘须站回 MA5 之上(弱转强确认)
  REQUIRE_DOWN_DAY: boolean // 今日须为下跌回踩日(close<昨收)
  PULL_MIN_PCT: number // 今日自突破后高点回撤下限%(要真回踩,非仍在冲)
  CONFIRM_WINDOW: number // 确认入场窗口(交易日):回踩日后 N 日内突破回踩日高点才介入(回测对照变体用)
  STOP_MAX_PCT: number // 止损封顶距进场%
  R_MULT: number // 目标 = 进场 + R_MULT×风险
  LIMITUP_MAX: number // 连板上限(软门槛)
  /** 打分因子权重(按权重和归一):突破放量 / 回踩深度适中 / 守MA5 / 新鲜度(回踩越早)。 */
  WEIGHTS: { breakVol: number; pullDepth: number; holdMa5: number; freshness: number }
}

// 回测裁决(PBREAK=1,293只/2023-07~2026-06,HOLD=10)——**未过线,不接 live**(规则+回测保留作探索):
//   回踩日收盘进 −0.04R/PF0.94(全 close 入场各旋钮均负,止损率64%/回撤200R);改「次日突破回踩高确认进」
//   升到 0.12R/PF1.21,confirm+放量2.2× 最佳 0.14R/PF1.26/n581 —— 仍 **PF<1.3 够不到过线**。
//   结论:**"买突破后的回踩下跌"是弱/负期望;这一族的 edge 在「突破后守住」(第7战法 breakoutHold confirm 0.45R),
//   不在"买回踩"**。故本战法不上 live tab(用户"过线才上"纪律);保留供数据/入场改善后复测。一键试:PBREAK=1。
export const PBREAK = {
  MIN_BARS: 70,
  BREAK_LOOKBACK: 20,
  VOL_MA: 10,
  VOL_MULT: 1.8,
  PB_MAX_AGO: 3,
  HOLD_TOL: 0.03,
  MA_FAST: 5,
  TOUCH_TOL: 0.02,
  CLOSE_ABOVE_MA: true,
  REQUIRE_DOWN_DAY: true,
  PULL_MIN_PCT: 1,
  CONFIRM_WINDOW: 3,
  STOP_MAX_PCT: 7,
  R_MULT: 2,
  LIMITUP_MAX: 2,
  WEIGHTS: { breakVol: 0.35, pullDepth: 0.25, holdMa5: 0.2, freshness: 0.2 },
} as const satisfies BreakoutPullbackConfig

// ════════════════════════════════════════════════════════════════════════
// 技术分析组合(Wyckoff 量价 + 道氏趋势结构 + Al Brooks 价格行为)· 全战法整体评分因子
//   (纯函数 bar 级,见 services/technicalScore.technicalCombo)。复用项目已有方法:
//   Wyckoff = knowledge/wyckoff.analyzeWyckoffPhase;价格行为 = divergenceRules 的 bodyRatio/upper-/lowerWickRatio;
//   道氏 = screenerRules.trendTemplate。输出 0..1 因子(0.5 中性)+ bias + distribution(强派发=大族式出货)。
//   作用:新高 finalScore 加 ta01 权重;其余组 score 按 ta 因子缩放、distribution 降一档 + ⚠。
// ⚠ 权重/惩罚强度待 TA=1 因子分桶回测裁决(确认 供给<中性<需求 单调且显著)才据数定;无区分度则只展示不动分。
export interface TechnicalComboConfig {
  LOOKBACK: number // 近端高点/结构回看(根):前高判定 + 道氏 HH-HL
  WYCKOFF_WIN: number // 喂 analyzeWyckoffPhase 的窗口(根)
  VOL_MA: number // 量价基准均量窗
  VOL_HOT: number // 放量门槛:今量 ≥ VOL_HOT×均量
  UPPER_WICK: number // 长上影门槛:upperWickRatio ≥ 此 = 冲高回落
  CLOSE_STRONG: number // 收强门槛:(收−低)/振幅 ≥ 此 = SOS 需求
  STALL_PCT: number // 努力≠结果:放量但 |涨幅| ≤ 此% = 滞涨(供给)
  NEAR_HIGH_PCT: number // 距近端高点 ≤ 此% = "于前高附近"(派发上下文)
  GAP_UP_PCT: number // 高开门槛:今开/昨收−1 ≥ 此%
  PENALTY_TIER_DROP: boolean // distribution 时其余组降一档
  /** 因子缩放:其余组 score × (MULT_MIN + (MULT_MAX−MULT_MIN)×score01)。供给压低、需求抬高。 */
  MULT_MIN: number
  MULT_MAX: number
  /** 三法权重(按权重和归一)。 */
  WEIGHTS: { wyckoff: number; priceAction: number; dow: number }
}

export const TECH = {
  LOOKBACK: 20,
  WYCKOFF_WIN: 30,
  VOL_MA: 10,
  VOL_HOT: 1.8,
  UPPER_WICK: 0.4,
  CLOSE_STRONG: 0.7,
  STALL_PCT: 1.5,
  NEAR_HIGH_PCT: 3,
  GAP_UP_PCT: 1,
  PENALTY_TIER_DROP: true,
  MULT_MIN: 0.7,
  MULT_MAX: 1.3,
  WEIGHTS: { wyckoff: 0.4, priceAction: 0.4, dow: 0.2 },
} as const satisfies TechnicalComboConfig

// ════════════════════════════════════════════════════════════════════════
// 放量吸筹 · 持续异常放量横盘 监控清单(发现型,纯 OHLCV,见 services/accumRules.classifyAccum)。
// 来源:用户给 激智科技(300566) 截图——「从某日起(约 5/20)每天成交量都是之前均量的好几倍(持续异常放量)」。
//   主力吸筹/换庄的典型量价背离:量持续巨幅放大,但价格横盘、均线走平 = 资金在低位/箱体内换手吸筹。
// 核心硬门槛＝持续放量;用户要的两条「加分」做成打分因子:① 均线走平(MA_REF 斜率近 0)
//   ② 横盘越久越加分(价格箱体维持的连续天数)。发现型清单:吸筹本身是 setup,真正的买点＝
//   「放量站上箱体上沿(吸筹转拉升)」的【确认买点】(entryTrigger=箱体上沿 / stopRef=箱体下沿 /
//   targetRef=+ENTRY_R_MULT×R),卡片以此呈现;吸筹途中不埋伏。
//
// 回测校准(ACCUM=1,300只/2023-07~2026-06,对照突破基线 0.08R/PF1.11):
//   **入场机制是命门**(同 BHOLD/PBREAK)——检测日收盘进(吸筹途中埋伏)−0.24R/PF0.76(止损62%/回撤121R,负);
//   改「箱体突破确认进(放量站上箱体上沿)」→ **0.20R/PF1.33/胜率39.9%/回撤18.8R/n281**(过线:>突破基线、
//   PF>1.3、样本足、近分歧0.19R)。confirm vs close **+0.44R**。HOLD(confirm) 20~60 均过线(0.19~0.22R),20 最优。
//   **用户核心诉求「横盘越久越加分」被数据单调证实**(横盘天数因子分桶,close 入场):横盘 1~5 日 −0.63R/PF0.55
//   → 5~10 日 −0.06R → 10~20 日 **+0.24R/PF1.42/n99** → 20+ 日(n5 退化仅参考)。⇒ 真横盘吸筹(≥10日)才有
//   edge,短横盘是拉升途中噪音(故 consol 因子权重正确)。close-entry 旁扫:VOL_MULT 越高越差(高倍放量+横盘
//   ＝已剧烈换手,埋伏被洗)、箱体越宽(25%)越不差——印证"埋伏"无 edge,买点在突破那一刻。
//   结论:**过线上线为「监控清单 + 确认买点」**(entry=放量站上箱体上沿,stop=箱体下沿,target=+2R,确认窗3日);
//   监控卡的「观察触发位」即此买点。⚠ 单窗口、confirm 触发依赖箱体口径,有一定过拟合风险;一键回退为纯监控:
//   卡片忽略 stopRef/targetRef 即可(规则仍输出,不强制)。
//
// ⚠⚠ 2026-07-03 裁决翻转:入场日撮合修正(engine checkEntryBar——confirm 入场此前系统性
//   漏掉突破当日的止损/止盈)后重跑同一缓存样本:confirm **0.01R/PF1.02/n281,不再过线**;
//   原 0.20R/PF1.33 主要是入场日盲区的高估。边界:日线无法分辨突破日 low 在触发前还是后,
//   保守口径(低于止损即判损)与旧乐观口径(完全不查)之间才是真相——但按「保守优先」铁律,
//   该买点的 edge 无法在日线上稳健证明。**当前状态=降级回纯监控清单看待,确认买点仅作
//   触发位提示、不再当作有回测背书的买点**;要翻案需分钟线验证。
export interface AccumConfig {
  MIN_BARS: number
  VOL_WIN: number // 放量观察窗(根,≈"从5/20起"4~5周)
  BASE_LOOKBACK: number // 放量启动前的基准均量窗(根)
  VOL_MULT: number // "好几倍"放量倍数:窗内均量 / 基准 ≥ 此值(硬门槛)
  MIN_BURST_DAYS: number // VOL_WIN 内单日量 ≥ VOL_MULT×基准 的天数下限(持续,非一日脉冲)
  SURGE_SOFT_MULT: number // 持续放量天数 surgeRunDays 的软门槛倍数(walk-back 计天数,展示+评分)
  SURGE_TOL: number // walk-back 允许的连续 sub-threshold 容忍天数
  SURGE_FULL: number // 持续放量天数评分封顶(满分)
  MA_REF: number // 均线走平判定的均线窗(20)
  FLAT_WIN: number // MA 斜率回看窗(根)
  FLAT_MAX_PCT: number // MA_REF 在 FLAT_WIN 内偏移 ≤ 此% 视为走平(0 偏移=满分)
  BOX_RANGE_PCT: number // 横盘箱体:连续区间 (最高−最低)/最低 ≤ 此% 算"在箱内"(walk-back 求 consolDays)
  CONSOL_FULL: number // 横盘天数评分封顶(满分),越长越加分
  HI_POS_PCT: number // 收盘落在 52 周区间 ≥ 此分位＝高位放量(谨防出货 riskNote)
  LO_POS_PCT: number // ≤ 此分位＝低位放量(偏吸筹,favorable)
  DROP_WARN_PCT: number // 放量窗内净跌幅 ≤ −此%＝放量下跌·出货嫌疑 riskNote
  LIMITUP_MAX: number // 连板软门槛(妖股剔除)
  MAX: number // 清单容量上限
  /** 专用初筛:除 nh(动量)/pb(量比) 两切片外,额外按 换手率(f8,float归一·偏小中盘) 取 top 此数并入并集,
   *  不卡 mom60——专为捞「低位横盘吸筹」(长flat基底 mom60 常≈0/微负、当日量比可<1.3 而被两切片漏掉)。 */
  PREFILTER_MAX: number
  // ── 确认买点(2026-07-03 入场日撮合修正后 0.01R/PF1.02 不再过线,降级为触发位提示;见上方裁决翻转注)──
  ENTRY_STOP_PCT: number // 触发买点止损封顶距进场%(进场=箱体上沿;stop=max(箱体下沿, 进场×(1−此%/100)))
  ENTRY_R_MULT: number // 触发买点目标 = 进场 + 此×风险
  CONFIRM_WINDOW: number // 确认窗(交易日):检测后 N 日内放量站上箱体上沿才介入(实战触发位提示用)
  /** 打分权重(按权重和归一):放量强度 / 均线走平 / 横盘时长。 */
  WEIGHTS: { vol: number; flat: number; consol: number }
}

export const ACCUM = {
  MIN_BARS: 70,
  VOL_WIN: 20,
  BASE_LOOKBACK: 40,
  VOL_MULT: 2.5,
  MIN_BURST_DAYS: 12,
  SURGE_SOFT_MULT: 1.8,
  SURGE_TOL: 3,
  SURGE_FULL: 40,
  MA_REF: 20,
  FLAT_WIN: 10,
  FLAT_MAX_PCT: 8,
  BOX_RANGE_PCT: 18,
  CONSOL_FULL: 40,
  HI_POS_PCT: 70,
  LO_POS_PCT: 40,
  DROP_WARN_PCT: 8,
  LIMITUP_MAX: 2,
  MAX: 40,
  PREFILTER_MAX: 300, // 额外按换手率取 top300 并入并集(不卡 mom60),专捞低位横盘吸筹;增量取数有限(与 nh/pb 多有重叠)
  ENTRY_STOP_PCT: 8, // 回测同口径(STOP_AC=8)
  ENTRY_R_MULT: 2, // 回测同口径(R_AC=2)
  CONFIRM_WINDOW: 3, // 回测同口径(CONFIRM_AC=3)
  WEIGHTS: { vol: 0.4, flat: 0.3, consol: 0.3 },
} as const satisfies AccumConfig

// ════════════════════════════════════════════════════════════════════════
// 大盘反攻日·先锋股(reboundDay)—— 复盘卡 + 回测裁决用;回测过线前**非战法非买点**。
// 事件判据:指数连续杀跌数日后放量大阳反攻(2026-07-09 上证+1.65%原型);
// 先锋两型:长电科技型(率先涨停:低位首板/二板) + 东山精密型(连跌窗内抗跌·反攻日放量领涨)。
// reversalDay 是独立事件判据,与 buildRegime(情绪 phase)/marketRegime(均线趋势)两套 regime 并存不合并。
export interface ReboundConfig {
  INDEX_SECID: string // 判据指数(上证综指;创业板 20cm 波动尺度不同,不做双指数判据)
  SECONDARY_SECID: string // 展示用副指数(创业板指,仅复盘卡佐证,不参与判据)
  MIN_BARS: number // classifier 最少K线根数(52周分位需要长窗,不足则不判)
  DOWN_DAYS_MIN: number // 连跌口径A:反攻日前连续下跌天数 ≥ 此值
  DOWN_WINDOW: number // 连跌口径B:回看窗(交易日)
  DOWN_CUM_PCT: number // 口径B:窗内累计涨跌幅 ≤ 此%(负数)——捕捉非严格连续的杀跌
  UP_PCT_MIN: number // 反攻日指数涨幅线(%)
  VOL_BASE_WIN: number // 量比基准窗(日):当日量 / 前N日均量(指数与个股共用口径)
  VOL_RATIO_MIN: number // 反攻日指数量比线
  // ── 先锋(长电型:率先涨停) ──
  PIONEER_MAX: number // 复盘卡先锋榜容量
  PIONEER_LB_MAX: number // 低位首板/二板:连板数 ≤ 此值(剔除妖股高位板)
  PIONEER_POS_MAX: number // 52周分位 ≤ 此%(低位;回测 classifier 用,涨停池无此字段)
  // ── 抗跌领涨(东山型) ──
  RESIL_CANDIDATES: number // 当日涨幅榜候选池(控 kline 取数量,参照 HIGHS_CANDIDATES=80 同量级)
  RESIL_MAX: number // 复盘卡抗跌榜容量
  LEAD_CHG_MIN: number // 反攻日个股涨幅 ≥ 此%
  LEAD_VOL_MIN: number // 反攻日个股量比 ≥ 此值
  LEAD_CUMREL_MIN: number // 连跌窗内累计相对强度 ≥ 此 pp(个股累计涨跌 − 指数累计涨跌)
  // ── 回测入场参数(sweep 基线;裁决结论回填于此) ──
  MAX_GAP_PCT: number // 长电型次日追高拦截:高开 > 此% 放弃(sweep 3/5/7/不拦)
  STOP_PCT: number // 止损距参考位%(双保险:参考位与入场价取更紧)
  R_MULT: number // 目标 = entry + 此×风险
  HOLD: number // 持有(交易日)
}

export const REBOUND = {
  INDEX_SECID: '1.000001',
  SECONDARY_SECID: '0.399006',
  MIN_BARS: 60,
  DOWN_DAYS_MIN: 3,
  DOWN_WINDOW: 5,
  DOWN_CUM_PCT: -3,
  UP_PCT_MIN: 1.5,
  VOL_BASE_WIN: 5,
  VOL_RATIO_MIN: 1.3,
  PIONEER_MAX: 12,
  PIONEER_LB_MAX: 2,
  PIONEER_POS_MAX: 50,
  RESIL_CANDIDATES: 60,
  RESIL_MAX: 10,
  LEAD_CHG_MIN: 5,
  LEAD_VOL_MIN: 1.5,
  LEAD_CUMREL_MIN: 0,
  MAX_GAP_PCT: 7,
  STOP_PCT: 7,
  R_MULT: 2,
  HOLD: 5,
} as const satisfies ReboundConfig

// ════════════════════════════════════════════════════════════════════════
// 资金共振榜 / 机构调研榜(纯排行·非战法·非买点·未回测)—— 与 FUNDRES 第6战法(classifyFundResonance,
// 回测0.42R/PF2.22)完全独立,不共享阈值,互不影响(榜的「调研数量」列窗口借用 FUNDRES.SURVEY_LOOKBACK 保持口径一致)。
export const FUND_RESONANCE_BOARD = {
  TOPN: 200, // 成交额/净流入各取 top-N 做交集
  TOP_K: 10, // 交集内按净流入降序取前K展示
} as const
export const ORG_SURVEY_BOARD = {
  LOOKBACK_TRADING_DAYS: 20, // 机构调研聚合回看窗(交易日)
  MAX: 40, // 展示上限(20日窗口下全市场调研覆盖面广,按机构家数砍到40是真实的关注度分水岭)
} as const
