// 每日研报 LLM 看板主服务(消息面 tab 的研报子面板)。
//
// 数据流:用户往 docs/research/ 投文件 → GET 触发 assembleState(纯磁盘拼装,
// 永不被 LLM 阻塞)→ 存在未分析文件时 fire-and-forget 后台串行分析(llmComplete
// JSON 抽取 → shape guard → 按文件指纹写盘幂等,同文件永不重复喂 LLM)→ 全部
// 分析完按 fingerprintsHash 判断是否需要重生成当日汇总 → 前端 20s 轮询收敛。
//
// 降级契约(对齐 llmComplete 的 null 语义):
//   - key 未配置:零 LLM 调用、不烧限流窗口,响应带 llmConfigured=false;
//   - key 有但挂(网络/额度):该文件转 pending,30 分钟限流窗口后自动重试;
//   - PDF 损坏/扫描件无文本层:extract_failed 终态落盘不重试(换文件=新指纹重走)。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { createCache } from '../lib/cache'
import { todayShanghai } from '../lib/time'
import { isLLMConfigured, llmComplete, parseJsonFromText } from '../lib/llmComplete'
import {
  ANALYSES_DIR,
  RESEARCH_DIR,
  scanResearchDir,
  type ReportFile,
} from './researchFiles'
import {
  DIGEST_SYSTEM_PROMPT,
  REPORT_SYSTEM_PROMPT,
  REPORT_TEXT_MAX,
  buildDigestPrompt,
  buildReportPrompt,
  isReportAnalysis,
  isResearchDigestFields,
  type ResearchDigestFields,
} from './researchPrompt'

// 与 dailyReview 同款路由:默认 preset(MiMo)key 已失效,gemini 是当前唯一活路
// (见 server/.env;若换回默认 preset,把这里和 dailyReview.ts 的 llmId 一起改)。
const LLM_ID = 'gemini'

const RETRY_MS = 30 * 60_000 // LLM 失败后的重试限流窗口(同 dailyReview NARRATIVE_RETRY_MS 语义)
const MIN_TEXT_CHARS = 200 // 短于此按"扫描件无文本层"归为 extract_failed,防喂空文产生幻觉
const DIGEST_RE = /^digest-(\d{4}-\d{2}-\d{2})\.json$/
const ANALYSES_PATH = join(ANALYSES_DIR, 'analyses.json')

export interface ReportAnalysis {
  fingerprint: string
  fileName: string
  date: string
  stockName: string | null
  stockCode: string | null
  industry: string | null
  brokerage: string | null
  rating: string | null
  /** 字符串保留原文区间与单位,如 "25-28元"。 */
  targetPrice: string | null
  thesis: string[]
  catalysts: string[]
  risks: string[]
  oneLiner: string
  analyzedAt: string
  /** 正文超长被截断(可信度提示)。 */
  truncated: boolean
}

export interface ResearchDigest {
  date: string
  /** 当日 analyzed 指纹排序后的 sha1 前 16 位;集合变化(补析/删文件)触发重生成。 */
  fingerprintsHash: string
  reportCount: number
  /** 汇总观点 markdown(前端 ai-markdown 渲染)。 */
  overview: string
  hotIndustries: string[]
  keyStocks: { name: string; code: string | null; reason: string }[]
  consensus: string | null
  generatedAt: string
}

export type ReportStatus = 'analyzed' | 'pending' | 'extract_failed'

export interface ResearchReportEntry {
  file: ReportFile
  status: ReportStatus
  analysis: ReportAnalysis | null
  error?: string
}

export interface ResearchData {
  date: string
  llmConfigured: boolean
  /** 后台分析进行中(前端轮询依据)。 */
  analyzing: boolean
  reports: ResearchReportEntry[]
  digest: ResearchDigest | null
  generatedAt: string
}

// ---------- analyses.json 持久层 ----------

interface StoredFailure {
  status: 'extract_failed'
  fileName: string
  date: string
  error: string
  failedAt: string
}

type StoredEntry = { status: 'analyzed'; analysis: ReportAnalysis } | StoredFailure

interface AnalysesFile {
  version: 1
  entries: Record<string, StoredEntry>
}

/** 读 analyses.json;缺失/损坏一律当空(幂等安全:代价仅是重跑 LLM)。 */
function loadAnalysesDisk(): AnalysesFile {
  try {
    const raw = JSON.parse(readFileSync(ANALYSES_PATH, 'utf8')) as AnalysesFile
    if (raw && raw.version === 1 && typeof raw.entries === 'object' && raw.entries !== null) return raw
  } catch {
    // fallthrough
  }
  return { version: 1, entries: {} }
}

function saveAnalysesDisk(store: AnalysesFile): void {
  try {
    mkdirSync(ANALYSES_DIR, { recursive: true })
    writeFileSync(ANALYSES_PATH, JSON.stringify(store, null, 2))
  } catch (err) {
    console.warn('[Research] analyses.json 写盘失败(非致命):', err)
  }
}

