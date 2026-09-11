// 战法层的 host 契约。
//
// 公开仓库（本仓库）只认这里定义的类型；私有包 `wax-wane-strategy` 实现它。
// 本文件**不得** import 私有包的任何东西 —— 类型是契约，不是实现。
//
// 为什么需要它：公开仓库要在**不安装私有包**的前提下 build + 启动，
// 所以所有跨边界调用都必须是「可选能力」，缺失时降级而不是报错。
// 加载方式见 `./loader.ts`。
//
// 边界来源：搬迁私有文件后，公开侧 `tsc -p server --noEmit` 报出 69 处 TS2307
// （28 个缺失模块）。那些引用点就是这张契约要覆盖的面，不是凭想象设计的。
// 之后按「数据 vs 决策」重切了一轮：取数/归档/类型回到公开侧，只有编码了
// 战法门槛与评分的模块留在私有侧 —— 见 `docs/` 与本仓 AGENTS.md 的边界说明。

import type { Bar } from '../services/taMath'
import type { ScreenerSnapshot } from '../services/screenerDataContract'
import type { HoldingTAItem, HoldingTADelta } from '../services/holdingsTAContract'
import type { RelayPathEvidence, RelayPathScore } from '../services/relayPathTypes'

/** 采集上下文：公开侧把已经拿到的数据交给战法层做后置处理。 */
export interface CollectContext {
  /** 交易日 YYYY-MM-DD。 */
  tradeDate: string
  /** 采集阶段标识，如 'auction-l1' / 'post-close'。 */
  stage: string
}

/** 调度上下文。 */
export interface SchedulerContext {
  tradeDate: string
  /** 本次 tick 触发的任务名。 */
  task: string
}

/**
 * 采集/调度后置钩子。
 *
 * 对应公开侧这些调用点：
 * - `services/checkpointHandlers.ts`（选股扫描 / 实时报价 / 股票池快照）
 * - `services/auctionL1Provider.ts`（竞价 L1 采集后的选股侧处理）
 * - `services/schedulerCoordinator.ts`（首板扫描 tick）
 *
 * 全部可选：不实现 = 该阶段不跑战法扫描，采集与快照照常落盘。
 */
export interface StrategyHooks {
  onAfterCollect?(ctx: CollectContext): Promise<void>
  onSchedulerTick?(ctx: SchedulerContext): Promise<void>
}

/**
 * 给公开侧路由补充策略字段。
 *
 * 对应：`routes/market.ts` / `routes/ladder.ts` / `routes/ops.ts`。
 * 不实现 = 响应里没有策略字段。
 */
export interface StrategyEnricher {
  /** 行情路由：补选股/轮动字段。 */
  enrichMarket?(payload: Record<string, unknown>, ctx: CollectContext): Promise<Record<string, unknown>>
  /** 天梯路由：补首板扫描字段。 */
  enrichLadder?(payload: Record<string, unknown>, ctx: CollectContext): Promise<Record<string, unknown>>
}

/**
 * 技术分析增强。
 *
 * 持仓复盘与盘中复盘在公开侧仍可用基础 TA（`services/taMath.ts`：MA / 量比 /
 * 52周高距离 / ATR / 枢轴位）；趋势模板、VCP、N 字波段、三法合成评分属于战法层，
 * 缺失时不出对应区块。
 */
export interface StrategyTechnicalAnalysis {
  /** 趋势模板（Stage2）。缺失时持仓卡不出该块。 */
  trendTemplate?(bars: Bar[]): { pass: boolean; reasons: string[] } | null
  /** VCP / 即将新高。 */
  vcp?(bars: Bar[]): Record<string, number | boolean> | null
  /** N 字运动波段角度/时间/异动。 */
  nPattern?(bars: Bar[]): Record<string, unknown> | null
  /** 技术组合评分。 */
  technicalScore?(bars: Bar[]): number | null

