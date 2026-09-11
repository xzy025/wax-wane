// 公开侧市场配置。
//
// 本文件从 `config/screener.ts` 拆出：那一版 1372 行里装了 25 个策略配置，
// 但公开侧（采集、快照、复盘、看板）**只访问 SCREENER 的 7 个字段** ——
// 其余 49 个（MA_* / ATR_* / VOL_* / TARGET_* / WEIGHTS / WATCH_*）是纯策略参数，
// 随 `config/screener.ts` 归入私有战法层。
//
// 判定依据：对 18 个引用 `config/screener` 的公开文件做 `SCREENER.<FIELD>` 静态扫描，
// 得到 7 个实际字段。不是按名字猜的。
//
// 边界：这里放**市场标识与数据侧阈值**（指数 secid、板块代码、流动性/市值门槛、
// 持仓复盘参数、解禁/股东户数/机构调研窗口）。任何"买点/卖点/评分"口径都不属于本文件。

// ── 来自 SCREENER 的 7 个公开字段 ──────────────────────────────────────

/** 同花顺全市场板块过滤串（行情列表接口的 `fs` 参数）。 */
export const CLIST_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'

/** 日成交额下限（元）：低于此值不进入行情列表，避免流动性陷阱。 */
export const LIQUIDITY_MIN = 80_000_000

/** 总市值下限（元）。 */
export const MCAP_MIN = 2_000_000_000

/** 大盘指数 secid（沪深300）。 */
export const MARKET_INDEX_SECID = '1.000300'

/** 创业板指(与 ashare.ts INDEX_SECIDS 一致)。 */
export const CHINEXT_INDEX_SECID = '0.399006'

/** 科创50(上交所,secid 前缀 1)。 */
export const STAR50_INDEX_SECID = '1.000688'

/** 相对强度口径：大盘明显下跌日的判定阈值与逆势加成。 */
export const RELSTR = { CRASH_DAY_PCT: -1.5, COUNTER_BOOST: 1.15 }

// ── 公开的独立配置块 ─────────────────────────────────────────────────

export interface HoldingsConfig {
  /** 日 K 根数:trendTemplate 需 271、rsRaw 完整需 253、52周高 250 → 280 全覆盖留缓冲。 */
  KLINE_COUNT: number
  /** ATR 窗口(持仓管理用通用 14,选股引擎的 10/50 口径不动)。 */
  ATR_PERIOD: number
  /** 波动止损参考 = close − 此倍 × ATR。 */
  ATR_STOP_MULT: number
  /** K 线取数并发(持仓通常 ≤10 只,远小于选股全扫)。 */
  CONCURRENCY: number
  /** 单次请求持仓代码数上限(防滥用)。 */
  MAX_CODES: number
}

export const HOLDINGS = {
  KLINE_COUNT: 280,
  ATR_PERIOD: 14,
  ATR_STOP_MULT: 2,
  CONCURRENCY: 4,
  MAX_CODES: 30,
} as const satisfies HoldingsConfig

/** 股东户数确认因子(数据侧,纯展示·不进规则层·不影响回测)。 */
export const HOLDERNUM = {
  BATCH_SIZE: 40, // 单请求 in(...) 代码数上限(URL 长度安全;RPT_HOLDERNUMLATEST 每股仅最新一行)
  MAX_CODES: 120, // 单轮 enrich 代码数上限(防未来榜单膨胀拖慢扫描)
} as const

/** 解禁角标(纯展示·不进规则层·不影响回测):候选未来 N 日内有限售解禁批次则挂风险角标。 */
export const LIFTBAN = {
  FORWARD_DAYS: 30, // 前瞻窗(日历日;30 天窗全市场实测仅 ~136 行,单页拉完)
  MAX_PAGES: 6, // 翻页上限(500/页,3000 行只防上游异常膨胀)
} as const

/** 机构调研聚合(展示用)。 */
export const ORG_SURVEY_BOARD = {
  LOOKBACK_TRADING_DAYS: 20, // 机构调研聚合回看窗(交易日)
  MAX: 40, // 展示上限(20日窗口下全市场调研覆盖面广,按机构家数砍到40是真实的关注度分水岭)
} as const
