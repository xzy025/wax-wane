import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDailyOutputs } from '../services/dailyOutputValidation'

const target = process.argv.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg))
const requireHuishou = process.argv.includes('--require-huishou')
const requireAuxiliary = process.argv.includes('--require-auxiliary')
if (!target) throw new Error('Usage: npx tsx server/scripts/validateDailyOutputs.ts YYYY-MM-DD [--require-huishou]')

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const report = validateDailyOutputs(repoRoot, target, { requireHuishou, requireAuxiliary })
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
