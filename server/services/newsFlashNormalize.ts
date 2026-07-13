// 7x24 快讯三源归一化 + 去重合并(零 IO 纯函数,全部可测)。
//
// 上游真实响应结构(东财/新浪 2026-07-07、财联社 2026-07-14 实抓样本):
//   东财 getFastNewsList → { data: { fastNewsList: [{ code, title, summary, showTime,
//     titleColor, stockList: ["1.603132", "0.300620", ...] }] } }
//     - stockList 为 "市场.代码" 字符串,与项目 secid 口径一致(0=深 1=沪);
//     - summary 常以 "【标题】正文" 开头,展示层需去重;
//     - titleColor ≥ 2 = 东财加红要闻。
//   新浪 zhibo feed → { result: { data: { feed: { list: [{ id, rich_text, create_time,
//     tag: [{name}], ext: "<JSON字符串>", docurl }] } } } }
//     - rich_text 可能以 "【标题】" 开头也可能是纯正文;
//     - ext 是 JSON 字符串,内含 stocks[{market:'cn',symbol:'sz300024'}] 与 docurl;
//     - tag.name 含 "焦点" = 新浪要闻。
//   财联社 v1/roll/get_roll_list → { errno: 0, data: { roll_data: [{ id, ctime(unix秒),
//     level, title, brief, content, is_ad, shareurl, stock_list: [{StockID:'sh688183',
//     name, ...}] }] } }(来源 a-stock-data SKILL §5.2,签名见 buildClsUrl)
//     - title 常为空,brief 通常是 "【标题】正文",从 brief 拆标题优先;
//     - level: 'A'=加红 'B'=加粗(要闻) 'C'=普通;
//     - stock_list 带股票名(东财/新浪没有),StockID 前缀 sh/sz 同新浪口径。
// 网络抓取在 newsFlash.ts;本文件对畸形输入一律返回 [],绝不抛错。
import { createHash } from 'crypto'

export interface NewsFlashStock {
  code: string
  name?: string
}

export interface NewsFlashItem {
  id: string
  /** ISO 8601 含 +08:00 时区(上游给的是上海本地时间字符串)。 */
  time: string
  title: string
  summary: string
  source: 'eastmoney' | 'sina' | 'cls'
  important: boolean
  /** 仅保留 A 股标的(6 位数字代码),供前端 chip 联动。 */
  stocks: NewsFlashStock[]
  url?: string
}

/** "2026-07-07 16:28:24"(上海本地)→ "2026-07-07T16:28:24+08:00";非法格式返回 null。 */
export function shanghaiToIso(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(s.trim())
  if (!m) return null
  return `${m[1]}T${m[2]}+08:00`
}

/** 东财 stockList 条目 "1.603132" → A股 6 位代码;非 A 股市场(90/150/BK…)丢弃。 */
function emStockCode(entry: unknown): string | null {
  if (typeof entry !== 'string') return null
  const m = /^([01])\.(\d{6})$/.exec(entry)
  return m ? m[2] : null
}

/** 新浪 ext.stocks 条目 {market:'cn',symbol:'sz300024'} → 6 位代码;非 cn 市场丢弃。 */
function sinaStockCode(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  if (e.market !== 'cn' || typeof e.symbol !== 'string') return null
  const m = /^(?:sz|sh)(\d{6})$/i.exec(e.symbol)
  return m ? m[1] : null
}

/** "【标题】正文" → { title, rest };无 【】 前缀时 title 为空串。 */
export function splitBracketTitle(text: string): { title: string; rest: string } {
  const m = /^【([^】]{1,80})】\s*/.exec(text)
  if (!m) return { title: '', rest: text }
  return { title: m[1].trim(), rest: text.slice(m[0].length).trim() }
}

