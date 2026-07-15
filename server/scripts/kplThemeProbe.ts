// 开盘啦「精选题材」接口探针 —— 验证题材列表/成分接口能否匿名取用(节奏表第二分类源前提)。
// 复用 kaipanla.ts 同款匿名口(POST form,固定 DeviceID,UserID=0/Token=0)。
// 候选参数来自社区公开逆向(KPL 爬虫项目),本探针只做证据采集与判定,不落任何业务代码。
//
// 用法: npm --prefix server run probe:kpl
// 判定(全过才在 kplThemes.ts 实装):
//   P1 题材列表:200+合法JSON+≥10个真题材语义名称(如「华为昇腾」),两次调用稳定
//   P2 题材成分:每题材≥5个6位A股代码,且抽3只跑K线全非空(等权重构路径通)
//   P3 频控:间隔500ms连打10次列表无封禁/风控payload
//   P4(加分):题材自带当日涨幅字段(记录字段名,可校验等权重构精度)
import { fetchStockKline } from '../services/ashare'

const KPL_URL = 'https://apphq.longhuvip.com/w1/api/index.php'
const KPL_HEADERS = {
  'User-Agent': 'lhb/5.18.0 (iPhone; iOS 16.0)',
  'Content-Type': 'application/x-www-form-urlencoded',
}
const KPL_DEVICE_ID = '00000000-025d-1ffd-fa71-8fd5272bb997'

const BASE = { PhoneOSNew: '1', DeviceID: KPL_DEVICE_ID, VerSion: '5.18.0.0', UserID: '0', Token: '0' }

async function kplPost(params: Record<string, string>): Promise<{ status: number; json: unknown | null; raw: string }> {
  const body = new URLSearchParams({ ...BASE, ...params }).toString()
  try {
    const res = await fetch(KPL_URL, { method: 'POST', headers: KPL_HEADERS, body, signal: AbortSignal.timeout(8000) })
    const raw = await res.text()
    let json: unknown | null = null
    try {
      json = JSON.parse(raw)
    } catch {
      /* 非 JSON */
    }
    return { status: res.status, json, raw }
  } catch (e) {
    return { status: 0, json: null, raw: e instanceof Error ? e.message : String(e) }
  }
}

const topKeys = (v: unknown) => (typeof v === 'object' && v !== null ? Object.keys(v as object).join(',') : typeof v)

/** 从任意响应里挖「像题材列表」的数组:元素含 中文名称 + ID 样字段。返回 [ID字段名, 名称字段名, 样本]。 */
function sniffThemeArray(v: unknown, path = ''): { path: string; sample: unknown[] } | null {
  if (Array.isArray(v) && v.length >= 5) {
    const first = v[0]
    if (Array.isArray(first) || (typeof first === 'object' && first !== null)) return { path, sample: v.slice(0, 5) }
  }
  if (typeof v === 'object' && v !== null) {
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      const hit = sniffThemeArray(child, path ? `${path}.${k}` : k)
      if (hit) return hit
    }
  }
  return null
}

// 候选矩阵:题材/板块列表(社区逆向已知的 c/a 组合,逐个试)。
// 2026-07-10 21:00 盘后首测结论:
//   A/B/E' RealRanking 系:接口存在(200+errcode:0)但 list 恒空 —— 疑似仅盘中有数据,**须盘中复测**;
//   F DailyLimitResumption:盘后可用(106KB),题材taxonomy(ZSCode/ZSName 如「芯片」801001)+
//     每题材涨停股 StockList+首板/连板归因 —— 但成分只有当日涨停股(有偏样本),
//     不能直接做等权重构基底(只涨停成员→题材历史被幸存者偏差抬高);
//   G ZhiShuRanking:盘后返回 8 个板块(885/886 码系,DeepSeek概念/AI智能体等真题材名),
//     疑似盘后截断,盘中复测看全量;成分接口(PlateID/ZSCode 各变体)盘后全空。
const LIST_CANDIDATES: { label: string; params: Record<string, string> }[] = [
  { label: 'A 实时板块排行(Type=5)', params: { c: 'NewStockRanking', a: 'RealRankingInfo', Order: '1', st: '30', Type: '5', Index: '0', apiv: 'w35', ZSType: '7' } },
  { label: 'B 实时板块排行(Type=4)', params: { c: 'NewStockRanking', a: 'RealRankingInfo', Order: '1', st: '30', Type: '4', Index: '0', apiv: 'w32' } },
  { label: 'C 首页板块', params: { c: 'PCArrangeData', a: 'GetHomePlateList', apiv: 'w32' } },
  { label: 'D 题材库', params: { c: 'Theme', a: 'ThemeList', apiv: 'w32', Index: '0', st: '30' } },
  { label: 'E 盯盘板块异动', params: { c: 'HomeDingPan', a: 'GetPlateList', apiv: 'w32', Type: '1', Index: '0', st: '30' } },
  { label: 'F 涨停复盘题材(盘后可用)', params: { c: 'DailyLimitResumption', a: 'GetPlateInfo', st: '30', apiv: 'w18', Index: '0' } },
  { label: 'G 指数/板块排行', params: { c: 'ZhiShuRanking', a: 'RealRankingInfo', Order: '1', st: '300', Index: '0', apiv: 'w35', Type: '5', ZSType: '5' } },
]

