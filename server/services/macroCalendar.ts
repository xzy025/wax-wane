// 宏观数据发布日历:金十免费日历(按天 JSON)+ 内置规则兜底。
//
// 金十 CDN(cdn-rili.jin10.com)在部分网络环境不可达(本机实测 DNS 失败),
// 所以内置规则日历不是"兜底"而是常态路径:按天独立 catch,哪天拉到用哪天,
// 拉不到的那天落回规则事件(非农首个周五/LPR 20日/FOMC 硬编码等)。
// 解析/规则/合并全部是纯函数,零网络可测。
import { createCache } from '../lib/cache'
import { mapLimit } from './ashare'

export interface MacroEvent {
  date: string // YYYY-MM-DD
  time?: string // HH:mm(金十 pub_time;规则事件无具体时间)
  country: string // '中国' | '美国' | ...
  name: string
  star: number // 金十 1-3;规则事件统一 3
  previous?: string
  consensus?: string
  approx?: boolean // 规则事件里"约X日"类的估算日期
  source: 'jin10' | 'builtin'
}

export interface MacroCalendarResult {
  asof: string
  events: MacroEvent[]
  source: 'jin10' | 'builtin' | 'mixed'
}

const CAL_DAYS = 7 // 未来一周
const CAL_TTL = 12 * 3_600_000 // 日历一天内基本不变,固定长 TTL

/** 今天的上海日(YYYY-MM-DD);上海固定 UTC+8 无夏令时。 */
export function todayShanghai(): string {
  const now = new Date()
  const sh = new Date(now.getTime() + now.getTimezoneOffset() * 60_000 + 8 * 3_600_000)
  return sh.toISOString().slice(0, 10)
}

// ── 日期运算(全部基于 UTC 字符串,不依赖本机时区) ──────────────────────
function toUTC(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** 从 from 起连续 days 天的日期串(含 from)。 */
export function dateRange(from: string, days: number): string[] {
  const out: string[] = []
  const base = toUTC(from).getTime()
  for (let i = 0; i < days; i++) out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10))
  return out
}

// ── 金十解析(纯函数) ─────────────────────────────────────────────────
const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''

/** pub_time 可能是 unix 秒或含 HH:mm 的字符串,统一提取上海时刻 HH:mm。 */
function extractTime(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1_000_000_000) {
    const sh = new Date(v * 1000 + 8 * 3_600_000)
    return `${String(sh.getUTCHours()).padStart(2, '0')}:${String(sh.getUTCMinutes()).padStart(2, '0')}`
  }
  if (typeof v === 'string') {
    const m = /(\d{1,2}):(\d{2})/.exec(v)
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
  }
  return undefined
}

/** 金十单日 economics.json → MacroEvent[]。非数组/脏条目容错跳过,绝不抛。 */
export function parseJin10Day(raw: unknown, date: string): MacroEvent[] {
  if (!Array.isArray(raw)) return []
  const out: MacroEvent[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const name = str(r.name) || str(r.indicator_name) || str(r.title)
    if (!name) continue
    const starN = Number(r.star)
    out.push({
      date,
      time: extractTime(r.pub_time ?? r.public_time ?? r.time),
      country: str(r.country) || '—',
      name,
      star: Number.isFinite(starN) ? Math.max(0, Math.min(3, starN)) : 0,
      previous: str(r.previous) || undefined,
      consensus: str(r.consensus) || undefined,
      source: 'jin10',
    })
  }
  return out
}

// ── 重要度过滤(纯函数) ───────────────────────────────────────────────
const KEY_RE = /(CPI|PPI|GDP|PMI|非农|失业|利率决议|LPR|MLF|社会?融|新增信贷|新增贷款|M2|零售|FOMC|议息)/i

/** star≥2,或 中/美 + 关键指标名命中。规则事件(star=3)天然通过。 */
export function isImportant(e: MacroEvent): boolean {
  if (e.star >= 2) return true
  return /中国|美国/.test(e.country) && KEY_RE.test(e.name)
}

// ── 内置规则日历(纯函数) ─────────────────────────────────────────────
// FOMC 2026 决议日(美东,北京时间次日凌晨公布)——对照美联储官网日程硬编码。
const FOMC_2026 = new Set([
  '2026-01-28',
  '2026-03-18',
  '2026-04-29',
  '2026-06-17',
  '2026-07-29',
  '2026-09-16',
  '2026-10-28',
  '2026-12-09',
])

