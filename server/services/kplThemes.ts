// 开盘啦「精选题材」适配层 —— 节奏表的第二分类源(游资主线粒度,如「华为昇腾」)。
// 复用 kaipanla.ts 的匿名口(apphq.longhuvip.com,固定 DeviceID/UserID=0/Token=0)。
//
// ⚠ 当前为接口壳:具体 c/a 参数须先跑 `npm --prefix server run probe:kpl` 在宿主网络验证
// (题材列表≥10个真题材语义/每题材≥5个A股码且K线回查通/10连击无风控),探针 PASS 后填实装
// 并把 KPL_THEMES 门控翻默认开。探针 FAIL 则保持壳=节奏表只上东财源,零改主链路。
export interface KplTheme {
  id: string
  name: string
  stocks: { code: string; name: string }[]
}

/** env 门控:默认关;探针 PASS 后实装时翻为 !== '0'(默认开)。 */
export function isKplThemesEnabled(): boolean {
  return process.env.KPL_THEMES === '1'
}

/** 精选题材列表(含成分)。未启用/未实装/失败 → []。 */
export async function fetchKplThemes(): Promise<KplTheme[]> {
  if (!isKplThemesEnabled()) return []
  // TODO(probe:kpl PASS 后实装):题材列表 + 成分接口,30min 缓存,失败 → []
  console.warn('[KplThemes] 已开启门控但适配层未实装(等 probe:kpl 验证),返回空')
  return []
}
