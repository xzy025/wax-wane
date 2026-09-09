import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stageSettlement } from '../services/isolatedSettlement'

const [manifest, output] = process.argv.slice(2)
if (!manifest || !output) throw new Error('Usage: stageSettlement.ts <input-manifest.json> <new-output-directory>')
console.log(JSON.stringify(stageSettlement(JSON.parse(readFileSync(resolve(manifest), 'utf8')), resolve(output)), null, 2))
