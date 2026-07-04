// 交易日历工具(纯函数,可单测)。抽自 backtestScreener.ts —— COMBO 龙虎榜因子与
// REGIMEBUCKET 市场状态分桶共用;backtestScreener.ts 尾部无条件跑 main(),不能被测试
// import,故日历逻辑放这里。
import type { StockBars } from './universe'

/** 样本所有 K 线日期并集 = 交易日历(升序)+ date→下标。 */
export function buildCalendar(data: StockBars[]): { calendar: string[]; idxByDate: Map<string, number> } {
  const set = new Set<string>()
  for (const sb of data) for (const b of sb.bars) set.add(b.date)
  const calendar = [...set].sort()
  const idxByDate = new Map<string, number>()
  calendar.forEach((d, i) => idxByDate.set(d, i))
  return { calendar, idxByDate }
}

/** 信号日**前** k 个交易日(不含信号日当天)。
 *
 *  龙虎榜等盘后数据在信号日收盘入场那一刻不可见——旧实现含当日(slice 到 i+1)曾让
 *  COMBO 因子回测系统性前视,机构净买增益被同日信息抬高。线上 enrichConfluence 含当日
 *  是另一回事(盘后跑批、候选供次日执行,当日数据已公布),见 screener.ts 注释。
 *  信号日不在日历 → [](该信号拿不到窗口数据,调用方按「无因子」处理)。 */
export function windowDatesFor(calendar: string[], idxByDate: Map<string, number>, signalDate: string, k: number): string[] {
  const i = idxByDate.get(signalDate)
  if (i === undefined) return []
  return calendar.slice(Math.max(0, i - k), i)
}
