// 板块轮动 · 纯函数判定层(无网络,可单测)。
// 2×2 象限:长期窗口(高/低)× 短期窗口(强/弱)。

export type Quadrant = 'hs' | 'ls' | 'hw' | 'lw'
// hs=高强(60日涨+近5日涨,强势延续) ls=低强(60日跌+近5日涨,底部反转)
// hw=高弱(60日涨+近5日跌,高位回调) lw=低弱(60日跌+近5日跌,持续走弱)

/** 以末根收盘相对 n 根前的涨跌幅(%)。closes 升序;数据不足/基准非正返回 NaN(由调用方过滤)。 */
export function changeOverWindow(closes: number[], n: number): number {
  const len = closes.length
  if (n <= 0 || len < n + 1) return NaN
  const last = closes[len - 1]
  const base = closes[len - 1 - n]
  if (!(base > 0)) return NaN
  return (last / base - 1) * 100
}

/** 长期涨幅(高低轴)× 短期涨幅(强弱轴)→ 象限。≥0 记为 涨/高/强。 */
export function classifyQuadrant(longChg: number, shortChg: number): Quadrant {
  const high = longChg >= 0
  const strong = shortChg >= 0
  if (high && strong) return 'hs'
  if (!high && strong) return 'ls'
  if (high && !strong) return 'hw'
  return 'lw'
}
