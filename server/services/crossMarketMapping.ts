import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const CROSS_MARKET_MODEL_VERSION = 'cross-market-v1-research'
export const CROSS_MARKET_GRAPH_VERSION = 'evidence-graph-v1'

export type CrossMarketPhase = 'premarket' | 'auction' | 'open'
export type ProbabilityStatus = 'unavailable' | 'research-score' | 'calibrated'
export type DataQualityStatus = 'full' | 'degraded' | 'unavailable'
export type ResearchStatus = 'rejected' | 'research' | 'paper-trade' | 'eligible'
/**
 * When a phase snapshot's data was actually captured relative to the scheduled
 * freeze cutoff. Only `on-time` snapshots are written to the formal archive and
 * may enter the same-time liquidity baseline. `late-live` results exist solely
 * for live research display and must never be persisted.
 */
export type CaptureStatus = 'on-time' | 'late-live' | 'unavailable'

export interface CoreUsAsset {
  ticker: string
  name: string
  assetType: 'equity' | 'etf' | 'macro-proxy'
  sectorGroup: string
  role: 'industry-leader' | 'mapping-anchor' | 'market-control'
  effectiveFrom: string
  effectiveTo: string | null
}

export interface EvidenceEdge {
  edgeId: string
  fromTicker: string
  fromNode: string
  toNode: string
  relationType: 'product' | 'technology' | 'supply-chain' | 'theme' | 'company'
  direction: 'positive' | 'negative' | 'mixed'
  evidenceGrade: 'A' | 'B' | 'C' | 'D'
  sourceUrls: string[]
  sourcePublishedAt: string[]
  effectiveFrom: string
  effectiveTo: string | null
  status: ResearchStatus
  supportSessions: number
  posteriorMean: number | null
  posteriorLowerBound: number | null
  modelEligible: boolean
  rejectionReason?: string
}

export interface SourceShock {
  ticker: string
  sessionDate: string
  returnPct: number | null
  abnormalReturnPct: number | null
  returnZ: number | null
  volumeZ: number | null
  eventFlag: boolean
  sourceAvailable: boolean
  warnings: string[]
}

export interface ThemePrediction {
  theme: string
  baseScore?: number | null
  externalAdjustment?: number | null
  cycleAdjustment?: number | null
  liquidityAdjustment?: number | null
  burstProbability: number | null
  tradableProbability: number | null
  burstScore: number | null
  tradableScore: number | null
  status: ProbabilityStatus
  evidenceGrade: EvidenceEdge['evidenceGrade'] | 'none'
  drivers: string[]
  auctionConfirmation: '强化' | '背离' | '未确认' | '不可用'
  openConfirmation: '强化' | '背离' | '未确认' | '不可用'
  warnings: string[]
}

export type LiquidityRegimeState =
  | 'stock-crowding'
  | 'incremental-broad'
  | 'balanced'
  | 'unavailable'

export interface LiquidityRegimeSnapshot {
  phase: CrossMarketPhase
  cutoffAt: string
  source: 'full-market-clist' | 'unavailable'
  totalAmount: number | null
  baselineSessions: number
  sameTimeTurnoverRatio: number | null
  turnoverZ: number | null
  advanceRatePct: number | null
  top50AmountSharePct: number | null
  concentrationDeltaPct: number | null
  largeSmallSpreadPct: number | null
  state: LiquidityRegimeState
  confidence: number
  warnings: string[]
}

export type CapitalLaneId =
  | 'hard-tech'
  | 'innovative-drug'
  | 'small-theme'
  | 'index-weight'

export interface CapitalSeesawLane {
  id: CapitalLaneId
  label: string
  externalShock: number
  domesticCycle: number
  auctionConfirmation: number
  openConfirmation: number
  liquidityAdjustment: number
  interactionAdjustment: number
  netResearchScore: number
  state: '强化' | '分化' | '背离' | '观察' | '不可用'
  reasons: string[]
  warnings: string[]
}

export interface CapitalTransfer {
  from: CapitalLaneId
  to: CapitalLaneId
  strength: number
  label: '统计关联' | '资金偏移'
  reasons: string[]
}

export interface CapitalSeesawMatrix {
  phase: CrossMarketPhase
  generatedAt: string
  status: ProbabilityStatus
  lanes: CapitalSeesawLane[]
  transfers: CapitalTransfer[]
  warnings: string[]
}

export interface StockPrediction {
  code: string
  name: string
  theme: string
  leaderProbability: number | null
  leaderScore: number | null
  status: ProbabilityStatus
  tradable: boolean
  drivers: string[]
  rejectionReason?: string
}

