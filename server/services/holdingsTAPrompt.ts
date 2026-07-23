// 盘后持仓TA叙事的 LLM prompt 拼装(零 IO 纯函数,全部可测)。
// 职责边界:把 HoldingsTAResult 压成每票一行的紧凑中文事实(缺哪段删哪段,
// 绝不让 LLM 看到空段落去脑补);LLM 调用本身在 holdingsTA.ts。
// avgCost 只在这里换算成浮盈%喂给叙事,原值不落盘。
import type { HoldingTAItem, HoldingsTAResult } from './holdingsTARules'

export const HOLDINGS_TA_SYSTEM_PROMPT = `你是一位克制、专业的A股持仓技术面复盘助手。根据用户提供的持仓结构化技术数据,写一段简短的中文盘后持仓综述。硬性规则:
1. 只使用提供的数据,禁止编造任何数字、个股、事件;数据缺失的部分直接跳过不提。
2. 不做投资建议、不荐股、不预测点位;用"关注/留意/观察"而非"买入/卖出/加仓/清仓"。
3. 全文不超过 400 字。
4. 严格按以下 markdown 格式输出,不要任何多余前言或代码围栏:

**一句话定调**:<不超过40字,概括当日持仓组合技术面全貌>

### 持仓结构
- <每只一条:阶段/多空/量价信号/较昨变化,引用给定数据>

### 明日观察
- <2~3条:观察位(支撑/压力/均线/ATR止损)与需要留意的信号>`

const pct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const MA_LABEL: Record<string, string> = { ma5: 'MA5', ma10: 'MA10', ma20: 'MA20', ma60: 'MA60', ma250: 'MA250' }

/** 单票一行紧凑事实(缺段即删)。 */
function itemLine(it: HoldingTAItem, avgCost?: number): string {
  const segs: string[] = [`${it.name}(${it.code}) 收${it.close} ${pct(it.changePct)}`]

  const score = Math.round(it.combo.score01 * 100)
  const dScore = it.delta ? `(昨${it.delta.score01 >= 0 ? '+' : ''}${Math.round(it.delta.score01 * 100)}分)` : ''
  segs.push(`${it.combo.note}·技术分${score}${dScore}`)

  const above = Object.entries(it.aboveMa)
    .filter(([k, v]) => v && it.ma[k as keyof typeof it.ma] > 0)
    .map(([k]) => MA_LABEL[k])
  const tt = it.trendTemplateOk === null ? '' : `多头排列${it.trendTemplateOk ? '✓' : '✗'} `
  segs.push(`${tt}${above.length ? `站上${above.join('/')}` : '未站上任何均线'}`)

  segs.push(`量比${it.volRatio} 今量${it.breakoutVolRatio}× 距52周高${it.dist52Pct}%`)
  if (it.nPattern) {
    const np = it.nPattern
    segs.push(`N字:${np.note}${np.nTarget !== null ? ` 对称目标${np.nTarget}` : ''}`)
  }
  if (typeof it.relStrength === 'number') {
    segs.push(`RS${it.relStrength >= 0 ? '+' : ''}${it.relStrength}pp${it.counterTrend ? '(逆势强)' : ''}`)
  }
  segs.push(`ATR止损${it.atrStop} S1 ${it.pivots.s1}/R1 ${it.pivots.r1}`)
  if (typeof avgCost === 'number' && avgCost > 0 && it.close > 0) {
    segs.push(`浮盈${pct((it.close / avgCost - 1) * 100)}`)
  }

  const warn: string[] = []
  if (it.delta?.distributionNew) warn.push('⚠新增派发警报')
  else if (it.combo.distribution) warn.push('⚠派发')
  if (it.delta) {
    const lost = it.delta.maCrossings.filter((c) => c.startsWith('lost:')).map((c) => MA_LABEL[c.slice(5)])
    const regain = it.delta.maCrossings.filter((c) => c.startsWith('regain:')).map((c) => MA_LABEL[c.slice(7)])
    if (lost.length) warn.push(`失守${lost.join('/')}`)
    if (regain.length) warn.push(`收复${regain.join('/')}`)
    if (it.delta.wyckoffChanged) warn.push(`阶段${it.delta.wyckoffChanged.from}→${it.delta.wyckoffChanged.to}`)
    if (it.delta.nChanges?.length) warn.push(it.delta.nChanges.join(' '))
  }
  if (warn.length) segs.push(warn.join(' '))

  return `- ${segs.join(' | ')}`
}

/**
 * 结构化 TA → 紧凑中文事实摘要(user prompt)。error 票整行跳过;
 * delta 为 null(无昨档)时全程不出现"昨"字样。
 */
export function buildHoldingsTAFacts(
  r: HoldingsTAResult,
  positions: ReadonlyArray<{ code: string; avgCost?: number }> = [],
): string {
  const costOf = new Map(positions.filter((p) => typeof p.avgCost === 'number').map((p) => [p.code, p.avgCost!]))
  const ok = r.items.filter((i) => !i.error)
  const secs: string[] = [`日期:${r.date}`]

  if (ok.length) {
    secs.push(`【持仓技术面】\n${ok.map((it) => itemLine(it, costOf.get(it.code))).join('\n')}`)

    const ttOk = ok.filter((i) => i.trendTemplateOk === true).length
    const distN = ok.filter((i) => i.combo.distribution).length
    const parts = [`共${ok.length}只`, `多头排列${ttOk}只`]
    if (distN) parts.push(`派发警报${distN}只`)
    const b = r.benchmarks
    if (b.hs300 !== 0 || b.chinext !== 0 || b.star50 !== 0) {
      parts.push(`基准:沪深300 ${pct(b.hs300)} / 创业板指 ${pct(b.chinext)} / 科创50 ${pct(b.star50)}`)
    }
    secs.push(`【组合】${parts.join(';')}`)
  }

  secs.push('请按格式输出持仓技术面综述。')
  return secs.join('\n\n')
}
