// 飞书群消息 → 研报 PDF 的纯函数层(消息解析/文件名清洗/重名回避/状态文件 shape guard)。
// 网络与 fs 全在 feishuSync.ts;本层零 IO,直接单测。

export interface FeishuPdfMessage {
  messageId: string
  fileKey: string
  fileName: string
  /** 消息发送时间(毫秒);下载后回设文件 mtime,让研报归属日=发帖日而非同步日。 */
  createTimeMs: number
}

/** 列消息接口返回的单条消息(只声明用到的字段,其余字段透传忽略)。 */
export interface FeishuMessageItem {
  message_id?: unknown
  msg_type?: unknown
  create_time?: unknown
  deleted?: unknown
  body?: { content?: unknown }
}

/**
 * 单条消息 → 待同步 PDF;不合格返回 null。
 * 只收 msg_type=file 且文件名以 .pdf 结尾的消息(群里的文字点评/图片/撤回消息全部忽略);
 * content 是 JSON 字符串(飞书协议),损坏时静默跳过而非中断整轮同步。
 */
export function parseFileMessage(item: FeishuMessageItem): FeishuPdfMessage | null {
  if (item.msg_type !== 'file' || item.deleted === true) return null
  if (typeof item.message_id !== 'string' || !item.message_id) return null
  const createTimeMs = Number(item.create_time)
  if (!Number.isFinite(createTimeMs) || createTimeMs <= 0) return null
  if (typeof item.body?.content !== 'string') return null
  let content: unknown
  try {
    content = JSON.parse(item.body.content)
  } catch {
    return null
  }
  const c = content as { file_key?: unknown; file_name?: unknown }
  if (typeof c?.file_key !== 'string' || !c.file_key) return null
  if (typeof c?.file_name !== 'string') return null
  const fileName = c.file_name.trim()
  if (!/\.pdf$/i.test(fileName)) return null
  return { messageId: item.message_id, fileKey: c.file_key, fileName, createTimeMs }
}

const MAX_BASE_CHARS = 120

/**
 * 群消息里的文件名不可信,落盘前清洗:
 * 路径分隔符(防穿越)、Windows 非法字符与控制字符 → 空格;点前缀剥掉(点前缀
 * 文件会被 toReportFile 当隐藏文件跳过);去尾部点/空格(Windows 不允许);
 * 主体截断防超长路径;空名兜底。恒以 .pdf 结尾返回。
 */
export function sanitizeFileName(raw: string): string {
  let name = raw
    .replace(/\.pdf$/i, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/<>:"|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '')
  if (name.length > MAX_BASE_CHARS) name = name.slice(0, MAX_BASE_CHARS).trim()
  if (!name) name = 'feishu-report'
  return `${name}.pdf`
}

/** 重名回避:base-2.pdf / base-3.pdf 递增(同名不同内容的研报不互相覆盖)。 */
export function resolveCollision(fileName: string, exists: (name: string) => boolean): string {
  if (!exists(fileName)) return fileName
  const base = fileName.replace(/\.pdf$/i, '')
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}.pdf`
    if (!exists(candidate)) return candidate
  }
  // 100 个同名文件之外已属异常,拿 messageId 级别的唯一性兜底没有意义,直接报错中断该文件
  throw new Error(`重名回避失败(同名文件过多): ${fileName}`)
}

// ---------- feishu-sync.json 状态文件 ----------

export interface FeishuSyncedEntry {
  /** 消息里的原始文件名。 */
  fileName: string
  /** 清洗+重名回避后的落盘名。 */
  savedAs: string
  createTimeMs: number
  syncedAt: string
}

export interface FeishuSyncState {
  version: 1
  /** message_id → 已同步记录(按消息去重:同一条消息永不重复下载)。 */
  synced: Record<string, FeishuSyncedEntry>
  /** 最近一轮完整成功的同步时间;失败轮不更新。 */
  lastSyncAt: string | null
  lastError: string | null
}

export function emptySyncState(): FeishuSyncState {
  return { version: 1, synced: {}, lastSyncAt: null, lastError: null }
}

/** 读盘 shape guard;损坏一律当空(代价仅是重下载,指纹幂等保证不重复分析)。 */
export function isFeishuSyncState(raw: unknown): raw is FeishuSyncState {
  if (typeof raw !== 'object' || raw === null) return false
  const s = raw as FeishuSyncState
  return s.version === 1 && typeof s.synced === 'object' && s.synced !== null
}
