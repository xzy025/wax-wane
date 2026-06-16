// 题材对比数据：读注册表 → 一次批量取全部成分股实时行情 → 按题材回填 + 算 summary。
import { createCache, sessionTtl } from '../lib/cache'
import { fetchThemeQuotes, toSecids } from './emQuotes'
import { THEMES } from '../config/themes'

export interface ThemeRow {
  code: string
  name: string
  label: string
  price: number
  changePct: number
  pe: number | null
  pb: number | null
  marketCap: number
  chg60: number | null
  chgYtd: number | null
  found: boolean
}

export interface ThemeSummary {
  count: number // 取到行情的成分数
  avgChangePct: number // 今日平均涨跌%
  upCount: number
  downCount: number
  leader: { name: string; changePct: number } | null // 领涨
}

export interface ThemeBlock {
  id: string
  name: string
  nameEn: string
  blurb: string
  summary: ThemeSummary
  constituents: ThemeRow[]
}

const themesCache = createCache<ThemeBlock[]>({
  name: 'Themes',
  ttl: sessionTtl(60_000, 30 * 60_000),
  fetcher: fetchThemesFresh,
})

export function clearThemesCache() {
  themesCache.clear()
}

export function fetchThemes(): Promise<ThemeBlock[]> {
  return themesCache.get()
}

async function fetchThemesFresh(): Promise<ThemeBlock[]> {
  // De-dupe codes across themes; one batch quote call serves everything.
  const allCodes = Array.from(new Set(THEMES.flatMap((t) => t.constituents.map((c) => c.code))))
  const secids = allCodes.flatMap(toSecids)
  const quotes = await fetchThemeQuotes(secids)
  const byCode = new Map(quotes.map((q) => [q.code, q]))

  return THEMES.map((theme) => {
    const constituents: ThemeRow[] = theme.constituents.map((c) => {
      const q = byCode.get(c.code)
      return {
        code: c.code,
        name: q?.name || c.code,
        label: c.label,
        price: q?.price ?? 0,
        changePct: q?.changePct ?? 0,
        pe: q?.pe ?? null,
        pb: q?.pb ?? null,
        marketCap: q?.marketCap ?? 0,
        chg60: q?.chg60 ?? null,
        chgYtd: q?.chgYtd ?? null,
        found: !!q,
      }
    })

    const live = constituents.filter((r) => r.found)
    const avgChangePct = live.length
      ? live.reduce((s, r) => s + r.changePct, 0) / live.length
      : 0
    const leader = live.length
      ? live.reduce((a, b) => (b.changePct > a.changePct ? b : a))
      : null

    const summary: ThemeSummary = {
      count: live.length,
      avgChangePct,
      upCount: live.filter((r) => r.changePct > 0).length,
      downCount: live.filter((r) => r.changePct < 0).length,
      leader: leader ? { name: leader.name, changePct: leader.changePct } : null,
    }

    return {
      id: theme.id,
      name: theme.name,
      nameEn: theme.nameEn,
      blurb: theme.blurb,
      summary,
      constituents,
    }
  })
}
