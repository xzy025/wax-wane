// 全局东财节流器实抓探针(移植计划②验收)—— 真网络下验证 emFetch 四件事:
//   ① quote 族出队间隔 ≥ gap(全局账本,跨并发槽成立)  ② 在飞并发 ≤ conc
//   ③ report 族独立记账、间隔成立  ④ 服务层单例接线(resolveStock 走 searchapi)
// 出队时刻由注入 fetchImpl 记录(节流后、真发请求前),因此测的是节流器对真实时钟的效果。
//
// 用法:
//   npm --prefix server run probe:emfetch
//   EM_QUOTE_GAP_MS=120 npm --prefix server run probe:emfetch   (验证 env 调参生效)
// 验收标准:四项 ✓ 且无 403/异常;若线上正处风控冷却,探针会打印 EmCooldownError 并以 2 退出
// (这本身证明冷却快速失败在工作,不算探针失败——等冷却过了重跑)。
import { createEmFetch, emFetchDebugState, EmCooldownError, type EmFetchInit } from '../lib/emFetch'
import { EM_HEADERS } from '../lib/emHeaders'

const QUOTE_SECIDS = [
  '1.600000', '1.600036', '1.600519', '1.600900', '1.601318', '1.601899', '1.603501', '1.600031', '1.601012', '1.688981',
  '0.000001', '0.000002', '0.000858', '0.000333', '0.000725', '0.002415', '0.002594', '0.300750', '0.300059', '0.300308',
]
const klineUrl = (secid: string) =>
  `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1&fields2=f51,f53&klt=101&fqt=1&end=20500101&lmt=5`
const reportUrl = (report: string, pn: number) =>
  `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${report}&columns=ALL&source=WEB&client=WEB&pageSize=1&pageNumber=${pn}`

interface Shot { url: string; at: number; done: number; status: number }

