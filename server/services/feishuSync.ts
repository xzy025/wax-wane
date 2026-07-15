// 飞书群研报 PDF 同步(消息面研报看板的自动搬运层)。
//
// 研报源头是飞书群里 webhook 机器人转发的 PDF 附件。本服务用自建应用的
// tenant_access_token 拉群历史消息(要求应用机器人已在群内;外部群需在开发者
// 后台版本配置开「允许机器人被添加到外部群」),把新的 file+.pdf 消息下载到
// docs/research/,交给现有研报流水线(指纹幂等 → 自动 LLM 分析 → 当日汇总)。
// 下载后用消息 create_time 回设文件 mtime:研报归属日=发帖日,而非同步日。
//
// 触发:fetchResearch() 惰性踢(与 kickBackgroundAnalysis 同款 fire-and-forget),
// 5 分钟冷却防前端 20s 收敛轮询打爆;整轮失败 30 分钟限流(同 research.ts RETRY_MS
// 语义)。面板刷新按钮走 POST /api/refresh?market=intel-research →
// resetFeishuCooldown(),随后的 GET 立即重拉。
// 降级契约:env 缺任一 FEISHU_* 时 isFeishuConfigured=false,整体静默短路零请求。
//
// 网络用全局 fetch 直连:飞书是国内 API,不走 llm.ts 的 SOCKS 代理路径。
import { existsSync, mkdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ANALYSES_DIR, RESEARCH_DIR } from './researchFiles'
import {
  emptySyncState,
  isFeishuSyncState,
  parseFileMessage,
  resolveCollision,
  sanitizeFileName,
  type FeishuMessageItem,
  type FeishuPdfMessage,
  type FeishuSyncState,
} from './feishuMessages'

const FEISHU_BASE = 'https://open.feishu.cn/open-apis'
const SYNC_COOLDOWN_MS = 5 * 60_000 // 正常轮之间的最小间隔
const FAIL_RETRY_MS = 30 * 60_000 // 整轮失败后的重试限流窗口
const PAGE_SIZE = 50 // 列消息接口单页上限
const MAX_PAGES = 20 // 单轮最多翻 20 页(1000 条);lookback 窗口内到不了
const STATE_PATH = join(ANALYSES_DIR, 'feishu-sync.json')

interface FeishuEnv {
  appId: string
  appSecret: string
  chatId: string
  lookbackDays: number
}

/** env 每次调用现读:dotenv 的 config() 在 index.ts 里晚于模块加载执行(ESM import 提升)。 */
function readEnv(): FeishuEnv | null {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  const chatId = process.env.FEISHU_CHAT_ID
  if (!appId || !appSecret || !chatId) return null
  const days = Number(process.env.FEISHU_LOOKBACK_DAYS)
  return { appId, appSecret, chatId, lookbackDays: Number.isFinite(days) && days > 0 ? days : 7 }
}

export function isFeishuConfigured(): boolean {
  return readEnv() !== null
}

// ---------- tenant_access_token ----------

let tokenCache: { token: string; expiresAt: number } | null = null

async function getTenantToken(env: FeishuEnv): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.appId, app_secret: env.appSecret }),
  })
  const json = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number }
  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`tenant_access_token 获取失败: code=${json.code} ${json.msg ?? ''}`)
  }
  // 提前 5 分钟过期,防在长下载轮里撞线
  const ttlSec = Math.max(60, (json.expire ?? 7200) - 300)
  tokenCache = { token: json.tenant_access_token, expiresAt: Date.now() + ttlSec * 1000 }
  return tokenCache.token
}

// ---------- feishu-sync.json 持久层 ----------

let stateMem: FeishuSyncState | null = null

function loadState(): FeishuSyncState {
  if (stateMem) return stateMem
  try {
    const raw: unknown = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    if (isFeishuSyncState(raw)) {
      stateMem = raw
      return raw
    }
  } catch {
    // fallthrough:缺失/损坏当空,代价仅是重下载(研报指纹幂等,不会重复分析)
  }
  stateMem = emptySyncState()
  return stateMem
}

function saveState(state: FeishuSyncState): void {
  stateMem = state
  try {
    mkdirSync(ANALYSES_DIR, { recursive: true })
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
  } catch (err) {
    console.warn('[FeishuSync] feishu-sync.json 写盘失败(非致命):', err)
  }
}

// ---------- 飞书 API ----------

