// 回调二次启动 · 单股 ground-truth 探针。逐日切片在某只票上跑 classifyPullback,
// 打印所有命中日 + 关键字段,用于验证规则(如 301396 宏景科技应在 2026-06-10 附近异常放量日命中,
// 而顶部回调初期不误报)。规则同线上同回测。
//
// 用法:
//   npm --prefix server run probe:pullback -- 301396
//   npm --prefix server run probe:pullback -- 301396 002008 301308
import { fetchStockKline } from '../services/ashare'
import { classifyPullback } from '../services/pullbackRules'
import { PULLBACK as C } from '../config/screener'
import { type Bar } from '../services/screenerRules'

async function probeOne(code: string): Promise<void> {
  const { name, klines } = await fetchStockKline(code, 101, C.KLINE_COUNT)
  const bars = (klines ?? []) as Bar[]
  console.log(`\n━━━ ${code} ${name || ''}  取到 ${bars.length} 根日线 ━━━`)
  const minBars = C.MA_LONG + C.MA_LONG_RISE_LOOKBACK + 1
  if (bars.length < minBars) {
    console.log(`  K线不足(需 ≥ ${minBars}),无法判定`)
    return
  }
  const hits: { date: string; price: number; priorHigh: number; arcLow: number; retracePct: number; daysSinceHigh: number; recoverPct: number; stop: number; target: number; score: number }[] = []
  for (let i = minBars - 1; i < bars.length; i++) {
    const cand = classifyPullback(bars.slice(0, i + 1), C)
    if (cand) {
      hits.push({
        date: bars[i].date,
        price: cand.price,
        priorHigh: cand.priorHigh,
        arcLow: cand.arcLow,
        retracePct: cand.retracePct,
        daysSinceHigh: cand.daysSinceHigh,
        recoverPct: cand.recoverPct,
        stop: cand.stopLoss,
        target: cand.target,
        score: cand.score,
      })
    }
  }
  if (hits.length === 0) {
    console.log('  在取到的区间内无命中(逐日切片均不满足六要素)')
    return
  }
  console.log(`  命中 ${hits.length} 个交易日(首个=${hits[0].date}):`)
  for (const h of hits) {
    console.log(
      `   ${h.date}  现价 ${h.price}  近高 ${h.priorHigh}  圆弧底 ${h.arcLow}  ` +
        `回调 ${h.retracePct}%(${h.daysSinceHigh}d) 自低回升 ${h.recoverPct}%  ` +
        `止损 ${h.stop} → 目标 ${h.target}  评分 ${h.score}`,
    )
  }
}

async function main() {
  const codes = process.argv.slice(2).map((s) => s.trim()).filter((s) => /^\d{6}$/.test(s))
  if (codes.length === 0) {
    console.log('用法: npm --prefix server run probe:pullback -- <6位代码> [更多代码...]')
    console.log('示例: npm --prefix server run probe:pullback -- 301396')
    process.exit(1)
  }
  console.log(`回调二次启动 ground-truth 探针 · ${codes.length} 只 · 阈值同 config.PULLBACK`)
  for (const code of codes) {
    try {
      await probeOne(code)
    } catch (e) {
      console.log(`\n━━━ ${code} ━━━ 探测异常:`, e instanceof Error ? e.message : e)
    }
  }
}

main()
