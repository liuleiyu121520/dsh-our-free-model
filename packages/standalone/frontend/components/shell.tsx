import { Activity, Boxes, Cable, ChevronRight, Handshake, LayoutDashboard, LogOut, Moon, Network, Settings2, ShieldCheck, Sun, Monitor, PanelsTopLeft, LibraryBig, Route, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { Badge, Button } from './ui'
import type { Host, Page, Summary } from '../types'
import { hasDesktopBridge } from '../desktop-update'

const navigation = [
  { label: '免费模型', items: [
    { id: 'models', name: '模型与开关', icon: Boxes },
    { id: 'channels', name: '账号渠道', icon: Network },
    { id: 'connection', name: '网关与 API 接入', icon: Cable },
    { id: 'requests', name: '请求日志', icon: Activity },
  ] },
  { label: '工作空间', items: [
    { id: 'overview', name: '概览', icon: LayoutDashboard },
    { id: 'workspace', name: '模型工作台', icon: PanelsTopLeft },
    { id: 'agents', name: '客户端与订阅', icon: Monitor },
    { id: 'usage', name: '用量统计', icon: Activity },
    { id: 'library', name: '资源库', icon: LibraryBig },
  ] },
  { label: '渠道与连接', items: [
    { id: 'providers', name: '聚合渠道', icon: PanelsTopLeft },
    { id: 'routing', name: '路由组', icon: Route },
    { id: 'eac', name: 'EAC 协付渠道', icon: Handshake },
  ] },
  { label: '管理', items: [{ id: 'settings', name: '服务设置', icon: Settings2 }, { id: 'updates', name: '应用更新', icon: RotateCw }] },
] as const

/** 精简页面：新机器上只需要「登账号、挑模型、拿网关地址」三件事。
 *  模型清单已经并入「网关与 API 接入」页（在页面里选模型），所以独立的
 *  「模型与开关」页不再属于精简导航。 */
const LITE_PAGES: ReadonlySet<string> = new Set(['channels', 'connection', 'requests'])

/**
 * 侧边栏能到达的每一个页面，按侧边栏顺序排列。
 *
 * `App` 用它当导航白名单：不在这份名单里的页面会被 `host.navigate` **静默丢弃**。
 * 此前 `app.tsx` 自己又写了一份同样的数组，两份一漂移就出了「模型工作台」
 * 点了没反应 —— 侧边栏有这一项、白名单里没有，`navigate('workspace')` 直接被
 * `includes` 短路，无报错、无 loading、内容区不切换（#678）。
 *
 * 从侧边栏**推导**而不是重述，是让这两份永远不可能再漂移的唯一办法。
 */
export const navigationPages: Page[] = navigation.flatMap(group => group.items.map(item => item.id))

/**
 * 精简模式下真正能点到的页面。
 *
 * 仍然从 `navigation` 推导、只是多加一道 `LITE_PAGES` 过滤，所以「侧边栏列出什么
 * 就能点到什么」这条不变量不变：白名单永远是侧边栏的函数，不是另写的一份名单。
 * `lite` 缺省为 false，因此插件与 `--full` 启动的行为完全不变。
 */
export const liteNavigationPages = (lite: boolean): Page[] =>
  lite ? navigationPages.filter(page => LITE_PAGES.has(page)) : navigationPages

type Origin = { x: number; y: number }

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const apply = (next: 'light' | 'dark') => {
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('ofm-theme', next) } catch { /* 存储不可用时仅本次会话生效 */ }
    setTheme(next)
  }
  const toggle = (origin?: Origin) => {
    const next = theme === 'dark' ? 'light' : 'dark'
    // 没有 View Transition、或用户要求减少动效时直接切换，不做扩散。
    if (!origin || typeof document.startViewTransition !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(next); return }
    const root = document.documentElement
    // 半径取按钮中心到视口最远角的距离，保证圆盘一定盖满整屏。
    const radius = Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y))
    root.style.setProperty('--theme-reveal-x', `${origin.x}px`)
    root.style.setProperty('--theme-reveal-y', `${origin.y}px`)
    root.style.setProperty('--theme-reveal-r', `${radius}px`)
    // 扩散期间关掉 300ms 的底色过渡，否则"新主题"快照会抓到过渡中间色。
    root.classList.add('theme-transitioning')
    const transition = document.startViewTransition(() => { flushSync(() => apply(next)) })
    const finish = () => {
      root.classList.remove('theme-transitioning')
      root.style.removeProperty('--theme-reveal-x')
      root.style.removeProperty('--theme-reveal-y')
      root.style.removeProperty('--theme-reveal-r')
    }
    transition.finished.then(finish, finish)
  }
  return { theme, toggle }
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'
  return <Button variant="ghost" className="theme-toggle" aria-label={label} title={theme === 'dark' ? '浅色' : '深色'}
    onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); toggle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) }}>
    <span className="theme-toggle-track" data-theme={theme}>
      <span className="theme-toggle-icon theme-toggle-sun" aria-hidden="true"><Sun size={16} /></span>
      <span className="theme-toggle-icon theme-toggle-moon" aria-hidden="true"><Moon size={16} /></span>
    </span>
  </Button>
}