export function normalizeEastmoney(raw: unknown): NewsFlashItem[] {
  const list = (raw as { data?: { fastNewsList?: unknown } } | null)?.data?.fastNewsList
  if (!Array.isArray(list)) return []
  const items: NewsFlashItem[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const time = shanghaiToIso(e.showTime)
    const title = typeof e.title === 'string' ? e.title.trim() : ''
    if (!time || !title) continue
    // summary 开头的 "【标题】" 与 title 重复,剥掉只留正文。
    let summary = typeof e.summary === 'string' ? e.summary.trim() : ''
    const split = splitBracketTitle(summary)
    if (split.title) summary = split.rest
    const stocks: NewsFlashStock[] = []
    if (Array.isArray(e.stockList)) {
      for (const s of e.stockList) {
        const code = emStockCode(s)
        if (code && !stocks.some((x) => x.code === code)) stocks.push({ code })
      }
    }
    items.push({
      // 无 code 的降级 fallback 带标题片段:同秒多条不至于撞出重复 React key
      id: typeof e.code === 'string' && e.code ? `em-${e.code}` : `em-${time}-${normalizeFlashTitle(title).slice(0, 12)}`,
      time,
      title,
      summary,
      source: 'eastmoney',
      important: typeof e.titleColor === 'number' && e.titleColor >= 2,
      stocks,
    })
  }
  return items
}

export function normalizeSina(raw: unknown): NewsFlashItem[] {
  const list = (raw as { result?: { data?: { feed?: { list?: unknown } } } } | null)?.result?.data?.feed?.list
  if (!Array.isArray(list)) return []
  const items: NewsFlashItem[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const time = shanghaiToIso(e.create_time)
    const richText = typeof e.rich_text === 'string' ? e.rich_text.trim() : ''
    if (!time || !richText) continue
    const { title, rest } = splitBracketTitle(richText)
    // ext 是 JSON 字符串;损坏就当没有(股票联动与原文链接是增强,不是硬依赖)。
    let ext: Record<string, unknown> | null = null
    if (typeof e.ext === 'string') {
      try {
        ext = JSON.parse(e.ext) as Record<string, unknown>
      } catch {
        ext = null
      }
    }
    const stocks: NewsFlashStock[] = []
    if (ext && Array.isArray(ext.stocks)) {
      for (const s of ext.stocks) {
        const code = sinaStockCode(s)
        if (code && !stocks.some((x) => x.code === code)) stocks.push({ code })
      }
    }
    const tags = Array.isArray(e.tag) ? e.tag : []
    const important = tags.some(
      (t) => typeof t === 'object' && t !== null && String((t as Record<string, unknown>).name ?? '').includes('焦点'),
    )
    const url =
      typeof e.docurl === 'string' && e.docurl
        ? e.docurl
        : ext && typeof ext.docurl === 'string'
          ? (ext.docurl as string)
          : undefined
    items.push({
      id:
        typeof e.id === 'number' || (typeof e.id === 'string' && e.id)
          ? `sina-${e.id}`
          : `sina-${time}-${normalizeFlashTitle(title || rest).slice(0, 12)}`,
      time,
      // 无【标题】前缀的短快讯:正文既当标题,summary 留空避免重复展示。
      title: title || rest,
      summary: title ? rest : '',
      source: 'sina',
      important,
      stocks,
      url,
    })
  }
  return items
}

/** 财联社 stock_list 条目 {StockID:'sh688183', name:'生益电子'} → {code, name};非 sh/sz 丢弃。 */
function clsStock(entry: unknown): NewsFlashStock | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  if (typeof e.StockID !== 'string') return null
  const m = /^(?:sz|sh)(\d{6})$/i.exec(e.StockID)
  if (!m) return null
  return typeof e.name === 'string' && e.name ? { code: m[1], name: e.name } : { code: m[1] }
}

/** unix 秒 → "YYYY-MM-DDTHH:mm:ss+08:00"(上海挂钟,与 shanghaiToIso 输出同构)。 */
function epochToShanghaiIso(sec: unknown): string | null {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return null
  return new Date((sec + 8 * 3600) * 1000).toISOString().slice(0, 19) + '+08:00'
}

