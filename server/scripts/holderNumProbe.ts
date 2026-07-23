// 股东户数实抓探针(移植计划⑤验收)—— 验证三件事:
//   ① RPT_HOLDERNUMLATEST 列名活着(HOLDER_NUM/HOLDER_NUM_RATIO/END_DATE/HOLD_NOTICE_DATE/AVG_HOLD_NUM
//      ——⚠上游 SKILL 写的 AVG_FREE_SHARES 已被证伪不存在)
//   ② in(...) 批量 filter 可用(吸筹监控一次请求全覆盖的前提)
//   ③ 量纲合理(环比已是百分数不需×100;户数为正;披露日≥期末日)
// 用法:
//   npm --prefix server run probe:holdernum                    (默认样本:激智/士兰微/京东方)
//   CODES=600519,000858 npm --prefix server run probe:holdernum
import { fetchHolderNums } from '../services/holderNum'

async function main() {
  const codes = (process.env.CODES ?? '300566,600460,000725').split(',').map((s) => s.trim())
  console.log(`股东户数探针 · 样本 ${codes.join(' / ')}`)

  const map = await fetchHolderNums(codes)
  console.log(`命中 ${map.size}/${codes.length} 只`)

  const badges = [...map.values()]
  const numOk = badges.filter((b) => b.holderNum > 0 && Number.isFinite(b.changePct))
  const dateOk = badges.filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.endDate) && b.noticeDate >= b.endDate)
  // 环比量纲哨兵:季度户数环比几乎不可能超±80%(若东财改成小数,值会集中在±1内;若改千分比会打穿)
  const ratioSane = badges.filter((b) => Math.abs(b.changePct) <= 80)

  console.log(`① 列名:户数>0 且环比有限 ${numOk.length}/${badges.length} → ${numOk.length === badges.length ? '✓' : '✗ 列名漂移?'}`)
  console.log(`② 批量+日期:期末日格式对且披露日≥期末日 ${dateOk.length}/${badges.length} → ${dateOk.length === badges.length ? '✓' : '✗'}`)
  console.log(`③ 量纲:|环比|≤80% ${ratioSane.length}/${badges.length} → ${ratioSane.length === badges.length ? '✓' : '✗(HOLDER_NUM_RATIO 量纲变了?)'}`)

  for (const [code, b] of map) {
    console.log(`   ${code}: 户数 ${b.holderNum.toLocaleString()} 环比 ${b.changePct > 0 ? '+' : ''}${b.changePct}%(${b.endDate} 期,${b.noticeDate} 披露)户均 ${b.avgHoldShares.toLocaleString()} 股`)
  }

  const pass = map.size > 0 && numOk.length === badges.length && dateOk.length === badges.length && ratioSane.length === badges.length
  console.log(pass ? '✅ 全部通过' : '❌ 存在失败项')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error('探针异常:', e)
  process.exit(1)
})
