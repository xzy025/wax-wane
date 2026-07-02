// 每日复盘综述的 LLM prompt 拼装(零 IO 纯函数,全部可测)。
//
// 职责边界:把 DailyReviewData 的结构化数据压成紧凑中文事实摘要(缺哪段删哪段,
// 绝不让 LLM 看到空段落去脑补),外加固定的 system 约束和定调句提取。
// LLM 调用本身在 dailyReview.ts。
import type { DailyReviewData } from './dailyReview'

export const REVIEW_SYSTEM_PROMPT = `你是一位克制、专业的A股每日盘报撰写者。根据用户提供的当日市场数据,写一段简短的中文复盘综述。硬性规则:
1. 只使用提供的数据,禁止编造任何数字、个股、事件;数据缺失的部分直接跳过不提。
2. 不做投资建议、不荐股、不预测具体点位;用"关注/留意"而非"买入/看多"。
3. 全文不超过 350 字。
4. 严格按以下 markdown 格式输出,不要任何多余前言或代码围栏:

**一句话定调**:<不超过40字,概括当日市场核心特征>

### 今日主线
- <2~4条,每条一句话:主线板块/资金去向/情绪结构,引用给定数据>

### 明日关注
- <2~3条:结合外围走势、宏观日历事件、板块轮动位置给出观察点>`

const pct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

/** 成交额(元)→ "X.XX万亿" / "XXXX亿"。 */
export function fmtTurnover(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`
  return `${Math.round(v / 1e8)}亿`
}

/** 龙虎榜净额(元)→ "±X.X亿"。 */
const fmtNet = (v: number): string => `${v >= 0 ? '+' : ''}${(v / 1e8).toFixed(1)}亿`

/**
 * 结构化数据 → 紧凑中文事实摘要(user prompt)。
 * 每段独立判空:该段无数据就整段不出现,避免 LLM 对空段落脑补。日历最多 8 条。
 */
export function buildReviewFacts(d: DailyReviewData): string {
  const secs: string[] = [`日期:${d.asof}`]

  const overnight = d.overnight.map((q) => `${q.name} ${pct(q.changePct)}`).join(' / ')
  const asia = d.asia.map((q) => `${q.name} ${pct(q.changePct)}`).join(' / ')
  if (overnight || asia) {
    const parts: string[] = []
    if (overnight) parts.push(`隔夜美股:${overnight}`)
    if (asia) parts.push(`今日亚太:${asia}`)
    secs.push(`【外围】${parts.join(';')}`)
  }

  const newsLines = d.news.slice(0, 6).map((n) => {
    const brief = n.summary ? `:${n.summary.slice(0, 120)}` : ''
    return `- [${n.source}] ${n.title}${brief}`
  })
  if (newsLines.length) secs.push(`【消息面】\n${newsLines.join('\n')}`)

  if (d.dragonTiger.length) {
    const fmtRow = (x: DailyReviewData['dragonTiger'][number]) => `${x.name}(${fmtNet(x.netAmt)}/${pct(x.changePct)})`
    const buys = d.dragonTiger.filter((x) => x.netAmt > 0).map(fmtRow)
    const sells = d.dragonTiger.filter((x) => x.netAmt <= 0).map(fmtRow)
    const parts: string[] = []
    if (buys.length) parts.push(`净买前列:${buys.join('、')}`)
    if (sells.length) parts.push(`净卖前列:${sells.join('、')}`)
    secs.push(`【龙虎榜】${parts.join(';')}`)
  }

  if (d.calendar.length) {
    const srcLabel = d.calendarSource === 'jin10' ? '金十' : d.calendarSource === 'builtin' ? '内置规则' : '金十+规则'
    const lines = d.calendar.slice(0, 8).map((e) => {
      const stars = '★'.repeat(Math.max(1, Math.min(3, e.star)))
      const extra = [e.previous ? `前值${e.previous}` : '', e.consensus ? `预期${e.consensus}` : '']
        .filter(Boolean)
        .join(' ')
      return `- ${e.date.slice(5)} ${e.country} ${e.name}${e.approx ? '(约)' : ''} ${stars}${extra ? ` ${extra}` : ''}`
    })
    secs.push(`【未来一周宏观日历】(来源:${srcLabel})\n${lines.join('\n')}`)
  }

  // 0 是"上游不可用"哨兵(ashare.ts totalTurnover 注释),不能当事实喂给 LLM。
  if (d.ashare && (d.ashare.indices.length > 0 || d.ashare.totalTurnover > 0)) {
    const parts: string[] = []
    if (d.ashare.indices.length > 0) {
      parts.push(d.ashare.indices.map((q) => `${q.name} ${pct(q.changePct)} ${q.price}`).join(' / '))
    }
    if (d.ashare.totalTurnover > 0) parts.push(`两市成交 ${fmtTurnover(d.ashare.totalTurnover)}`)
    if (d.ashare.advance + d.ashare.decline > 0) {
      parts.push(`涨停 ${d.ashare.limitUp} 跌停 ${d.ashare.limitDown}`, `上涨 ${d.ashare.advance} / 下跌 ${d.ashare.decline}`)
    }
    secs.push(`【A股】${parts.join(';')}`)
  }

  // 象限全 0 = rotation 上游故障(如东财限流),与卡片端同款守卫,不让 LLM 看到假的"全市场无强势板块"。
  if (d.structure && d.structure.hsCount + d.structure.lsCount + d.structure.hwCount + d.structure.lwCount > 0) {
    const s = d.structure
    const top = (arr: typeof s.topHs) => arr.map((b) => `${b.name}(${pct(b.shortChg)})`).join('、')
    secs.push(
      `【板块轮动】(60/5日窗口) 强势延续 ${s.hsCount} / 底部反转 ${s.lsCount} / 高位回调 ${s.hwCount} / 持续走弱 ${s.lwCount};` +
        `近5日上涨板块占比 ${s.shortUpPct}%` +
        (s.topHs.length ? `;抱团龙头:${top(s.topHs)}` : '') +
        (s.topLs.length ? `;反转候选:${top(s.topLs)}` : ''),
    )
  }

  secs.push('请按格式输出今日复盘综述。')
  return secs.join('\n\n')
}

/**
 * 从 LLM 输出提取"一句话定调"(折叠态展示)。三级降级:
 * 标准行 → 首个非空非标题行(去掉包裹的 **) → 空串(前端退化为只显标题)。
 */
export function extractTone(markdown: string): string {
  const m = /\*\*一句话定调\*\*[:：]\s*(.+)/.exec(markdown)
  if (m) return m[1].trim()
  for (const line of markdown.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    return t.replace(/^\*\*/, '').replace(/\*\*$/, '').trim()
  }
  return ''
}
