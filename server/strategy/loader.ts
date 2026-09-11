// 战法层加载器。
//
// 设计目标：**公开仓库不装私有包也能 build + 启动**。所以这里
// ① 用运行时目录约定而不是 npm 依赖（公开仓库的 package.json 完全不出现私有包）；
// ② 加载失败一律降级为 `null`，绝不抛到调用方；
// ③ 只在第一次调用时尝试，结果缓存。
//
// 解析顺序：
//   1. 环境变量 `WAX_WANE_STRATEGY_DIR`
//   2. 约定路径 `<cwd>/../wax-wane-strategy`
//
// 已验证的行为（2026-09-11，见 BOUNDARY.md 附录）：在缺失/悬空路径上做
// `await import()` 抛的是**可捕获的** `ERR_MODULE_NOT_FOUND`，不是进程崩溃。

import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  STRATEGY_CONTRACT_VERSION,
  type StrategyModule,
} from './contract'

/** 候选入口文件名，按顺序尝试。 */
const ENTRY_CANDIDATES = ['register.ts', 'index.ts', 'register.mjs', 'register.js']

export interface StrategyStatus {
  loaded: boolean
  /** 解析出的战法层目录。 */
  dir: string
  /** 命中的入口文件（未加载时为 undefined）。 */
  entry?: string
  /** 未加载的原因，供启动日志与 /ops 诊断使用。 */
  reason?: string
}

/** 解析战法层目录：环境变量优先，否则用约定路径。 */
export function strategyDir(): string {
  const fromEnv = process.env.WAX_WANE_STRATEGY_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(process.cwd(), '..', 'wax-wane-strategy')
}

function findEntry(dir: string): string | undefined {
  for (const name of ENTRY_CANDIDATES) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

let cached: StrategyModule | null | undefined
let lastStatus: StrategyStatus = { loaded: false, dir: '', reason: 'not-loaded' }

/**
 * 加载战法层。幂等，结果缓存。
 * 任何失败都返回 `null` 并把原因写进 {@link strategyStatus}。
 */
export async function loadStrategy(): Promise<StrategyModule | null> {
  if (cached !== undefined) return cached

  const dir = strategyDir()
  const entry = findEntry(dir)

  if (!entry) {
    cached = null
    lastStatus = {
      loaded: false,
      dir,
      reason: fs.existsSync(dir)
        ? `目录存在但没有入口文件（找过 ${ENTRY_CANDIDATES.join(' / ')}）`
        : '战法层目录不存在',
    }
    return cached
  }

  try {
    const mod = (await import(pathToFileURL(entry).href)) as {
      default?: StrategyModule
      strategy?: StrategyModule
    }
    const resolved = mod.default ?? mod.strategy ?? (mod as unknown as StrategyModule)

    if (typeof resolved?.contractVersion !== 'string') {
      cached = null
      lastStatus = { loaded: false, dir, entry, reason: '入口没有导出 contractVersion' }
      return cached
    }
    if (resolved.contractVersion !== STRATEGY_CONTRACT_VERSION) {
      cached = null
      lastStatus = {
        loaded: false,
        dir,
        entry,
        reason: `契约版本不匹配：私有包 ${resolved.contractVersion}，公开侧 ${STRATEGY_CONTRACT_VERSION}`,
      }
      return cached
    }

    cached = resolved
    lastStatus = { loaded: true, dir, entry }
    return cached
  } catch (err) {
    cached = null
    const code = (err as { code?: string })?.code
    lastStatus = {
      loaded: false,
      dir,
      entry,
      reason: code === 'ERR_MODULE_NOT_FOUND'
        ? '入口存在但依赖解析失败（私有包可能没装依赖）'
        : `加载失败：${err instanceof Error ? err.message : String(err)}`,
    }
    return cached
  }
}

/**
 * 同步取已加载的战法层。**未先调用 {@link loadStrategy} 时恒为 `null`。**
 * 供无法 await 的调用点使用。
 */
export function getStrategy(): StrategyModule | null {
  return cached ?? null
}

/** 加载状态，供启动日志与诊断端点使用。 */
export function strategyStatus(): StrategyStatus {
  return { ...lastStatus }
}

/**
 * 把加载结果打成一行启动日志。
 * 降级不是错误 —— 公开部署本来就不带战法层，所以用 log 而不是 error。
 */
export function logStrategyStatus(log: (msg: string) => void = console.log): void {
  const s = strategyStatus()
  if (s.loaded) {
    log(`[strategy] 已加载战法层：${s.entry}`)
  } else {
    log(`[strategy] 未加载战法层（${s.reason}）；选股/轮动/战法评分相关功能将不可用。`)
    log(`[strategy] 如需启用，设置 WAX_WANE_STRATEGY_DIR 指向私有包目录。`)
  }
}

/** 仅供测试：重置缓存。 */
export function __resetStrategyCache(): void {
  cached = undefined
  lastStatus = { loaded: false, dir: '', reason: 'not-loaded' }
}
