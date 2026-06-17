// 主流板块注册表（单一事实来源）。
// 以后新增/调整板块或成分股，只改这个文件即可——前端「板块」tab 会自动反映。
// constituents.code: 6 位 A 股代码（也支持港股 5 位 / 美股字母，见 emQuotes.toSecids）。
// constituents.label: 细分标注（人工维护，低频；如「海缆」「覆铜板」），可留空。
// peers: 海外可比龙头（美/日/韩/港/台），点开板块时与 A 股成分股并列对照。
//   peers.code: 按 market 取交易所代码——US=字母代码；HK/JP/KR/TW=数字代码。
//   行情「尽力而为」：美股/港股有东财通道带实时价；韩/日/台暂为对照（价格显示「—」）。

export interface ThemeConstituent {
  code: string
  label: string
}

export type PeerMarket = 'US' | 'HK' | 'JP' | 'KR' | 'TW'

export interface OverseasPeer {
  market: PeerMarket
  code: string // US=字母代码（如 MU）；HK/JP/KR/TW=数字代码（如 1888 / 6981 / 000660 / 2327）
  name: string // 中文名
  nameEn: string
  label?: string // 细分（如 DRAM龙头 / 被动元件）
}

export interface ThemeDef {
  id: string
  name: string
  nameEn: string
  blurb: string
  constituents: ThemeConstituent[]
  peers?: OverseasPeer[]
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
    peers: [
      { market: 'US', code: 'GLW', name: '康宁', nameEn: 'Corning', label: '光纤+玻璃基板' },
      { market: 'US', code: 'FN', name: '富纳康', nameEn: 'Fabrinet', label: '光器件代工' },
    ],
  },
  {
    id: 'pcb-copper',
    name: '铜箔/覆铜板',
    nameEn: 'CCL & Copper Foil',
    blurb: 'PCB 上游：电子铜箔 / 覆铜板(CCL) / PCB化学品',
    constituents: [
      { code: '301217', label: '电子铜箔' }, // 铜冠铜箔
      { code: '301176', label: '电子铜箔' }, // 逸豪新材
      { code: '600110', label: '锂电铜箔' }, // 诺德股份
      { code: '002585', label: '复合铜箔' }, // 双星新材
      { code: '603186', label: '覆铜板' }, // 华正新材
      { code: '600183', label: '覆铜板全球前二' }, // 生益科技
      { code: '688519', label: '高频高速CCL' }, // 南亚新材
      { code: '002636', label: '中厚型FR-4 CCL' }, // 金安国纪
      { code: '002741', label: 'PCB化学品/电镀' }, // 光华科技
    ],
    peers: [
      { market: 'HK', code: '1888', name: '建滔积层板', nameEn: 'Kingboard Laminates', label: '覆铜板龙头' },
      { market: 'JP', code: '4062', name: '揖斐电', nameEn: 'Ibiden', label: 'IC载板/CCL' },
    ],
  },
  {
    id: 'pcb-makers',
    name: 'PCB龙头',
    nameEn: 'PCB Leaders',
    blurb: 'PCB 成品制造龙头：AI服务器 / 高端通信 / FPC',
    constituents: [
      { code: '300476', label: 'AI服务器PCB龙头(NV GB200/300)' }, // 胜宏科技
      { code: '002463', label: '高端通信/AI PCB(NV 78层背板)' }, // 沪电股份
      { code: '002938', label: '全球PCB营收9连冠/FPC' }, // 鹏鼎控股
      { code: '002916', label: '通信PCB+FC-BGA载板' }, // 深南电路
      { code: '002384', label: 'FPC巨头+EML光芯片/CPO(双修)' }, // 东山精密
      { code: '603228', label: '全品类PCB平台' }, // 景旺电子
      { code: '688183', label: 'AI服务器PCB(生益系)' }, // 生益电子
    ],
    peers: [
      { market: 'TW', code: '4958', name: '臻鼎-KY', nameEn: 'Zhen Ding Tech', label: 'PCB/FPC龙头' },
      { market: 'TW', code: '3037', name: '欣兴电子', nameEn: 'Unimicron', label: 'IC载板' },
      { market: 'JP', code: '6787', name: '名幸电子', nameEn: 'Meiko', label: 'PCB制造' },
      { market: 'US', code: 'TTMI', name: 'TTM科技', nameEn: 'TTM Technologies', label: '美最大PCB/AI国防' },
    ],
  },
  {
    id: 'pcb-resin-fabric',
    name: 'PCB树脂和电子布',
    nameEn: 'PCB Resin & Glass Fabric',
    blurb: 'PCB 上游材料：电子树脂 / 电子布 / 低介电玻纤',
    constituents: [
      { code: '603002', label: '环氧树脂+覆铜板一体化' }, // 宏昌电子
      { code: '605589', label: 'PPO/特种环氧 高频高速树脂' }, // 圣泉集团
      { code: '601208', label: '高速电子树脂(M9级)' }, // 东材科技（玻璃基板移入）
      { code: '603256', label: '超薄电子布龙头/低介电' }, // 宏和科技
      { code: '600176', label: '低介电玻纤龙头' }, // 中国巨石
      { code: '002080', label: '电子布/玻纤(产能最大)' }, // 中材科技
    ],
    peers: [
      { market: 'JP', code: '3110', name: '日东纺', nameEn: 'Nittobo', label: '电子布(T-Glass)全球龙头' },
    ],
  },
  {
    id: 'cpo-optics',
    name: 'CPO/光模块',
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
      { code: '002384', label: 'EML光芯片/光模块(并购Solus)' }, // 东山精密（PCB+CPO双修，同见 pcb-makers）
    ],
    peers: [
      { market: 'US', code: 'COHR', name: '相干', nameEn: 'Coherent', label: '光器件/激光' },
      { market: 'US', code: 'LITE', name: 'Lumentum', nameEn: 'Lumentum', label: '光模块/光芯片' },
      { market: 'US', code: 'FN', name: '富纳康', nameEn: 'Fabrinet', label: '光模块代工' },
    ],
  },
  {
    id: 'compute-leasing',
    name: '算力租赁',
    nameEn: 'Compute Leasing',
    blurb: 'AI 算力租赁 / 智算中心 / GPU 服务器出租 / IDC',
    constituents: [
      { code: '301396', label: '算力租赁双雄/智算服务' }, // 宏景科技（用户口中的「宏景电子」）
      { code: '300857', label: '算力租赁龙头/GPU服务器' }, // 协创数据
      { code: '603629', label: '算力租赁/液冷' }, // 利通电子
      { code: '002229', label: '英伟达算力/智算中心' }, // 鸿博股份
      { code: '603220', label: '算力(英伟达+华为)' }, // 中贝通信
      { code: '603881', label: 'IDC龙头(腾讯)' }, // 数据港
      { code: '300442', label: '智算中心/IDC' }, // 润泽科技
      { code: '600186', label: 'GPU服务器/算力租赁' }, // 莲花控股
    ],
    peers: [
      { market: 'US', code: 'CRWV', name: 'CoreWeave', nameEn: 'CoreWeave', label: 'GPU云/neocloud龙头' },
      { market: 'US', code: 'NBIS', name: 'Nebius', nameEn: 'Nebius', label: 'AI算力云' },
    ],
  },
  {
    id: 'memory',
    name: '存储',
    nameEn: 'Memory & Storage',
    blurb: '存储产业链：DRAM / NAND / 存储主控 / 模组',
    constituents: [
      { code: '603986', label: 'NORFlash/利基' },
      { code: '300223', label: '车规存储' },
      { code: '301308', label: '存储模组' },
      { code: '688525', label: '存储模组' },
      { code: '688766', label: 'NORFlash' },
      { code: '688110', label: 'NANDFlash' },
      { code: '001309', label: '存储主控/模组' },
      { code: '300475', label: '存储分销' },
      { code: '000021', label: '存储封测/模组' },
    ],
    peers: [
      { market: 'US', code: 'MU', name: '美光', nameEn: 'Micron', label: 'DRAM/NAND三巨头' },
      { market: 'KR', code: '000660', name: 'SK海力士', nameEn: 'SK Hynix', label: 'DRAM/HBM龙头' },
      { market: 'KR', code: '005930', name: '三星电子', nameEn: 'Samsung Electronics', label: 'DRAM/NAND龙头' },
      { market: 'US', code: 'WDC', name: '西部数据', nameEn: 'Western Digital', label: 'NAND/硬盘' },
      { market: 'JP', code: '285A', name: '铠侠', nameEn: 'Kioxia', label: 'NAND龙头' },
    ],
  },
  {
    id: 'mlcc',
    name: 'MLCC',
    nameEn: 'MLCC',
    blurb: '片式多层陶瓷电容（MLCC）/ 被动元件',
    constituents: [
      { code: '300408', label: 'MLCC龙头' },
      { code: '000636', label: 'MLCC' },
      { code: '002859', label: '载带/离型膜' },
      { code: '603267', label: '军用MLCC' },
      { code: '603678', label: '军用MLCC' },
      { code: '300726', label: '军用电容' },
      { code: '002138', label: '电感/被动元件' },
    ],
    peers: [
      { market: 'JP', code: '6981', name: '村田制作所', nameEn: 'Murata', label: 'MLCC全球龙头' },
      { market: 'JP', code: '6762', name: 'TDK', nameEn: 'TDK', label: '被动元件' },
      { market: 'JP', code: '6976', name: '太阳诱电', nameEn: 'Taiyo Yuden', label: 'MLCC' },
      { market: 'TW', code: '2327', name: '国巨', nameEn: 'Yageo', label: 'MLCC/被动元件' },
      { market: 'KR', code: '009150', name: '三星电机', nameEn: 'Samsung Electro-Mechanics', label: 'MLCC' },
    ],
  },
  {
    id: 'glass-substrate',
    name: '玻璃基板',
    nameEn: 'Glass Substrate',
    blurb: '玻璃基载板 / 先进封装基板 / 显示玻璃',
    constituents: [
      { code: '603773', label: '玻璃基板/TGV' },
      { code: '600552', label: '显示玻璃/UTG' },
      { code: '300088', label: '减薄/镀膜' },
      { code: '688300', label: '封装材料' },
      { code: '002876', label: '偏光片' },
    ],
    peers: [
      { market: 'US', code: 'GLW', name: '康宁', nameEn: 'Corning', label: '显示/载板玻璃龙头' },
      { market: 'JP', code: '5201', name: 'AGC旭硝子', nameEn: 'AGC', label: '玻璃基板' },
      { market: 'JP', code: '5214', name: '日本电气硝子', nameEn: 'Nippon Electric Glass', label: '特种玻璃' },
    ],
  },
]
