// 板块轮动节奏探针 —— 用线上同款取数(getBoardBars)对指定板块跑 computeTempoSeries,
// 打印逐日 启动/调整第N天·强弱·注记,对照游资复盘表验收状态口径(长期保留作口径回归工具)。
//
// 用法:
//   npm --prefix server run probe:tempo                       (默认关键词:半导体 存储)
//   npm --prefix server run probe:tempo -- 半导体设备 存储芯片 算力
//   FROM=2026-07-03 TO=2026-07-09 npm --prefix server run probe:tempo -- 半导体
// 验收标准:与截图逐日对照,每板块 5 日中 ≥4 日 state(启动/调整)一致即过;
// tier 不符优先调 TEMPO.STRONG_PCT(1.2/1.5/2.0),阈值单点在 rotationRules.ts。
import { fetchBoardUniverse, fetchBoardConstituents, getBoardBars, mapLimit, type BoardMeta } from '../services/rotation'
import { fetchStockKline } from '../services/ashare'
import { dailyChanges, volRatios, computeTempoSeries, tempoHeat, TEMPO, type TempoDayInput } from '../services/rotationRules'
import { REBOUND } from '../config/screener'

const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
const TIER_MARK = { strong: '🔴强', weak: '🟡弱', adjust: '🟢' } as const
const Q_LABEL = { aboveIndex: '强于指数', volUp: '放量', volDown: '缩量', resilient: '抗跌' } as const

/** 板块K线挂时(push2his 慢性封锁)的降级:成交额前 N 成分股K线等权重构板块逐日涨跌。
 *  与 rotationTempo 服务层同思路(kpl 题材同款);量能不聚合(量纲混杂)→ volRatio undefined。 */
async function reconstructBoardChg(bkCode: string, topN = 15): Promise<Map<string, number[]>> {
  const members = (await fetchBoardConstituents(bkCode)).slice(0, topN)
  const byDate = new Map<string, number[]>()
  await mapLimit(members, 8, async (m) => {
    try {
      const { klines } = await fetchStockKline(m.code, 101, 70)
      for (const d of dailyChanges(klines)) {
        const arr = byDate.get(d.date) ?? []
        arr.push(d.chg)
        byDate.set(d.date, arr)
      }
    } catch {
      /* 单股失败容忍 */
    }
  })
  return byDate
}

async function main() {
  const keywords = process.argv.slice(2).filter((s) => s && !s.startsWith('-'))
  const kws = keywords.length ? keywords : ['半导体', '存储']
  const from = process.env.FROM ?? ''
  const to = process.env.TO ?? ''

  console.log(`节奏探针 · 关键词 [${kws.join(' ')}] · 口径:启动=收红且≥指数;红=涨幅≥${TEMPO.STRONG_PCT}%或量比≥${TEMPO.VOL_UP}×`)
  const [industry, concept] = await Promise.all([fetchBoardUniverse('industry'), fetchBoardUniverse('concept')])
  const universe: (BoardMeta & { cat: string })[] = [
    ...industry.map((b) => ({ ...b, cat: '行业' })),
    ...concept.map((b) => ({ ...b, cat: '概念' })),
  ]
  const matched = universe.filter((b) => kws.some((k) => b.name.includes(k))).slice(0, 6)
  if (matched.length === 0) {
    console.log('✗ 无匹配板块;可用板块示例:', universe.slice(0, 20).map((b) => b.name).join(' '))
    process.exit(1)
  }

  const idxBars = await getBoardBars(REBOUND.INDEX_SECID) // 上证,与节奏表同基准
  const idxChgs = dailyChanges(idxBars)
  const idxByDate = new Map(idxChgs.map((d) => [d.date, d.chg]))

  for (const b of matched) {
    console.log(`\n━━━ ${b.cat} ${b.code} ${b.name} ━━━`)
    let days: TempoDayInput[]
    try {
      const bars = await getBoardBars(`90.${b.code}`)
      if (bars.length < 10) throw new Error('bars 不足')
      const chgs = dailyChanges(bars)
      const vrs = volRatios(bars.map((x) => x.volume)) // 与 bars 等长;chgs 从 bars[1] 起 → vrs[i+1] 对齐 chgs[i]
      days = chgs
        .map((d, i) => ({ date: d.date, boardChg: d.chg, indexChg: idxByDate.get(d.date) ?? NaN, volRatio: vrs[i + 1] }))
        .filter((d) => Number.isFinite(d.indexChg))
      console.log('   来源:东财板块日K')
    } catch {
      // push2his 挂(慢性)→ 成分股等权重构(成交额前15,腾讯兜底K线)
      console.log('   来源:板块日K不可用 → 成分股等权重构(前15成分,无量比)')
      const byDate = await reconstructBoardChg(b.code)
      days = [...byDate.entries()]
        .filter(([date, chgs]) => idxByDate.has(date) && chgs.length >= 8) // 覆盖率:≥8/15 成分才算有效日
        .sort((a, b2) => a[0].localeCompare(b2[0]))
        .map(([date, chgs]) => ({
          date,
          boardChg: chgs.reduce((s, x) => s + x, 0) / chgs.length,
          indexChg: idxByDate.get(date) ?? NaN,
        }))
    }
    if (days.length < 5) {
      console.log('   数据不足,跳过')
      continue
    }
    const cells = computeTempoSeries(days)
    const inRange = cells.filter((c) => (!from || c.date >= from) && (!to || c.date <= to))
    const show = from || to ? inRange : cells.slice(-TEMPO.WINDOW)
    for (const c of show) {
      const d = days.find((x) => x.date === c.date)
      const vr = d?.volRatio
      const q = c.qualifiers.map((k) => Q_LABEL[k]).join(' ')
      console.log(
        `   ${c.date}  ${c.state === 'launch' ? '启动' : '调整'}第${c.dayN}天 ${TIER_MARK[c.tier]}  板块 ${pct(c.chg).padStart(7)}  指数 ${pct(d?.indexChg ?? NaN).padStart(7)}  量比 ${vr !== undefined && Number.isFinite(vr) ? vr.toFixed(2) + '×' : ' --  '}  ${q}`,
      )
    }
    console.log(`   发酵度 heat=${tempoHeat(cells)}`)
  }
}

main()