/**
 * 给定起始日+天数,生成窗口内的规则事件。日期规则:
 *   中国: CPI/PPI 约9日 · 社融/信贷 约13日(中旬) · LPR 20日 · MLF 约25日 · 官方PMI 月末最后一天
 *   美国: 非农=每月第一个周五 · CPI 约13日 · FOMC 按 2026 硬编码日程
 * "约X日"类标 approx=true(前端提示估算日期);全部 star=3。
 */
export function builtinCalendar(fromDate: string, days: number): MacroEvent[] {
  const out: MacroEvent[] = []
  for (const date of dateRange(fromDate, days)) {
    const d = toUTC(date)
    const dd = d.getUTCDate()
    const dow = d.getUTCDay()
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    const ev = (country: string, name: string, approx: boolean) =>
      out.push({ date, country, name, star: 3, approx, source: 'builtin' })

    if (dd === 9) ev('中国', 'CPI/PPI 月度物价数据', true)
    if (dd === 13) ev('中国', '社融/新增信贷(中旬公布)', true)
    if (dd === 20) ev('中国', 'LPR 报价', false)
    if (dd === 25) ev('中国', 'MLF 操作', true)
    if (dd === lastDay) ev('中国', '官方制造业PMI', false)
    if (dow === 5 && dd <= 7) ev('美国', '非农就业报告', false)
    if (dd === 13) ev('美国', 'CPI(中旬公布)', true)
    if (FOMC_2026.has(date)) ev('美国', 'FOMC 利率决议(北京时间次日凌晨公布)', false)
  }
  return out
}

// ── 合并(纯函数) ─────────────────────────────────────────────────────
/**
 * 逐日合并:某日金十拉到(含空数组=当日确无事件)→ 用金十;该日失败(null)→ 用规则事件。
 * source: 全成功 jin10 / 全失败 builtin / 各有 mixed。按 日期,时刻 排序(无时刻排该日末尾)。
 */
export function mergeCalendar(
  byDay: Map<string, MacroEvent[] | null>,
  builtin: MacroEvent[],
): { events: MacroEvent[]; source: MacroCalendarResult['source'] } {
  const events: MacroEvent[] = []
  let okDays = 0
  let failDays = 0
  for (const [date, dayEvents] of byDay) {
    if (dayEvents !== null) {
      okDays++
      events.push(...dayEvents)
    } else {
      failDays++
      events.push(...builtin.filter((e) => e.date === date))
    }
  }
  events.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.time ?? '99:99').localeCompare(b.time ?? '99:99'),
  )
  const source = failDays === 0 ? 'jin10' : okDays === 0 ? 'builtin' : 'mixed'
  return { events, source }
}

// ── 取数 + 缓存 ──────────────────────────────────────────────────────
async function fetchJin10Day(date: string): Promise<MacroEvent[]> {
  const [y, m, d] = date.split('-')
  const url = `https://cdn-rili.jin10.com/web_data/${y}/daily/${m}/${d}/economics.json`
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
  if (!res.ok) throw new Error(`jin10 HTTP ${res.status}`)
  return parseJin10Day(await res.json(), date)
}

/** 未来 CAL_DAYS 天:按天并发拉金十(每天独立 catch)→ 逐日合并规则兜底 → 重要度过滤。永不 reject。 */
async function computeMacroCalendar(): Promise<MacroCalendarResult> {
  const from = todayShanghai()
  const dates = dateRange(from, CAL_DAYS)
  const perDay = await mapLimit(dates, 3, (d) => fetchJin10Day(d).catch(() => null))
  const byDay = new Map(dates.map((d, i) => [d, perDay[i]] as const))
  const { events, source } = mergeCalendar(byDay, builtinCalendar(from, CAL_DAYS))
  return { asof: from, events: events.filter(isImportant), source }
}

const calendarCache = createCache<MacroCalendarResult>({
  name: 'MacroCalendar',
  ttl: CAL_TTL,
  fetcher: computeMacroCalendar,
})

export function fetchMacroCalendar(): Promise<MacroCalendarResult> {
  return calendarCache.get()
}

export function clearMacroCalendarCache(): void {
  calendarCache.clear()
}