async function main() {
  const gapQ = Number(process.env.EM_QUOTE_GAP_MS ?? 60)
  const gapR = Number(process.env.EM_REPORT_GAP_MS ?? 250)
  const concQ = Number(process.env.EM_QUOTE_CONC ?? 8)

  // 独立实例 + 记录出队轨迹的 fetchImpl(单例另测,见④)
  const shots: Shot[] = []
  let active = 0
  let maxActive = 0
  const { emFetch: probeFetch, debugState } = createEmFetch(undefined, {
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const shot: Shot = { url: String(url), at: Date.now(), done: 0, status: -1 }
      shots.push(shot)
      active++
      maxActive = Math.max(maxActive, active)
      try {
        const res = await fetch(url as string, init)
        shot.status = res.status
        return res
      } finally {
        active--
        shot.done = Date.now()
      }
    }) as typeof fetch,
  })

  console.log(`emFetch 实抓探针 · quote gap=${gapQ}ms conc=${concQ} · report gap=${gapR}ms`)

  // ①② quote 族:20 发 K线 并发齐射,验证间隔与并发槽
  const t0 = Date.now()
  const quotes = await Promise.all(
    QUOTE_SECIDS.map((s) =>
      probeFetch(klineUrl(s), { headers: EM_HEADERS, timeoutMs: 8000 } as EmFetchInit)
        .then(async (r) => ((await r.json()) as { data?: { klines?: string[] } })?.data?.klines?.length ?? 0)
        .catch((e) => (e instanceof EmCooldownError ? 'cooldown' : `err:${e}`)),
    ),
  )
  const quoteShots = shots.filter((s) => s.url.includes('push2his')).sort((a, b) => a.at - b.at)
  const gaps = quoteShots.slice(1).map((s, i) => s.at - quoteShots[i].at)
  const span = quoteShots.length > 1 ? quoteShots[quoteShots.length - 1].at - quoteShots[0].at : 0
  const okQ = quotes.filter((q) => typeof q === 'number' && q > 0).length

  // ③ report 族:4 发 datacenter,应完全不受 quote 账本影响
  const reports = await Promise.all(
    [1, 2].flatMap((pn) => ['RPT_ORG_SURVEYNEW', 'RPT_DAILYBILLBOARD_DETAILSNEW'].map((r) => reportUrl(r, pn))).map((u) =>
      probeFetch(u, { headers: EM_HEADERS, timeoutMs: 10000 } as EmFetchInit)
        .then((r) => r.status)
        .catch((e) => (e instanceof EmCooldownError ? 'cooldown' : `err:${e}`)),
    ),
  )
  const reportShots = shots.filter((s) => s.url.includes('datacenter-web')).sort((a, b) => a.at - b.at)
  const rGaps = reportShots.slice(1).map((s, i) => s.at - reportShots[i].at)

  // ④ 服务层单例接线:searchapi(report 族)经 services/stockSearch → 默认单例
  const { resolveStock } = await import('../services/stockSearch')
  const hit = await resolveStock('京东方A').catch((e) => (e instanceof EmCooldownError ? null : Promise.reject(e)))

  if ([...quotes, ...reports].includes('cooldown')) {
    console.log('⚠ 线上正处 403 风控冷却,快速失败路径已验证;等冷却结束后重跑本探针')
    process.exit(2)
  }

  // 判定:速率与突发上界(实现承诺的是账本级速率;事件循环下 timer 批量补发会压扁瞬时
  // 相邻间距,故不断言逐对 gap——只断言 ⑴ 跨度 ≥ (N-1)*gap ⑵ 任意 500ms 窗内出队数
  // ≤ 1.5×名义值。裸 fetch 齐射(20 发同 tick)必然打穿 ⑵,节流生效则两者都成立。
  const WIN = 500
  const burstCap = Math.ceil((WIN / gapQ) * 1.5)
  let maxBurst = 0
  for (let i = 0; i < quoteShots.length; i++) {
    let n = 0
    for (let j = i; j < quoteShots.length && quoteShots[j].at - quoteShots[i].at <= WIN; j++) n++
    maxBurst = Math.max(maxBurst, n)
  }
  const burstOk = maxBurst <= burstCap
  const spanOk = span >= (quoteShots.length - 1) * gapQ * 0.9 - 30
  const concOk = maxActive <= concQ
  const rGapOk = rGaps.length === 0 || Math.min(...rGaps) >= gapR * 0.45 - 15
  const httpOk = okQ >= QUOTE_SECIDS.length - 2 && reports.every((s) => s === 200)

  console.log(`① quote 速率:出队 ${quoteShots.length} 发 跨度 ${span}ms(下限 ${(quoteShots.length - 1) * gapQ}ms) ${WIN}ms窗峰值 ${maxBurst}/${burstCap} 相邻最小 ${gaps.length ? Math.min(...gaps) : '-'}ms(参考) → ${burstOk && spanOk ? '✓' : '✗'}`)
  console.log(`② 并发槽:峰值在飞 ${maxActive}/${concQ} → ${concOk ? '✓' : '✗'}`)
  console.log(`③ report 独立:${reportShots.length} 发 相邻最小 ${rGaps.length ? Math.min(...rGaps) : '-'}ms(gap ${gapR}) 状态 [${reports.join(',')}] → ${rGapOk ? '✓' : '✗'}`)
  console.log(`④ 单例接线:resolveStock('京东方A') → ${hit ? `${hit.code} ${hit.name} ✓` : '✗ 未命中'}`)
  console.log(`   K线成功 ${okQ}/${QUOTE_SECIDS.length} · 实际 QPS ${(quoteShots.length / Math.max(span, 1) * 1000).toFixed(1)} · 单例账本 ${JSON.stringify(emFetchDebugState())} · 探针账本 ${JSON.stringify(debugState())}`)
  console.log(`   总耗时 ${Date.now() - t0}ms`)

  const pass = burstOk && spanOk && concOk && rGapOk && httpOk && !!hit
  console.log(pass ? '✅ 全部通过' : '❌ 存在失败项')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error('探针异常:', e)
  process.exit(1)
})
