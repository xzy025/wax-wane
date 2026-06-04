// Web search proxy using DuckDuckGo Lite (no API key needed)

const SEARCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

export interface SearchResult {
  title: string
  snippet: string
  url: string
}

export async function searchWeb(
  query: string,
  count: number = 5,
): Promise<{ results: SearchResult[]; query: string }> {
  try {
    // Use DuckDuckGo Lite HTML
    const encodedQuery = encodeURIComponent(query)
    const url = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(url, {
      headers: SEARCH_HEADERS,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      return { results: [], query }
    }

    const html = await res.text()

    // Parse DuckDuckGo Lite HTML results
    const results: SearchResult[] = []

    // DDG Lite uses simple HTML with <a class="result-link"> and <td class="result-snippet">
    const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi
    const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi

    const links: Array<{ url: string; title: string }> = []
    let match

    // Extract links
    while ((match = linkRegex.exec(html)) !== null) {
      links.push({ url: match[1], title: match[2].trim() })
    }

    // Extract snippets
    const snippets: string[] = []
    while ((match = snippetRegex.exec(html)) !== null) {
      // Strip HTML tags
      const snippet = match[1].replace(/<[^>]+>/g, '').trim()
      if (snippet) snippets.push(snippet)
    }

    // Combine links and snippets
    for (let i = 0; i < Math.min(links.length, count); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || '',
      })
    }

    // If DDG Lite parsing failed, try the HTML lite alternative format
    if (results.length === 0) {
      // Alternative: parse from <a> tags with class="resulta"
      const altRegex = /<a[^>]+class="resulta"[^>]*>([\s\S]*?)<\/a>/gi
      while ((match = altRegex.exec(html)) !== null && results.length < count) {
        const content = match[1]
        const titleMatch = content.match(/<span[^>]*>([^<]+)<\/span>/)
        const snippetMatch = content.match(/<td[^>]*>([^<]+)<\/td>/)
        if (titleMatch) {
          results.push({
            title: titleMatch[1].trim(),
            url: '',
            snippet: snippetMatch ? snippetMatch[1].trim() : '',
          })
        }
      }
    }

    return { results, query }
  } catch (err) {
    console.error('[WebSearch] Error:', err instanceof Error ? err.message : err)
    return { results: [], query }
  }
}

// EastMoney stock news search (more reliable for A-share news)
const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://so.eastmoney.com/',
}

export interface StockNews {
  title: string
  url: string
  time: string
  source: string
  snippet: string
}

export async function searchStockNews(
  stockCode: string,
  count: number = 10,
): Promise<{ news: StockNews[]; code: string }> {
  try {
    // EastMoney search API for stock news
    const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=&type=8001&pageindex=1&pagesize=${count}&keyword=${stockCode}&name=zixun`
    const res = await fetch(url, { headers: EM_HEADERS })
    if (!res.ok) return { news: [], code: stockCode }

    const text = await res.text()
    // Remove JSONP callback wrapper if present
    const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '')
    const json = JSON.parse(jsonStr)

    const items = json?.Data ?? json?.data ?? []
    const news: StockNews[] = []

    for (const item of items) {
      if (news.length >= count) break
      news.push({
        title: item.Title || item.title || '',
        url: item.Url || item.url || '',
        time: item.Date || item.date || item.ShowTime || '',
        source: item.MediaName || item.source || '东方财富',
        snippet: item.Content || item.content || item.Digest || '',
      })
    }

    return { news, code: stockCode }
  } catch (err) {
    console.error('[StockNews] Error:', err instanceof Error ? err.message : err)
    return { news: [], code: stockCode }
  }
}