/**
 * 财联社 v1 roll 签名 URL(纯本地计算,零 key):sign = md5(sha1(按 key 字典序拼接的
 * query 串))。算法来源 a-stock-data SKILL §5.2(2026-07 实测 errno=0)。
 */
export function buildClsUrl(pageSize = 50): string {
  const params: Record<string, string> = {
    appName: 'CailianpressWeb',
    os: 'web',
    sv: '7.7.5',
    last_time: '',
    refresh_type: '1',
    rn: String(pageSize),
  }
  const qs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  const sha = createHash('sha1').update(qs).digest('hex')
  const sign = createHash('md5').update(sha).digest('hex')
  return `https://www.cls.cn/v1/roll/get_roll_list?${qs}&sign=${sign}`
}

export function normalizeCls(raw: unknown): NewsFlashItem[] {
  const list = (raw as { data?: { roll_data?: unknown } } | null)?.data?.roll_data
  if (!Array.isArray(list)) return []
  const items: NewsFlashItem[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (e.is_ad === 1 || e.is_ad === true) continue
    const time = epochToShanghaiIso(e.ctime)
    const brief = typeof e.brief === 'string' ? e.brief.trim() : ''
    const content = typeof e.content === 'string' ? e.content.trim() : ''
    const rawTitle = typeof e.title === 'string' ? e.title.trim() : ''
    if (!time || (!brief && !content && !rawTitle)) continue
    // title 字段常为空,brief 通常自带 "【标题】正文"——优先从 brief 拆,退回 title 字段。
    const { title: bracket, rest } = splitBracketTitle(brief || content)
    const title = bracket || rawTitle || rest
    const summary = bracket || rawTitle ? rest : ''
    const stocks: NewsFlashStock[] = []
    if (Array.isArray(e.stock_list)) {
      for (const s of e.stock_list) {
        const st = clsStock(s)
        if (st && !stocks.some((x) => x.code === st.code)) stocks.push(st)
      }
    }
    items.push({
      id:
        typeof e.id === 'number' || (typeof e.id === 'string' && e.id)
          ? `cls-${e.id}`
          : `cls-${time}-${normalizeFlashTitle(title).slice(0, 12)}`,
      time,
      title,
      summary,
      source: 'cls',
      important: e.level === 'A' || e.level === 'B',
      stocks,
      url: typeof e.shareurl === 'string' && e.shareurl ? e.shareurl : undefined,
    })
  }
  return items
}

/** 标题归一化:去空白/标点取前 30 字(双源同一条新闻措辞几乎一致)。 */
export function normalizeFlashTitle(title: string): string {
  return title.replace(/[\s,。:;、!?"'()【】《》,.:;!?"'()]/g, '').slice(0, 30)
}

/** 双源发同一条新闻的典型时差 1~2.5 分钟;固定 5 分钟桶会在桶边界漏掉,改滑动窗。 */
const DEDUPE_WINDOW_MS = 300_000

/**
 * 多源合并:同标题且时间差 ≤5 分钟视为同一条,按传入顺序去重(先者优先——
 * 调用方把东财放第一保证要闻标记与 secid 口径优先),再按时间倒序,截前 `limit` 条。
 */
export function mergeFlashItems(lists: NewsFlashItem[][], limit = 80): NewsFlashItem[] {
  const seenTimes = new Map<string, number[]>()
  const merged: NewsFlashItem[] = []
  for (const list of lists) {
    for (const item of list) {
      const key = normalizeFlashTitle(item.title)
      const t = Date.parse(item.time)
      const times = seenTimes.get(key)
      if (times?.some((prev) => Math.abs(prev - t) <= DEDUPE_WINDOW_MS)) continue
      if (times) times.push(t)
      else seenTimes.set(key, [t])
      merged.push(item)
    }
  }
  merged.sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
  return merged.slice(0, limit)
}
