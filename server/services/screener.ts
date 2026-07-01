// 新高战法选股器服务:全市场 clist 廉价初筛 → 入围者 K 线精筛(纯规则) →
// RS 百分位 + 评分 + 分组 → 缓存 + 按日落盘 docs/screener/YYYY-MM-DD.json。
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createCache, sessionTtl, isAShareSession } from '../lib/cache'
import { pickLatestArchiveName, parseScreenerArchiveName, isScreenerResult } from './screenerArchive'
import { isDbReady, upsertScreenerSnapshot, getRecentScreenerSnapshots } from '../db/pgDatabase'
import { computeStreaks } from './screenerStreak'
import { EM_HEADERS } from '../lib/emHeaders'
import { fetchStockKline, fetchIndexKline } from './ashare'
import { fetchSentiment } from './kaipanla'
import { SCREENER as C, PULLBACK, HIGHDIV, VOLBREAK, FUNDRES, BHOLD, TRENDNEW, TRENDWATCH, ACCUM, type ScreenerConfig } from '../config/screener'
import { classify, finalScore, marketRegime, targetRMultFor, enrichRelStrength, type Bar, type Candidate, type MarketRegime } from './screenerRules'
import { classifyPullback, type PullbackCandidate } from './pullbackRules'
import { classifyHighDivergence, type HighDivCandidate } from './divergenceRules'
import { classifyVolBreakout, type VolBreakCandidate } from './volBreakoutRules'
import { classifyFundResonance, type FundResCandidate } from './fundResonanceRules'
import { classifyBreakoutHold, type BreakoutHoldCandidate } from './breakoutHoldRules'
import { classifyTrendNewHigh, type TrendNewCandidate } from './trendNewHighRules'
import { classifyTrendLeader, type TrendLeaderCandidate } from './trendLeaderRules'
import { classifyAccum, type AccumCandidate } from './accumRules'
import { technicalCombo, techMult, type TechnicalCombo } from './technicalScore'
import { boardStrengthAsOf } from './rotationRules'
import { resolveStockIndustryBoard } from './rotation'
import { fetchTradingDates } from './moneyflow'
import { fetchRecentOrgSurvey } from './orgSurvey'
import { fetchInflowRankTop, fetchFundFlowForCodes, isFundFlowEnabled, type FundFlowInfo } from './fundFlow'
import { buildLhbIndex, lhbFactorFor } from './lhbHistory'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')

/** 龙虎榜加分(近 K 交易日机构/游资/资金净买埋伏)。金额单位:元。 */
export interface LhbConfluence {
  onDays: number // 近 K 日上榜天数
  net: number // 全口径净买入和
  instDays: number // 机构专用净买天数
  instNet: number // 机构专用净买和
  hotDays: number // 知名游资净买天数
  hotNet: number // 知名游资净买和
  score: number // 0..1 加分
}

/** 板块强弱加分(个股所属行业板块当前 2×2 象限)。 */
export interface BoardConfluence {
  code: string // BKxxxx
  name: string // 板块名
  quadrant: string // hs/ls/hw/lw
  shortChg: number // 近短窗涨幅%
  strong: boolean // 短窗为正(轮动顺风)
  score: number // 0..1 加分
}

export interface ScreenerCandidate extends Candidate {
  code: string
  name: string
  score: number
  /** 龙虎榜加分(无则不存在=该股近 K 日未上榜)。 */
  lhbInst?: LhbConfluence
  /** 板块强弱加分(无则不存在=板块数据不可用)。 */
  board?: BoardConfluence
  /** 连续出现天数:含今天、回溯历史快照算出的连续入选交易日数(任意榜单口径,最小 1)。 */
  appearStreak?: number
  /** 技术分析组合(Wyckoff+道氏+AlBrooks 量价);全战法整体评分因子。 */
  ta?: TechnicalCombo
}

/** 回调二次启动候选(第三组):新高战法外的另一类形态,见 pullbackRules.classifyPullback。 */
export interface PullbackScreenerCandidate extends PullbackCandidate {
  code: string
  name: string
  /** 龙虎榜加分(机构/游资,无则未上榜)。 */
  lhbInst?: LhbConfluence
  /** 连续出现天数(任意榜单口径,含今天,最小 1)。 */
  appearStreak?: number
  /** 技术分析组合(Wyckoff+道氏+AlBrooks 量价);全战法整体评分因子。 */
  ta?: TechnicalCombo
}

/** 连续新高·分歧低吸候选(第四组):缩量十字星守MA5,纯OHLCV,见 divergenceRules.classifyHighDivergence。 */
export interface HighDivScreenerCandidate extends HighDivCandidate {
  code: string
  name: string
  /** 今日换手率%(clist f8);过高→已降 tier + 风险标注。 */
  turnoverRate?: number
  /** 龙虎榜加分(机构/游资,无则未上榜)。 */
  lhbInst?: LhbConfluence
  /** 板块强弱加分(无则不存在=板块数据不可用);quadrant==='hs' 时属今日抱团强势板块内的分歧候选。 */
  board?: BoardConfluence
  /** 连续出现天数(任意榜单口径,含今天,最小 1)。 */
  appearStreak?: number
  /** 技术分析组合(Wyckoff+道氏+AlBrooks 量价);全战法整体评分因子。 */
  ta?: TechnicalCombo
}

/** 放量新高·资金驱动突破候选(第五组):MA5>MA21 + 持续放量 + 真·52周新高,见 volBreakoutRules.classifyVolBreakout。 */
export interface VolBreakScreenerCandidate extends VolBreakCandidate {
  code: string
  name: string
  /** 龙虎榜加分(机构/游资,无则未上榜)。 */
  lhbInst?: LhbConfluence
  /** 连续出现天数(任意榜单口径,含今天,最小 1)。 */
  appearStreak?: number
  /** 技术分析组合(Wyckoff+道氏+AlBrooks 量价);全战法整体评分因子。 */
  ta?: TechnicalCombo
}

/** 资金流共振·机构调研候选(第六组):放量+短期多头+机构近N日调研,见 fundResonanceRules.classifyFundResonance。
 *  可回测子集已过线(0.26R/PF2.08);主力净流入∩成交额「资金共振」为实盘加成(未回测,env 门控)。 */
