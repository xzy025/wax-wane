// RSS feed fetching for WeChat public account news aggregation

export interface NewsItem {
  title: string
  summary: string
  link: string
  pubDate: string
  source: string
}

export interface NewsSource {
  name: string
  url: string
  strategy: 'date_match' | 'latest_n'
  count?: number // for latest_n strategy
}

const CACHE_TTL = 300_000 // 5 minutes
let cachedNews: NewsItem[] | null = null
let cacheTimestamp = 0

function getConfiguredSources(): NewsSource[] {
  const sources: NewsSource[] = []

  // 复盘资料 - match by today's date
  const fupanUrl = process.env.NEWS_FUPAN_URL
  if (fupanUrl) {
    sources.push({
      name: '复盘资料',
      url: fupanUrl,
      strategy: 'date_match',
    })
  }

  // 财联社 - latest 3 articles
  const clsUrl = process.env.NEWS_CLS_URL
  if (clsUrl) {
    sources.push({
      name: '财联社',
      url: clsUrl,
      strategy: 'latest_n',
      count: 3,
    })
  }

  // Fallback: legacy NEWS_RSS_URLS
  if (sources.length === 0) {
    const urls = process.env.NEWS_RSS_URLS
    if (urls) {
      for (const url of urls.split(',').map((u) => u.trim()).filter(Boolean)) {
        sources.push({
          name: new URL(url).hostname,
          url,
          strategy: 'latest_n',
          count: 5,
        })
      }
    }
  }

  return sources
}

function extractText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = xml.match(regex)
  if (!match) return ''
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function parseRSS(xml: string, sourceName: string): NewsItem[] {
  const items: NewsItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let match

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    items.push({
      title: extractText(block, 'title'),
      summary: extractText(block, 'description').slice(0, 300),
      link: extractText(block, 'link'),
      pubDate: extractText(block, 'pubDate'),
      source: sourceName,
    })
  }

  return items
}

function getTodayDatePatterns(): RegExp[] {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()

  // Match patterns like: 5月28日, 05月28日, 5.28, 05.28, 528
  return [
    new RegExp(`${month}月${day}日`),
    new RegExp(`${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`),
    new RegExp(`${month}\\.${day}`),
    new RegExp(`${String(month).padStart(2, '0')}\\.${String(day).padStart(2, '0')}`),
  ]
}

async function fetchRSS(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`)
  return res.text()
}

async function fetchArticleContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.44',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return ''
    const html = await res.text()

    // Extract article content from WeChat page
    const contentMatch = html.match(/id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<script/)
    if (!contentMatch) return ''

    // Strip HTML tags and get text
    return contentMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000) // Limit to 2000 chars
  } catch {
    return ''
  }
}

export async function fetchNewsFeed(): Promise<NewsItem[]> {
  const now = Date.now()
  if (cachedNews && now - cacheTimestamp < CACHE_TTL) {
    return cachedNews
  }

  const sources = getConfiguredSources()
  if (sources.length === 0) {
    return [{ title: '未配置 RSS 源', summary: '请在 server/.env 中配置 NEWS_FUPAN_URL 和 NEWS_CLS_URL', link: '', pubDate: '', source: 'system' }]
  }

  const allItems: NewsItem[] = []
  const datePatterns = getTodayDatePatterns()

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const xml = await fetchRSS(source.url)
      const items = parseRSS(xml, source.name)

      if (source.strategy === 'date_match') {
        // Find article matching today's date
        const todayItem = items.find((item) =>
          datePatterns.some((pattern) => pattern.test(item.title))
        )
        return todayItem ? [todayItem] : []
      } else {
        // Get latest N articles
        const count = source.count ?? 5
        return items.slice(0, count)
      }
    }),
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value)
    }
  }

  // Fetch full content for 财联社 articles
  const clsItems = allItems.filter((item) => item.source === '财联社')
  if (clsItems.length > 0) {
    const contentResults = await Promise.allSettled(
      clsItems.map(async (item) => {
        const content = await fetchArticleContent(item.link)
        if (content) {
          item.summary = content.slice(0, 500)
        }
        return item
      }),
    )
    // Items are modified in place
  }

  cachedNews = allItems
  cacheTimestamp = now
  return cachedNews
}
