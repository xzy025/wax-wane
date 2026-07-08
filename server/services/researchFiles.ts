// 每日研报目录扫描层(消息面 tab 的研报子面板)。
//
// 用户手动往 docs/research/ 平铺投放研报文件(pdf/md/txt),本层负责:
// 扫描 → 扩展名白名单分类 → 文件指纹(幂等键)→ mtime 归属上海日。
// 指纹 = name|size|mtimeMs:文件被替换(重下同名研报)自然产生新指纹重新分析,
// 人类可直接读懂,便于排查 analyses.json。
// 除 scanResearchDir 的 fs 调用外全部纯函数可测。
import { mkdirSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { todayShanghai } from '../lib/time'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const RESEARCH_DIR = join(__dirname, '..', '..', 'docs', 'research')

/** .analyses 子目录:分析结果落盘处,扫描时按点前缀跳过。 */
export const ANALYSES_DIR = join(RESEARCH_DIR, '.analyses')

export type ReportKind = 'pdf' | 'md' | 'txt'

export interface ReportFile {
  name: string
  kind: ReportKind
  sizeBytes: number
  mtimeMs: number
  /** mtime 归属的上海日(研报按投放日分组,与交易日无耦合)。 */
  date: string
  fingerprint: string
}

/** 扩展名白名单;其余(docx/json/无扩展名…)一律忽略不报错。 */
export function classifyFile(name: string): ReportKind | null {
  const m = /\.([^.]+)$/.exec(name)
  if (!m) return null
  const ext = m[1].toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'txt') return 'txt'
  return null
}

export function makeFingerprint(name: string, sizeBytes: number, mtimeMs: number): string {
  return `${name}|${sizeBytes}|${Math.round(mtimeMs)}`
}

export function fileDate(mtimeMs: number): string {
  return todayShanghai(mtimeMs)
}

/**
 * 单个目录项 → ReportFile;不合格返回 null。抽成纯函数供测试:
 * 跳过点前缀(.analyses 等)、白名单外扩展名、正在拷贝中的文件
 * (mtime 距 now < 10s,半个 PDF 解析必败且指纹会变,下一轮再收)。
 */
export function toReportFile(
  name: string,
  sizeBytes: number,
  mtimeMs: number,
  nowMs: number = Date.now(),
): ReportFile | null {
  if (name.startsWith('.')) return null
  const kind = classifyFile(name)
  if (!kind) return null
  if (nowMs - mtimeMs < 10_000) return null
  return {
    name,
    kind,
    sizeBytes,
    mtimeMs,
    date: fileDate(mtimeMs),
    fingerprint: makeFingerprint(name, sizeBytes, mtimeMs),
  }
}

/**
 * 扫描研报目录顶层文件(不递归)。目录不存在时创建后返回 [] ——
 * 用户第一次打开面板就能看到目录已就位,照提示投文件即可。
 */
export function scanResearchDir(dir: string = RESEARCH_DIR): ReportFile[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    try {
      mkdirSync(dir, { recursive: true })
    } catch (err) {
      console.warn('[Research] 研报目录创建失败:', err)
    }
    return []
  }
  const files: ReportFile[] = []
  for (const name of names) {
    let stat
    try {
      stat = statSync(join(dir, name))
    } catch {
      continue // 扫描窗口内被删除/移走
    }
    if (!stat.isFile()) continue
    const file = toReportFile(name, stat.size, stat.mtimeMs)
    if (file) files.push(file)
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
}