export interface FundResScreenerCandidate extends FundResCandidate {
  code: string
  name: string
  /** 主力净流入∩成交额 资金共振(实盘 live·未回测;无则不在双榜交集或门控关闭)。 */
  fundFlow?: FundFlowInfo
  /** 龙虎榜加分(机构/游资,无则未上榜)。 */
  lhbInst?: LhbConfluence
  /** 连续出现天数(任意榜单口径,含今天,最小 1)。 */
  appearStreak?: number
  /** 技术分析组合(Wyckoff+道氏+AlBrooks 量价);全战法整体评分因子。 */
  ta?: TechnicalCombo
}

/** 突破整理·延续候选(第七组):放量大阳过前高 + 1~2根十字星整理 + 高低点双抬,见 breakoutHoldRules.classifyBreakoutHold。
 *  确认入场版回测 0.45R/PF1.90(所有战法最高);信号日=整理日,实战次日突破 trigger 介入。 */
export interface BHoldScreenerCandidate extends BreakoutHoldCandidate {
  code: string
  name: string
  /** 龙虎榜加分(机构/游资,无则未上榜)。 */
  lhbInst?: LhbConfluence
  /** 连续出现天数(任意榜单口径,含今天,最小 1)。 */
  appearStreak?: number
  /** 技术分析组合(Wyckoff+道氏+AlBrooks 量价);全战法整体评分因子。 */
  ta?: TechnicalCombo
}

/** 趋势新高候选(第八组):多头排列 + 贴/站上 52 周高 + 近期持续创新高,见 trendNewHighRules.classifyTrendNewHigh。
 *  纯 OHLCV,专收突破战法拦掉的「已走出来的趋势中军」;走查回测 0.28R/PF1.52(EXT15+NHlookback40 调优后)。 */
export interface TrendNewScreenerCandidate extends TrendNewCandidate {
  code: string
  name: string
  /** 龙虎榜加分(机构/游资,无则未上榜)。 */
  lhbInst?: LhbConfluence
  /** 连续出现天数(任意榜单口径,含今天,最小 1)。 */
  appearStreak?: number
  /** 技术分析组合(Wyckoff+道氏+AlBrooks 量价);全战法整体评分因子。 */
  ta?: TechnicalCombo
}

/** 趋势中军·监控候选(发现型视图,非战法):多头排列 + 持续创新高 + 连续站上 MA5,放宽收强/追高/贴高
 *  这些买点门槛,让已脱离 MA20 的强势龙头(京东方/士兰微/中国巨石)看得见。见 trendLeaderRules.classifyTrendLeader。
 *  【监控·非买点·未回测】。 */
export interface TrendWatchScreenerCandidate extends TrendLeaderCandidate {
  code: string
  name: string
  /** 龙虎榜加分(机构/游资,无则未上榜)。 */
  lhbInst?: LhbConfluence
  /** 连续出现天数(任意榜单口径,含今天,最小 1)。 */
  appearStreak?: number
  /** 技术分析组合(Wyckoff+道氏+AlBrooks 量价);全战法整体评分因子。 */
  ta?: TechnicalCombo
}

/** 放量吸筹·监控候选(发现型视图,非买点):持续异常放量 + 均线走平 + 横盘 = 主力箱体内吸筹/换手。
 *  核心硬门槛=持续放量;均线走平 + 横盘越久越加分。见 accumRules.classifyAccum。【监控·非买点·特征回测另裁决】。 */
export interface AccumScreenerCandidate extends AccumCandidate {
  code: string
  name: string
  /** 龙虎榜加分(机构/游资,无则未上榜)。 */
  lhbInst?: LhbConfluence
  /** 连续出现天数(任意榜单口径,含今天,最小 1)。 */
  appearStreak?: number
}

export interface ScreenerRegime {
  phase: 'attack' | 'caution' | 'retreat'
  temperature: number
  limitUp: number
  limitDown: number
  breakRate: number
  note: string
  /** 大盘趋势(指数代理):动态目标位的依据。 */
  marketTrend: MarketRegime
  /** 本次扫描据大盘趋势选定的目标位 R 倍数(动态关闭时=固定标量)。 */
  targetRMult: number
  /** 大盘(沪深300)当日涨跌幅%(相对强度参照;逆势红盘的"逆"即对此)。 */
  marketChgPct: number
}

export interface ScreenerResult {
  asof: string // YYYY-MM-DD
  regime: ScreenerRegime
  breakout: ScreenerCandidate[]
  trigger: ScreenerCandidate[]
  watch: ScreenerCandidate[] // 临界观察:突破/扳机近失的「放量逼近·待确认」票
  pullback: PullbackScreenerCandidate[] // 第三组:回调二次启动/圆弧底反包
  highdiv: HighDivScreenerCandidate[] // 第四组:连续新高·缩量十字星·守MA5 分歧低吸(回测 0.19R)
  volbreak: VolBreakScreenerCandidate[] // 第五组:放量新高·资金驱动突破(MA5>MA21+持续放量+真52周高,回测 0.27R/PF1.41)
  fundres: FundResScreenerCandidate[] // 第六组:资金流共振·机构调研(放量+短期多头+机构调研,回测 0.26R/PF2.08;资金共振为实盘加成)
  bhold: BHoldScreenerCandidate[] // 第七组:突破整理·延续(放量大阳过前高+十字星整理+高低点双抬,确认入场回测 0.45R/PF1.90)
  trendnew: TrendNewScreenerCandidate[] // 第八组:趋势新高(多头排列+持续创新高+贴52周高,纯OHLCV,回测 0.28R/PF1.52)
  trendwatch: TrendWatchScreenerCandidate[] // 趋势中军·监控(趋势新高的放宽超集,纯监控·非买点·未回测;排除已在 trendnew 的代码)
  accum: AccumScreenerCandidate[] // 放量吸筹·监控(持续异常放量+均线走平+横盘;纯监控·非买点·特征回测另裁决)
  scanned: number // 新高战法初筛后入围(取K线)只数
  scannedPullback: number // 回调战法初筛(量比榜)入围只数
  universe: number // clist 全市场只数
  truncated: boolean // 是否触及 MAX_KLINE 上限
  savedAt?: string // 落盘时刻(ISO);随存档持久化
  closed?: boolean // 扫描发生在收盘后(盘后快照);随存档持久化
  fromCache?: boolean // 本次响应来自磁盘存档兜底(仅内存标记,不落盘)
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

interface Pre {
  code: string
  name: string
  price: number
  amount: number // 成交额(元)
  mom60: number
  vr: number // 量比
  turnoverRate: number // 今日换手率%(clist f8;新高分歧换手风险过滤用)
}

const CLIST_FIELDS = 'f2,f3,f6,f8,f10,f12,f14,f20,f24,f25'
const CLIST_PZ = 100 // EM 每页上限 100,须翻页
// 多镜像主机轮换:分散负载 + 规避单主机反爬限流(push2delay 通常最宽松)。
const CLIST_HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '82.push2.eastmoney.com']