  /** 单票持仓深度 TA（公开侧负责取数/缓存/落盘，战法层负责判定）。 */
  buildHoldingTA?(code: string, name: string, bars: Bar[], market?: string): HoldingTAItem | null
  /** 就地补写相对大盘强度。 */
  enrichRelStrength?(
    items: HoldingTAItem[],
    benchmarkChgPctFor: (code: string) => number,
    crashDayPct: number,
  ): void
  /** 今昨两份同票 TA 的 delta。 */
  diffHoldingTA?(prev: HoldingTAItem, cur: HoldingTAItem, prevDate: string): HoldingTADelta
}

/**
 * 策略面板 / 快照数据源。
 *
 * 对应：`services/settlementArchive.ts`（收盘定盘归档编排）、
 * `services/dailyReview.ts`（每日复盘）、`routes/market.ts`（刷新按钮）。
 * 不实现 = 归档里没有策略面板，刷新按钮不清策略缓存，其余照常。
 */
export interface StrategyPanels {
  /** 收盘定盘选股快照。 */
  scanScreener?(mode: 'intraday' | 'close'): Promise<ScreenerSnapshot>
  clearScreenerCache?(): void
  /** 前瞻跟踪面板（信号跟踪战绩）。公开侧只断言 `asof` 与目标日一致。 */
  fetchScreenerForward?(): Promise<{ asof: string }>
  clearScreenerForwardCache?(): void
  /** 大盘反攻日·先锋股复盘段。 */
  fetchReboundSection?(): Promise<unknown>
  clearReboundCache?(): void
  /** 资金共振榜 / 机构调研榜。 */
  fetchFundResonanceBoard?(): Promise<unknown>
  clearFundResonanceBoardCache?(): void
  /** 龙虎榜机构累积榜。 */
  fetchInstitutionAccum?(): Promise<unknown>
  clearInstitutionAccumCache?(): void
  /** 选股辅助快照刷新（由脚本/scheduler 调用）。 */
  refreshScreenerAuxiliary?(): Promise<void>
  /** 挥手研究存档写入。 */
  writeResearchJson?(dir: string, name: string, value: unknown): unknown
}

/**
 * 连板天梯的接力路径评分。
 *
 * 天梯的**原始梯队数据**留在公开侧（`services/limitLadder.ts`）；由原始证据推出的
 * 接力路径评分属战法层。不实现 = 天梯只出原始梯队，`relayPathScore` 为 undefined。
 */
export interface StrategyLadder {
  /** 由天梯原始证据构造接力路径证据对象。 */
  buildRelayPathEvidence?(input: unknown): RelayPathEvidence
  /** 按连板数选首板/连板评分模型。 */
  scoreRelayPath?(evidence: RelayPathEvidence, consecutiveDays: number): RelayPathScore
  /** 首板扫描（供 `routes/ladder` / `routes/ops` / scheduler 调用）。 */
  fetchFirstBoardScan?(date: string): Promise<unknown>
  getFirstBoardProviderHealth?(): unknown
  runFirstBoardScanSchedulerTick?(tradeDate: string): Promise<void>
}

/**
 * Express 路由注册。
 *
 * 对应：`index.ts` 里对 `routes/screener` / `routes/screenerForward` /
 * `routes/rotation` / `routes/huishouResearch` 的注册。
 * 不实现 = 这些端点在公开部署里不存在（前端对应面板隐藏）。
 */
export interface StrategyRoutes {
  register(app: unknown): void
}

/** Agent 工具注册。对应 `src/agent/tools/index.ts` 的 `toolRegistry`。 */
export interface StrategyTools {
  /** 返回要并入公开侧 toolRegistry 的工具模块。 */
  tools(): Record<string, unknown>
}

/**
 * 私有包对外暴露的完整模块形状。
 *
 * 每个字段都可选 —— 私有包可以只实现一部分，公开侧按能力逐个降级。
 */
export interface StrategyModule {
  /** 契约版本，用于公开侧做兼容性检查。 */
  contractVersion: string
  hooks?: StrategyHooks
  enricher?: StrategyEnricher
  technical?: StrategyTechnicalAnalysis
  panels?: StrategyPanels
  ladder?: StrategyLadder
  routes?: StrategyRoutes
  tools?: StrategyTools
}

/** 公开侧当前实现的契约版本。私有包声明不匹配时 loader 会拒绝加载。 */
export const STRATEGY_CONTRACT_VERSION = '1.0'
