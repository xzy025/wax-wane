import { config as dotenv } from 'dotenv'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDate } from '../market-data/hithinkFinanceClient'
import { validateLadderThs, type LadderValidationEvidence } from '../services/ladderThsValidation'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
dotenv({ path: resolve(root, 'server/.env') })
async function main() {
  const tradeDate = process.argv[2] ?? '2026-09-09'
  validateDate(tradeDate, 'tradeDate')
  const limit = process.argv[3] === undefined ? undefined : Number(process.argv[3])
  const dir = resolve(root, 'docs/ladder', ...tradeDate.split('-'))
  const files = (await readdir(dir)).flatMap((name) => {
    const match = /^evidence-limit-ladder-v(\d+)(?:-r(\d+))?\.json$/.exec(name)
    return match ? [{ name, version: Number(match[1]), revision: Number(match[2] ?? 1) }] : []
  }).sort((a, b) => b.version - a.version || b.revision - a.revision)
  if (!files.length) throw new Error('No frozen ladder evidence')
  const evidencePath = resolve(dir, files[0].name)
  const bytes = await readFile(evidencePath)
  const evidence = JSON.parse(bytes.toString('utf8')) as LadderValidationEvidence
  const report = { evidencePath, evidenceSha256: createHash('sha256').update(bytes).digest('hex'),
    ...await validateLadderThs({ evidence, tradeDate, limit }) }
  const output = resolve(root, 'docs/ladder/provider-validation', `${tradeDate}-ths-${report.generatedAt.replace(/[:.]/g, '-')}`)
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  const markdown = [`# 同花顺连板日 K 并行校验 ${tradeDate}`, '', `状态：research-only；providerAt=null；不能据此放行正式候选。`, '',
    `冻结证据：${evidencePath}`, `证据 SHA256：${report.evidenceSha256}`, `窗口：${report.startDate}—${tradeDate}；股票 ${report.requestedStocks}/${report.totalEvidenceStocks}；请求 ${report.summary.requests}。`,
    `OHLCV 一致 ${report.summary.ohlcvAgrees}；不一致 ${report.summary.mismatches}；无效响应 ${report.summary.invalid}；不可用 ${report.summary.unavailable}。`, '',
    `契约：[历史行情字段](${report.contract})`, '', ...report.notes.map((note) => `- ${note}`), '', '| 股票 | 复权 | 状态 |', '|---|---|---|',
    ...report.rows.map((row) => `| ${row.code} | ${row.adjustment} | ${row.status} |`), ''].join('\n')
  await writeFile(resolve(output, 'report.md'), markdown, { flag: 'wx' })
  console.log(JSON.stringify({ output, ...report.summary, requestedStocks: report.requestedStocks, providerAt: null }))
}
main().catch(() => { console.error('THS ladder validation failed; inspect input/configuration. Upstream bodies and credentials omitted.'); process.exitCode = 1 })