/** 取 clist 第 pn 页;镜像主机轮换 + 失败重试一次(东财限流容错)。 */
async function fetchClistPage(pn: number, attempt = 0): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  // 起始主机按页号轮换,失败再依次试其余主机。
  for (let i = 0; i < CLIST_HOSTS.length; i++) {
    const host = CLIST_HOSTS[(pn + i) % CLIST_HOSTS.length]
    const url =
      `https://${host}/api/qt/clist/get?pn=${pn}&pz=${CLIST_PZ}&po=1&np=1&fltt=2&invt=2&fid=f3` +
      `&fs=${encodeURIComponent(C.CLIST_FS)}&fields=${CLIST_FIELDS}`
    try {
      const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`clist HTTP ${res.status}`)
      const json = await res.json()
      return { rows: (json?.data?.diff ?? []) as Record<string, unknown>[], total: Number(json?.data?.total) || 0 }
    } catch {
      /* 试下一个镜像 */
    }
  }
  if (attempt < 1) {
    await new Promise((r) => setTimeout(r, 800))
    return fetchClistPage(pn, attempt + 1)
  }
  throw new Error('clist 全部镜像均失败')
}

/** Stage 1: 全市场 clist 翻页取数 + 廉价初筛。
 *  同一份 clist 产出两个切片:新高战法(按 60 日动量,mom60≥0)、回调战法(按量比,vr≥PB_VR_MIN)。
 *  回调票 mom60 常为负→不能用动量榜,改用量比榜(当日放量=二次启动触发,与该战法对齐)。 */
async function prefilter(): Promise<{ rows: Pre[]; pullbackRows: Pre[]; accumRows: Pre[]; universe: number; turnoverRankByCode: Map<string, number> }> {
  const first = await fetchClistPage(1)
  const total = first.total || first.rows.length
  const pages = Math.min(Math.ceil(total / CLIST_PZ), 60) // 安全上限 6000 只
  const diff: Record<string, unknown>[] = [...first.rows]
  // 顺序翻页 + 小延迟,避免并发突发触发东财 clist 反爬限流;某页失败则用已取到的优雅降级。
  for (let pn = 2; pn <= pages; pn++) {
    await new Promise((r) => setTimeout(r, 120))
    try {
      const page = await fetchClistPage(pn)
      if (page.rows.length === 0) break
      diff.push(...page.rows)
    } catch {
      console.warn(`[Screener] clist 第 ${pn} 页失败,使用已取 ${diff.length} 只继续`)
      break
    }
  }
  const universe = diff.length

  // 成交量(成交额 f6)排名:全市场(本 clist 宇宙,A股主板/创业/科创)按成交额降序,1-based。
  // 图里「成交量排名 top200」的实现,资金流共振卡片展示用;免费(prefilter 已取 f6),覆盖全部候选。
  const turnoverRankByCode = new Map<string, number>()
  const byTurnover = diff
    .map((d) => ({ code: String(d.f12 ?? ''), amt: num(d.f6) }))
    .filter((x) => x.code)
    .sort((a, b) => b.amt - a.amt)
  byTurnover.forEach((x, i) => turnoverRankByCode.set(x.code, i + 1))

  // 廉价基础过滤(ST/流动/市值),两战法共用。
  const base: Pre[] = []
  for (const d of diff) {
    const code = String(d.f12 ?? '')
    const name = String(d.f14 ?? '')
    const price = num(d.f2)
    const amount = num(d.f6)
    const mcap = num(d.f20)
    const mom60 = num(d.f24)
    const vr = num(d.f10)
    const turnoverRate = num(d.f8)
    if (!code || price <= 0) continue
    if (/ST|退/i.test(name)) continue // 剔除 ST/*ST/退市整理
    if (amount < C.LIQUIDITY_MIN) continue // 低流动
    if (mcap < C.MCAP_MIN) continue // 小市值
    base.push({ code, name, price, amount, mom60, vr, turnoverRate })
  }
  // 新高战法:留强势(mom60≥0),按 60 日动量排序(不掺量比——量比高会埋没"缩量待发"的扳机候选)。
  const rows = base.filter((p) => p.mom60 >= C.MOM60_MIN).sort((a, b) => b.mom60 - a.mom60)
  // 回调战法:不筛动量(回调票常为负),按当日量比(放量=二次启动触发)降序,量比达标者入围。
  const pullbackRows = base.filter((p) => p.vr >= PULLBACK.PB_VR_MIN).sort((a, b) => b.vr - a.vr)
  // 放量吸筹:不卡 mom60、不卡量比(低位横盘吸筹 mom60≈0/微负、当日量比可<1.3),按 换手率(float归一,
  // 偏小中盘换手)降序——持续吸筹/换手的票换手率持续偏高,即便当日是平静日;真·20日持续放量由K线规则精筛。
  const accumRows = base.slice().sort((a, b) => b.turnoverRate - a.turnoverRate)
  return { rows, pullbackRows, accumRows, universe, turnoverRankByCode }
}

/** 并集中的一只票:标记其所属切片(可同属两者,虽几乎互斥)。 */
interface UnionStock {
  p: Pre
  nh: boolean // 新高切片
  pb: boolean // 回调切片
  ac: boolean // 放量吸筹切片(换手率 top·不卡 mom60,专捞低位横盘吸筹)
}

/** Stage 2: 对一只票取一次 K 线,按所属切片跑 新高(classify) 与/或 回调(classifyPullback)。
 *  两战法 KLINE_COUNT 一致(300),故单次取数即可覆盖。cfg 可注入(动态目标位 R 倍数)。 */
