// 上海时区日期的唯一实现。此前 todayShanghai/todayStr 在 5 个服务里各抄一份,
// 其中 3 份把 getTimezoneOffset 算术(本地 getter 读法的配套)接到了 toISOString
// (UTC getter)上,时区偏移被双算:中国机器上凌晨 0-8 点错一天,UTC-7 进程直接
// 漂到明天。统一为纯 UTC 算术,与进程时区彻底解耦。
// (分钟级时钟见 lib/cache.ts shanghaiClock,那份本地 getter 写法是正确的。)

/** 今天的上海日(YYYY-MM-DD);上海固定 UTC+8 无夏令时。可注入 nowMs 便于测试。 */
export function todayShanghai(nowMs: number = Date.now()): string {
  return new Date(nowMs + 8 * 3_600_000).toISOString().slice(0, 10)
}
