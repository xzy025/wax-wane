// 消息面 · 7x24 实时快讯(消息面 tab 的快讯子面板)。
//
// 三源互备:东财 getFastNewsList(主源,stockList 即项目 secid 口径)+ 财联社 v1 roll
// (A股定位、时效强,带股票名;本地签名零 key,见 buildClsUrl)+ 新浪 zhibo feed
// (实时性最强)。三源 allSettled 各自归一化后合并去重(东财>财联社>新浪优先),
// 部分失联降级为存活源;三源全挂 throw 交给 createCache serve-stale。
// 三源在三个不同域名/风控面(东财 np-weblist / cls.cn / 新浪 zhibo),单点被封不断供。
// 快讯 7x24 全天滚动,盘后不能像行情那样给 12h 长 TTL——盘中 30s / 盘后 5min。
// 国内源直连,不走代理;东财/新浪零 header(2026-07-07 实测),财联社需 UA+Referer。
import { createCache, sessionTtl } from '../lib/cache'
import {
  buildClsUrl,
  mergeFlashItems,
  normalizeCls,
  normalizeEastmoney,
  normalizeSina,
  type NewsFlashItem,
} from './newsFlashNormalize'

export type { NewsFlashItem, NewsFlashStock } from './newsFlashNormalize'

const EM_URL =
  'https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=50&req_trace=1'
const SINA_URL = 'https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=50&zhibo_id=152&tag_id=0'
const CLS_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.cls.cn/',
}
const FETCH_TIMEOUT_MS = 10_000

export interface NewsFlashData {
  /** 本次聚合时间(ISO)。 */
  asof: string
  /** 时间倒序,≤80 条。 */
  items: NewsFlashItem[]
  /** 本轮各源是否成功(单源失联的降级可见性)。 */
  sources: { eastmoney: boolean; sina: boolean; cls: boolean }
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function computeNewsFlash(): Promise<NewsFlashData> {
  const [em, cls, sina] = await Promise.allSettled([
    fetchJson(EM_URL),
    fetchJson(buildClsUrl(), CLS_HEADERS),
    fetchJson(SINA_URL),
  ])
  const emItems = em.status === 'fulfilled' ? normalizeEastmoney(em.value) : []
  const clsItems = cls.status === 'fulfilled' ? normalizeCls(cls.value) : []
  const sinaItems = sina.status === 'fulfilled' ? normalizeSina(sina.value) : []
  // "请求 200 但结构变了解析出 0 条"同样按失联算,别让接口改版伪装成"今天没新闻"。
  const sources = { eastmoney: emItems.length > 0, sina: sinaItems.length > 0, cls: clsItems.length > 0 }
  if (!sources.eastmoney && !sources.sina && !sources.cls) {
    throw new Error('[NewsFlash] 东财+财联社+新浪三源全部失败,保留既有缓存')
  }
  return {
    asof: new Date().toISOString(),
    // 东财第一(要闻标记+secid 口径),财联社第二(带股票名),新浪殿后
    items: mergeFlashItems([emItems, clsItems, sinaItems]),
    sources,
  }
}

const flashCache = createCache<NewsFlashData>({
  name: 'NewsFlash',
  ttl: sessionTtl(30_000, 300_000),
  fetcher: computeNewsFlash,
})

export function fetchNewsFlash(): Promise<NewsFlashData> {
  return flashCache.get()
}

/**
 * 手动刷新用 expire 而非 clear:强制下一次 GET 重取,但保留旧值。
 * 双源全挂时用户最可能点刷新——clear 会把 serve-stale 依赖的唯一好副本
 * 也删掉,之后所有请求(包括其他会话)都变 500,直到上游恢复。
 */
export function clearNewsFlashCache(): void {
  flashCache.expire()
}