function loadDigestDisk(date: string): ResearchDigest | null {
  try {
    const raw = JSON.parse(readFileSync(join(ANALYSES_DIR, `digest-${date}.json`), 'utf8')) as ResearchDigest
    if (raw && typeof raw.overview === 'string' && typeof raw.fingerprintsHash === 'string') return raw
  } catch {
    // fallthrough
  }
  return null
}

function saveDigestDisk(digest: ResearchDigest): void {
  try {
    mkdirSync(ANALYSES_DIR, { recursive: true })
    writeFileSync(join(ANALYSES_DIR, `digest-${digest.date}.json`), JSON.stringify(digest, null, 2))
  } catch (err) {
    console.warn('[Research] digest 写盘失败(非致命):', err)
  }
}

/** 当日 analyzed 指纹集合 → 排序 sha1 前 16 位(digest 幂等键)。 */
export function fingerprintsHash(fingerprints: string[]): string {
  return createHash('sha1').update([...fingerprints].sort().join('\n')).digest('hex').slice(0, 16)
}

// ---------- 状态拼装(纯磁盘,GET 即时返回) ----------

function assembleState(date: string): ResearchData {
  const store = loadAnalysesDisk()
  const files = scanResearchDir().filter((f) => f.date === date)
  const reports: ResearchReportEntry[] = files.map((file) => {
    const entry = store.entries[file.fingerprint]
    if (entry?.status === 'analyzed') return { file, status: 'analyzed', analysis: entry.analysis }
    if (entry?.status === 'extract_failed') return { file, status: 'extract_failed', analysis: null, error: entry.error }
    return { file, status: 'pending', analysis: null }
  })
  return {
    date,
    llmConfigured: isLLMConfigured(LLM_ID),
    analyzing,
    reports,
    digest: loadDigestDisk(date),
    generatedAt: new Date().toISOString(),
  }
}

/** 可回看的日期:今日 ∪ 目录内文件归属日 ∪ 已落盘 digest 日,倒序。 */
export function listResearchDates(): string[] {
  const dates = new Set<string>(scanResearchDir().map((f) => f.date))
  // 恒含今日:文件全归属历史日时(Windows 拷贝保留源 mtime 是常态),前端日期
  // chip 行才会出现(>1 个日期),且始终有"回到今天"的锚点。
  dates.add(todayShanghai())
  try {
    for (const name of readdirSync(ANALYSES_DIR)) {
      const m = DIGEST_RE.exec(name)
      if (m) dates.add(m[1])
    }
  } catch {
    // .analyses 尚未创建
  }
  return [...dates].sort((a, b) => (a < b ? 1 : -1))
}

// ---------- 文本提取 ----------

async function extractReportText(file: ReportFile): Promise<string> {
  const path = join(RESEARCH_DIR, file.name)
  if (file.kind === 'pdf') {
    // 动态 import:unpdf 内嵌 pdf.js 初始化不便宜,只在真的要解析 PDF 时加载。
    const { extractText, getDocumentProxy } = await import('unpdf')
    const doc = await getDocumentProxy(new Uint8Array(readFileSync(path)))
    const { text } = await extractText(doc, { mergePages: true })
    return typeof text === 'string' ? text : ''
  }
  return readFileSync(path, 'utf8')
}

// ---------- 后台分析循环 ----------

let analyzing = false
let lastLlmAttempt = 0 // 最近一次 LLM 失败尝试;窗口内不重试已失败过的指纹
const attempted = new Set<string>() // 本进程内已尝试且失败的指纹(成功即移除)

async function analyzeOneFile(file: ReportFile, store: AnalysesFile): Promise<boolean> {
  let text: string
  try {
    text = await extractReportText(file)
  } catch (err) {
    store.entries[file.fingerprint] = {
      status: 'extract_failed',
      fileName: file.name,
      date: file.date,
      error: `文本提取失败:${err instanceof Error ? err.message : String(err)}`,
      failedAt: new Date().toISOString(),
    }
    saveAnalysesDisk(store)
    return false
  }
  if (text.trim().length < MIN_TEXT_CHARS) {
    store.entries[file.fingerprint] = {
      status: 'extract_failed',
      fileName: file.name,
      date: file.date,
      error: '正文过短(可能是扫描件,无文本层)',
      failedAt: new Date().toISOString(),
    }
    saveAnalysesDisk(store)
    return false
  }

  const res = await llmComplete(buildReportPrompt(file.name, text), {
    system: REPORT_SYSTEM_PROMPT,
    maxTokens: 1200,
    temperature: 0,
    timeoutMs: 45_000,
    llmId: LLM_ID,
  })
  const fields = res ? parseJsonFromText<unknown>(res.text) : null
  if (!fields || !isReportAnalysis(fields)) {
    attempted.add(file.fingerprint)
    lastLlmAttempt = Date.now()
    return false
  }
  store.entries[file.fingerprint] = {
    status: 'analyzed',
    analysis: {
      ...fields,
      fingerprint: file.fingerprint,
      fileName: file.name,
      date: file.date,
      analyzedAt: new Date().toISOString(),
      truncated: text.length > REPORT_TEXT_MAX,
    },
  }
  attempted.delete(file.fingerprint)
  saveAnalysesDisk(store)
  return true
}

