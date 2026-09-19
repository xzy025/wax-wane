#!/usr/bin/env node
/**
 * 生成 MCP 候选集落盘文件 docs/screener/mcp-universe-<asof>.json。
 *
 * 数据不由本脚本抓取 —— MCP 工具只在 WorkBuddy 会话内可用，Express 运行时调不到。
 * 因此流程是：会话里调 MCP(腾讯自选股 tool_strategy / tool_ranking / 通达信 tdx_screener)
 * 拿到当日候选 → 写成 input JSON → 本脚本规范化并落盘 → 前端「MCP候选」tab 读取。
 *
 * 用法：
 *   node scripts/gen-mcp-universe.mjs --input tmp/mcp-input.json [--asof 2026-09-15] [--force]
 *
 * input JSON 结构（rows 用 [code, name] 或 {code, name}，code 可带 sh/sz/bj 前缀）：
 * {
 *   "asof": "2026-09-15",
 *   "strategies": {
 *     "newhigh_year": { "label": "今日创一年新高", "mcpStrategy": "today_newhigh_in_year",
 *                       "totalStocks": 19, "rows": [["sh605177", "东亚药业"], ...] }
 *   }
 * }
 *
 * totalStocks 必须是 MCP 报告的全市场命中总数（不是 rows 长度）—— 它决定
 * truncated 标记，前端据此提示"非全量"。弄不清就填 rows.length，宁可保守。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'docs', 'screener')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const force = process.argv.includes('--force')

const inputPath = arg('input')
if (!inputPath) {
  console.error('用法: node scripts/gen-mcp-universe.mjs --input <file> [--asof YYYY-MM-DD] [--force]')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(inputPath, 'utf8'))
const asof = arg('asof') ?? raw.asof
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asof ?? ''))) {
  console.error('缺少合法 asof（input.asof 或 --asof YYYY-MM-DD）')
  process.exit(1)
}

const stripPrefix = (code) => String(code).replace(/^(sh|sz|bj)/i, '')

const strategies = {}
const union = new Map()
let skipped = 0

for (const [key, def] of Object.entries(raw.strategies ?? {})) {
  const rows = (def.rows ?? def.codes ?? []).map((r) => {
    const code = Array.isArray(r) ? r[0] : r.code
    const name = Array.isArray(r) ? r[1] : r.name
    return { code: stripPrefix(code), name: name ?? '' }
  })
  if (rows.length === 0) {
    console.warn(`  ! ${key}: 无候选，跳过（数据源可能异常，不要静默写空组）`)
    skipped += 1
    continue
  }
  const total = Number.isFinite(def.totalStocks) ? Number(def.totalStocks) : rows.length
  strategies[key] = {
    label: def.label ?? key,
    mcpStrategy: def.mcpStrategy ?? '',
    totalStocks: total,
    collected: rows.length,
    truncated: rows.length < total,
    codes: rows,
  }
  for (const r of rows) if (!union.has(r.code)) union.set(r.code, { code: r.code, name: r.name })
}

if (Object.keys(strategies).length === 0) {
  console.error('没有任何策略产出候选，拒绝落盘（空文件会让前端误判"今日无候选"）')
  process.exit(1)
}

const out = {
  schemaVersion: 'mcp-universe-v1',
  provider: raw.provider ?? 'westock-mcp(腾讯自选股) + tdx-connector(通达信)',
  asof,
  generatedAt: new Date().toISOString(),
  purpose: 'research',
  statusNote: '影子运行：仅供与现有 clist 候选集做覆盖率 diff，不进战法评分、不改信号状态。',
  coverageNote: 'collected < totalStocks 的策略被 limit 截断，可按需翻 offset 补齐。',
  strategies,
  unionSize: union.size,
  union: [...union.values()],
}

mkdirSync(OUT_DIR, { recursive: true })
const outPath = join(OUT_DIR, `mcp-universe-${asof}.json`)
if (existsSync(outPath) && !force) {
  console.error(`${outPath} 已存在。确认要覆盖请加 --force。`)
  process.exit(1)
}

writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8')
console.log(`✅ 已写入 ${outPath}`)
console.log(`   asof=${asof} · 策略 ${Object.keys(strategies).length} 组 · 去重候选 ${union.size} 只${skipped ? ` · 跳过空组 ${skipped}` : ''}`)
for (const [k, v] of Object.entries(strategies)) {
  console.log(
    `   ${k.padEnd(18)} ${String(v.collected).padStart(3)}/${v.totalStocks}${v.truncated ? ' (截断)' : ''}`,
  )
}
