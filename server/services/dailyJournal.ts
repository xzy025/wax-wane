import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = join(__dirname, '..', '..', 'docs', 'screener')

type Json = Record<string, any>

export interface DailyJournalResult {
  written: boolean
  action: 'created' | 'replaced' | 'skipped'
  reason?: string
  path: string
}

function readJson(root: string, name: string): Json | null {
  try {
    return JSON.parse(readFileSync(join(root, name), 'utf8')) as Json
  } catch {
    return null
  }
}

function pct(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
    : '?'
}

function buildDigest(date: string, root: string, review: Json): string[] {
  const snap = readJson(root, `${date}.json`)
  const structure = readJson(root, `structure-${date}.json`)
  const tempo = readJson(root, `tempo-${date}.json`)
  const forward = readJson(root, `forward-${date}.json`)
  const digest: string[] = []
  const regime = snap?.regime
  digest.push(
    regime
      ? `- 市况:${regime.phase}·温度${regime.temperature}·大盘${pct(regime.marketChgPct)}·${regime.marketTrend}|universe ${snap?.universe ?? '?'}`
      : '- 市况:(缺档)',
  )

  const ashare = review.ashare as Json | undefined
  if (ashare?.indices) {
    const indices = (ashare.indices as Json[]).map((index) => `${index.name}${pct(index.changePct)}`).join(' ')
    const turnover = typeof ashare.totalTurnover === 'number'
      ? `${(ashare.totalTurnover / 1e12).toFixed(2)}万亿`
      : '?'
    digest.push(`- 指数:${indices}|成交${turnover}`)
    digest.push(
      `- 涨跌:涨停${ashare.limitUp}/跌停${ashare.limitDown}|上涨${ashare.advance}/下跌${ashare.decline}${snap?.regime?.breakRate != null ? `|破板率${snap.regime.breakRate}%` : ''}`,
    )
  } else {
    digest.push('- 指数/涨跌:(缺档)')
  }

  const structureData = review.structure as Json | undefined
  digest.push(
    structureData
      ? `- 结构:强势延续${structureData.hsCount}/底部反转${structureData.lsCount}/高位回调${structureData.hwCount}/持续走弱${structureData.lwCount}|5日上涨板块占比${structureData.shortUpPct}%|领涨:${(structureData.topHs as Json[] | undefined)?.slice(0, 3).map((board) => board.name).join('、') ?? '?'}`
      : '- 结构:(缺档)',
  )

  if (snap) {
    const groups: Array<[string, string]> = [
      ['breakout', '突破'], ['trigger', '扳机'], ['watch', '临界'], ['pullback', '回调'],
      ['highdiv', '新高分歧'], ['volbreak', '放量新高'], ['bigbreak', '大形态突破'], ['fundres', '资金共振'], ['bhold', '突破整理'],
      ['trendnew', '趋势新高'], ['trendwatch', '趋势中军'], ['accum', '放量吸筹'],
    ]
    const counts = groups.map(([key, label]) => `${label}${Array.isArray(snap[key]) ? snap[key].length : 0}`).join('·')
    const tops = groups
      .filter(([key]) => Array.isArray(snap[key]) && snap[key].length > 0)
      .map(([key, label]) => {
        const top = snap[key][0]
        return `${label}=${top.name ?? '?'}${top.score != null ? `(${top.score})` : ''}`
      })
      .slice(0, 6)
      .join(' ')
    digest.push(`- 战法命中:${counts}`)
    if (tops) digest.push(`- 各组头名:${tops}`)
  } else {
    digest.push('- 战法命中:(缺档)')
  }

  const overall = forward?.overall
  digest.push(
    overall
      ? `- 实盘战绩:n=${overall.n}·胜率${overall.winRate}%·期望${overall.expectancyR}R·止损率${overall.stopRate}%(${forward?.hold ?? '?'}日持有)`
      : '- 实盘战绩:(缺档)',
  )

  const checks: Array<[string, Json | null, boolean]> = [
    ['选股', snap, snap?.asof === date],
    ['结构', structure, (structure?.asof ?? structure?.date) === date],
    ['节奏', tempo, tempo?.asof === date],
    ['复盘', review, true],
    ['战绩', forward, forward?.asof === date],
  ]
  const ok = checks.filter(([, file, asof]) => file && asof).length
  const detail = checks.map(([name, file, asof]) => `${name}${file ? (asof ? '✅' : '⚠asof') : '❌'}`).join(' ')
  const reconstructed = structure?.reconstructed ? `|structure 重构档(${structure.boardSource})` : ''
  const universeWarning = snap && typeof snap.universe === 'number' && snap.universe < 3000
    ? '|⚠universe 降级档'
    : ''
  digest.push(`- 落盘核验:${ok}/5 ${detail}${reconstructed}${universeWarning}`)
  return digest
}

/**
 * 从已经落盘的当日 review 叙事生成/替换日报条目。
 * 没有叙事时明确跳过，不生成占位观点，避免把数据缺失伪装成复盘结论。
 */
export function syncDailyJournal(date: string, root = DEFAULT_ROOT): DailyJournalResult {
  const path = join(root, 'daily-journal.md')
  const review = readJson(root, `review-${date}.json`)
  const narrative = review?.narrative
  if (
    !review ||
    review.asof !== date ||
    !narrative ||
    typeof narrative.markdown !== 'string' ||
    !narrative.markdown.trim()
  ) {
    return { written: false, action: 'skipped', reason: 'narrative-unavailable', path }
  }

  const weekday = ['日', '一', '二', '三', '四', '五', '六'][
    new Date(`${date}T12:00:00+08:00`).getUTCDay()
  ]
  const entry = `## ${date}(周${weekday})\n\n${narrative.markdown.trim()}\n\n### 数据摘要\n${buildDigest(date, root, review).join('\n')}\n`
  const header = `# A股每日复盘日志\n\n> 由 /daily-review 流程逐日写入,最新在前。叙事与 docs/screener/review-<date>.json 的\n> narrative 字段一致;数据摘要由 dailyJournal.ts 从当日档案自动生成。\n> 本目录为生成物(gitignored),勿当作唯一留存。\n`
  let journal = existsSync(path) ? readFileSync(path, 'utf8') : header
  const blockRe = new RegExp(`^## ${date}\\([^)]*\\)$[\\s\\S]*?(?=^## \\d{4}-\\d{2}-\\d{2}|(?![\\s\\S]))`, 'm')
  const replacing = blockRe.test(journal)
  if (replacing) {
    journal = journal.replace(blockRe, entry + '\n')
  } else {
    const firstEntry = journal.search(/^## \d{4}-\d{2}-\d{2}/m)
    journal = firstEntry === -1
      ? journal.trimEnd() + '\n\n' + entry
      : journal.slice(0, firstEntry) + entry + '\n' + journal.slice(firstEntry)
  }

  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, journal.replace(/\n{3,}/g, '\n\n'), 'utf8')
  renameSync(temp, path)
  return { written: true, action: replacing ? 'replaced' : 'created', path }
}
