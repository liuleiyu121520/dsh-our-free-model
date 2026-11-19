import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { Sidebar, Topbar, navigationPages } from './components/shell'
import { Connection } from './connection'
import { Requests } from './requests'
import { DisclaimerDialog } from './components/disclaimer-dialog'
import { DshImportDialog } from './components/dsh-import-dialog'
import { UpdateNotice } from './components/update-notice'
import type { ClaimsQuery, Host, Page, ServiceSettings, SmartState, Snapshot, UpdateWait } from './types'
import './app.css'

const API = '/api/management'
const platform = document.getElementById('root')?.dataset.loginPlatform ?? (/Windows/i.test(navigator.userAgent) ? 'windows' : /Macintosh|Mac OS/i.test(navigator.userAgent) ? 'macos' : 'unsupported')
const terminalName = platform === 'windows' ? 'PowerShell' : '终端'
type Request = <T = any>(path: string, body?: unknown, timeoutMs?: number, signal?: AbortSignal) => Promise<T>
const messageOf = (error: unknown) => error instanceof Error ? error.name === 'TimeoutError' ? '请求超时，请检查服务是否仍在运行。' : error.message : '请求失败，请重试。'

/** hash 路由（刷新定位当前页）：`#/smart` 等 6 页 id 与内存 page 双向同步，刷新/直达链接
 *  可回到对应页。合法页白名单仍从侧边栏推导（navigationPages），不另写名单；
 *  非法/缺失 hash 回落落地页（channels）。写 hash 用 history.replaceState——
 *  切页不产生多余历史记录（与原内存切换语义一致，也不触发 hashchange 回环）；
 *  需要前进/后退时再升级 pushState。登录引导 hash（#login=token）不匹配页 id，
 *  天然走回落逻辑，启动时原有的清 hash 行为不受影响。 */
const pageFromHash = (): Page | undefined => {
  const id = /^#\/([a-z-]+)/.exec(location.hash)?.[1]
  return id !== undefined && navigationPages.includes(id as Page) ? id as Page : undefined
}
const syncPageHash = (next: Page) => { history.replaceState(null, '', `#/${next}`) }

