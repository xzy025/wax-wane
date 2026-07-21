// 解禁日历实抓探针(移植计划③验收)—— 验证三件事:
//   ① RPT_LIFT_STAGE 新列名活着(FREE_SHARES_TYPE/ABLE_FREE_SHARES/FREE_RATIO 非空——旧列名恒空的坑)
//   ② 窗口过滤+分组正确(全市场未来 N 日,code→按日升序批次)
//   ③ 量纲合理(ratioPct ∈ (0,100],日期在窗内)
// 用法:
//   npm --prefix server run probe:liftban            (默认 30 天窗)
//   DAYS=90 npm --prefix server run probe:liftban    (SKILL 同款 90 天日历)
import { fetchUpcomingLiftBans, toLiftBanBadge, windowEnd } from '../services/liftBan'
import { todayShanghai } from '../lib/time'

async function main() {
  const days = Number(process.env.DAYS) || 30
  const from = todayShanghai()
  const to = windowEnd(from, days)
  console.log(`解禁探针 · 窗口 ${from} ~ ${to}(${days} 天)`)

  const map = await fetchUpcomingLiftBans(from, days)
  const codes = [...map.keys()]
  const events = [...map.values()].flat()
  console.log(`命中 ${codes.length} 只 / ${events.length} 批`)

  const typed = events.filter((e) => e.type.trim().length > 0)
  const inWindow = events.filter((e) => e.date >= from && e.date <= to)
  // ratio 可 >100%:首发原股东解禁时解禁股可达当前流通股本的数倍(IPO 仅流通 25% → 300% 合法且是最重抛压);
  // 上界 500% 只防量纲漂移(若东财改成千分比/basis point 会打穿)。0=字段缺省,容忍。
  const ratioSane = events.filter((e) => e.ratioPct >= 0 && e.ratioPct <= 500)
  const sorted = [...map.values()].every((evs) => evs.every((e, i) => i === 0 || evs[i - 1].date <= e.date))

  console.log(`① 新列名:类型非空 ${typed.length}/${events.length} → ${typed.length === events.length ? '✓' : typed.length > events.length * 0.9 ? '✓(个别缺省可容忍)' : '✗ 旧列名坑复发?'}`)
  console.log(`② 窗口+排序:窗内 ${inWindow.length}/${events.length} 组内升序 ${sorted ? '✓' : '✗'} → ${inWindow.length === events.length && sorted ? '✓' : '✗'}`)
  console.log(`③ 量纲:ratioPct∈[0,500] ${ratioSane.length}/${events.length} → ${ratioSane.length === events.length ? '✓' : '✗(FREE_RATIO 量纲变了?)'}`)

  // 样例:最近 3 批 + 占比最大 3 批(角标口径)
  const nearest = [...events].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 3)
  const biggest = [...events].sort((a, b) => b.ratioPct - a.ratioPct).slice(0, 3)
  const codeOf = (ev: (typeof events)[number]) => codes.find((c) => map.get(c)?.includes(ev)) ?? '?'
  for (const e of nearest) console.log(`   最近: ${codeOf(e)} ${e.date} ${e.ratioPct}% ${e.type}`)
  for (const e of biggest) console.log(`   最大: ${codeOf(e)} ${e.date} ${e.ratioPct}% ${e.type}(可流通 ${e.ableSharesWan} 万股)`)
  const sample = codes[0]
  console.log(`   角标样例: ${sample} →`, toLiftBanBadge(map.get(sample)))

  const pass = codes.length > 0 && typed.length >= events.length * 0.9 && inWindow.length === events.length && sorted && ratioSane.length === events.length
  console.log(pass ? '✅ 全部通过' : '❌ 存在失败项')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error('探针异常:', e)
  process.exit(1)
})
