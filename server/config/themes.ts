// 主流题材注册表（单一事实来源）。
// 以后新增/调整题材或成分股，只改这个文件即可——前端「题材」tab 会自动反映。
// constituents.code: 6 位 A 股代码（也支持港股 5 位 / 美股字母，见 emQuotes.toSecids）。
// constituents.label: 细分标注（人工维护，低频；如「海缆」「覆铜板」），可留空。

export interface ThemeConstituent {
  code: string
  label: string
}

export interface ThemeDef {
  id: string
  name: string
  nameEn: string
  blurb: string
  constituents: ThemeConstituent[]
}

export const THEMES: ThemeDef[] = [
  {
    id: 'optical-fiber',
    name: '光纤光缆',
    nameEn: 'Optical Fiber',
    blurb: '光纤光缆 / 海缆 / 光通信',
    constituents: [
      { code: '600522', label: '海缆+光纤' },
      { code: '600487', label: '海缆+电力' },
      { code: '601869', label: '光纤龙头' },
      { code: '600498', label: '光通信设备' },
      { code: '002491', label: '光纤光缆' },
      { code: '600105', label: '光棒+超导' },
      { code: '688635', label: '光子器件' },
    ],
  },
  {
    id: 'pcb-copper',
    name: '铜箔/覆铜板/PCB',
    nameEn: 'PCB & Copper Foil',
    blurb: 'PCB 产业链：铜箔 / 树脂 / 电子布 / 覆铜板 / PCB 制造',
    constituents: [
      { code: '301217', label: '电子铜箔' },
      { code: '301176', label: '电子铜箔' },
      { code: '600110', label: '锂电铜箔' },
      { code: '002585', label: '复合铜箔' },
      { code: '603186', label: '覆铜板' },
      { code: '603002', label: '环氧树脂' },
      { code: '002741', label: 'PCB化学品' },
      { code: '002436', label: 'PCB/载板' },
      { code: '603175', label: 'PCB' },
      { code: '300964', label: 'PCB' },
      { code: '300476', label: 'PCB龙头' },
    ],
  },
  {
    id: 'cpo-optics',
    name: '算力/CPO/光模块',
    nameEn: 'CPO & Optical Modules',
    blurb: 'AI 算力光互联：光模块 / CPO / 光器件',
    constituents: [
      { code: '300308', label: '光模块龙头' },
      { code: '300502', label: '光模块' },
      { code: '300394', label: '光器件' },
      { code: '002281', label: '光模块' },
      { code: '300570', label: '光连接' },
      { code: '603083', label: '光模块' },
      { code: '688313', label: '光芯片' },
    ],
  },
]