function LoginScreen({ request }: { request: Request }) {
  const [key, setKey] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  const command = platform === 'windows'
    ? '$ofmLogin = Get-Content -LiteralPath "$env:USERPROFILE\\.our-free-model\\settings.json" -Raw -Encoding UTF8 | ConvertFrom-Json; $(if ($ofmLogin.managementKey) { $ofmLogin.managementKey } else { $ofmLogin.forwardKey }) | Set-Clipboard'
    : platform === 'macos'
      ? `node -e 'const fs = require("node:fs"); const {execFileSync} = require("node:child_process"); const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const key = settings.managementKey ?? settings.forwardKey; if (typeof key !== "string" || !key.trim()) throw new Error("missing login token"); execFileSync("/usr/bin/pbcopy", [], {input: key});' "$HOME/.our-free-model/settings.json"`
      : `node -e 'const fs = require("node:fs"); const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const key = settings.managementKey ?? settings.forwardKey; if (typeof key !== "string" || !key.trim()) throw new Error("missing login token"); process.stdout.write(key + "\\n");' "$HOME/.our-free-model/settings.json"`
  const submit = async (event: FormEvent) => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await request('/session', { key: key.trim() }); setKey(''); window.dispatchEvent(new CustomEvent('ofm:logged-in')) } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) } }
  const openTerminal = async () => { if (platform === 'unsupported' || busy) return; setBusy(true); setStatus(`正在本机打开${terminalName}…`); try { await request('/login/terminal', {}, 15000); setStatus(`已请求打开${terminalName}。窗口提示复制成功后，回到这里粘贴令牌。`); document.getElementById('login-key')?.focus() } catch (reason) { setStatus(`${messageOf(reason)}。可以展开下方的手动获取说明。`) } finally { setBusy(false) } }
  const copyCommand = async () => { try { await navigator.clipboard.writeText(command); setStatus(`命令已复制。在${terminalName}执行后，回到这里粘贴令牌。`) } catch { const input = document.getElementById('login-command') as HTMLTextAreaElement | null; input?.focus(); input?.select(); setStatus(`浏览器未允许复制，已选中命令，请按 ${platform === 'macos' ? 'Command+C' : 'Ctrl+C'} 手动复制。`) } }
  return <section id="login-screen" className="login-shell" data-testid="login-screen"><div className="login-card login-card-enter"><span className="login-card-glow" aria-hidden="true" /><div className="brand-mark" aria-hidden="true">ofm<span>.</span></div>
    <span className="eyebrow">LOCAL CONSOLE</span><h1>连接你的本地服务</h1><p>使用启动时打印的一次性链接，或输入保存在本机的登录令牌。</p>
    <form id="login-form" onSubmit={event => { void submit(event) }}><label htmlFor="login-key">本机管理令牌</label><input id="login-key" name="key" type="password" autoComplete="off" placeholder="ofm-…" required value={key} onChange={event => setKey(event.target.value)} /><button className={"primary" + (busy ? " is-busy" : "")} type="submit" disabled={busy}>{busy && <span className="ui-spinner" aria-hidden="true" />}<span className="login-submit-label">进入控制台</span> <span aria-hidden="true">→</span></button></form>
    {error && <p id="login-error" role="alert" className="error login-error-enter">{error}</p>}<div className="login-help"><h2>没有令牌？从本机获取</h2><p id="login-terminal-help">{platform === 'unsupported' ? '当前系统不支持自动打开终端，请展开下方说明手动获取令牌。' : `点击下方按钮，会打开${terminalName}并将当前服务的令牌复制到剪贴板。回来粘贴到上方即可。`}</p>
      <button id="login-terminal" className="secondary" type="button" data-login-platform={platform} disabled={platform === 'unsupported' || busy} onClick={() => void openTerminal()}>打开{platform === 'windows' ? ' PowerShell ' : '终端'}获取令牌 ↗</button><p id="login-help-status" role="status">{status}</p><details><summary>手动获取与其他系统</summary><p>默认位置：用户目录下的 <code>.our-free-model/settings.json</code>，取 <code>managementKey</code> 字段。</p><label id="login-command-label" htmlFor="login-command">获取令牌命令（默认目录）</label><textarea id="login-command" readOnly rows={4} spellCheck={false} value={command} /><button id="copy-login-command" className="text-button" type="button" onClick={() => void copyCommand()}>复制获取令牌命令</button></details></div><small>登录仅用于本机管理。会话在 8 小时后或服务重启后失效。</small></div></section>
}
function LoadingScreen() { return <div id="loading-screen" className="loading-screen"><div className="loading-inner"><div className="brand-mark loading-brand">ofm<span>·</span></div><span className="loading-bar" aria-hidden="true"><span className="loading-bar-fill" /></span><p>正在连接本地服务…</p></div></div> }
function ChannelMount({ summary }: { summary: Snapshot['summary'] & { reload(): void } }) {
  const [module, setModule] = useState<typeof import('./channels.mjs')>(); const generation = useRef(0); const summaryRef = useRef(summary); summaryRef.current = summary
  useEffect(() => { const current = ++generation.current; let alive = true; void import('./channels.mjs').then(value => { if (alive && current === generation.current) setModule(value) }); return () => { alive = false; generation.current++; module?.hide() } }, [])
  useEffect(() => { if (!module) return; module.show(summaryRef.current); return () => module.hide() }, [module])
  return <div id="channel-root" className="ofm_root" role={module ? undefined : 'status'}>{module ? null : '正在加载渠道管理…'}</div>
}
/**
 * 懒加载页面集合（单一来源）：`Smart`/`Calendar`/`Settings` 三个页面按需分包。
 * LazyPage 的名字类型与渲染数组都从这份元组推导，绝不另写枚举——
 * 漏写一页会直接被类型/渲染排除，多写一页则会被 navigationPages 过滤掉。
 */
