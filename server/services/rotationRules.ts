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

/** 某板块「截至 dateIdx(含)」的强弱:把 closes 切到 [0..dateIdx] 再算长/短窗象限。
 *  供选股加分 + 回测(切片到信号日,避免前视)。closes 升序;数据不足返回 null。
 *  strong = 短窗为正(近 shortWin 日在涨)= 轮动顺风(对应象限 hs/ls)。
 *  score01:象限映射的 0..1 加分(hs 强势延续最高,lw 持续走弱最低),叠加短窗幅度微调。 */
export function boardStrengthAsOf(
  closes: number[],
  dateIdx: number,
  longWin: number,
  shortWin: number,
): { quadrant: Quadrant; longChg: number; shortChg: number; strong: boolean; score01: number } | null {
  if (dateIdx < 0 || dateIdx >= closes.length) return null
  const slice = closes.slice(0, dateIdx + 1)
  const longChg = changeOverWindow(slice, longWin)
  const shortChg = changeOverWindow(slice, shortWin)
  if (Number.isNaN(longChg) || Number.isNaN(shortChg)) return null
  const quadrant = classifyQuadrant(longChg, shortChg)
  const base: Record<Quadrant, number> = { hs: 0.8, ls: 0.6, hw: 0.4, lw: 0.1 }
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
  // 同象限内按近 shortWin 日幅度微调 ±0.1:-10%→base-0.1、0%→base、+10%→base+0.1。
  const adj = clamp01((shortChg + 10) / 20) // 0..1,0% 居中 0.5
  const score01 = clamp01(base[quadrant] - 0.1 + 0.2 * adj)
  const round2 = (n: number) => Math.round(n * 100) / 100
  return { quadrant, longChg: round2(longChg), shortChg: round2(shortChg), strong: shortChg >= 0, score01: round2(score01) }
}