export const pageNames: Record<Page, string> = {
  overview: '概览', workspace: '模型工作台', models: '模型与开关', usage: '用量统计',
  channels: '账号渠道', agents: '客户端与订阅', providers: '聚合渠道', library: '资源库', routing: '路由组',
  eac: 'EAC 协付渠道', settings: '服务设置', updates: '应用更新', connection: '网关与 API 接入', requests: '请求日志',
}

export function Sidebar({ page, summary, host, lite = false, onDisclaimer }: { page: Page; summary?: Summary; host: Host; lite?: boolean; onDisclaimer(): void }) {
  return <>
    <div className="console-brand">
      <span className="console-brand-title">{lite ? '本地模型网关' : '本地模型控制台'}<small>{lite ? '账号渠道 · 模型 · 接入' : ''}</small></span>
    </div>
    <div className="workspace-switch"><span className="workspace-avatar"><ShieldCheck size={17} /></span>
      <span>个人工作空间<small>独立本地服务</small></span><Badge>本机</Badge>
    </div>
    <nav className="console-nav" aria-label="管理导航">{navigation
      // ⚠️ 先按分组过滤**条目**，再丢掉整组为空的。
      // 早先只过滤了条目、`navigation.map` 照旧渲染外层 `div` 与 `nav-group-label`，
      // 结果 lite 模式下「工作空间 / 渠道与连接 / 管理」三个标题留在侧栏里，
      // 下面没有任何可点的东西 —— 看起来像加载失败。
      .map(group => ({
        label: group.label,
        items: group.items.filter(item => (!lite || LITE_PAGES.has(item.id)) && (item.id !== 'updates' || hasDesktopBridge())),
      }))
      .filter(group => group.items.length > 0)
      .map(group => <div className="nav-group" key={group.label}>
        <span className="nav-group-label">{group.label}</span>
        {group.items.map(item => <button key={item.id} className={`console-nav-item ${page === item.id ? 'selected' : ''}`}
          aria-current={page === item.id ? 'page' : undefined} onClick={() => host.navigate(item.id)}>
          <span className="console-nav-indicator" aria-hidden="true" />
          <item.icon size={18} strokeWidth={1.7} /><span>{item.name}</span>
          {item.id === 'models' && <span className="count-badge">{summary?.catalog.length ?? '—'}</span>}
        </button>)}
      </div>)}</nav>
    <div className="sidebar-support"><ShieldCheck size={17} /><div><strong>独立本地存储</strong><p>本机运行 / 仅监听回环地址</p></div></div>
    <div className="console-sidebar-footer"><div><span className="status-dot" />本地服务在线<small>v{summary?.version ?? '—'}</small></div>
      <ThemeToggle /><Button variant="ghost" aria-label="退出管理" title="退出管理" onClick={() => { void host.logout().catch(host.error) }}><LogOut size={16} /></Button></div>
    <button type="button" className="sidebar-disclaimer" onClick={onDisclaimer}>使用须知与免责声明</button>
  </>
}
export function Topbar({ page, summary }: { page: Page; summary?: Summary }) {
  return <><div className="console-breadcrumb"><span>工作空间</span><ChevronRight size={14} /><strong key={page} className="console-breadcrumb-current">{pageNames[page]}</strong></div>
    <div className="console-topbar-status"><span className="status-dot" /><span>{summary?.settings.enabled === false ? '推理已暂停' : '本地服务'}</span><span className="topbar-divider" /><span>LOCAL</span></div></>
}