export interface CrossMarketDataQuality {
  status: DataQualityStatus
  sourceCoveragePct: number
  staleSources: string[]
  missingSources: string[]
  warnings: string[]
}

export interface CrossMarketSnapshot {
  tradeDate: string
  scheduledCutoffAt: string
  capturedAt: string
  captureStatus: CaptureStatus
  cutoffAt: string
  generatedAt: string
  phase: CrossMarketPhase
  modelVersion: string
  graphVersion: string
  probabilityStatus: ProbabilityStatus
  researchStatus: ResearchStatus
  dataQuality: CrossMarketDataQuality
  liquidityRegime?: LiquidityRegimeSnapshot
  capitalSeesaw?: CapitalSeesawMatrix
  sourceShocks: SourceShock[]
  themePredictions: ThemePrediction[]
  stockPredictions: StockPrediction[]
  rejectedMappings: Array<{ edgeId: string; reason: string }>
  warnings: string[]
}

export interface CrossMarketSettledTheme {
  id: 'cpo' | 'innovative-drug'
  label: string
  source: 'eastmoney-industry-proxy' | 'unavailable'
  constituentCount: number
  themeReturnPct: number | null
  benchmarkReturnPct: number | null
  excessReturnPct: number | null
  positiveBreadthPct: number | null
  amount: number | null
  amountRatio20: number | null
  returnZ: number | null
  limitUpCount: number | null
  firstBoardCount: number | null
  strongCoreCount: number | null
  cycle: {
    state: 'climax' | 'normal' | 'adjustment' | 'unavailable'
    climaxScore: number
    cycleComponent: number
    metCriteria: string[]
    availableCriteria: number
    warnings: string[]
  }
  outcome: 'continuation' | 'differentiation' | 'collapse' | 'unavailable'
  warnings: string[]
}

export interface CrossMarketSettlement {
  tradeDate: string
  generatedAt: string
  modelVersion: string
  status: 'settled' | 'degraded' | 'unavailable'
  themes: CrossMarketSettledTheme[]
  warnings: string[]
}

export interface ThemeLabelInput {
  code: string
  limitUp: boolean
  firstBoard: boolean
  onePriceLimitUp: boolean
  suspended: boolean
  st: boolean
  tradable: boolean
  themeReturnPct: number
  benchmarkReturnPct: number
}

export interface ThemeLabels {
  validThemeStockCount: number
  limitUpCount: number
  firstBoardCount: number
  burst: 0 | 1
  validTradableStockCount: number
  positiveExcessBreadth: number
  excessReturnPct: number
  tradable: 0 | 1
}

const EFFECTIVE_FROM = '2020-01-01'

