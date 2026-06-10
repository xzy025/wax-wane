#!/usr/bin/env node
// Vendor the claude-for-cn-finance methodology SKILL.md files into this repo as
// *data* (server/knowledge/cn-finance/). The upstream project is a Claude Code
// plugin set (prompts + MCP connectors), not a library — so we copy its
// methodology prompts and let the analysis endpoint use them as system context.
//
// Decoupling guarantee: upstream updates → re-run this script → `git diff` the
// knowledge files → commit. Zero application-code changes required.
//
// Usage:
//   node scripts/sync-cn-finance.mjs [sourceRepoPath]
//   CN_FINANCE_SRC=/path/to/repo node scripts/sync-cn-finance.mjs

import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..')
const DEST_DIR = join(PROJECT_ROOT, 'server', 'knowledge', 'cn-finance')

const DEFAULT_SRC = 'D:/AI/claude-for-cn-finance'
const SRC = resolve(process.argv[2] || process.env.CN_FINANCE_SRC || DEFAULT_SRC)

// Upstream skill files → local flattened names.
const FILES = [
  {
    from: 'plugins/vertical-plugins/a-share-research/skills/company-profile/SKILL.md',
    to: 'company-profile.md',
  },
  {
    from: 'plugins/vertical-plugins/financial-analysis/skills/financial-statements/SKILL.md',
    to: 'financial-statements.md',
  },
  {
    from: 'plugins/vertical-plugins/financial-analysis/skills/valuation-models/SKILL.md',
    to: 'valuation-models.md',
  },
]

function fail(msg) {
  console.error(`[sync-cn-finance] ERROR: ${msg}`)
  process.exit(1)
}

if (!existsSync(SRC)) {
  fail(`source repo not found: ${SRC}\n  Pass a path arg or set CN_FINANCE_SRC.`)
}

mkdirSync(DEST_DIR, { recursive: true })

let copied = 0
for (const f of FILES) {
  const srcPath = join(SRC, f.from)
  if (!existsSync(srcPath)) {
    fail(`expected skill file missing in source repo: ${srcPath}`)
  }
  copyFileSync(srcPath, join(DEST_DIR, f.to))
  console.log(`[sync-cn-finance] ${f.to} <- ${f.from}`)
  copied++
}

// Record provenance so we can tell exactly which upstream commit produced these.
let srcCommit = 'unknown'
try {
  srcCommit = execSync('git rev-parse HEAD', { cwd: SRC }).toString().trim()
} catch {
  console.warn('[sync-cn-finance] WARN: could not read source git HEAD (not a git repo?)')
}

const lockPath = join(SRC, 'skills-lock.json')
let skillsLock = null
if (existsSync(lockPath)) {
  try {
    skillsLock = JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch {
    console.warn('[sync-cn-finance] WARN: skills-lock.json present but not valid JSON')
  }
}

const manifest = {
  source: SRC.replace(/\\/g, '/'),
  sourceCommit: srcCommit,
  syncedAt: new Date().toISOString(),
  files: FILES.map((f) => ({ upstream: f.from, local: f.to })),
  upstreamSkillsLock: skillsLock,
}
writeFileSync(join(DEST_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

console.log(
  `[sync-cn-finance] done — ${copied} file(s) + manifest.json written to ${DEST_DIR.replace(/\\/g, '/')}`,
)
console.log(`[sync-cn-finance] source commit: ${srcCommit}`)
