// 飞书研报同步探针 —— 正式接线前逐步验证四件事:
//   ① App ID/Secret 能换 tenant_access_token
//   ② 机器人已在目标群(列所在群,拿 chat_id 回填 .env)
//   ③ 群历史消息可读(敏感权限 im:message.group_msg 已生效)
//   ④ webhook 机器人发的 PDF 资源可下载(官方文档对跨 bot 文件下载语焉不详,实测定音)
//
// 用法:
//   npm --prefix server run probe:feishu            (需 .env 里 FEISHU_APP_ID/SECRET;CHAT_ID 可后补)
//   npm --prefix server run probe:feishu -- --chat oc_xxx   (显式指定群,覆盖 .env)
//
// 任一步失败按提示处置:③④ 报 403/234xx → 核对敏感权限是否随版本发布生效;
// 机器人加不进外部群 → 转 Path C(自己租户建中转群转发研报,换 FEISHU_CHAT_ID)。
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { parseFileMessage, type FeishuMessageItem, type FeishuPdfMessage } from '../services/feishuMessages'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const BASE = 'https://open.feishu.cn/open-apis'

function fail(step: string, detail: unknown): never {
  console.error(`\n✗ ${step} 失败:`, detail)
  process.exit(1)
}

async function main() {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  const chatArg = process.argv.indexOf('--chat')
  const chatId = chatArg > -1 ? process.argv[chatArg + 1] : process.env.FEISHU_CHAT_ID
  if (!appId || !appSecret) {
    fail('前置检查', 'server/.env 缺 FEISHU_APP_ID / FEISHU_APP_SECRET')
  }

  // ① tenant_access_token
  const tokenRes = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const tokenJson = (await tokenRes.json()) as { code?: number; msg?: string; tenant_access_token?: string }
  if (tokenJson.code !== 0 || !tokenJson.tenant_access_token) fail('① 获取 token', tokenJson)
  const token = tokenJson.tenant_access_token
  const auth = { Authorization: `Bearer ${token}` }
  console.log(`✓ ① tenant_access_token OK (${token.slice(0, 8)}…)`)

  // ② 机器人所在群
  const chatsRes = await fetch(`${BASE}/im/v1/chats?page_size=50`, { headers: auth })
  const chatsJson = (await chatsRes.json()) as {
    code?: number
    msg?: string
    data?: { items?: { chat_id?: string; name?: string; external?: boolean }[] }
  }
  if (chatsJson.code !== 0) fail('② 列所在群', chatsJson)
  const chats = chatsJson.data?.items ?? []
  console.log(`✓ ② 机器人在 ${chats.length} 个群:`)
  for (const c of chats) {
    console.log(`     ${c.chat_id}  ${c.external ? '[外部]' : '[内部]'}  ${c.name ?? '(无名)'}`)
  }
  if (!chatId) {
    console.log('\n→ 把目标群的 chat_id 写进 server/.env 的 FEISHU_CHAT_ID 后重跑,继续 ③④')
    return
  }
  if (chats.length > 0 && !chats.some((c) => c.chat_id === chatId)) {
    console.log(`\n⚠ 目标群 ${chatId} 不在机器人所在群列表里——先把机器人加进群(外部群用桌面端)`)
  }

  // ③ 拉最近消息
  const msgParams = new URLSearchParams({
    container_id_type: 'chat',
    container_id: chatId,
    sort_type: 'ByCreateTimeDesc',
    page_size: '20',
  })
  const msgsRes = await fetch(`${BASE}/im/v1/messages?${msgParams.toString()}`, { headers: auth })
  const msgsJson = (await msgsRes.json()) as {
    code?: number
    msg?: string
    data?: { items?: (FeishuMessageItem & { sender?: { sender_type?: string } })[] }
  }
  if (msgsJson.code !== 0) fail('③ 拉群消息(核对敏感权限 im:message.group_msg 是否已随版本发布生效)', msgsJson)
  const items = msgsJson.data?.items ?? []
  console.log(`✓ ③ 最近 ${items.length} 条消息:`)
  const pdfs: FeishuPdfMessage[] = []
  for (const item of items) {
    const parsed = parseFileMessage(item)
    if (parsed) pdfs.push(parsed)
    const time = Number(item.create_time) > 0 ? new Date(Number(item.create_time)).toISOString() : '?'
    console.log(
      `     ${String(item.msg_type).padEnd(11)} sender=${item.sender?.sender_type ?? '?'}  ${time}` +
        (parsed ? `  📄 ${parsed.fileName}` : ''),
    )
  }
  if (pdfs.length === 0) {
    console.log('\n⚠ 最近 20 条里没有 PDF 文件消息,④ 无从验证——群里发一个测试 PDF 再重跑')
    return
  }

  // ④ 下载首个 PDF(只进内存验 magic,不落盘)
  const target = pdfs[0]
  const dlUrl =
    `${BASE}/im/v1/messages/${encodeURIComponent(target.messageId)}` +
    `/resources/${encodeURIComponent(target.fileKey)}?type=file`
  const dlRes = await fetch(dlUrl, { headers: auth })
  const contentType = dlRes.headers.get('content-type') ?? ''
  if (!dlRes.ok || contentType.includes('application/json')) {
    fail(`④ 下载 ${target.fileName}(若 403:跨 bot 文件下载受限 → 转 Path C 中转群)`, await dlRes.text())
  }
  const buf = Buffer.from(await dlRes.arrayBuffer())
  const magic = buf.subarray(0, 5).toString('latin1')
  console.log(`✓ ④ 下载 ${target.fileName}: ${buf.length} 字节, magic=${JSON.stringify(magic)} ${magic === '%PDF-' ? '✓ PDF' : '✗ 不是 PDF?'}`)
  console.log('\n🎉 四步全通,可以正式启用同步(重启 server 即生效)')
}

main().catch((err) => fail('探针异常', err))