// The pool is intentionally a source-asset registry, not a claim that every
// ticker has an active A-share edge. Edges are separately admitted by the
// evidence graph and historical tests.
const TICKERS = `
MSFT NVDA AMD AVGO INTC QCOM MU ARM TSM ASML AMAT LRCX KLAC MRVL ON NXPI TXN ADI MCHP STM GFS TER ENTG AMKR ACLS WDC STX SMCI DELL HPE IBM ORCL CRM SNOW PLTR PANW CRWD ZS NET DDOG MDB NOW SHOP UBER ABNB DASH
GOOGL GOOG META AMZN AAPL NFLX TSLA RIVN F GM F IONQ RGTI QUBT APP DUOL ROKU SPOT PINS SNAP TTD MTCH WBD DIS PARA CMCSA VZ T TMO
ADBE INTU ACN SAP SE TEAM HUBS DOCU ASAN OKTA BILL PAYC TWLO SQ PYPL V MA MA ARKK COIN HOOD SOFI AFRM NU RBLX EA TTWO ATVI U
SBUX MCD NKE LULU TGT WMT COST HD LOW TJX ROST DG DLTR KR CVS WBA PEP KO MNST KDP PM MO EL CLX PG UL UNH HUM CI CNC HCA
JNJ PFE MRNA BNTX GILD REGN BIIB AMGN VRTX ABBV LLY BMY MRK AZN NVO SGEN INCY EXAS ILMN ISRG SYK MDT BSX EW ZBH DXCM PODD ALGN RMD HOLX XRAY RGEN IQV ABT DHR
XBI IBB XLV SPY QQQ DIA IWM SMH SOXX IGV SKYY CLOU HACK BOTZ ROBO LIT TAN ICLN ARKK ARKG ARKF XLE XLF XLI XLY XLP XLK XLC XLU XLB XLP
JPM BAC WFC C C GS MS SCHW BLK BX KKR APO AXP DFS COF USB PNC TFC BK STT NTRS CME ICE CBOE SPGI MCO MSCI VRSK FIS FISV GPN ADP PAYX ALL TRV CB PGR MET PRU AFL AIG
XOM CVX COP OXY SLB HAL BKR EOG PXD MPC VLO PSX OKE KMI ENB EQT LNG CTRA DVN FANG APA CNQ SU RIG FCX SCCO NEM GOLD AEM RGLD WPM
LIN APD ECL SHW DD DOW LYB NUE STLD CLF AA CENX ALB SQM MP MOS CF FMC CAT DE CMI ETN EMR HON GE RTX LMT NOC GD BA UPS FDX UNP CSX NSC WM RSG
MMM PH ROK ITW FAST PAYC URI PWR VMC MLM JCI CARR TT DOV IR SBD SWK WAB GWW XYL WAT ZBRA KEYS ANSS CDNS SNPS ADSK PTC DHI LEN NVR PHM
TMUS TCOM BILI BIDU JD PDD NIO LI XPEV GRAB SE MELI BABA TSMC SONY NTES WB VIPS YUMC EDU TAL MNSO BEKE YMM
AXTI LITE MTSI COHR CIEN NOK ERIC INFN CAMT FORM ACMR UCTT AEHR IIVI SIMO SMTC DIOD POWI WOLF MPWR ENPH FSLR RUN PLUG BE STEM QS CHPT
MRVL WOLF CRDO ALAB ASTS RKLB LUNR SPCE JOBY ACHR AVAV KTOS IRDM VSAT MAXR
NVO SNDX VKTX HIMS TEM RXRX CRSP NTLA BEAM EDIT BLUE ABCL ARWR ALNY SRPT BMRN MGEN VCYT TWST PACB SANA VERV
RITM O REXR AMH PLD EQIX DLR CCI AMT SBAC WELL VICI RKT OPEN RDFN
GLD SLV GDX GDXJ COPX CPER USO UNG TLT HYG LQD UUP FXI KWEB EEM EFA VWO AGG SHY IEF TIP
` .trim().split(/\s+/)

const CORE_TICKERS = Array.from(new Set([
  'AXTI',
  'LITE',
  'MRNA',
  ...TICKERS.filter((ticker) => !['AXTI', 'LITE', 'MRNA'].includes(ticker)),
])).slice(0, 300)

export const CORE_US_ASSET_UNIVERSE: CoreUsAsset[] = CORE_TICKERS.map((ticker) => ({
  ticker,
  name: ticker,
  assetType: ['SPY', 'QQQ', 'DIA', 'IWM', 'SMH', 'SOXX', 'XBI', 'IBB', 'XLV', 'XLE', 'XLF', 'XLI', 'XLY', 'XLP', 'XLK', 'XLC', 'XLU', 'XLB', 'ARKK', 'ARKG', 'ARKF', 'XLE', 'GLD', 'SLV', 'GDX', 'GDXJ', 'COPX', 'CPER', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'UUP', 'FXI', 'KWEB', 'EEM', 'EFA', 'VWO', 'AGG', 'SHY', 'IEF', 'TIP'].includes(ticker) ? 'etf' : 'equity',
  sectorGroup: 'core-300',
  role: ['SPY', 'QQQ', 'DIA', 'IWM', 'SMH', 'SOXX', 'XBI', 'IBB', 'XLV', 'XLE', 'XLF', 'XLI', 'XLY', 'XLP', 'XLK', 'XLC', 'XLU', 'XLB', 'ARKK', 'ARKG', 'ARKF', 'GLD', 'SLV', 'GDX', 'GDXJ', 'COPX', 'CPER', 'USO', 'UNG', 'TLT', 'HYG', 'LQD', 'UUP', 'FXI', 'KWEB', 'EEM', 'EFA', 'VWO', 'AGG', 'SHY', 'IEF', 'TIP'].includes(ticker) ? 'market-control' : 'industry-leader',
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
}))