/** 对某日重生成汇总(analyzed 集合与既有 digest 的 fingerprintsHash 不一致时)。 */
async function regenerateDigest(date: string, store: AnalysesFile, files: ReportFile[]): Promise<void> {
  const analyzed = files
    .map((f) => store.entries[f.fingerprint])
    .filter((e): e is { status: 'analyzed'; analysis: ReportAnalysis } => e?.status === 'analyzed')
    .map((e) => e.analysis)
  if (analyzed.length === 0) return
  const hash = fingerprintsHash(analyzed.map((a) => a.fingerprint))
  if (loadDigestDisk(date)?.fingerprintsHash === hash) return

  const res = await llmComplete(buildDigestPrompt(analyzed), {
    system: DIGEST_SYSTEM_PROMPT,
    maxTokens: 1000,
    temperature: 0.3,
    timeoutMs: 45_000,
    llmId: LLM_ID,
  })
  const fields = res ? parseJsonFromText<unknown>(res.text) : null
  if (!fields || !isResearchDigestFields(fields)) {
    lastLlmAttempt = Date.now()
    return
  }
  const f = fields as ResearchDigestFields
  saveDigestDisk({
    date,
    fingerprintsHash: hash,
    reportCount: analyzed.length,
    overview: f.overview,
    hotIndustries: f.hotIndustries,
    keyStocks: f.keyStocks,
    consensus: f.consensus,
    generatedAt: new Date().toISOString(),
  })
}

/**
 * 后台串行分析(fire-and-forget,analyzing flag 防重入):
 * 全目录未分析文件逐篇喂 LLM(不并发,保护配额),每篇落盘后即清缓存让下一次
 * GET/轮询立刻看到增量;收尾对涉及的日期按需重生成汇总。
 * 限流:本进程失败过的指纹在 30 分钟窗口内不重试;新指纹不受限,立即分析。
 */
async function kickBackgroundAnalysis(): Promise<void> {
  if (analyzing || !isLLMConfigured(LLM_ID)) return
  const store = loadAnalysesDisk()
  const files = scanResearchDir()
  const retryOk = Date.now() - lastLlmAttempt > RETRY_MS
  const todo = files.filter((f) => !store.entries[f.fingerprint] && (retryOk || !attempted.has(f.fingerprint)))
  // digest 对全部日期核对而非只 todo 日期:文件被删、上轮汇总 LLM 失败的日期都
  // 不在 todo 里;regenerateDigest 有 hash 相等早退,核对成本只是读盘。
  const touchedDates = new Set<string>(files.map((f) => f.date))

  analyzing = true
  try {
    let analyzedThisRound = false
    for (const file of todo) {
      if (await analyzeOneFile(file, store)) analyzedThisRound = true
      clearResearchCache() // 增量可见:前端 20s 轮询逐篇点亮
    }
    // 本轮有新分析成功,或不在失败限流窗口内(digest 上次失败后的补生成),才打汇总 LLM。
    if (analyzedThisRound || Date.now() - lastLlmAttempt > RETRY_MS) {
      for (const date of touchedDates) {
        await regenerateDigest(date, store, files.filter((f) => f.date === date))
      }
    }
  } catch (err) {
    console.warn('[Research] 后台分析异常:', err)
  } finally {
    analyzing = false
    clearResearchCache()
  }
}

// ---------- 对外接口 ----------

const todayCache = createCache<ResearchData>({
  name: 'Research',
  ttl: 60_000, // 目录变化 1 分钟内可见;数据本身在磁盘,无需 fallback
  fetcher: async () => assembleState(todayShanghai()),
})

/**
 * 研报看板数据。GET 永不被 LLM 阻塞:即时返回磁盘状态,顺手踢一脚后台分析。
 * 缺省今日走缓存;历史日期纯磁盘直读(便宜,不缓存)。
 */
export async function fetchResearch(date?: string): Promise<ResearchData> {
  const today = todayShanghai()
  const target = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today
  const data = target === today ? await todayCache.get() : assembleState(target)
  // 无条件踢,而非"本切片有 pending 才踢":待分析文件可能归属其他日期(Windows
  // 拷贝保留源 mtime),digest 也可能在上轮失败后等 30 分钟窗口补生成——只看当前
  // 切片这两条路都永远走不到。kick 自带 analyzing 防重入 + isLLMConfigured 短路 +
  // 指纹/hash 幂等,无事可做时的成本只是读盘。
  void kickBackgroundAnalysis()
  return data
}

export function clearResearchCache(): void {
  todayCache.clear()
}
