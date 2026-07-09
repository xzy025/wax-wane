// 反攻日探针 —— 输入日期(默认最新交易日),用线上同款取数跑 detectReversalDay,
// 打印「连跌/累计跌幅/涨幅/收阳/量比」逐项诊断;命中时给出连跌窗 + 涨停池封板时间轴(fbt)
// + 低位首板/二板先锋(classifyReboundPioneer E2E) + fetchLimitPoolRaw 历史可用性报告
// (裁定「历史封板时间能否用于回测因子分桶」——主裁决不依赖 fbt,不可用零影响)。
//
// 用法:
//   npx tsx server/scripts/reboundProbe.ts              (最新交易日)
//   npx tsx server/scripts/reboundProbe.ts 2026-07-09
import { fetchIndexKline, fetchStockKline } from '../services/ashare'
import { type Bar } from '../services/screenerRules'
import {
  detectReversalDay,
  declineWindow,
  classifyReboundPioneer,
  type IndexBar,
} from '../services/reboundRules'
import { REBOUND as C } from '../config/screener'

const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const mark = (ok: boolean) => (ok ? '✓' : '✗')

/** 涨停池接口要 YYYYMMDD。 */
const ymd = (date: string) => date.replaceAll('-', '')

// fetchLimitPoolRaw 未导出(线上仅晋级率内部用),探针直连同一端点,口径一致。
async function fetchZtPool(dateYmd: string) {
  const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cb3fce871cbecd&dpt=wz.ztzt&date=${dateYmd}&_=${Date.now()}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`ztpool ${dateYmd}: HTTP ${res.status}`)
  const json = (await res.json()) as any
  const pool = (json?.data?.pool ?? []) as any[]
  return pool.map((it) => ({
    code: String(it.c ?? ''),
    name: String(it.n ?? ''),
    firstTime: String(it.fbt ?? ''),
    lastTime: String(it.lbt ?? ''),
    openCount: Number(it.zbc ?? 0),
    lbc: Number(it.lbc ?? 0),
    industry: String(it.hybk ?? ''),
  }))
}

/** fbt 是 HHMMSS 数字串(如 '92500'/'133000'),补零转 HH:MM。 */
const fbtHHMM = (fbt: string) => {
  const s = fbt.padStart(6, '0')
  return s === '000000' ? '--:--' : `${s.slice(0, 2)}:${s.slice(2, 4)}`
}

function diagnose(bars: IndexBar[]): void {
  const len = bars.length
  const last = bars[len - 1]
  const prev = bars[len - 2]
  const chgPct = ((last.close - prev.close) / prev.close) * 100
  const bullish = last.close > last.open
  const volRatio = prev.volume > 0 ? last.volume / prev.volume : 0
  const baseVol = mean(bars.slice(len - 1 - C.VOL_BASE_WIN, len - 1).map((b) => b.volume))
  const vol5Ratio = baseVol > 0 ? last.volume / baseVol : 0
  let downDays = 0
  for (let i = len - 2; i >= 1; i--) {
    if (bars[i].close < bars[i - 1].close) downDays++
    else break
  }
  const cumBase = bars[len - 2 - C.DOWN_WINDOW].close
  const downCumPct = cumBase > 0 ? ((prev.close - cumBase) / cumBase) * 100 : 0
  const declineOk = downDays >= C.DOWN_DAYS_MIN || downCumPct <= C.DOWN_CUM_PCT
  console.log(`   ① 前置杀跌:连跌 ${downDays}日 ≥ ${C.DOWN_DAYS_MIN} ${mark(downDays >= C.DOWN_DAYS_MIN)}  或  近${C.DOWN_WINDOW}日累计 ${pct(downCumPct)} ≤ ${C.DOWN_CUM_PCT}% ${mark(downCumPct <= C.DOWN_CUM_PCT)}  → ${mark(declineOk)}`)
  console.log(`   ② 反攻涨幅:${pct(chgPct)} ≥ ${C.UP_PCT_MIN}% ${mark(chgPct >= C.UP_PCT_MIN)}`)
  console.log(`   ③ 收阳:开 ${last.open.toFixed(2)} → 收 ${last.close.toFixed(2)} ${mark(bullish)}`)
  console.log(`   ④ 放量:较昨日 ${volRatio.toFixed(2)}× ≥ ${C.VOL_RATIO_MIN}× ${mark(volRatio >= C.VOL_RATIO_MIN)}  (对${C.VOL_BASE_WIN}日均量 ${vol5Ratio.toFixed(2)}×,仅记录)`)
}

