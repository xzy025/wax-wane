// 「连续出现天数」纯函数:无 IO,便于单测。screener.ts 负责读历史快照后调用。
//
// 口径:一只票出现在某日扫描的任意榜单(突破/扳机/临界观察/回调/分歧)即计「出现」。
// 「连续」= 连续的可用日快照(非自然日)——偶发停机漏扫某日会顺延到上一份快照、
// 不视作断裂;调用方传入的 priorCodeSets 已按日期 DESC 排好且不含今天。

/**
 * 计算今天每只票的连续出现天数。
 * @param todayCodes      今天出现的全部 code(五组并集)
 * @param priorCodeSets   历史快照各日的 code 集合,按日期 DESC(最近在前),不含今天
 * @returns code → 连续出现交易日数(含今天,最小为 1)
 */
export function computeStreaks(
  todayCodes: Set<string>,
  priorCodeSets: Set<string>[],
): Map<string, number> {
  const streaks = new Map<string, number>()
  for (const code of todayCodes) {
    let streak = 1 // 今天
    for (const prior of priorCodeSets) {
      if (prior.has(code)) streak++
      else break // 第一次缺席即断裂
    }
    streaks.set(code, streak)
  }
  return streaks
}
