// 新高战法「关注名单」探针 —— 输入任意 A 股代码,逐关复盘它在选股管线的哪一步落选,
// 并给出「距触发还差什么」。完全复用线上同款取数(fetchStockKline)+ 规则(trendTemplate/classify)。
//
// 用法:
//   npm --prefix server run probe -- 301308
//   npm --prefix server run probe -- 301308 600519 002008   (多个=一张关注名单)
//
// 注:与线上 /api/screener 同源同规则,差别仅在跳过 stage-1 的全市场排序/top600 截断
//     (单独探一只时不存在排名竞争),其余阈值判定逐字一致。
import { EM_HEADERS } from '../lib/emHeaders'
import { fetchStockKline } from '../services/ashare'
import { trendTemplate, computeVCP, classify, type Bar } from '../services/screenerRules'
import { SCREENER as C } from '../config/screener'

const yi = (n: number) => (n / 1e8).toFixed(2) + '亿'
const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
const mark = (ok: boolean) => (ok ? '✓' : '✗')
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

interface Verdict {
  code: string
  name: string
  status: string // 一句话结论
  group?: 'breakout' | 'trigger'
}

/** Stage 1:全市场 clist 廉价初筛(成交额/市值/动量/ST)。返回 null=取数失败。 */
async function stage1(code: string): Promise<{ name: string; pass: boolean; reason: string } | null> {
  const secid = `${code.startsWith('6') ? '1' : '0'}.${code}`
  const fields = 'f2,f3,f6,f10,f12,f14,f20,f24'
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=${secid}&fields=${fields}`
  const res = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(8000) })
  const json: Record<string, any> = await res.json()
  const d = json?.data?.diff?.[0]
  if (!d) return null
  const name = String(d.f14 ?? code)
  const price = Number(d.f2)
  const amount = Number(d.f6)
  const mcap = Number(d.f20)
  const mom60 = Number(d.f24)
  const vr = Number(d.f10)
  const isST = /ST|退/i.test(name)
  const okLiq = amount >= C.LIQUIDITY_MIN
  const okCap = mcap >= C.MCAP_MIN
  const okMom = mom60 >= C.MOM60_MIN
  const pass = !isST && okLiq && okCap && okMom

  console.log(`\n━━━ ${code} ${name}  现价 ${price}  涨跌 ${pct(Number(d.f3))} ━━━`)
  console.log('① 初筛(廉价字段过滤):')
  console.log(`   成交额  ${yi(amount).padStart(9)}  ≥ ${yi(C.LIQUIDITY_MIN)}   ${mark(okLiq)}`)
  console.log(`   总市值  ${yi(mcap).padStart(9)}  ≥ ${yi(C.MCAP_MIN)}  ${mark(okCap)}`)
  console.log(`   60日动量 ${pct(mom60).padStart(8)}  ≥ ${C.MOM60_MIN}%        ${mark(okMom)}`)
  console.log(`   非 ST/退                            ${mark(!isST)}`)
  console.log(`   量比 ${vr.toFixed(2)}(仅 stage-1 排序参考,非门槛)`)

  let reason = ''
  if (isST) reason = 'ST/退市股被剔除'
  else if (!okLiq) reason = `成交额 ${yi(amount)} < 门槛 ${yi(C.LIQUIDITY_MIN)}(流动性不足)`
  else if (!okCap) reason = `总市值 ${yi(mcap)} < 门槛 ${yi(C.MCAP_MIN)}(小市值剔除)`
  else if (!okMom) reason = `60日动量 ${pct(mom60)} < ${C.MOM60_MIN}%(非强势)`
  return { name, pass, reason }
}

/** Stage 2:K 线精筛(趋势模板 → 突破/扳机分组)。 */
async function stage2(code: string, fallbackName: string): Promise<Verdict> {
  const { name: kName, klines } = await fetchStockKline(code, 101, C.KLINE_COUNT)
  const name = kName || fallbackName
  const need = C.MA_LONG + C.MA_LONG_RISE_LOOKBACK + 1
  console.log(`② K线精筛:取到 ${klines?.length ?? 0} 根(需 ≥ ${need})`)
  if (!klines || klines.length < need) {
    console.log('   K线不足 → 次新股,趋势模板无法判定(跳过)')
    return { code, name, status: '次新股/K线不足,无法判定趋势模板' }
  }
  const bars = klines as Bar[]
  const closes = bars.map((b) => b.close)
  const last = bars.length - 1
  const c = closes[last]
  const tt = trendTemplate(bars, C)!
  const { f, m, s, l } = tt.ma
  // MA250 上行:与 MA_LONG_RISE_LOOKBACK 根前比较(复刻内部判定)
  const maLPrev = mean(closes.slice(last - C.MA_LONG_RISE_LOOKBACK - C.MA_LONG + 1, last - C.MA_LONG_RISE_LOOKBACK + 1))
  const dist52 = ((tt.hi52 - c) / tt.hi52) * 100
  const distLo = ((c - tt.lo52) / tt.lo52) * 100

  console.log('   趋势模板(硬门槛):')
  console.log(`     C ${c.toFixed(2)} > MA20 ${f.toFixed(2)} ${mark(c > f)}  > MA60 ${m.toFixed(2)} ${mark(f > m)}  > MA120 ${s.toFixed(2)} ${mark(m > s)}  > MA250 ${l.toFixed(2)} ${mark(s > l)}`)
  console.log(`     MA250 上行(${maLPrev.toFixed(2)}→${l.toFixed(2)}) ${mark(l > maLPrev)}`)
  console.log(`     距52周高 ${dist52.toFixed(2)}% ≤ ${((1 - C.HI52_NEAR) * 100).toFixed(0)}% ${mark(c >= C.HI52_NEAR * tt.hi52)}    距52周低 ${distLo.toFixed(1)}% ≥ ${((C.LO52_MULT - 1) * 100).toFixed(0)}% ${mark(c >= C.LO52_MULT * tt.lo52)}`)
  console.log(`     >>> 趋势模板 ${tt.pass ? 'PASS ✓' : 'FAIL ✗'}`)

  if (!tt.pass) {
    const fails: string[] = []
    if (!(c > f && f > m && m > s && s > l)) fails.push('均线非多头排列')
    if (!(l > maLPrev)) fails.push('MA250 未上行')
    if (!(c >= C.HI52_NEAR * tt.hi52)) fails.push(`距52周高 ${dist52.toFixed(1)}% 超 15%`)
    if (!(c >= C.LO52_MULT * tt.lo52)) fails.push('距52周低不足 25%')
    return { code, name, status: `趋势模板不过:${fails.join('、')}` }
  }

  // 分组诊断
  const v = computeVCP(bars, C)
  const pivot = v.resistPrior
  const distToPivot = ((pivot - c) / pivot) * 100
  const today = bars[last]
  const range = today.high - today.low
  const closeStrong = range > 0 ? (c - today.low) / range : 1
  const volNow = v.volSlow > 0 ? today.volume / v.volSlow : 0
  const breakoutVol = volNow >= C.BREAKOUT_VOL
  const abovePivot = c > pivot
  const notExt = c <= pivot * (1 + C.EXT_MAX / 100)
  const inNear = distToPivot > 0 && distToPivot <= C.NEAR_PCT
  const volDry = v.volRatio < C.VOL_DRY_MAX

  console.log(`   分组(pivot=52周前高 ${pivot.toFixed(2)},距 pivot ${distToPivot.toFixed(2)}%):`)
  console.log(`     [突破] 站上pivot ${mark(abovePivot)}  放量≥${C.BREAKOUT_VOL}× ${mark(breakoutVol)}(${volNow.toFixed(2)}×)  收强≥${C.CLOSE_STRENGTH} ${mark(closeStrong >= C.CLOSE_STRENGTH)}(${closeStrong.toFixed(2)})  不追高 ${mark(notExt)}`)
  console.log(`     [扳机] 贴前高0~${C.NEAR_PCT}% ${mark(inNear)}  缩量<${C.VOL_DRY_MAX} ${mark(volDry)}(volMA5/50=${v.volRatio.toFixed(2)})`)

  const cand = classify(bars, C)
  if (cand) {
    console.log(`   >>> ✅ 命中【${cand.group === 'breakout' ? '突破' : '扳机'}】${cand.signals.pattern}`)
    console.log(`       进场 ${cand.price}  止损 ${cand.stopLoss}  目标 ${cand.target}  评分 ${cand.score || '(单股探针不计排名分)'}`)
    return { code, name, group: cand.group, status: `命中 ${cand.group === 'breakout' ? '突破' : '扳机'}:${cand.signals.pattern}` }
  }

  // 趋势过但两组都不收 → 给「距触发还差什么」
  const tips: string[] = []
  if (abovePivot && !breakoutVol) tips.push(`已站上前高但量能仅 ${volNow.toFixed(2)}×,需放量到 ${C.BREAKOUT_VOL}× 确认`)
  if (!abovePivot) tips.push(`距前高还差 ${distToPivot.toFixed(2)}%(需放量站上 ${pivot.toFixed(2)} 进突破组)`)
  if (inNear && !volDry) tips.push(`贴近前高但放量(volMA5/50=${v.volRatio.toFixed(2)}),需缩量到 <${C.VOL_DRY_MAX} 才进扳机组`)
  if (!inNear && !abovePivot && distToPivot > C.NEAR_PCT) tips.push(`距前高 ${distToPivot.toFixed(2)}% 超出扳机带 ${C.NEAR_PCT}%`)
  console.log(`   >>> ⏳ 趋势完美,但落在"放量逼近"空档(两组都不收)`)
  console.log(`       距触发:${tips.join(';') || '等量价进一步明朗'}`)
  return { code, name, status: `观察中(趋势过/未触发):${tips.join(';')}` }
}

async function probeOne(code: string): Promise<Verdict> {
  try {
    const s1 = await stage1(code)
    if (s1 === null) {
      console.log(`\n━━━ ${code} ━━━\n① 初筛:取报价失败(代码不存在或数据源限流)`)
      return { code, name: code, status: '取报价失败(代码/数据源)' }
    }
    if (!s1.pass) {
      console.log(`   >>> 初筛即落选:${s1.reason}`)
      return { code, name: s1.name, status: `初筛落选:${s1.reason}` }
    }
    return await stage2(code, s1.name)
  } catch (e) {
    console.log(`\n━━━ ${code} ━━━ 探测异常:`, e instanceof Error ? e.message : e)
    return { code, name: code, status: '探测异常' }
  }
}

async function main() {
  const codes = process.argv.slice(2).map((s) => s.trim()).filter((s) => /^\d{6}$/.test(s))
  if (codes.length === 0) {
    console.log('用法: npm --prefix server run probe -- <6位代码> [更多代码...]')
    console.log('示例: npm --prefix server run probe -- 301308 600519 002008')
    process.exit(1)
  }
  console.log(`新高战法关注名单探针 · ${codes.length} 只 · 规则同线上(目标 ${C.TARGET_R_MULT}R 等)`)
  const verdicts: Verdict[] = []
  for (const code of codes) verdicts.push(await probeOne(code))

  console.log('\n════════ 汇总 ════════')
  for (const v of verdicts) {
    const tag = v.group === 'breakout' ? '🟢突破' : v.group === 'trigger' ? '🟡扳机' : '⚪观察'
    console.log(`  ${tag}  ${v.code} ${v.name.padEnd(6)}  ${v.status}`)
  }
}

main()