// 成分候选(拿到 PlateID/ZSCode 后逐个试)。盘后首测全空 → **盘中复测是 P2 的裁决前提**。
const MEMBER_CANDIDATES: { label: string; params: (id: string) => Record<string, string> }[] = [
  { label: 'M1 板块成分排行(Type=6)', params: (id) => ({ c: 'NewStockRanking', a: 'RealRankingInfo', Order: '1', st: '30', Type: '6', PlateID: id, Index: '0', apiv: 'w35' }) },
  { label: 'M1b 板块成分排行(Type=1)', params: (id) => ({ c: 'NewStockRanking', a: 'RealRankingInfo', Order: '1', st: '30', Type: '1', PlateID: id, Index: '0', apiv: 'w35' }) },
  { label: 'M2 指数成分', params: (id) => ({ c: 'ZhiShuRanking', a: 'RealRankingStock', Order: '1', st: '30', ZSCode: id, Index: '0', apiv: 'w35' }) },
  { label: 'M3 板块成分', params: (id) => ({ c: 'Plate', a: 'PlateInfo', PlateID: id, apiv: 'w32' }) },
]

async function main() {
  console.log('开盘啦题材探针 · 匿名口同 kaipanla.ts(情绪接口线上可用,故网络路径通)')

  // P1: 列表候选矩阵
  console.log('\n━━━ P1 题材列表候选 ━━━')
  let plateIds: string[] = []
  for (const cand of LIST_CANDIDATES) {
    const r = await kplPost(cand.params)
    const head = r.raw.slice(0, 160).replace(/\s+/g, ' ')
    console.log(`\n  [${cand.label}] HTTP ${r.status} 顶层键={${topKeys(r.json)}}`)
    console.log(`    raw: ${head}`)
    const arr = r.json ? sniffThemeArray(r.json) : null
    if (arr) {
      console.log(`    ✓ 疑似列表 @ ${arr.path},样本:`)
      for (const s of arr.sample) console.log(`      ${JSON.stringify(s).slice(0, 140)}`)
      // 挖 ID:数组元素若是数组取[0],若是对象取 ID/PlateID/id 字段
      for (const s of arr.sample) {
        if (Array.isArray(s) && s[0] != null) plateIds.push(String(s[0]))
        else if (typeof s === 'object' && s !== null) {
          const o = s as Record<string, unknown>
          const id = o.ID ?? o.PlateID ?? o.id
          if (id != null) plateIds.push(String(id))
        }
      }
    }
    await new Promise((rs) => setTimeout(rs, 400))
  }
  plateIds = [...new Set(plateIds)].slice(0, 3)
  console.log(`\n  → 采到候选 PlateID: ${plateIds.length ? plateIds.join(' ') : '无(P1 未过,P2 跳过)'}`)

  // P2: 成分候选
  const memberCodes: string[] = []
  if (plateIds.length > 0) {
    console.log('\n━━━ P2 题材成分候选 ━━━')
    for (const mc of MEMBER_CANDIDATES) {
      const r = await kplPost(mc.params(plateIds[0]))
      console.log(`\n  [${mc.label}] HTTP ${r.status} 顶层键={${topKeys(r.json)}}`)
      console.log(`    raw: ${r.raw.slice(0, 160).replace(/\s+/g, ' ')}`)
      const codes = [...r.raw.matchAll(/"(\d{6})"/g)].map((m) => m[1]).filter((c) => /^[03456]/.test(c))
      if (codes.length >= 5) {
        console.log(`    ✓ 含 ${new Set(codes).size} 个A股代码样本: ${[...new Set(codes)].slice(0, 8).join(' ')}`)
        memberCodes.push(...new Set(codes))
      }
      await new Promise((rs) => setTimeout(rs, 400))
    }
    // 成分K线回查(等权重构路径)
    if (memberCodes.length >= 3) {
      console.log('\n  成分K线回查(3只):')
      let okCount = 0
      for (const code of memberCodes.slice(0, 3)) {
        try {
          const { klines } = await fetchStockKline(code, 101, 60)
          const ok = klines.length > 30
          if (ok) okCount++
          console.log(`    ${code}: ${ok ? `✓ ${klines.length}根` : '✗ 不足'}`)
        } catch {
          console.log(`    ${code}: ✗ 取数失败`)
        }
      }
      console.log(`  → K线回查 ${okCount}/3 ${okCount === 3 ? '✓' : '✗'}`)
    }
  }

  // P3: 频控
  console.log('\n━━━ P3 频控(500ms×10连击列表A) ━━━')
  let blocked = 0
  for (let i = 0; i < 10; i++) {
    const r = await kplPost(LIST_CANDIDATES[0].params)
    if (r.status !== 200 || /风控|拒绝|forbid|blocked/i.test(r.raw)) blocked++
    await new Promise((rs) => setTimeout(rs, 500))
  }
  console.log(`  异常 ${blocked}/10 ${blocked === 0 ? '✓' : '✗'}`)

  console.log('\n━━━ 汇总 ━━━')
  console.log(`  P1 列表: ${plateIds.length > 0 ? '疑似可用(人工核对上方样本名称是否真题材)' : '✗ 候选全部未命中'}`)
  console.log(`  P2 成分: ${memberCodes.length >= 5 ? '疑似可用' : '✗'}`)
  console.log(`  P3 频控: ${blocked === 0 ? '✓' : '✗'}`)
  console.log('  → 全过则把可用的 c/a 参数填进 kplThemes.ts 并翻 KPL_THEMES 门控;任一不过保持东财单源。')
  console.log('  ⚠ RealRanking 系接口盘后 list 恒空(2026-07-10 21:00 实测)——若本次为盘后运行且 P1/P2 ✗,')
  console.log('    请在交易时段(9:30-15:00)复测后再下最终裁决;F(涨停复盘题材)盘后可用但成分仅当日涨停股,')
  console.log('    有偏样本不能做等权重构基底,只能当"题材taxonomy+涨停归因"的辅助数据源。')
}

main()
