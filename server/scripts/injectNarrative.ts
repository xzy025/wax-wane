/**
 * 每日复盘叙事注入 + 累积日志:把外部(Claude 会话内)撰写的叙事 markdown 写入
 * review-<date>.json 的 narrative 字段(dailyReview prior 复用机制保证对一切后续
 * 重算持久),并幂等 upsert docs/screener/daily-journal.md(最新在前,同日重跑整块替换)。
 *
 * 叙事经 UTF-8 文件传递(勿经 shell 引号传中文多行文本);数据摘要一律读当日五档
 * 磁盘真值生成,单档缺失该行降级为"(缺档)",不阻断。
 *
 * 运行(cwd=server):
 *   npx tsx scripts/injectNarrative.ts <YYYY-MM-DD> <叙事md路径> [--force] [--no-journal]
 *   --force      review 档已有非 null 叙事时才需要(覆盖重注,修订错稿的唯一途径)
 *   --no-journal 只注入存档,不写日志
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { extractTone } from '../services/dailyReviewPrompt'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENER_DIR = join(__dirname, '..', '..', 'docs', 'screener')
const JOURNAL_PATH = join(SCREENER_DIR, 'daily-journal.md')

const args = process.argv.slice(2)
const force = args.includes('--force')
const noJournal = args.includes('--no-journal')
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
const mdPath = args.find((a) => !a.startsWith('--') && a !== date)
if (!date || !mdPath) {
  console.error('用法: tsx scripts/injectNarrative.ts <YYYY-MM-DD> <叙事md路径> [--force] [--no-journal]')
  process.exit(1)
}

// ── 1. 读叙事 + 格式校验 ────────────────────────────────────────────────
if (!existsSync(mdPath)) {
  console.error(`[inject] 叙事文件不存在: ${mdPath}`)
  process.exit(1)
}
const markdown = readFileSync(mdPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
if (!markdown) {
  console.error('[inject] 叙事文件为空')
  process.exit(1)
}
for (const must of ['**一句话定调**', '### 今日主线', '### 明日关注']) {
  if (!markdown.includes(must)) {
    console.error(`[inject] 叙事缺少必需段落「${must}」(格式须与 REVIEW_SYSTEM_PROMPT 一致)`)
    process.exit(1)
  }
}
if (markdown.length > 350) console.warn(`[inject] ⚠ 叙事 ${markdown.length} 字 > 350 建议上限`)
for (const banned of ['买入', '看多', '满仓']) {
  if (markdown.includes(banned)) console.warn(`[inject] ⚠ 叙事含「${banned}」——复盘叙事不应做投资建议措辞`)
}
const tone = extractTone(markdown)
if (!tone) console.warn('[inject] ⚠ extractTone 未取到定调句,前端标题将回退为卡片默认标题')

// ── 2. 注入 review-<date>.json ─────────────────────────────────────────
const reviewPath = join(SCREENER_DIR, `review-${date}.json`)
if (!existsSync(reviewPath)) {
  console.error(`[inject] ${reviewPath} 不存在——先跑 backfillDay.ts ${date} 落盘复盘档`)
  process.exit(1)
}
const review = JSON.parse(readFileSync(reviewPath, 'utf8')) as Record<string, unknown> & {
  asof?: string
  narrative?: { tone: string; markdown: string; generatedAt: string } | null
}
if (review.asof !== date) {
  console.error(`[inject] review 档 asof=${review.asof} 与目标 ${date} 不符,拒绝注入`)
  process.exit(1)
}
if (review.narrative && !force) {
  console.error(`[inject] review-${date}.json 已有叙事(${review.narrative.generatedAt}),覆盖请加 --force`)
  process.exit(1)
}
review.narrative = { tone, markdown, generatedAt: new Date().toISOString() }
writeFileSync(reviewPath, JSON.stringify(review, null, 2))
console.log(`[inject] ✅ 已注入 review-${date}.json (tone: ${tone.slice(0, 30)}${tone.length > 30 ? '…' : ''})`)

// ── 3. 数据摘要(全部读磁盘真值,缺档降级) ───────────────────────────────
function loadJson(name: string): Record<string, any> | null {
  const p = join(SCREENER_DIR, name)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>
  } catch {
    return null
  }
}
const pct = (n: unknown) => (typeof n === 'number' ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '?')

const snap = loadJson(`${date}.json`)
const structure = loadJson(`structure-${date}.json`)
const tempo = loadJson(`tempo-${date}.json`)
const forward = loadJson(`forward-${date}.json`)

const digest: string[] = []
{
  const r = snap?.regime
  digest.push(
    r
      ? `- 市况:${r.phase}·温度${r.temperature}·大盘${pct(r.marketChgPct)}·${r.marketTrend}|universe ${snap?.universe ?? '?'}`
      : '- 市况:(缺档)',
  )
}
{
  const a = review.ashare as Record<string, any> | undefined
  if (a?.indices) {
    const idx = (a.indices as Array<Record<string, any>>).map((i) => `${i.name}${pct(i.changePct)}`).join(' ')
    const turn = typeof a.totalTurnover === 'number' ? `${(a.totalTurnover / 1e12).toFixed(2)}万亿` : '?'
    digest.push(`- 指数:${idx}|成交${turn}`)
    digest.push(`- 涨跌:涨停${a.limitUp}/跌停${a.limitDown}|上涨${a.advance}/下跌${a.decline}${snap?.regime?.breakRate != null ? `|破板率${snap.regime.breakRate}%` : ''}`)
  } else digest.push('- 指数/涨跌:(缺档)')
}
{
  const s = review.structure as Record<string, any> | undefined
  digest.push(
    s
      ? `- 结构:强势延续${s.hsCount}/底部反转${s.lsCount}/高位回调${s.hwCount}/持续走弱${s.lwCount}|5日上涨板块占比${s.shortUpPct}%|领涨:${(s.topHs as Array<Record<string, any>> | undefined)?.slice(0, 3).map((b) => b.name).join('、') ?? '?'}`
      : '- 结构:(缺档)',
  )
}
{
  if (snap) {
    const GROUPS: Array<[string, string]> = [
      ['breakout', '突破'], ['trigger', '扳机'], ['watch', '临界'], ['pullback', '回调'],
      ['highdiv', '新高分歧'], ['volbreak', '放量新高'], ['fundres', '资金共振'], ['bhold', '突破整理'],
      ['trendnew', '趋势新高'], ['trendwatch', '趋势中军'], ['accum', '放量吸筹'],
    ]
    const counts = GROUPS.map(([k, label]) => `${label}${Array.isArray(snap[k]) ? snap[k].length : 0}`).join('·')
    const tops = GROUPS.filter(([k]) => Array.isArray(snap[k]) && snap[k].length > 0)
      .map(([k, label]) => {
        const t = snap[k][0]
        return `${label}=${t.name ?? '?'}${t.score != null ? `(${t.score})` : ''}`
      })
      .slice(0, 6)
      .join(' ')
    digest.push(`- 战法命中:${counts}`)
    if (tops) digest.push(`- 各组头名:${tops}`)
  } else digest.push('- 战法命中:(缺档)')
}
{
  const o = forward?.overall
  digest.push(
    o
      ? `- 实盘战绩:n=${o.n}·胜率${o.winRate}%·期望${o.expectancyR}R·止损率${o.stopRate}%(${forward?.hold ?? '?'}日持有)`
      : '- 实盘战绩:(缺档)',
  )
}
{
  const checks = [
    ['选股', snap, snap?.asof === date],
    ['结构', structure, (structure?.asof ?? structure?.date) === date],
    ['节奏', tempo, tempo?.asof === date],
    ['复盘', review, true],
    ['战绩', forward, forward?.asof === date],
  ] as Array<[string, unknown, boolean]>
  const ok = checks.filter(([, f, a]) => f && a).length
  const detail = checks.map(([n, f, a]) => `${n}${f ? (a ? '✅' : '⚠asof') : '❌'}`).join(' ')
  const recon = structure?.reconstructed ? `|structure 重构档(${structure.boardSource})` : ''
  const uniWarn = snap && typeof snap.universe === 'number' && snap.universe < 3000 ? '|⚠universe 降级档' : ''
  digest.push(`- 落盘核验:${ok}/5 ${detail}${recon}${uniWarn}`)
}

// ── 4. 幂等 upsert daily-journal.md(最新在前) ──────────────────────────
if (!noJournal) {
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
  const dow = WEEKDAYS[new Date(`${date}T12:00:00+08:00`).getUTCDay()]
  const entry = `## ${date}(周${dow})\n\n${markdown}\n\n### 数据摘要\n${digest.join('\n')}\n`
  const HEADER = `# A股每日复盘日志\n\n> 由 /daily-review 流程逐日写入,最新在前。叙事与 docs/screener/review-<date>.json 的\n> narrative 字段一致;数据摘要由 injectNarrative.ts 从当日档案自动生成。\n> 本目录为生成物(gitignored),勿当作唯一留存。\n`
  let journal = existsSync(JOURNAL_PATH) ? readFileSync(JOURNAL_PATH, 'utf8') : HEADER
  const blockRe = new RegExp(`^## ${date}\\([^)]*\\)$[\\s\\S]*?(?=^## \\d{4}-\\d{2}-\\d{2}|(?![\\s\\S]))`, 'm')
  let action: string
  if (blockRe.test(journal)) {
    journal = journal.replace(blockRe, entry + '\n')
    action = '替换同日条目'
  } else {
    const firstEntry = journal.search(/^## \d{4}-\d{2}-\d{2}/m)
    journal = firstEntry === -1
      ? journal.trimEnd() + '\n\n' + entry
      : journal.slice(0, firstEntry) + entry + '\n' + journal.slice(firstEntry)
    action = '新增条目(置顶)'
  }
  writeFileSync(JOURNAL_PATH, journal.replace(/\n{3,}/g, '\n\n'))
  console.log(`[inject] ✅ daily-journal.md ${action}`)
}

console.log(`[inject] 完成。终验:dev server 在跑时 POST /api/refresh?market=daily-review 后 GET /api/screener/daily-review 应见 narrative 非 null`)