const LAZY_PAGE_NAMES = ['smart', 'calendar', 'settings'] as const
const LAZY_PAGES: ReadonlySet<Page> = new Set(LAZY_PAGE_NAMES)
type LazyPageName = (typeof LAZY_PAGE_NAMES)[number]
const LAZY_COMPONENT: Record<LazyPageName, string> = { smart: 'Smart', calendar: 'Calendar', settings: 'Settings' }
function LazyPage({ name, snapshot, host, active }: { name: LazyPageName; snapshot: Snapshot; host: Host; active: boolean }) {
  const [module, setModule] = useState<any>(); useEffect(() => { let alive = true; const loaded = name === 'smart' ? import('./smart') : name === 'calendar' ? import('./calendar') : import('./settings'); void loaded.then(value => { if (alive) setModule(value) }); return () => { alive = false } }, [name])
  if (!module) return <p role="status">正在加载页面…</p>; const Component = module[LAZY_COMPONENT[name]]; return <Component summary={snapshot.summary} stats={snapshot.stats} host={host} active={active} />
}
function App() {
  // 初始页从 hash 读（项 C）：合法页 id 直达，非法/缺失维持落地页 channels；
  // 懒加载页还需登记 visited，否则首个渲染周期内容为空。
  const [mode, setMode] = useState<'loading' | 'login' | 'ready'>('loading'), [snapshot, setSnapshot] = useState<Snapshot>(), [page, setPage] = useState<Page>(() => pageFromHash() ?? 'channels'), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const [visited, setVisited] = useState<Page[]>(() => { const initial = pageFromHash(); return initial ? [initial] : [] })
  // The disclaimer reads once on the first console visit and is reopenable from
  // the sidebar. It never gates the lanes: acknowledging only writes a setting.
  const [disclaimer, setDisclaimer] = useState<{ acknowledged?: boolean } | undefined>(undefined)
  const [disclaimerOpen, setDisclaimerOpen] = useState(false)
  const generation = useRef(0), loading = useRef<Promise<void> | undefined>(undefined), authenticated = useRef(false), settingsRevision = useRef(0)
  // 自更新「等待重启」阶段（§V11.5-3）：独立 2s 探测轮询 + 等待期抑制全局报错，
  // 防止服务重启窗口的全屏 error-notice 与更新气泡打架（SR-17）。
  const [updateWait, setUpdateWait] = useState<UpdateWait>({ phase: 'idle' })
  const updateWaitRef = useRef(updateWait)
  updateWaitRef.current = updateWait
  const enterLogin = (reason = '') => { generation.current++; loading.current = undefined; authenticated.current = false; setSnapshot(undefined); setVisited([]); setPage('channels'); setError(reason); setNotice(''); setMode('login'); syncPageHash('channels') }
  // navigate 与 hashchange 共用的切页路径：登记 visited（懒加载页渲染依赖）、清错误/提示。
  const switchPage = (next: Page) => {
    setPage(next)
    setVisited(previous => previous.includes(next) ? previous : [...previous, next])
    setError('')
    setNotice('')
  }
  const request: Request = async (path, body, timeoutMs = 10000, signal) => { const current = generation.current; const response = await fetch(API + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) }); const value = await response.json(); if (!response.ok) { const reason = Object.assign(new Error(value.error ?? `请求失败（${response.status}）`), { status: response.status }); if (current === generation.current && response.status === 401 && path !== '/session') enterLogin(reason.message); throw reason } if (current !== generation.current) throw new Error('管理会话已变化，请重新操作。'); return value }
  const loadData = async () => { if (loading.current) return loading.current; const current = generation.current, revision = settingsRevision.current; const pending = Promise.all([request('/summary'), request('/stats')]).then(([summary, stats]) => { if (current !== generation.current) return; setSnapshot(previous => ({ summary: revision !== settingsRevision.current && previous ? { ...summary, settings: previous.summary.settings } : summary, stats })); authenticated.current = true; setMode('ready'); setError('') }).finally(() => { if (loading.current === pending) loading.current = undefined }); loading.current = pending; return pending }
  const host = useMemo<Host>(() => ({ navigate: next => { if (navigationPages.includes(next)) { switchPage(next); syncPageHash(next) } }, refresh: async () => { await loadData() }, copy: async value => { await navigator.clipboard.writeText(value); setNotice('已复制到剪贴板') }, getApiKey: async () => (await request<{ key: string }>('/key')).key, rotateKey: async () => (await request<{ key: string }>('/key/rotate', { confirm: true })).key, logout: async () => { await request('/logout', {}); enterLogin('已退出管理') }, error: reason => setError(messageOf(reason)), setModelDisabled: async (provider, modelId, disabled) => { await request('/channels/rpc', { method: 'model.setDisabled', payload: { provider, modelId, disabled } }, 20000); void loadData().catch(() => {}) }, saveSettings: async (settings: Partial<ServiceSettings>) => { const value = await request<{ settings: ServiceSettings }>('/settings', settings); settingsRevision.current++; setSnapshot(previous => previous ? { ...previous, summary: { ...previous.summary, settings: value.settings } } : previous); return value.settings }, smartState: () => request<SmartState>('/smart/state', undefined, 20000), saveSmartPool: async models => { const value = await request<SmartState>('/smart/pool', { models }, 20000); void loadData().catch(() => {}); return value }, claimsHistory: (from, to) => request<ClaimsQuery>(`/claims/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, undefined, 20000) }), [page])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [page])
  useEffect(() => { const onUnauthorized = () => enterLogin('管理会话已失效，请重新登录'); window.addEventListener('ofm:unauthorized', onUnauthorized); return () => window.removeEventListener('ofm:unauthorized', onUnauthorized) }, [])
  // hashchange 兜底：用户手改地址栏 hash（或外部链接带 hash）时同步切页；
  // 非法/清空 hash 回落地页。replaceState 不触发本事件，无回环。
  useEffect(() => {
    const onHashChange = () => switchPage(pageFromHash() ?? 'channels')
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => { const token = new URLSearchParams(location.hash.slice(1)).get('login'); if (token) history.replaceState(null, '', location.pathname + location.search); void (async () => { try { if (token) await request('/session', { bootstrapToken: token }); await loadData() } catch (reason) { enterLogin((reason as any)?.status === 401 && !token ? '' : messageOf(reason)) } })() }, [])
  useEffect(() => { if (mode !== 'ready') return; const timer = window.setInterval(() => { if (!document.hidden) void loadData().catch(reason => { if (updateWaitRef.current.phase !== 'waiting') setError(messageOf(reason)) }) }, 15000); return () => window.clearInterval(timer) }, [mode])
  // 等待重启的独立 2s 探测（AC-48）：fetch 失败/超时/401 = 服务重启中（预期，不报错），
  // 继续轮询；成功且版本已变化（到位或异常）→ location.reload() 回稳态（hash 保留，
  // 页面回位）；5 分钟总超时 → 错误态提示手动刷新。
  useEffect(() => {
    if (updateWait.phase !== 'waiting') return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(API + '/summary', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(2500) })
          if (response.status === 401) return // LAN 场景旧会话 401：继续轮询至超时，reload 后走登录页
          if (response.ok) {
            const value = await response.json()
            if (typeof value?.version !== 'string' || value.version !== updateWaitRef.current.from) { location.reload(); return }
          }
        } catch { /* 服务重启中：预期失败 */ }
        if (Date.now() - startedAt >= 5 * 60_000) setUpdateWait(previous => previous.phase === 'waiting' ? { ...previous, phase: 'timeout' } : previous)
      })()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [updateWait.phase])
  useEffect(() => {
    if (mode !== 'ready') return
    let alive = true
    request<{ acknowledged?: boolean }>('/disclaimer')
      .then(value => { if (alive) { setDisclaimer(value); if (value.acknowledged !== true) setDisclaimerOpen(true) } })
      .catch(() => { if (alive) setDisclaimer({ acknowledged: true }) })
    return () => { alive = false }
  }, [mode])
  // 落地页是「账号渠道」（导航首位）：登录后第一件事是接账号，模型与接入在其后。
  // channels 不是懒加载页（独立 React 根同步挂载），不需要登记 visited。
  const content: ReactNode = snapshot && page === 'connection' ? <Connection summary={snapshot.summary} host={host} active /> : snapshot && page === 'requests' ? <Requests summary={snapshot.summary} host={host} active request={request} /> : snapshot && page === 'channels' ? <ChannelMount summary={{ ...snapshot.summary, reload: () => { void loadData() } }} /> : null
  if (mode === 'loading') return <LoadingScreen />
  if (mode === 'login') return <LoginScreen request={async (...args) => { const result = await request(...args); if (args[0] === '/session') await loadData(); return result }} />
  // data-active-page 供页面级样式挂钩（smart 页视口内自适应布局，smart.css）。
  return <div id="app" className="app-shell" data-active-page={page}><aside className="sidebar"><Sidebar page={page} summary={snapshot?.summary} host={host} onDisclaimer={() => setDisclaimerOpen(true)} /></aside><main><header className="topbar"><Topbar page={page} summary={snapshot?.summary} /><UpdateNotice update={snapshot?.summary.update} wait={updateWait} request={request} onWait={next => setUpdateWait(next)} onWaitDone={() => setUpdateWait({ phase: 'idle' })} /></header>{snapshot?.summary.networkMode === 'fixture' && <div className="notice test-mode-notice notice-enter" role="alert">当前为本机替身测试模式：账号、模型回答与额度均为测试数据。</div>}{notice && <div className="notice notice-enter" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>关闭</button></div>}{error && <div className="notice error-notice notice-enter" role="alert"><AlertCircle size={16} /><span>{error}</span><button className="text-button" onClick={() => { setError(''); void loadData() }}>重试</button></div>}<section className="page">{content}{snapshot && navigationPages.filter((name): name is LazyPageName => LAZY_PAGES.has(name) && visited.includes(name)).map(name => <div key={name} hidden={page !== name}><LazyPage name={name} snapshot={snapshot} host={host} active={page === name} /></div>)}</section><footer>本地运行 <span>·</span> 由你掌控</footer></main>{snapshot && <DshImportDialog request={request} onDone={() => { void loadData() }} />}<DisclaimerDialog open={disclaimerOpen} onClose={() => { setDisclaimerOpen(false); setDisclaimer(current => current ? { ...current, acknowledged: true } : current) }} /></div>
}
createRoot(document.getElementById('root')!).render(<App />)
