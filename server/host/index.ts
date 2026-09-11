// 公开侧的 host 入口 —— 私有包 `wax-wane-strategy` **唯一允许** import 的路径。
//
// 规则：私有包只准 `import ... from 'wax-wane/host'`，
// **不得 deep-import 公开侧的其他路径**（`wax-wane/server/services/xxx`）。
// 否则边界会重新长回去，拆分白做。
//
// 所以这里刻意保持窄：只导出私有包确实需要的稳定 API。
// 要新增导出时，先问一句「这是不是把公开侧内部结构泄露给私有包了」。

// ── 通用 TA 原语 ─────────────────────────────────────────────────────
export { atr, clamp01, mean, pivotLevels, r2, smaAt } from '../services/taMath'
export type { Bar, Pivots } from '../services/taMath'

// ── 市场配置（公开侧从 SCREENER 拆出的那部分）────────────────────────
export {
  CHINEXT_INDEX_SECID,
  CLIST_FS,
  HOLDINGS,
  HOLDERNUM,
  LIFTBAN,
  LIQUIDITY_MIN,
  MARKET_INDEX_SECID,
  MCAP_MIN,
  ORG_SURVEY_BOARD,
  RELSTR,
  STAR50_INDEX_SECID,
} from '../config/market'
export type { HoldingsConfig } from '../config/market'

// ── 契约类型 ─────────────────────────────────────────────────────────
export { STRATEGY_CONTRACT_VERSION } from '../strategy/contract'
export type {
  CollectContext,
  SchedulerContext,
  StrategyEnricher,
  StrategyHooks,
  StrategyModule,
  StrategyRoutes,
  StrategyTechnicalAnalysis,
  StrategyTools,
} from '../strategy/contract'