async function confirmUnion(
  u: UnionStock,
  cfg: ScreenerConfig,
  stats: { fetched: number },
  surveyOrgs: number,
): Promise<{
  nh: (ScreenerCandidate & { liqAmount: number }) | null
  pb: PullbackScreenerCandidate | null
  hd: HighDivScreenerCandidate | null
  vb: VolBreakScreenerCandidate | null
  fr: FundResScreenerCandidate | null
  bh: BHoldScreenerCandidate | null
  tn: TrendNewScreenerCandidate | null
  tw: TrendWatchScreenerCandidate | null
  ac: AccumScreenerCandidate | null
}> {
  try {
    const { klines } = await fetchStockKline(u.p.code, 101, cfg.KLINE_COUNT)
    if (!klines || klines.length < cfg.MA_LONG + cfg.MA_LONG_RISE_LOOKBACK + 1) return { nh: null, pb: null, hd: null, vb: null, fr: null, bh: null, tn: null, tw: null, ac: null }
    stats.fetched++ // 取到足量K线(数据源健康度);match 与否是另一回事
    const bars = klines as Bar[]
    let nh: (ScreenerCandidate & { liqAmount: number }) | null = null
    let pb: PullbackScreenerCandidate | null = null
    let hd: HighDivScreenerCandidate | null = null
    let vb: VolBreakScreenerCandidate | null = null
    let fr: FundResScreenerCandidate | null = null
    let bh: BHoldScreenerCandidate | null = null
    let tn: TrendNewScreenerCandidate | null = null
    let tw: TrendWatchScreenerCandidate | null = null
    let ac: AccumScreenerCandidate | null = null
    if (u.nh) {
      const cand = classify(bars, cfg)
      if (cand) nh = { ...cand, code: u.p.code, name: u.p.name, score: 0, liqAmount: u.p.amount }
      // 连续新高分歧低吸跑在同一份强势股 K 线上(纯 OHLCV,无额外取数)
      const hdCand = classifyHighDivergence(bars, u.p.code, HIGHDIV)
      if (hdCand) {
        hd = { ...hdCand, code: u.p.code, name: u.p.name, turnoverRate: u.p.turnoverRate }
        // 换手过大软降级(线上 clist f8;绝对换手需流通盘故不进纯函数/回测):降 tier + 风险标注
        if (u.p.turnoverRate > HIGHDIV.TURNOVER_HOT) {
          hd.tier = Math.max(1, hd.tier - 1)
          hd.riskNote = `换手过大 ${u.p.turnoverRate.toFixed(1)}%·抛压重${hd.riskNote ? ' · ' + hd.riskNote : ''}`
        }
      }
    }
    if (u.pb) {
      const cand = classifyPullback(bars, PULLBACK)
      if (cand) pb = { ...cand, code: u.p.code, name: u.p.name }
    }
    // 放量新高·资金驱动突破:对全并集都跑(纯 OHLCV·K线已取,无额外取数;回测 0.27R/PF1.41)。
    // 不限于 nh 切片——其目标(刚从箱体突破、moderate 动量)常被 mom60 top600 截断(如兴发集团),
    // 且回测本就在全样本上验证,跑全并集与回测口径一致。
    const vbCand = classifyVolBreakout(bars, u.p.code, VOLBREAK)
    if (vbCand) vb = { ...vbCand, code: u.p.code, name: u.p.name }
    // 资金流共振·机构调研(对全并集都跑,纯 OHLCV·K线已取;surveyOrgs 由调用方按近窗口算好传入)。
    const frCand = classifyFundResonance(bars, u.p.code, surveyOrgs, FUNDRES)
    if (frCand) fr = { ...frCand, code: u.p.code, name: u.p.name }
    // 突破整理·延续(对全并集都跑,纯 OHLCV·K线已取;信号日=整理日,实战次日突破 trigger 介入)。
    const bhCand = classifyBreakoutHold(bars, u.p.code, BHOLD)
    if (bhCand) bh = { ...bhCand, code: u.p.code, name: u.p.name }
    // 趋势新高(对全并集都跑,纯 OHLCV·K线已取;专收突破战法拦掉的趋势中军,回测 0.28R/PF1.52)。
    const tnCand = classifyTrendNewHigh(bars, u.p.code, TRENDNEW)
    if (tnCand) tn = { ...tnCand, code: u.p.code, name: u.p.name }
    // 趋势中军·监控(对全并集都跑,纯 OHLCV·K线已取;趋势新高的放宽超集,非买点·未回测;组装时排除已在 trendnew 的代码)。
    const twCand = classifyTrendLeader(bars, u.p.code, TRENDWATCH)
    if (twCand) tw = { ...twCand, code: u.p.code, name: u.p.name }
    // 放量吸筹·监控(对全并集都跑,纯 OHLCV·K线已取;持续异常放量+均线走平+横盘,非买点·特征回测另裁决)。
    const acCand = classifyAccum(bars, u.p.code, ACCUM)
    if (acCand) ac = { ...acCand, code: u.p.code, name: u.p.name }
    // 技术分析组合(Wyckoff+道氏+AlBrooks 量价)—— 全战法整体评分因子,K 线在手算一次,挂到各命中候选。
    const ta = technicalCombo(bars, u.p.code)
    if (nh) nh.ta = ta
    if (pb) pb.ta = ta
    if (hd) hd.ta = ta
    if (vb) vb.ta = ta
    if (fr) fr.ta = ta
    if (bh) bh.ta = ta
    if (tn) tn.ta = ta
    if (tw) tw.ta = ta
    return { nh, pb, hd, vb, fr, bh, tn, tw, ac }
  } catch {
    return { nh: null, pb: null, hd: null, vb: null, fr: null, bh: null, tn: null, tw: null, ac: null }
  }
}

/** 取大盘趋势(指数代理)→ 动态目标位 R 倍数 + 大盘当日涨跌幅(相对强度用)。失败兜底中性/0。
 *  另并行取双创(创业板指/科创50)当日涨跌幅,供相对大盘强度按板块动态换基准(见 relBenchmarkFor);
 *  单独取数失败时兜底退回沪深300 marketChgPct,与既有单基准行为一致,不引入新失败模式。 */
async function resolveMarketTarget(): Promise<{
  marketTrend: MarketRegime
  targetRMult: number
  marketChgPct: number
  chinextChgPct: number
  star50ChgPct: number
}> {
  const base = await (async () => {
    try {
      const idx = await fetchIndexKline(C.MARKET_INDEX_SECID, C.MARKET_MA_SLOW + 10)
      const closes = idx.map((b) => b.close)
      const marketTrend = marketRegime(closes)
      // 大盘当日涨跌幅:最后两根 close(零额外取数,这段 K 线已为趋势档位取过)。
      const n = closes.length
      const marketChgPct = n >= 2 && closes[n - 2] > 0 ? (closes[n - 1] / closes[n - 2] - 1) * 100 : 0
      return { marketTrend, targetRMult: targetRMultFor(marketTrend), marketChgPct }
    } catch {
      return { marketTrend: 'neutral' as MarketRegime, targetRMult: targetRMultFor('neutral'), marketChgPct: 0 }
    }
  })()
  const chgPctOf = async (secid: string): Promise<number> => {
    try {
      const k = await fetchIndexKline(secid, 2)
      const n = k.length
      return n >= 2 && k[n - 2].close > 0 ? (k[n - 1].close / k[n - 2].close - 1) * 100 : base.marketChgPct
    } catch {
      return base.marketChgPct
    }
  }
  const [chinextChgPct, star50ChgPct] = await Promise.all([
    chgPctOf(C.CHINEXT_INDEX_SECID),
    chgPctOf(C.STAR50_INDEX_SECID),
  ])
  return { ...base, chinextChgPct, star50ChgPct }
}

