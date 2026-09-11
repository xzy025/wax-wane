// 「当日是否涨停」判定。
//
// 本文件从 `services/divergenceRules.ts` 拆出。原文件带 DIVERGENCE / HIGHDIV 两套
// 战法阈值，整体归入私有战法层；但 `isLimitUpDay` 本身是**交易所价格限制规则的
// 应用**（依赖 `market-rules/priceLimitRules`），不含任何战法参数，公开侧的天梯
// 原始数据需要它，故留在公开侧。
//
// 边界：这里只回答「这根 bar 的收盘价是否触及当日涨停价」。任何「涨停之后该不该
// 买」的判定不属于本文件。

import { priceLimitRules } from './priceLimitRules'
import type { SecurityMasterSnapshot } from './securityMaster'
import type { Bar } from '../services/taMath'

export function isLimitUpDay(
  bar: Bar,
  prevClose: number,
  code: string,
  security?: Partial<SecurityMasterSnapshot> | null,
): boolean {
  if (prevClose <= 0) return false
  // Explicitly adjusted bars cannot prove an exchange limit price. Legacy
  // fixtures without provenance remain supported, while production callers
  // must request raw OHLC for labels and execution rules.
  if (bar.adjustment != null && bar.adjustment !== 'raw') return false
  const rules = priceLimitRules({ code, asOfDate: bar.date.slice(0, 10), previousClose: prevClose, security })
  return rules.upperPrice != null && bar.close >= rules.upperPrice
}
