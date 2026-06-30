// 放量吸筹探针 —— 输入任意 A 股代码,用线上同款取数(fetchStockKline)跑 classifyAccum,
// 打印「持续放量 / 均线走平 / 横盘时长」三因子逐项诊断,验证某票是否命中放量吸筹监控清单。
//
// 用法:
//   npm --prefix server run probe:accum -- 300566
//   npm --prefix server run probe:accum -- 300566 600519 002008   (多个=一张关注名单)
import { fetchStockKline } from '../services/ashare'
import { type Bar } from '../services/screenerRules'
import { classifyAccum } from '../services/accumRules'
import { ACCUM as C } from '../config/screener'

const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
const wan = (n: number) => (n / 1e4).toFixed(1) + '万手'

async function probeOne(code: string): Promise<{ code: string; name: string; hit: boolean; score: number }> {
  try {
    const { name: kName, klines } = await fetchStockKline(code, 101, 300)
    const name = kName || code
    console.log(`\n━━━ ${code} ${name} ━━━`)
    if (!klines || klines.length < C.MIN_BARS) {
      console.log(`   K线不足(${klines?.length ?? 0} < ${C.MIN_BARS}),次新股/取数失败,跳过`)
      return { code, name, hit: false, score: 0 }
    }
    const bars = klines as Bar[]
    const r = classifyAccum(bars, code, C)
    if (!r) {
      // 复算基准/放量,给"差在哪"
      const last = bars.length - 1
      const baseStart = last - C.VOL_WIN - C.BASE_LOOKBACK + 1
      if (baseStart < 0) {
        console.log('   K线不足以取基准均量窗,跳过')
        return { code, name, hit: false, score: 0 }
      }
      const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
      const baseVol = mean(bars.slice(baseStart, last - C.VOL_WIN + 1).map((b) => b.volume))
      const winBars = bars.slice(last - C.VOL_WIN + 1, last + 1)
      const burstDays = winBars.filter((b) => b.volume >= C.VOL_MULT * baseVol).length
      const avgRatio = baseVol > 0 ? mean(winBars.map((b) => b.volume)) / baseVol : 0
      console.log(`   ✗ 未命中放量吸筹`)
      console.log(`     基准均量(放量前${C.BASE_LOOKBACK}日) ${wan(baseVol)}`)
      console.log(`     近${C.VOL_WIN}日均量倍数 ${avgRatio.toFixed(2)}× ≥ ${C.VOL_MULT}× ${avgRatio >= C.VOL_MULT ? '✓' : '✗'}`)
      console.log(`     窗内放量天数 ${burstDays}日 ≥ ${C.MIN_BURST_DAYS}日 ${burstDays >= C.MIN_BURST_DAYS ? '✓' : '✗'}`)
      return { code, name, hit: false, score: 0 }
    }
    console.log(`   ✅ 命中放量吸筹  现价 ${r.price} (${pct(r.changePct)})  tier${r.tier}/${r.score}分`)
    console.log(`   ① 持续放量:近${C.VOL_WIN}日均量 ${r.avgVolRatio}× 基准 · 窗内 ${r.burstDays}日≥${C.VOL_MULT}× · 持续约 ${r.surgeRunDays}日  → vol因子 ${r.vol01}`)
    console.log(`   ② 均线走平:MA${C.MA_REF}斜率 ${r.maSlopePct}%(≤${C.FLAT_MAX_PCT}%=走平)  → flat因子 ${r.flat01}`)
    console.log(`   ③ 横盘时长:箱体 ${r.boxLow}~${r.boxHigh} 维持 ${r.consolDays}日  → consol因子 ${r.consol01}`)
    console.log(`   横盘箱体 ${r.boxLow}~${r.boxHigh}  ·  52周分位 ${r.posPct}%  ·  放量窗内净涨跌 ${pct(r.winNetChgPct)}`)
    console.log(`   确认买点(放量站上箱体上沿确认进,回测0.20R/PF1.33):介入 ${r.entryTrigger}  止损 ${r.stopRef}  目标 ${r.targetRef}  (吸筹途中收盘埋伏回测−0.24R,不进)`)
    if (r.riskNote) console.log(`   ⚠ ${r.riskNote}`)
    return { code, name, hit: true, score: r.score }
  } catch (e) {
    console.log(`\n━━━ ${code} ━━━ 探测异常:`, e instanceof Error ? e.message : e)
    return { code, name: code, hit: false, score: 0 }
  }
}

async function main() {
  const codes = process.argv.slice(2).map((s) => s.trim()).filter((s) => /^\d{6}$/.test(s))
  if (codes.length === 0) {
    console.log('用法: npm --prefix server run probe:accum -- <6位代码> [更多代码...]')
    console.log('示例: npm --prefix server run probe:accum -- 300566')
    process.exit(1)
  }
  console.log(`放量吸筹探针 · ${codes.length} 只 · 规则同 ACCUM(VOL_MULT=${C.VOL_MULT}×/窗${C.VOL_WIN}日/≥${C.MIN_BURST_DAYS}日)`)
  const out: { code: string; name: string; hit: boolean; score: number }[] = []
  for (const code of codes) out.push(await probeOne(code))
  console.log('\n════════ 汇总 ════════')
  for (const v of out) console.log(`  ${v.hit ? '✅' : '✗ '}  ${v.code} ${v.name.padEnd(6)}  ${v.hit ? `${v.score}分` : '未命中'}`)
}

main()