async function main() {
  const arg = (process.argv[2] ?? '').trim()
  if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    console.log('用法: npx tsx server/scripts/reboundProbe.ts [YYYY-MM-DD]')
    process.exit(1)
  }

  const idxBars = await fetchIndexKline(C.INDEX_SECID, 700)
  const at = arg ? idxBars.findIndex((b) => b.date === arg) : idxBars.length - 1
  if (at < 0) {
    console.log(`✗ ${arg} 不在指数日线序列内(非交易日或超出 700 根回看窗)`)
    process.exit(1)
  }
  const bars = idxBars.slice(0, at + 1)
  const date = bars[bars.length - 1].date
  console.log(`反攻日探针 · ${date} · 判据指数 ${C.INDEX_SECID}(上证) · 规则同 REBOUND`)
  console.log(`\n━━━ 判据诊断 ━━━`)
  diagnose(bars)

  const sig = detectReversalDay(bars, C)
  if (!sig) {
    console.log(`\n   ✗ ${date} 不是反攻日`)
  } else {
    const win = declineWindow(bars, C)
    console.log(`\n   ✅ 反攻日成立:${pct(sig.chgPct)} / 较昨日量 ${sig.volRatio}× / 连跌 ${sig.downDays}日 / ${C.DOWN_WINDOW}日累计 ${pct(sig.downCumPct)}`)
    if (win) console.log(`   连跌窗(抗跌对齐窗):${win.fromDate} → ${win.toDate}`)

    // 副指数佐证(仅展示)
    try {
      const sec = await fetchIndexKline(C.SECONDARY_SECID, 700)
      const si = sec.findIndex((b) => b.date === date)
      if (si >= 1) {
        const sc = ((sec[si].close - sec[si - 1].close) / sec[si - 1].close) * 100
        console.log(`   创业板指同日 ${pct(sc)}(佐证)`)
      }
    } catch {
      console.log('   创业板指取数失败(佐证省略)')
    }

    // 封板时间轴 + 先锋 classifier E2E
    console.log(`\n━━━ 涨停池封板时间轴(fbt) ━━━`)
    try {
      const pool = await fetchZtPool(ymd(date))
      if (pool.length === 0) {
        console.log('   池为空(该日期无数据或接口不支持此历史日期)')
      } else {
        const byTime = [...pool].sort((a, b) => a.firstTime.padStart(6, '0').localeCompare(b.firstTime.padStart(6, '0')))
        console.log(`   全池 ${pool.length} 只;最早封板前 ${Math.min(C.PIONEER_MAX, byTime.length)} 只:`)
        for (const s of byTime.slice(0, C.PIONEER_MAX)) {
          console.log(`     ${fbtHHMM(s.firstTime)}  ${s.code} ${s.name.padEnd(6)} ${s.lbc}板${s.openCount > 0 ? ` 炸${s.openCount}` : ''}  ${s.industry}`)
        }
        // 低位首板/二板过滤(classifyReboundPioneer,K线截到目标日,防前视)
        const lowLb = byTime.filter((s) => s.lbc <= C.PIONEER_LB_MAX).slice(0, 15)
        console.log(`\n   先锋过滤(连板≤${C.PIONEER_LB_MAX} 且 52周分位≤${C.PIONEER_POS_MAX}%,取封板最早的 ${lowLb.length} 只跑 classifier):`)
        for (const s of lowLb) {
          try {
            const { klines } = await fetchStockKline(s.code, 101, 320)
            const i = klines.findIndex((k) => k.date === date)
            if (i < 0) {
              console.log(`     ?  ${fbtHHMM(s.firstTime)}  ${s.code} ${s.name}  个股K线无该日,跳过`)
              continue
            }
            const hit = classifyReboundPioneer(klines.slice(0, i + 1) as Bar[], s.code, C)
            console.log(`     ${hit ? '✅' : '✗ '}  ${fbtHHMM(s.firstTime)}  ${s.code} ${s.name.padEnd(6)} ${s.lbc}板  ${hit ? `52周分位 ${hit.posPct}%` : '高位/连板超限/K线不足'}`)
          } catch {
            console.log(`     ?  ${s.code} ${s.name}  K线取数失败`)
          }
        }
      }
    } catch (e) {
      console.log(`   涨停池取数失败: ${e instanceof Error ? e.message : e}`)
    }
  }

  // 历史可用性报告:回测若要用真实封板时间做「早板/晚板」因子分桶,须此接口支持历史日期
  console.log(`\n━━━ getTopicZTPool 历史可用性(回测 fbt 因子分桶的前提) ━━━`)
  const offsets = [0, 21, 120, 250, 500] // 交易日回看:当日/1月/半年/1年/2年
  for (const off of offsets) {
    const i = at - off
    if (i < 0) continue
    const d = idxBars[i].date
    try {
      const pool = await fetchZtPool(ymd(d))
      const withFbt = pool.filter((s) => s.firstTime && s.firstTime !== '0').length
      console.log(`   ${d}(T-${off}):池 ${pool.length} 只,含 fbt ${withFbt} 只 ${pool.length > 0 && withFbt > 0 ? '✓' : '✗'}`)
    } catch (e) {
      console.log(`   ${d}(T-${off}):✗ ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log('   结论:全✓=历史 fbt 可用于回测「早板/晚板」分桶;任一✗=该深度不可用(主裁决不依赖 fbt,零影响)。')
  console.log('   ⚠ 若连 T-0 都为空:大概率是 push2ex 被本机网络掐(同 push2his 慢性病,线上 limitUpStocks 会走')
  console.log('     Sina 兜底=fbt 空),属网络故障而非接口不支持历史——换网络/隔天重跑再裁定。')
}

main()
