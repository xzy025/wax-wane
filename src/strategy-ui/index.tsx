// 私有战法层的**前端挂载点**。
//
// 背景：选股器 / 板块轮动 / 研报面板 的视图带战法口径（阈值、评分、榜单口径），
// 属私有层。但公开仓库要在不装私有包的前提下 `npm run build` 通过，所以不能
// 直接 `import './views/ScreenerView'` —— 那会是一个 TS2307 + Vite 解析失败。
//
// 做法：`import.meta.glob` 按**固定名单**扫 `../views/*.tsx`。**glob 匹配不到文件时
// 返回空对象、不报错**（已实测）。私有层安装时把这些视图放回它们在 `src/views/`
// 的原始路径，公开侧就自动用真面板；没装则回退到占位组件，路由仍在、只提示未启用。
//
// 为什么坚持「原始路径」而不是另建一个 panels/ 目录：视图内部有大量相对 import
// （`../hooks/useScreener`、`../components/...`）。换个目录就得改写全部相对路径，
// 那是纯负债。放在原路径 = 私有层是公开层的**超集工作树**，复制即可，零改写。
//
// 边界：本文件不 import 任何私有路径，只按文件名查表。

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { PuzzlePiece } from 'phosphor-react'

/** 面板 props 由公开侧的路由决定；私有面板需按同一组 props 实现。 */
export type StrategyPanelProps = Record<string, unknown>

/** 允许挂载的策略面板名单。写死而不是通配 —— 通配会把所有公开视图都切成异步 chunk。 */
const registry = import.meta.glob<{ default: ComponentType<StrategyPanelProps> }>(
  '../views/{ScreenerView,RotationView,ResearchPanel}.tsx',
)

function Placeholder({ name, language }: { name: string; language?: 'zh' | 'en' }) {
  const isEn = language === 'en'
  return (
    <section className="view-stack strategy-view">
      <div className="strategy-placeholder" role="status">
        <span className="strategy-placeholder-icon"><PuzzlePiece size={22} aria-hidden="true" /></span>
        <div className="strategy-placeholder-copy">
          <div className="strategy-placeholder-heading">
            <strong>{name}</strong>
            <span>{isEn ? 'Not mounted' : '未挂载'}</span>
          </div>
          <h2>{isEn ? 'Private strategy panel is not connected' : '私有战法面板暂未接入'}</h2>
          <p>
            {isEn
              ? 'Navigation and the data contract are ready; mount the strategy package to show scan results.'
              : '当前部署保留导航和数据契约，等待对应策略包挂载后显示完整扫描结果。'}
          </p>
          <p className="strategy-placeholder-hint">
            {isEn ? 'Place the same-named view back in ' : '将同名视图放回 '}<code>src/views/</code>{isEn ? ' to mount it automatically.' : ' 原路径即可自动挂载。'}
          </p>
        </div>
      </div>
    </section>
  )
}

/**
 * 取一个策略面板组件。
 *
 * @param name 视图文件名（不含扩展名），如 `ScreenerView` →
 *             `src/views/ScreenerView.tsx`。未安装时返回占位组件。
 */
export function strategyView(name: string): LazyExoticComponent<ComponentType<StrategyPanelProps>> {
  const loader = registry[`../views/${name}.tsx`]
  if (!loader) {
    return lazy(async () => ({ default: (props: StrategyPanelProps) => <Placeholder name={name} language={props.language as 'zh' | 'en' | undefined} /> }))
  }
  return lazy(loader)
}

/** 当前构建里挂载了哪些策略面板（供诊断/导航显隐使用）。 */
export function mountedStrategyPanels(): string[] {
  return Object.keys(registry)
    .map((key) => key.replace('../views/', '').replace(/\.tsx$/, ''))
    .sort()
}