/** 有界并发。 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const cur = i++
      out[cur] = await fn(items[cur])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** 给候选挂上「龙虎榜机构/游资净买」+「板块强弱」加分(best-effort:失败/取不到数据则该因子缺省=中性,不伤分)。
 *  龙虎榜对 新高 + 回调 候选都挂(近 K 日索引取一次,全候选共享);板块强弱给 新高 + 连续新高分歧低吸(highdiv)——
 *  后者用于识别"今日抱团强势板块(HS象限)内的分歧低吸候选"(quadrant==='hs')。 */
async function enrichConfluence(
  nhCands: (ScreenerCandidate & { liqAmount: number })[],
  pbCands: PullbackScreenerCandidate[],
  frCands: FundResScreenerCandidate[],
  bhCands: BHoldScreenerCandidate[],
  tnCands: TrendNewScreenerCandidate[],
  hdCands: HighDivScreenerCandidate[],
): Promise<void> {
  const lhbTargets: Array<{ code: string; lhbInst?: LhbConfluence }> = [...nhCands, ...pbCands, ...frCands, ...bhCands, ...tnCands, ...hdCands]
  if (lhbTargets.length === 0) return
  // ① 龙虎榜:近 K 交易日机构/游资/资金净买(新高 + 回调 候选共享同一索引)
  try {
    const dates = await fetchTradingDates() // 降序(最近在前)
    const win = dates.slice(0, C.LHB_LOOKBACK_K + 1)
    if (win.length) {
      const lhbIndex = await buildLhbIndex(win, { institutional: C.LHB_INSTITUTIONAL, concurrency: 4 })
      for (const c of lhbTargets) {
        const f = lhbFactorFor(c.code, win, lhbIndex)
        if (f.onDays > 0) {
          c.lhbInst = {
            onDays: f.onDays,
            net: f.netSum,
            instDays: f.instDays,
            instNet: f.instNetSum,
            hotDays: f.hotDays,
            hotNet: f.hotNetSum,
            score: f.score01,
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Screener] 龙虎榜加分取数失败(忽略):', err instanceof Error ? err.message : err)
  }
  // ② 板块强弱:新高 + highdiv 候选(回调等其余组不展示板块)。个股→行业板块→板块日线→当前 2×2 强弱(同板块 closes 缓存复用)
  try {
    const closesByBk = new Map<string, number[]>()
    await mapLimit([...nhCands, ...hdCands], 6, async (c) => {
      const { bk, name } = await resolveStockIndustryBoard(c.code)
      if (!bk) return
      let closes = closesByBk.get(bk)
      if (!closes) {
        try {
          const bars = await fetchIndexKline(`90.${bk}`, C.BOARD_LONG_WIN + 30)
          closes = bars.map((b) => b.close)
        } catch {
          closes = []
        }
        closesByBk.set(bk, closes)
      }
      if (closes.length === 0) return
      const s = boardStrengthAsOf(closes, closes.length - 1, C.BOARD_LONG_WIN, C.BOARD_SHORT_WIN)
      if (s) c.board = { code: bk, name, quadrant: s.quadrant, shortChg: s.shortChg, strong: s.strong, score: s.score01 }
    })
  } catch (err) {
    console.warn('[Screener] 板块加分取数失败(忽略):', err instanceof Error ? err.message : err)
  }
}

/** 全市场近 SURVEY_LOOKBACK 个交易日的机构调研家数(code→orgs)。best-effort:失败给空 Map(规则得 0)。 */
async function resolveRecentSurvey(): Promise<Map<string, number>> {
  try {
    const dates = await fetchTradingDates() // 降序(最近在前)
    if (!dates.length) return new Map()
    const fromDate = dates[Math.min(FUNDRES.SURVEY_LOOKBACK - 1, dates.length - 1)]
    const agg = await fetchRecentOrgSurvey(fromDate)
    const out = new Map<string, number>()
    for (const [code, a] of agg) out.set(code, a.orgs)
    return out
  } catch (err) {
    console.warn('[Screener] 机构调研取数失败(忽略):', err instanceof Error ? err.message : err)
    return new Map()
  }
}

/** 给资金流共振候选挂 fundFlow:成交量排名(免费,prefilter 全市场)+ 主力净流入值/排名/资金共振(实盘·未回测·env 门控)。
 *  成交量排名始终展示;主力净流入(买1买2主动净买)随门控,取不到时仅留成交量排名。best-effort。 */
async function enrichFundFlow(frCands: FundResScreenerCandidate[], turnoverRankByCode: Map<string, number>): Promise<void> {
  if (frCands.length === 0) return
  // ① 主力净流入「值」+ 排名(实盘·未回测·env 门控);关闭/失败 → 空。
  let valueByCode = new Map<string, { netInflow: number; netInflowPct: number }>()
  let inflowRankByCode = new Map<string, number>()
  if (isFundFlowEnabled()) {
    try {
      ;[valueByCode, inflowRankByCode] = await Promise.all([
        fetchFundFlowForCodes(frCands.map((c) => c.code)),
        fetchInflowRankTop(200),
      ])
    } catch (err) {
      console.warn('[Screener] 主力净流入取数失败(忽略):', err instanceof Error ? err.message : err)
    }
  }
  // ② 组装:成交量排名(免费)恒挂;主力净流入随门控;资金共振=双 top200。
  for (const c of frCands) {
    const turnoverRank = turnoverRankByCode.get(c.code)
    const v = valueByCode.get(c.code)
    const inflowRank = inflowRankByCode.get(c.code)
    const resonance = inflowRank != null && inflowRank <= 200 && turnoverRank != null && turnoverRank <= 200
    if (turnoverRank == null && !v && inflowRank == null) continue // 全无数据则不挂
    c.fundFlow = {
      netInflow: v?.netInflow,
      netInflowPct: v?.netInflowPct,
      turnoverRank,
      inflowRank,
      resonance,
    }
  }
}

/** 技术分析组合(TA)整体评分:其余组 score 按 ta 因子缩放(供给压低/需求抬高);distribution(派发)降一档 + ⚠。
 *  适用带 tier+riskNote 的组(highdiv/volbreak/fundres/bhold);pullback 仅 score 缩放(无 tier)单独处理。 */
function applyTaPenalty<T extends { score: number; tier: number; riskNote?: string; ta?: TechnicalCombo }>(cands: T[]): void {
  for (const c of cands) {
    if (!c.ta) continue
    c.score = Math.round(c.score * techMult(c.ta.score01))
    if (c.ta.distribution) {
      c.tier = Math.max(1, c.tier - 1)
      const warn = `疑似派发出货/冲高回落${c.ta.tags[0] ? '·' + c.ta.tags[0] : ''}`
      c.riskNote = c.riskNote ? `${warn} · ${c.riskNote}` : warn
    }
  }
}

function buildRegime(s: {
  temperature?: number
  limitUp?: number
  limitDown?: number
  breakRate?: number
}): ScreenerRegime {
  const temperature = num(s.temperature)
  const limitUp = num(s.limitUp)
  const limitDown = num(s.limitDown)
  const breakRate = num(s.breakRate)
  let phase: ScreenerRegime['phase']
  let note: string
  if (temperature >= 60 && breakRate < 30) {
    phase = 'attack'
    note = '情绪偏暖、破板率可控,题材友好——可正常打突破'
  } else if (temperature <= 40 || breakRate >= 40) {
    phase = 'retreat'
    note = '情绪退潮/破板率高——降仓,突破假信号多,谨慎或观望'
  } else {
    phase = 'caution'
    note = '情绪中性——小仓优选龙头突破,严格止损'
  }
  // marketTrend/targetRMult/marketChgPct 先给安全默认,由 fetchScreenerFresh 取指数后回填。
  return { phase, temperature, limitUp, limitDown, breakRate, note, marketTrend: 'neutral', targetRMult: C.TARGET_R_MULT, marketChgPct: 0 }
}

function todayStr(): string {
  // 用 Shanghai 日期作为存档键
  const now = new Date()
  const sh = new Date(now.getTime() + now.getTimezoneOffset() * 60_000 + 8 * 3_600_000)
  return `${sh.getFullYear()}-${String(sh.getMonth() + 1).padStart(2, '0')}-${String(sh.getDate()).padStart(2, '0')}`
}

async function fetchScreenerFresh(): Promise<ScreenerResult> {
  const asof = todayStr()
  const t0 = Date.now()

  // Regime(尽力而为,失败给中性)
  let regime: ScreenerRegime
  try {
    regime = buildRegime((await fetchSentiment()) as Record<string, number>)
  } catch {
    regime = {
      phase: 'caution', temperature: 0, limitUp: 0, limitDown: 0, breakRate: 0,
      note: '情绪数据暂不可用', marketTrend: 'neutral', targetRMult: C.TARGET_R_MULT, marketChgPct: 0,
    }
  }

  // 大盘趋势 → 动态目标位 R(逆向:弱市新高=龙头给更远目标)+ 大盘当日涨跌幅(相对强度)。回填 regime + 注入扫描 cfg。
  const { marketTrend, targetRMult, marketChgPct, chinextChgPct, star50ChgPct } = await resolveMarketTarget()
  regime.marketTrend = marketTrend
  regime.targetRMult = targetRMult
  regime.marketChgPct = Math.round(marketChgPct * 100) / 100
  const scanCfg: ScreenerConfig = { ...C, TARGET_R_MULT: targetRMult, MARKET_CHG_PCT: marketChgPct }
  // 相对大盘强度按板块动态换基准:300/301(创业板)→ 创业板指、688(科创板)→ 科创50,其余仍用沪深300。
  const relBenchmarkFor = (code: string): number =>
    code.startsWith('300') || code.startsWith('301') ? chinextChgPct
      : code.startsWith('688') ? star50ChgPct
      : marketChgPct

  const { rows, pullbackRows, accumRows, universe, turnoverRankByCode } = await prefilter()
  const truncated = rows.length > C.MAX_KLINE
  const nhSurvivors = rows.slice(0, C.MAX_KLINE)
  const pbSurvivors = pullbackRows.slice(0, C.MAX_KLINE)
  const acSurvivors = accumRows.slice(0, ACCUM.PREFILTER_MAX)
  // 三切片并集去重(同一只只取一次 K 线),记录所属切片。
  const unionMap = new Map<string, UnionStock>()
  for (const p of nhSurvivors) unionMap.set(p.code, { p, nh: true, pb: false, ac: false })
  for (const p of pbSurvivors) {
    const e = unionMap.get(p.code)
    if (e) e.pb = true
    else unionMap.set(p.code, { p, nh: false, pb: true, ac: false })
  }
  // 放量吸筹专用切片(换手率 top·不卡 mom60):并入并集,捞两切片漏掉的低位横盘吸筹。
  for (const p of acSurvivors) {
    const e = unionMap.get(p.code)
    if (e) e.ac = true
    else unionMap.set(p.code, { p, nh: false, pb: false, ac: true })
  }
  const union = [...unionMap.values()]
  if (truncated) console.log(`[Screener] 新高初筛 ${rows.length} 只 > 上限 ${C.MAX_KLINE},截断`)
  console.log(
    `[Screener] 全市场 ${universe} → 新高入围 ${nhSurvivors.length} / 回调入围 ${pbSurvivors.length} / 吸筹入围 ${acSurvivors.length} → 并集取K线 ${union.length};大盘 ${marketTrend} → 目标 ${targetRMult}R`,
  )

  // 机构调研:全市场近 SURVEY_LOOKBACK 个交易日的调研家数(按 code),供资金流共振规则。best-effort。
  const surveyByCode = await resolveRecentSurvey()

  const stats = { fetched: 0 }
  const confirmed = await mapLimit(union, C.CONCURRENCY, (u) =>
    confirmUnion(u, scanCfg, stats, surveyByCode.get(u.p.code) ?? 0),
  )
  const enriched = confirmed
    .map((r) => r.nh)
    .filter((x): x is ScreenerCandidate & { liqAmount: number } => x != null)
  const pullback = confirmed
    .map((r) => r.pb)
    .filter((x): x is PullbackScreenerCandidate => x != null)
    .sort((a, b) => b.score - a.score)
  const highdiv = confirmed
    .map((r) => r.hd)
    .filter((x): x is HighDivScreenerCandidate => x != null)
    .sort((a, b) => b.tier - a.tier || b.score - a.score)
  const volbreak = confirmed
    .map((r) => r.vb)
    .filter((x): x is VolBreakScreenerCandidate => x != null)
    .sort((a, b) => b.tier - a.tier || b.score - a.score)
  const fundres = confirmed
    .map((r) => r.fr)
    .filter((x): x is FundResScreenerCandidate => x != null)
    .sort((a, b) => b.tier - a.tier || b.score - a.score)
  const bhold = confirmed
    .map((r) => r.bh)
    .filter((x): x is BHoldScreenerCandidate => x != null)
    .sort((a, b) => b.tier - a.tier || b.score - a.score)
  const trendnew = confirmed
    .map((r) => r.tn)
    .filter((x): x is TrendNewScreenerCandidate => x != null)
    .sort((a, b) => b.tier - a.tier || b.score - a.score)
  // 趋势中军·监控:趋势新高的放宽超集 → 排除已在 trendnew(买点战法)的代码,只留"买点战法看不见"的趋势龙头。
  const trendnewCodes = new Set(trendnew.map((x) => x.code))
  const trendwatch = confirmed
    .map((r) => r.tw)
    .filter((x): x is TrendWatchScreenerCandidate => x != null)
    .filter((x) => !trendnewCodes.has(x.code))
    .sort((a, b) => b.tier - a.tier || b.score - a.score)
  const accum = confirmed
    .map((r) => r.ac)
    .filter((x): x is AccumScreenerCandidate => x != null)
    .sort((a, b) => b.tier - a.tier || b.score - a.score)

  // 资金流加成:成交量排名(免费)+ 主力净流入/资金共振(实盘 live·未回测·env 门控)。
  await enrichFundFlow(fundres, turnoverRankByCode)

  // 龙虎榜机构/游资 + 板块强弱 加分(龙虎榜对新高+回调+资金流共振+突破整理+趋势新高+分歧低吸都挂,
  // 板块仅新高+分歧低吸(用于标出"抱团强势板块(HS)内的分歧候选");best-effort)
  await enrichConfluence(enriched, pullback, fundres, bhold, trendnew, highdiv)

  // 技术分析组合(Wyckoff+道氏+AlBrooks)整体评分:其余组 score 按 ta 因子缩放、distribution 降档+⚠,再按调整后重排。
  applyTaPenalty(highdiv)
  applyTaPenalty(volbreak)
  applyTaPenalty(fundres)
  applyTaPenalty(bhold)
  applyTaPenalty(trendnew)
  applyTaPenalty(trendwatch)
  for (const c of pullback) if (c.ta) c.score = Math.round(c.score * techMult(c.ta.score01))
  highdiv.sort((a, b) => b.tier - a.tier || b.score - a.score)
  volbreak.sort((a, b) => b.tier - a.tier || b.score - a.score)
  fundres.sort((a, b) => b.tier - a.tier || b.score - a.score)
  bhold.sort((a, b) => b.tier - a.tier || b.score - a.score)
  trendnew.sort((a, b) => b.tier - a.tier || b.score - a.score)
  // 相对大盘强度:给趋势中军监控打 relStrength/counterTrend(逆势强),并在截断前对逆势龙头加分(排前+保住名额)。
  enrichRelStrength(trendwatch, relBenchmarkFor, C.RELSTR.CRASH_DAY_PCT)
  for (const c of trendwatch) if (c.counterTrend) c.score = Math.round(c.score * C.RELSTR.COUNTER_BOOST)
  trendwatch.sort((a, b) => b.tier - a.tier || b.score - a.score)
  trendwatch.splice(TRENDWATCH.MAX) // 监控清单容量上限(末尾截断,保留分数高的趋势龙头)
  // 放量吸筹·监控:同为发现型清单,打 relStrength/counterTrend(逆势放量吸筹更值得留意),按分排序后截断。
  enrichRelStrength(accum, relBenchmarkFor, C.RELSTR.CRASH_DAY_PCT)
  for (const c of accum) if (c.counterTrend) c.score = Math.round(c.score * C.RELSTR.COUNTER_BOOST)
  accum.sort((a, b) => b.tier - a.tier || b.score - a.score)
  accum.splice(ACCUM.MAX) // 监控清单容量上限(末尾截断,保留高分吸筹票)
  pullback.sort((a, b) => b.score - a.score)

  // RS 百分位(在入围集内)+ 流动性归一 + 外部加分 → 评分
  const rs = enriched.map((c) => c.rsRaw).sort((a, b) => a - b)
  const rsRank = (v: number) => (rs.length <= 1 ? 1 : rs.filter((x) => x <= v).length / rs.length)
  for (const c of enriched) {
    const liq01 = clamp01(Math.log10(Math.max(c.liqAmount, 1) / C.LIQUIDITY_MIN) / 2)
    c.score = finalScore(c, rsRank(c.rsRaw), liq01, C, { lhb01: c.lhbInst?.score, board01: c.board?.score, ta01: c.ta?.score01 })
  }

  const strip = ({ liqAmount: _liq, ...rest }: ScreenerCandidate & { liqAmount: number }) => rest
  const breakout = enriched
    .filter((c) => c.group === 'breakout')
    .sort((a, b) => b.score - a.score)
    .map(strip)
  const trigger = enriched
    .filter((c) => c.group === 'trigger')
    .sort((a, b) => b.score - a.score)
    .map(strip)
  const watchAll = enriched.filter((c) => c.group === 'watch')
  // 相对大盘强度:临界观察也打 relStrength/counterTrend,逆势强加分 → 暴跌日逆势红盘能扛过 WATCH_MAX 截断。
  enrichRelStrength(watchAll, relBenchmarkFor, C.RELSTR.CRASH_DAY_PCT)
  for (const c of watchAll) if (c.counterTrend) c.score = Math.round(c.score * C.RELSTR.COUNTER_BOOST)
  const watch = watchAll
    .sort((a, b) => b.score - a.score)
    .slice(0, C.WATCH_MAX)
    .map(strip)

  const result: ScreenerResult = {
    asof,
    regime,
    breakout,
    trigger,
    watch,
    pullback,
    highdiv,
    volbreak,
    fundres,
    bhold,
    trendnew,
    trendwatch,
    accum,
    scanned: nhSurvivors.length,
    scannedPullback: pbSurvivors.length,
    universe,
    truncated,
  }

  // 连续出现天数:回溯历史快照(DB 优先,否则磁盘)给每只候选打 appearStreak。
  // 放在落盘/入库之前 → 持久化的快照里也带 streak(重载即正确,幂等)。
  try {
    const all = [...breakout, ...trigger, ...watch, ...pullback, ...highdiv, ...volbreak, ...fundres, ...bhold, ...trendnew, ...trendwatch, ...accum]
    const todayCodes = new Set(all.map((c) => c.code))
    const priorSets = await loadRecentCodeSets(asof, 30)
    const streaks = computeStreaks(todayCodes, priorSets)
    for (const c of all) c.appearStreak = streaks.get(c.code) ?? 1
  } catch (err) {
    console.warn('[Screener] 连续出现天数计算失败(非致命):', err)
  }

  // 完成日志:取K线成功率(fetched/union 偏低=数据源不健康,真·卡顿信号)+ 命中数 + 耗时。
  console.log(
    `[Screener] 完成:取K线 ${stats.fetched}/${union.length} 成功 → 命中 突破 ${breakout.length} / 扳机 ${trigger.length} / 临界 ${watch.length} / 回调 ${pullback.length} / 新高分歧 ${highdiv.length} / 放量新高 ${volbreak.length} / 资金流共振 ${fundres.length} / 突破整理 ${bhold.length} / 趋势新高 ${trendnew.length} / 趋势中军 ${trendwatch.length} / 放量吸筹 ${accum.length},耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )

  // 按日落盘(无DB也可回看,并作为重启/盘后/过0点的磁盘兜底);失败不影响返回。
  // 防污染:取K线成功率过低(数据源限流/异常)时跳过,避免用残缺结果覆盖当日好快照。
  const healthy = union.length === 0 || stats.fetched >= union.length * 0.6
  if (healthy) {
    result.savedAt = new Date().toISOString()
    result.closed = !isAShareSession()
    try {
      mkdirSync(SCREENER_DIR, { recursive: true })
      writeFileSync(join(SCREENER_DIR, `${asof}.json`), JSON.stringify(result, null, 2))
    } catch (err) {
      console.warn('[Screener] 存档失败(非致命):', err)
    }
    // 同时存一份到数据库(best-effort,仅连库时;失败不影响返回)。
    if (isDbReady()) {
      try {
        await upsertScreenerSnapshot({
          asof: result.asof,
          resultJson: JSON.stringify(result),
          regimePhase: result.regime?.phase,
          universe: result.universe,
          scanned: result.scanned,
          closed: result.closed,
        })
      } catch (dbErr) {
        console.warn('[Screener] DB 快照写入失败(非致命):', dbErr)
      }
    }
  } else {
    console.warn(`[Screener] 取K线成功率过低(${stats.fetched}/${union.length}),跳过存档以免覆盖好快照`)
  }

  return result
}

/** 读单个日期的存档(损坏/不合法→null)。 */
function loadArchive(date: string): ScreenerResult | null {
  try {
    const raw = JSON.parse(readFileSync(join(SCREENER_DIR, `${date}.json`), 'utf8'))
    if (!isScreenerResult(raw)) return null
    return { ...raw, fromCache: true } // 标记本次来自磁盘兜底(仅内存)
  } catch {
    return null
  }
}

/**
 * 读「最新存在的」盘后快照,作为内存缓存的冷启动种子 + 抓取失败兜底。
 * 永远取目录里最新的 YYYY-MM-DD.json(周末/节假日自然回退到上一交易日存档),
 * 不按 todayStr() 取键 —— 周六会返回周五的快照。
 */
function loadLatestArchive(): ScreenerResult | null {
  let files: string[]
  try {
    files = readdirSync(SCREENER_DIR)
  } catch {
    return null // 目录还不存在
  }
  const ref = pickLatestArchiveName(files)
  return ref ? loadArchive(ref.date) : null
}

/** 一份快照里五组候选的 code 并集(任意榜单口径;旧快照缺 watch/highdiv 时容错)。 */
function unionCodes(r: ScreenerResult): Set<string> {
  return new Set(
    [
      ...(r.breakout ?? []),
      ...(r.trigger ?? []),
      ...(r.watch ?? []),
      ...(r.pullback ?? []),
      ...(r.highdiv ?? []),
      ...(r.volbreak ?? []),
      ...(r.fundres ?? []),
      ...(r.bhold ?? []),
      ...(r.trendnew ?? []),
      ...(r.trendwatch ?? []),
      ...(r.accum ?? []),
    ].map((c) => c.code),
  )
}

/**
 * 取最近 `limit` 份历史快照的 code 集合,按日期 DESC、不含 `excludeDate`(今天)。
 * DB 优先(连库时),失败/未连则回退磁盘 docs/screener。供「连续出现天数」回溯用。
 */
async function loadRecentCodeSets(excludeDate: string, limit: number): Promise<Set<string>[]> {
  if (isDbReady()) {
    try {
      const rows = await getRecentScreenerSnapshots(limit + 1) // +1 容下今天再过滤
      const sets: Set<string>[] = []
      for (const row of rows) {
        if (row.asof === excludeDate) continue
        try {
          sets.push(unionCodes(JSON.parse(row.result_json) as ScreenerResult))
        } catch {
          // 损坏行跳过
        }
        if (sets.length >= limit) break
      }
      // DB 尚未攒到历史(刚启用)时落空 → 回退磁盘,沿用既有 docs/screener 历史。
      if (sets.length > 0) return sets
    } catch (err) {
      console.warn('[Screener] DB 历史快照读取失败,回退磁盘:', err)
    }
  }

  let files: string[]
  try {
    files = readdirSync(SCREENER_DIR)
  } catch {
    return []
  }
  const refs = files
    .map(parseScreenerArchiveName)
    .filter((x): x is NonNullable<ReturnType<typeof parseScreenerArchiveName>> => x != null && x.date !== excludeDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1)) // DESC
    .slice(0, limit)
  const sets: Set<string>[] = []
  for (const ref of refs) {
    const r = loadArchive(ref.date)
    if (r) sets.push(unionCodes(r))
  }
  return sets
}

// 盘后长 TTL:收盘后(含周末/节假日)缓存/磁盘种子一直被服务、不自动重扫,
// 杜绝盘后反复打接口(防超限);手动「每日扫描」走 clearScreenerCache() 绕过。
// 次日 09:30 开盘 → isAShareSession 翻 true → TTL 回到 2min,自动重新抓取(自愈)。
const CLOSED_TTL = 12 * 3_600_000

const screenerCache = createCache<ScreenerResult>({
  name: 'Screener',
  ttl: sessionTtl(120_000, CLOSED_TTL),
  fetcher: fetchScreenerFresh,
  fallback: loadLatestArchive,
})

export function fetchScreener(): Promise<ScreenerResult> {
  return screenerCache.get()
}

export function clearScreenerCache(): void {
  screenerCache.clear()
}
