import type { ToolModule } from '../types'

export const analyzeLimitLadder: ToolModule = {
  schema: {
    name: 'analyzeLimitLadder',
    description:
      'Analyze the settled A-share limit-up ladder for a trading date. Returns the market cycle, theme tiers, board-height ladder, and explainable next-day states for every limit-up stock.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Trading date in YYYY-MM-DD format. Omit for the current trading day.',
        },
        theme: {
          type: 'string',
          description: 'Optional theme name filter.',
        },
        state: {
          type: 'string',
          enum: ['candidate', 'waiting', 'observe', 'exclude'],
          description: 'Optional analysis-state filter.',
        },
      },
      required: [],
    },
  },

  async execute(args) {
    const date = typeof args.date === 'string' ? args.date : ''
    const query = date ? `?date=${encodeURIComponent(date)}` : ''
    const res = await fetch(`/api/ladder/analysis${query}`)
    const json = await res.json()
    if (!res.ok) return { error: json?.error ?? `HTTP ${res.status}` }

    const theme = typeof args.theme === 'string' ? args.theme.trim() : ''
    const state = typeof args.state === 'string' ? args.state : ''
    const stocks = (json.stocks ?? []).filter((stock: { themes?: string[]; state?: string }) => {
      if (theme && !(stock.themes ?? []).some((name) => name.includes(theme))) return false
      if (state && stock.state !== state) return false
      return true
    })
    return {
      asof: json.asof,
      ruleVersion: json.ruleVersion,
      market: json.market,
      themes: json.themes,
      quality: json.quality,
      stocks,
    }
  },
}
