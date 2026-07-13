import { describe, expect, it } from 'vitest'
import {
  buildClsUrl,
  mergeFlashItems,
  normalizeCls,
  normalizeEastmoney,
  normalizeFlashTitle,
  normalizeSina,
  shanghaiToIso,
  splitBracketTitle,
  type NewsFlashItem,
} from './newsFlashNormalize'

// fixture 取自 2026-07-07 实抓响应(字段与嵌套与线上一致,内容精简)
const EM_RAW = {
  code: '1',
  message: 'success',
  data: {
    sortEnd: '1783412741021714',
    fastNewsList: [
      {
        summary: '【光库科技:预计上半年净利大增】光库科技7月7日公告,预计2026年上半年归母净利润1.4亿元-1.5亿元。',
        code: '202607073796727742',
        titleColor: 0,
        showTime: '2026-07-07 16:28:24',
        title: '光库科技:预计上半年净利大增',
        stockList: ['0.300620'],
      },
      {
        summary: '重要会议召开,部署下半年经济工作。',
        code: '202607073796730045',
        titleColor: 2,
        showTime: '2026-07-07 16:30:00',
        title: '重要会议召开',
        stockList: ['150.012322', '90.BK1560', '1.603132'],
      },
    ],
  },
}

const SINA_RAW = {
  result: {
    status: { code: 0 },
    data: {
      feed: {
        list: [
          {
            id: 4973888,
            rich_text: '【波士顿动力机器人亮相世界杯】人形机器人 Atlas 走上世界杯赛场。',
            create_time: '2026-07-07 16:31:33',
            tag: [{ id: '10', name: '焦点' }],
            ext: '{"stocks":[{"market":"cn","symbol":"sz300024","key":"机器人"},{"market":"foreign","symbol":"fx_scnhusd"}],"docurl":"https://finance.sina.com.cn/7x24/doc-x.shtml"}',
            docurl: 'https://finance.sina.cn/7x24/detail-x.d.html',
          },
          {
            id: 4973887,
            rich_text: '在岸人民币兑美元收盘报6.7956,较上一交易日下降31点。',
            create_time: '2026-07-07 16:30:45',
            tag: [{ id: '5', name: '市场' }],
            ext: '{invalid json',
          },
        ],
      },
    },
  },
}

describe('shanghaiToIso', () => {
  it('converts Shanghai local time string to ISO with +08:00', () => {
    expect(shanghaiToIso('2026-07-07 16:28:24')).toBe('2026-07-07T16:28:24+08:00')
  })
  it('rejects malformed input', () => {
    expect(shanghaiToIso('2026/07/07')).toBeNull()
    expect(shanghaiToIso(undefined)).toBeNull()
    expect(shanghaiToIso(1234)).toBeNull()
  })
})

describe('splitBracketTitle', () => {
  it('splits 【title】body', () => {
    expect(splitBracketTitle('【标题】正文内容')).toEqual({ title: '标题', rest: '正文内容' })
  })
  it('returns empty title without bracket prefix', () => {
    expect(splitBracketTitle('纯正文')).toEqual({ title: '', rest: '纯正文' })
  })
})

describe('normalizeEastmoney', () => {
  const items = normalizeEastmoney(EM_RAW)

  it('maps fields and strips duplicated 【title】 from summary', () => {
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'em-202607073796727742',
      time: '2026-07-07T16:28:24+08:00',
      title: '光库科技:预计上半年净利大增',
      source: 'eastmoney',
      important: false,
    })
    expect(items[0].summary).not.toContain('【')
    expect(items[0].summary).toContain('光库科技7月7日公告')
  })

  it('flags titleColor >= 2 as important', () => {
    expect(items[1].important).toBe(true)
  })

  it('keeps only A-share secids (market 0/1, 6-digit)', () => {
    expect(items[0].stocks).toEqual([{ code: '300620' }])
    expect(items[1].stocks).toEqual([{ code: '603132' }]) // 150.x 基金 / 90.BK 板块被丢弃
  })

  it('returns [] on malformed payloads without throwing', () => {
    expect(normalizeEastmoney(null)).toEqual([])
    expect(normalizeEastmoney({})).toEqual([])
    expect(normalizeEastmoney({ data: { fastNewsList: 'nope' } })).toEqual([])
    expect(normalizeEastmoney({ data: { fastNewsList: [null, 42, { title: '无时间' }] } })).toEqual([])
  })
})