export const SEED_EVIDENCE_EDGES: EvidenceEdge[] = [
  {
    edgeId: 'AXTI:inp:phosphide:ashare',
    fromTicker: 'AXTI',
    fromNode: 'AXT / InP substrate',
    toNode: 'A股磷化铟与光通信材料题材',
    relationType: 'supply-chain',
    direction: 'positive',
    evidenceGrade: 'A',
    sourceUrls: ['https://investors.axt.com/Investors/Overview/', 'https://investors.axt.com/Investors/news/news-details/2026/AXT-Inc--Announces-Long-Term-Supplier-Agreement-with-Lumentum/default.aspx'],
    sourcePublishedAt: [],
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    status: 'research',
    supportSessions: 0,
    posteriorMean: null,
    posteriorLowerBound: null,
    modelEligible: false,
  },
  {
    edgeId: 'LITE:optical:module:ashare',
    fromTicker: 'LITE',
    fromNode: 'Lumentum / optical photonics',
    toNode: 'A股光模块与光通信题材',
    relationType: 'product',
    direction: 'positive',
    evidenceGrade: 'A',
    sourceUrls: ['https://investor.lumentum.com/overview/'],
    sourcePublishedAt: [],
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    status: 'research',
    supportSessions: 0,
    posteriorMean: null,
    posteriorLowerBound: null,
    modelEligible: false,
  },
  {
    edgeId: 'MRNA:mrna:biotech:ashare',
    fromTicker: 'MRNA',
    fromNode: 'Moderna / mRNA platform',
    toNode: 'A股 mRNA 与创新药题材',
    relationType: 'technology',
    direction: 'positive',
    evidenceGrade: 'B',
    sourceUrls: [],
    sourcePublishedAt: [],
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    status: 'research',
    supportSessions: 0,
    posteriorMean: null,
    posteriorLowerBound: null,
    modelEligible: false,
  },
]

function safeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

/** US session D closes after the A-share session on D, so it maps to the next A-share trading date. */
export function resolveAshareTradeDateForUsSession(usSessionDate: string, ashareTradingDates: string[]): string | null {
  if (!safeDate(usSessionDate)) throw new Error('usSessionDate 必须是 YYYY-MM-DD')
  return [...ashareTradingDates].filter((date) => safeDate(date) && date > usSessionDate).sort()[0] ?? null
}

export function buildThemeLabels(rows: ThemeLabelInput[]): ThemeLabels {
  const valid = rows.filter((row) => !row.suspended && !row.st)
  const tradable = valid.filter((row) => row.tradable && !row.onePriceLimitUp)
  const limitUpCount = valid.filter((row) => row.limitUp).length
  const firstBoardCount = valid.filter((row) => row.firstBoard).length
  const excessReturnPct = tradable.length
    ? tradable.reduce((sum, row) => sum + (row.themeReturnPct - row.benchmarkReturnPct), 0) / tradable.length
    : 0
  const positiveExcessBreadth = tradable.length
    ? tradable.filter((row) => row.themeReturnPct - row.benchmarkReturnPct > 0).length / tradable.length
    : 0
  return {
    validThemeStockCount: valid.length,
    limitUpCount,
    firstBoardCount,
    burst: limitUpCount >= 3 && firstBoardCount >= 2 && valid.length > 0 && limitUpCount / valid.length >= 0.05 ? 1 : 0,
    validTradableStockCount: tradable.length,
    positiveExcessBreadth,
    excessReturnPct,
    tradable: tradable.length >= 5 && excessReturnPct >= 1.5 && positiveExcessBreadth >= 0.6 ? 1 : 0,
  }
}

export function assessCrossMarketDataQuality(args: {
  sourceCoveragePct: number
  staleSources?: string[]
  missingSources?: string[]
  warnings?: string[]
  criticalReady?: boolean
}): CrossMarketDataQuality {
  const staleSources = args.staleSources ?? []
  const missingSources = args.missingSources ?? []
  const warnings = args.warnings ?? []
  const criticalReady = args.criticalReady ?? true
  const unavailable = !criticalReady || args.sourceCoveragePct <= 0 || missingSources.some((source) => source.startsWith('critical:'))
  const degraded = !unavailable && (args.sourceCoveragePct < 95 || staleSources.length > 0 || missingSources.length > 0 || warnings.length > 0)
  return {
    status: unavailable ? 'unavailable' : degraded ? 'degraded' : 'full',
    sourceCoveragePct: args.sourceCoveragePct,
    staleSources,
    missingSources,
    warnings,
  }
}

export function createUnavailableSnapshot(args: { tradeDate: string; phase: CrossMarketPhase; cutoffAt?: string; warning?: string }): CrossMarketSnapshot {
  const warning = args.warning ?? '跨市场模型尚未完成历史覆盖与校准'
  const capturedAt = new Date().toISOString()
  return {
    tradeDate: args.tradeDate,
    scheduledCutoffAt: args.cutoffAt ?? phaseCutoffAt(args.tradeDate, args.phase),
    capturedAt,
    captureStatus: 'unavailable',
    cutoffAt: args.cutoffAt ?? capturedAt,
    generatedAt: capturedAt,
    phase: args.phase,
    modelVersion: CROSS_MARKET_MODEL_VERSION,
    graphVersion: CROSS_MARKET_GRAPH_VERSION,
    probabilityStatus: 'unavailable',
    researchStatus: 'research',
    dataQuality: assessCrossMarketDataQuality({ sourceCoveragePct: 0, missingSources: ['critical:model'], warnings: [warning], criticalReady: false }),
    sourceShocks: [],
    themePredictions: [],
    stockPredictions: [],
    rejectedMappings: [],
    warnings: [warning],
  }
}

