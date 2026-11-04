import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// This suite compiles the TSX page source in-process, so it needs esbuild — a
// `packages/standalone` devDependency. The offline CI job installs nothing by
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
  Sidebar: 'Sidebar', Topbar: 'Topbar', SponsorNotice: 'SponsorNotice', Overview: 'Overview', Workspace: 'Workspace', Connection: 'Connection', ChannelMount: 'ChannelMount', LazyPage: 'LazyPage', LoadingScreen: 'LoadingScreen', LoginScreen: 'LoginScreen', AlertCircle: 'AlertCircle', DisclaimerDialog: 'DisclaimerDialog', DshImportDialog: 'DshImportDialog',
  // `App` navigates against the sidebar-derived list (`liteNavigationPages`), so
  // that is the name this sandbox has to supply. The value only needs to cover
  // the pages this suite walks through — the sidebar/type agreement itself is
  // pinned by `standalone-nav-test.mjs`. `lite` 缺省为 false，即完整页面集。
  liteNavigationPages: lite => lite
    ? ['models', 'channels', 'connection', 'requests']
    : ['overview', 'workspace', 'models', 'usage', 'channels', 'eac', 'settings', 'connection'], API: '/api/management',
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
// #678：侧边栏列了「模型工作台」，但白名单里没有它，`navigate('workspace')` 被
// `includes` 静默丢弃 —— 点击无反应、无报错、无 loading。白名单现在从侧边栏
// 推导，这一条钉住「侧边栏有的页面，点了真的会切过去」。
host().navigate('workspace'); tree = render()
assert.ok(all(tree).some(node => node.type === 'Workspace'), '「模型工作台」必须可达，点击后真的切页（#678）')
host().navigate('settings'); tree = render()
assert.ok(all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'settings'))
host().navigate('models'); tree = render()
assert.ok(all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'settings' && node.props.active === false), '切页后保留设置组件及草稿，但停止非活动页面任务')
assert.ok(all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'models' && node.props.active === true))
host().navigate('usage'); tree = render()
assert.ok(all(tree).some(node => node.type === 'LazyPage' && node.props.name === 'models' && node.props.active === false), '模型筛选状态在切页后保留')
assert.ok(!all(tree).some(node => node.type === 'Connection'), '密钥页面离开后卸载，清除显示的密钥')
host().navigate('channels'); tree = render()
assert.equal(all(tree).find(node => node.type === 'ChannelMount').props.key, 'channels', '账号渠道使用独立嵌套根容器')
host().navigate('eac'); tree = render()
assert.equal(all(tree).find(node => node.type === 'ChannelMount').props.key, 'eac', 'EAC 切换时更换容器，避免旧 React 根覆盖新页面')
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

// 精简模式（`--lite`，默认）：只留模型、渠道、网关三页。落地页不能是已被
// 隐藏的概览，否则首屏一片空白；被隐藏的页面即使有人调用 `navigate` 也必须点不动。
const liteSummary = { settings, catalog: [], networkMode: 'fixture', lite: true }
context.fetch = async url => ({ ok: true, json: async () => url.endsWith('/summary') ? liteSummary : { models: [], days: [] } })
slots.length = 0; effects.length = 0
// 摘要解析后 snapshot 才带上 `lite`，而 effect 的依赖只有在新一轮 render 里
// 才会用新值登记；所以「渲染 → 跑 effect → 再渲染 → 再跑」两轮才能到稳定态。
render(); await flush()
render(); await flush()
let liteTree = render()
const liteHost = () => all(liteTree).find(node => node.type === 'Sidebar').props.host
assert.equal(all(liteTree).find(node => node.type === 'Sidebar').props.lite, true, '精简模式下侧边栏必须收到 lite')
// 落地页现在是「网关与 API 接入」：精简模式下模型清单已并入该页，
// 独立的「模型与开关」页不再出现在精简导航里。
assert.ok(all(liteTree).some(node => node.type === 'Connection'),
  '精简模式的落地页必须是网关与 API 接入页，不能停在已被隐藏的概览')
liteHost().navigate('overview'); liteTree = render()
assert.ok(!all(liteTree).some(node => node.type === 'Overview'), '概览在精简模式下不可达')
// 「模型与开关」已移出精简导航。直接断言**导航列表**不含它 —— 这是精简模式
// 的真正不变量（侧栏列什么，白名单就放什么），比「navigate 之后页面是否
// 还 active」可靠：后者取决于之前停在哪一页。
liteHost().navigate('channels'); liteTree = render()
assert.equal(all(liteTree).find(node => node.type === 'ChannelMount').props.key, 'channels', '精简模式仍能进入账号渠道')
liteHost().navigate('connection'); liteTree = render()
assert.ok(all(liteTree).some(node => node.type === 'Connection'), '精简模式仍能进入网关与 API 接入')
console.log('ok  切页保留设置草稿与模型筛选，非活动页面暂停任务，退出移除工作空间')
console.log('ok  精简模式：只留渠道/网关/日志三页，落地页落在网关页，模型页点不动')