describe('normalizeSina', () => {
  const items = normalizeSina(SINA_RAW)

  it('splits 【title】 rich_text and parses ext stocks (cn only)', () => {
    expect(items[0]).toMatchObject({
      id: 'sina-4973888',
      time: '2026-07-07T16:31:33+08:00',
      title: '波士顿动力机器人亮相世界杯',
      source: 'sina',
      important: true, // tag 焦点
      url: 'https://finance.sina.cn/7x24/detail-x.d.html',
    })
    expect(items[0].stocks).toEqual([{ code: '300024' }]) // foreign 市场被丢弃
  })

  it('uses body as title when no bracket prefix, tolerates broken ext json', () => {
    expect(items[1].title).toContain('在岸人民币')
    expect(items[1].summary).toBe('')
    expect(items[1].important).toBe(false)
    expect(items[1].stocks).toEqual([])
  })

  it('returns [] on malformed payloads without throwing', () => {
    expect(normalizeSina(null)).toEqual([])
    expect(normalizeSina({ result: {} })).toEqual([])
  })

  it('falls back to time+title id for empty-string ids (no duplicate React keys)', () => {
    const raw = {
      result: {
        data: {
          feed: {
            list: [
              { id: '', rich_text: '第一条快讯正文', create_time: '2026-07-07 16:00:00' },
              { id: '', rich_text: '第二条快讯正文', create_time: '2026-07-07 16:00:00' },
            ],
          },
        },
      },
    }
    const ids = normalizeSina(raw).map((it) => it.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    expect(ids.every((id) => id.startsWith('sina-2026-07-07T16:00:00'))).toBe(true)
  })
})

// fixture 取自 2026-07-14 实抓响应(字段与嵌套与线上一致,内容精简)
const CLS_RAW = {
  errno: 0,
  msg: '',
  data: {
    roll_data: [
      {
        id: 2425034,
        ctime: 1783952870,
        level: 'B',
        title: '盘后A股上市公司重点业绩公告精选',
        brief: '【盘后A股上市公司重点业绩公告精选】财联社7月13日电,据财联社不完全统计,多家A股上市公司发布2026年半年度业绩预告。',
        content: '',
        is_ad: 0,
        shareurl: 'https://api3.cls.cn/share/article/2425034?os=web',
        stock_list: [
          { StockID: 'sh688183', name: '生益电子', RiseRange: -9.75, last: 111.01 },
          { StockID: 'sz002185', name: '华天科技', RiseRange: -4.66, last: 24.13 },
          { StockID: 'sh688183', name: '生益电子(重复)' },
          { StockID: 'hk00700', name: '腾讯控股' },
        ],
      },
      {
        id: 2425159,
        ctime: 1783964368,
        level: 'C',
        title: '沙特称应对胡塞武装导弹',
        brief: '【沙特称应对胡塞武装导弹】财联社7月14日电,由沙特主导的多国联军表示…',
        content: '',
        is_ad: 0,
        shareurl: '',
        stock_list: [],
      },
      { id: 999, ctime: 1783964000, level: 'C', title: '', brief: '推广内容', is_ad: 1, stock_list: [] },
    ],
  },
}

describe('normalizeCls', () => {
  const items = normalizeCls(CLS_RAW)

  it('maps fields: brief 拆【标题】、ctime 转上海 ISO、level B 记要闻、shareurl 为 url', () => {
    expect(items).toHaveLength(2) // is_ad=1 的推广条被剔除
    const [biz, war] = items
    expect(biz.id).toBe('cls-2425034')
    expect(biz.time).toBe('2026-07-13T22:27:50+08:00')
    expect(biz.title).toBe('盘后A股上市公司重点业绩公告精选')
    expect(biz.summary).toContain('财联社7月13日电')
    expect(biz.summary).not.toContain('【')
    expect(biz.source).toBe('cls')
    expect(biz.important).toBe(true) // level B = 加粗要闻
    expect(biz.url).toBe('https://api3.cls.cn/share/article/2425034?os=web')
    expect(war.time).toBe('2026-07-14T01:39:28+08:00')
    expect(war.important).toBe(false) // level C
    expect(war.url).toBeUndefined() // 空 shareurl 不带
  })

  it('parses stock_list: sh/sz 前缀取 6 位码并带股票名,去重,非 A 股(hk)丢弃', () => {
    expect(items[0].stocks).toEqual([
      { code: '688183', name: '生益电子' },
      { code: '002185', name: '华天科技' },
    ])
  })

  it('returns [] on malformed payloads without throwing', () => {
    expect(normalizeCls(null)).toEqual([])
    expect(normalizeCls({})).toEqual([])
    expect(normalizeCls({ data: { roll_data: 'nope' } })).toEqual([])
    expect(normalizeCls({ data: { roll_data: [{ id: 1 }] } })).toEqual([]) // 无 ctime/正文
  })
})

describe('buildClsUrl', () => {
  it('生成带本地签名的 v1 roll URL(sign=md5(sha1(字典序query)),已知值锁定防回归)', () => {
    const url = buildClsUrl(50)
    expect(url).toBe(
      'https://www.cls.cn/v1/roll/get_roll_list?appName=CailianpressWeb&last_time=&os=web&refresh_type=1&rn=50&sv=7.7.5&sign=b849fe86598f3ceca205eda7b33a49a1',
    )
  })
})

describe('mergeFlashItems', () => {
  const mk = (over: Partial<NewsFlashItem>): NewsFlashItem => ({
    id: 'x',
    time: '2026-07-07T16:00:00+08:00',
    title: '标题',
    summary: '',
    source: 'eastmoney',
    important: false,
    stocks: [],
    ...over,
  })

  it('dedupes same title within 5-min bucket, first list wins', () => {
    const em = mk({ id: 'em-1', title: '央行宣布降准0.5个百分点', time: '2026-07-07T16:00:00+08:00' })
    const sina = mk({
      id: 'sina-1',
      source: 'sina',
      title: '央行宣布降准0.5个百分点!',
      time: '2026-07-07T16:02:00+08:00',
    })
    const merged = mergeFlashItems([[em], [sina]])
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('em-1')
  })

  it('keeps same title in different time buckets', () => {
    const a = mk({ id: 'a', time: '2026-07-07T16:00:00+08:00' })
    const b = mk({ id: 'b', time: '2026-07-07T17:00:00+08:00' })
    expect(mergeFlashItems([[a], [b]])).toHaveLength(2)
  })

  it('sorts by time desc and caps at limit', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      mk({ id: `i${i}`, title: `新闻${i}`, time: `2026-07-07T0${i % 10}:00:00+08:00` }),
    )
    const merged = mergeFlashItems([items], 5)
    expect(merged).toHaveLength(5)
    expect(Date.parse(merged[0].time)).toBeGreaterThan(Date.parse(merged[4].time))
  })

  it('normalizeFlashTitle normalizes punctuation and whitespace', () => {
    expect(normalizeFlashTitle('央行:宣布 降准')).toBe(normalizeFlashTitle('央行宣布降准'))
  })
})