async function listPdfMessages(env: FeishuEnv, token: string): Promise<FeishuPdfMessage[]> {
  const startSec = Math.floor(Date.now() / 1000) - env.lookbackDays * 86_400
  const out: FeishuPdfMessage[] = []
  let pageToken = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      container_id_type: 'chat',
      container_id: env.chatId,
      start_time: String(startSec),
      sort_type: 'ByCreateTimeAsc',
      page_size: String(PAGE_SIZE),
    })
    if (pageToken) params.set('page_token', pageToken)
    const res = await fetch(`${FEISHU_BASE}/im/v1/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json()) as {
      code?: number
      msg?: string
      data?: { has_more?: boolean; page_token?: string; items?: FeishuMessageItem[] }
    }
    if (json.code !== 0) throw new Error(`列消息失败: code=${json.code} ${json.msg ?? ''}`)
    for (const item of json.data?.items ?? []) {
      const parsed = parseFileMessage(item)
      if (parsed) out.push(parsed)
    }
    if (!json.data?.has_more || !json.data.page_token) break
    pageToken = json.data.page_token
  }
  return out
}

async function downloadPdf(token: string, msg: FeishuPdfMessage): Promise<Buffer> {
  const url =
    `${FEISHU_BASE}/im/v1/messages/${encodeURIComponent(msg.messageId)}` +
    `/resources/${encodeURIComponent(msg.fileKey)}?type=file`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok || contentType.includes('application/json')) {
    // 飞书的错误(权限不足/资源不存在)以 JSON body 返回
    const text = await res.text()
    throw new Error(`下载失败(HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('内容不是 PDF(magic 校验失败)')
  }
  return buf
}

// ---------- 同步轮 ----------

/**
 * 单轮同步:列 lookback 窗口内消息 → 过滤新的 PDF → 逐个下载落盘。
 * 单个文件失败不中断整轮(记 lastError 继续),全部落完仍有失败则抛错让
 * kick 进入失败限流;成功的文件已各自落盘+记账,下轮不会重下。
 */
async function syncOnce(env: FeishuEnv, onUpdate?: () => void): Promise<void> {
  const state = loadState()
  const token = await getTenantToken(env)
  const messages = await listPdfMessages(env, token)
  const todo = messages.filter((m) => !state.synced[m.messageId])
  let lastFileError: string | null = null
  for (const msg of todo) {
    try {
      const buf = await downloadPdf(token, msg)
      mkdirSync(RESEARCH_DIR, { recursive: true })
      const savedAs = resolveCollision(sanitizeFileName(msg.fileName), (name) =>
        existsSync(join(RESEARCH_DIR, name)),
      )
      // 点前缀临时名:半个文件不会被 scanResearchDir 收进流水线;rename 保留 mtime
      const tmpPath = join(RESEARCH_DIR, `.feishu-tmp-${msg.messageId.replace(/[^\w-]/g, '')}.part`)
      writeFileSync(tmpPath, buf)
      const t = new Date(msg.createTimeMs)
      utimesSync(tmpPath, t, t)
      renameSync(tmpPath, join(RESEARCH_DIR, savedAs))
      state.synced[msg.messageId] = {
        fileName: msg.fileName,
        savedAs,
        createTimeMs: msg.createTimeMs,
        syncedAt: new Date().toISOString(),
      }
      saveState(state)
      onUpdate?.() // 清研报缓存:前端 20s 轮询立刻看到新文件逐个出现
    } catch (err) {
      lastFileError = `${msg.fileName}: ${err instanceof Error ? err.message : String(err)}`
      console.warn('[FeishuSync] 文件同步失败:', lastFileError)
    }
  }
  if (lastFileError) {
    state.lastError = lastFileError
    saveState(state)
    throw new Error(lastFileError)
  }
  state.lastSyncAt = new Date().toISOString()
  state.lastError = null
  saveState(state)
}

// ---------- 对外接口 ----------

let syncing = false
let cooldownUntil = 0

/**
 * 惰性踢一脚(fire-and-forget,syncing flag 防重入 + 冷却限流)。
 * onUpdate 由调用方传入 clearResearchCache——避免反向 import research.ts 成环。
 */
export async function kickFeishuSync(onUpdate?: () => void): Promise<void> {
  const env = readEnv()
  if (!env || syncing || Date.now() < cooldownUntil) return
  syncing = true
  cooldownUntil = Date.now() + SYNC_COOLDOWN_MS
  try {
    await syncOnce(env, onUpdate)
  } catch (err) {
    cooldownUntil = Date.now() + FAIL_RETRY_MS
    const state = loadState()
    state.lastError = err instanceof Error ? err.message : String(err)
    saveState(state)
    console.warn('[FeishuSync] 同步失败(30 分钟后重试):', state.lastError)
  } finally {
    syncing = false
    onUpdate?.() // syncing 翻转对前端可见(今日缓存 60s,不清会晚一分钟)
  }
}

export interface FeishuSyncStatus {
  configured: boolean
  syncing: boolean
  lastSyncAt: string | null
  lastError: string | null
}

export function getFeishuSyncStatus(): FeishuSyncStatus {
  if (!isFeishuConfigured()) return { configured: false, syncing: false, lastSyncAt: null, lastError: null }
  const state = loadState()
  return { configured: true, syncing, lastSyncAt: state.lastSyncAt, lastError: state.lastError }
}

/** 面板刷新按钮 → /api/refresh 清冷却,下一次 GET 立即重拉(失败限流同样被清,用户显式要求即重试)。 */
export function resetFeishuCooldown(): void {
  cooldownUntil = 0
}
