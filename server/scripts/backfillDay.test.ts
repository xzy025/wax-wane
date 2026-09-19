/**
 * backfillDay 的战法层初始化契约(handoff §D)。
 *
 * 覆盖的是**运行时行为**,不是类型:
 *   1. 私有入口存在且契约版本一致 → `loadStrategy()` 成功,选股步骤能拿到 panels;
 *   2. 入口缺失 → 战法层未加载,选股/战绩步骤**明确失败**(不是静默跳过);
 *   3. 契约版本不匹配 → 同上,且原因里点明版本不一致。
 * 三种情况都必须打印步骤汇总并以非零码退出 —— 失败不被吞掉。
 *
 * 不依赖真实私有代码、不依赖网络、不写任何正式归档:用临时目录里的假 register.ts
 * 冒充战法层,其 panels 只返回 `{asof}`,不产生副作用。
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = resolve(HERE, '..')
const TSX_CLI = join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs')

/**
 * 与 backfillDay.ts 内 lastSettledTradingDay() 同一推算(真实上海时钟)。
 * 脚本闸门要求 target === 「上游数据当前最近完结交易日」,把 TARGET 冻结成历史日期
 * 会在下一个交易日就失效(2026-09-15 冻结版即踩坑)。盘中(09:15–15:00 上海)没有
 * 完结日、脚本一律拒绝,此时整套用例直接跳过。
 */
function currentSettledTradingDay(): string | null {
  const sh = new Date(Date.now() + 8 * 3_600_000)
  const day = sh.getUTCDay()
  const minutes = sh.getUTCHours() * 60 + sh.getUTCMinutes()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const minusDays = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000)
  // 竞价开始(09:15)~收盘(15:00)之间:上游数据是目标日盘中态,不可回填
  if (day >= 1 && day <= 5 && minutes >= 9 * 60 + 15 && minutes < 15 * 60) return null
  let d: Date
  if (day >= 1 && day <= 5 && minutes >= 15 * 60) d = sh
  else if (day >= 1 && day <= 5) d = minusDays(sh, day === 1 ? 3 : 1)
  else d = minusDays(sh, day === 6 ? 1 : 2)
  return iso(d)
}

const settled = currentSettledTradingDay()
const TARGET = settled ?? ''
const intraday = settled === null

/** 造一个假战法层目录;contractVersion 传 null 表示目录里不放入口文件。 */
function makeFakeStrategyDir(contractVersion: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'wax-wane-fake-strategy-'))
  if (contractVersion !== null) {
    writeFileSync(
      join(dir, 'register.ts'),
      [
        `export const contractVersion = ${JSON.stringify(contractVersion)}`,
        'export const panels = {',
        `  scanScreener: async () => ({ asof: ${JSON.stringify(TARGET)} }),`,
        `  fetchScreenerForward: async () => ({ asof: ${JSON.stringify(TARGET)} }),`,
        '  clearScreenerCache: () => {},',
        '  clearScreenerForwardCache: () => {},',
        '}',
        '',
      ].join('\n'),
    )
  }
  return dir
}

function runBackfill(strategyDir: string): { status: number | null; out: string } {
  const res = spawnSync(
    process.execPath,
    [TSX_CLI, 'scripts/backfillDay.ts', TARGET, '--only=screener,forward'],
    {
      cwd: SERVER_DIR,
      env: { ...process.env, WAX_WANE_STRATEGY_DIR: strategyDir },
      encoding: 'utf8',
      timeout: 180_000,
    },
  )
  return { status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` }
}

describe.skipIf(intraday)('backfillDay 战法层初始化契约', () => {
  it('入口存在且契约版本一致 → 已加载,选股步骤能调用 panels', () => {
    const dir = makeFakeStrategyDir('1.0')
    try {
      const { status, out } = runBackfill(dir)
      expect(out).toContain('[backfillDay] 战法层 已加载(')
      // 走到 panels 调用(而不是在第 200 行的守卫处抛错)
      expect(out).toContain(`计算 asof=${TARGET}`)
      expect(out).not.toContain('未安装私有战法层')
      expect(out).toContain('[backfillDay] 结果:')
      expect(status).not.toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('入口缺失 → 战法层未加载,选股与战绩步骤都明确失败', () => {
    const dir = makeFakeStrategyDir(null)
    try {
      const { status, out } = runBackfill(dir)
      expect(out).toContain('战法层 未加载')
      expect(out).toContain('未安装私有战法层，选股快照无法回填')
      // 战绩步骤先过「选股归档必须存在」的闸门(它排在 panels 守卫之前),所以这里断言的是
      // 「明确失败」而不是某一条具体消息 —— 不写真实选股归档的前提下,拿不到 panels 那条分支。
      expect(out).toContain('❌ 实盘战绩: 抛错')
      expect(out).toContain('[backfillDay] 结果:')
      expect(status).toBe(1) // 步骤失败必须反映到退出码,不静默成功
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('契约版本不匹配 → 未加载,原因点名版本差异,选股步骤明确失败', () => {
    const dir = makeFakeStrategyDir('9.9')
    try {
      const { status, out } = runBackfill(dir)
      expect(out).toContain('契约版本不匹配')
      expect(out).toContain('未安装私有战法层，选股快照无法回填')
      expect(out).toContain('[backfillDay] 结果:')
      expect(status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('公共步骤(天梯/结构/节奏/复盘)不引用战法层 —— 私有层缺失不影响它们', () => {
    // 行为上无法在不触网、不落盘的前提下跑公共步骤,所以这里用源码级不变量守住边界:
    // getStrategy 只允许出现在「选股快照」与「实盘战绩」两个步骤里。
    const src = readFileSync(join(HERE, 'backfillDay.ts'), 'utf8')
    expect(src.match(/const panels = getStrategy\(\)\?\.panels/g) ?? []).toHaveLength(2)
    for (const service of ['../services/limitLadder', '../services/marketStructure', '../services/rotationTempo', '../services/dailyReview']) {
      expect(src).toContain(`await import('${service}')`)
    }
  })
})
