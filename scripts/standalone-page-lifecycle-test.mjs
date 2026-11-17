import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// This suite compiles the TSX page source in-process, so it needs esbuild — a
// `packages/standalone` devdependency. The offline CI job installs nothing by
// design (see .github/workflows/test.yml), so the check skips when the compiler
// is absent, the same way the release-preparation suite skips its Windows-only
// symlink check. Locally, where the devDependency is installed, it runs.
let transformSync
try {
  const standaloneRequire = createRequire(new URL('../packages/standalone/package.json', import.meta.url))
  ;({ transformSync } = standaloneRequire('esbuild'))
} catch {
  console.log('ok  standalone-page-lifecycle skipped: esbuild is not installed (the offline job installs nothing)')
  process.exit(0)
}

const source = fs.readFileSync(new URL('../packages/standalone/frontend/app.tsx', import.meta.url), 'utf8')
const code = source.slice(source.indexOf('function App()'), source.indexOf('createRoot(document'))
const slots = [], effects = []
let index = 0
const react = {
  useState(initial) { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value }] },
  useRef(value) { const at = index++; return slots[at] ??= { current: value } },
  useMemo(factory) { index++; return factory() },
  useEffect(effect, deps) { const at = index++, previous = slots[at]; if (previous?.deps?.length === deps?.length && deps?.every((value, i) => value === previous.deps[i])) return; slots[at] = { deps }; effects.push(effect) },
}
const settings = { enabled: true }
const summary = { settings, catalog: [], networkMode: 'fixture' }
const context = {
  ...react, h: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), Fragment: 'fragment',
  Sidebar: 'Sidebar', Topbar: 'Topbar', Connection: 'Connection', ChannelMount: 'ChannelMount', LazyPage: 'LazyPage', LoadingScreen: 'LoadingScreen', LoginScreen: 'LoginScreen', AlertCircle: 'AlertCircle', DisclaimerDialog: 'DisclaimerDialog', DshImportDialog: 'DshImportDialog',
  // `App` navigates against the sidebar-derived list (`navigationPages`), so
  // that is the name this sandbox has to supply. The value only needs to cover
  // the pages this suite walks through — the sidebar/type agreement itself is
  // pinned by `standalone-nav-test.mjs`. S12 后是单一 6 页集合，无 lite 分支。
  navigationPages: ['channels', 'smart', 'connection', 'calendar', 'requests', 'settings'],
  // App() 里的渲染数组从模块级 LAZY_PAGES 推导；切片只取函数体，这里补上同名集合。
  LAZY_PAGES: new Set(['smart', 'calendar', 'settings']), API: '/api/management',
  messageOf: error => error.message, AbortSignal, URLSearchParams, location: { hash: '' }, history: {},
  window: { scrollTo() {}, addEventListener() {}, removeEventListener() {}, setInterval() { return 1 }, clearInterval() {} },
  document: { hidden: false }, navigator: { clipboard: { writeText: async () => {} } },
  fetch: async url => ({ ok: true, json: async () => url.endsWith('/summary') ? summary : { models: [], days: [] } }),
}
vm.createContext(context)
vm.runInContext(transformSync(code + '\nglobalThis.testApp = App', { loader: 'tsx', jsxFactory: 'h', jsxFragment: 'Fragment' }).code, context)
const render = () => { index = 0; return context.testApp() }
const all = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(all)] : []
const flush = async () => { for (const effect of effects.splice(0)) effect(); await new Promise(resolve => setImmediate(resolve)) }
render(); await flush()
let tree = render()
const host = () => all(tree).find(node => node.type === 'Sidebar').props.host
// #678 血统：侧边栏列出的页面，点了真的会切过去。落地页是「账号渠道」。
assert.ok(all(tree).some(node => node.type === 'ChannelMount'), '落地页必须是账号渠道（导航首位）')
host().navigate('smart'); tree = render()
assert.ok(all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'smart'), '智能调度必须懒加载可达（AC-36）')
host().navigate('settings'); tree = render()
assert.ok(all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'settings'))
assert.ok(all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'smart' && node.props.active === false), '切页后保留智能调度组件与草稿，但停止非活动页面任务')
host().navigate('calendar'); tree = render()
assert.ok(all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'calendar' && node.props.active === true), '用量日历懒加载可达（AC-36）')
assert.ok(all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'settings' && node.props.active === false), '设置页切走后保留组件、暂停任务')
host().navigate('connection'); tree = render()
assert.ok(all(tree).some(node => node.type === 'Connection'), '网关页同步渲染可达')
assert.ok(!all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'calendar' && node.props.active === true), '日历离开后不再活动')
host().navigate('channels'); tree = render()
assert.equal(all(tree).find(node => node.type === 'ChannelMount').props.summary.networkMode, 'fixture', '账号渠道挂载收到摘要')
// 已删除的页面即使有人调用 navigate 也必须点不动（未知 page 不可达，AC-36 尾项）。
for (const gone of ['overview', 'models', 'usage', 'workspace', 'providers', 'eac', 'updates']) {
  host().navigate(gone); tree = render()
  assert.equal(all(tree).find(node => node.type === 'ChannelMount') !== undefined, true, `navigate('${gone}') 不得离开当前页面`)
}
host().navigate('smart'); tree = render()
let releaseOldKey
context.fetch = async url => url.endsWith('/key') ? new Promise(resolve => { releaseOldKey = resolve }) : { ok: true, json: async () => ({}) }
const oldKey = host().getApiKey().catch(error => error)
await host().logout(); tree = render()
assert.equal(tree.type, 'LoginScreen')
context.fetch = async url => ({ ok: true, json: async () => url.endsWith('/summary') ? summary : { models: [], days: [] } })
await tree.props.request('/session', { key: 'test' }); tree = render()
assert.equal(tree.props.id, 'app')
releaseOldKey({ ok: false, status: 401, json: async () => ({ error: '旧会话已过期' }) })
await oldKey; tree = render()
assert.equal(tree.props.id, 'app', '旧会话迟到 401 不得登出新会话')
console.log('ok  切页保留懒加载草稿（smart/calendar/settings visited 缓存）、未知页不可达、退出移除工作空间')