/** Scheduled freeze instant (Asia/Shanghai) for each bidding-stage snapshot. */
export function phaseStartMinute(phase: CrossMarketPhase): number {
  return phase === 'premarket' ? 9 * 60 + 15 : phase === 'auction' ? 9 * 60 + 25 : 9 * 60 + 35
}

/** The exact scheduled cutoff instant for a phase snapshot, used as its watermark. */
export function phaseCutoffAt(tradeDate: string, phase: CrossMarketPhase): string {
  const minutes = phaseStartMinute(phase)
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${tradeDate}T${hh}:${mm}:00.000+08:00`
}

function archiveRoot(): string {
  return resolve(process.env.CROSS_MARKET_ARCHIVE_ROOT ?? join(import.meta.dirname ?? process.cwd(), '../../docs/cross-market/snapshots'))
}

function snapshotPath(tradeDate: string, phase: CrossMarketPhase): string {
  return join(archiveRoot(), tradeDate, `${phase}.json`)
}

function settlementPath(tradeDate: string): string {
  return join(archiveRoot(), tradeDate, 'settled.json')
}

export function writeCrossMarketSnapshot(snapshot: CrossMarketSnapshot): CrossMarketSnapshot {
  if (!safeDate(snapshot.tradeDate)) throw new Error('tradeDate 必须是 YYYY-MM-DD')
  if (snapshot.captureStatus !== 'on-time') {
    throw new Error(
      `拒绝写入非 on-time 快照: ${snapshot.tradeDate}/${snapshot.phase} captureStatus=${snapshot.captureStatus}`,
    )
  }
  const target = snapshotPath(snapshot.tradeDate, snapshot.phase)
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  renameSync(temp, target)
  return snapshot
}

export function readCrossMarketSnapshot(tradeDate: string, phase: CrossMarketPhase): CrossMarketSnapshot | null {
  const path = snapshotPath(tradeDate, phase)
  if (!existsSync(path)) return null
  try {
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as CrossMarketSnapshot
    if (snapshot.captureStatus !== 'on-time' && snapshot.captureStatus !== 'late-live') {
      snapshot.captureStatus = 'unavailable'
    }
    snapshot.scheduledCutoffAt = snapshot.scheduledCutoffAt ?? phaseCutoffAt(tradeDate, phase)
    snapshot.capturedAt = snapshot.capturedAt ?? snapshot.cutoffAt ?? snapshot.generatedAt
    snapshot.warnings = snapshot.warnings ?? []
    return snapshot
  } catch {
    return null
  }
}

export function listCrossMarketSnapshots(phase: CrossMarketPhase, beforeDate = '9999-12-31', limit = 60): CrossMarketSnapshot[] {
  const root = archiveRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && safeDate(entry.name) && entry.name < beforeDate)
    .map((entry) => entry.name)
    .sort()
    .slice(-Math.max(0, limit))
    .flatMap((date) => {
      const snapshot = readCrossMarketSnapshot(date, phase)
      // Only verified on-time captures enter the same-time baseline; legacy or
      // unavailable archives are intentionally excluded to avoid stale reuses.
      return snapshot && snapshot.captureStatus === 'on-time' ? [snapshot] : []
    })
}

export function writeCrossMarketSettlement(settlement: CrossMarketSettlement): CrossMarketSettlement {
  if (!safeDate(settlement.tradeDate)) throw new Error('tradeDate 必须是 YYYY-MM-DD')
  const target = settlementPath(settlement.tradeDate)
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(settlement, null, 2)}\n`, 'utf8')
  renameSync(temp, target)
  return settlement
}

export function readCrossMarketSettlement(tradeDate: string): CrossMarketSettlement | null {
  const path = settlementPath(tradeDate)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CrossMarketSettlement
  } catch {
    return null
  }
}

export function listCrossMarketSettlements(
  beforeDate = '9999-12-31',
  limit = 60,
): CrossMarketSettlement[] {
  const root = archiveRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && safeDate(entry.name) && entry.name < beforeDate)
    .map((entry) => entry.name)
    .sort()
    .slice(-Math.max(0, limit))
    .flatMap((date) => {
      const settlement = readCrossMarketSettlement(date)
      return settlement ? [settlement] : []
    })
}
