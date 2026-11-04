/**
 * The sidebar is the only list of pages — nothing may restate it.
 *
 * 「模型工作台」在 2.7.1 里是个死入口：侧边栏有这一项，`App` 的 `host.navigate`
 * 却拿另一份手写数组当白名单，`navigate('workspace')` 被 `includes` 直接短路，
 * 于是点击无反应、无报错、无 loading（#678）。
 *
 * 修法不是往白名单里补一个字符串，而是让它**从侧边栏推导**。这个脚本守住两件事：
 *
 * 1. `Page` 联合类型与侧边栏条目是同一个集合 —— 类型允许的页面必须真的能点到，
 *    侧边栏也不能列出类型里没有的页面；
 * 2. `app.tsx` 不再自己写一份名单，而是用 `shell.tsx` 导出的 `navigationPages`。
 *
 * 纯静态检查：不需要浏览器，也不构建前端产物。
 *
 * Run: node scripts/standalone-nav-test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(new URL('..', import.meta.url)))
const frontend = path.join(root, 'packages', 'standalone', 'frontend')
const read = rel => fs.readFileSync(path.join(frontend, rel), 'utf8')

let checks = 0
const check = (name, run) => {
  checks++
  run()
  console.log(`ok  ${name}`)
}

// ── the declared page set ───────────────────────────────────────────────────
const types = read('types.ts')
const pageUnion = /export type Page\s*=([\s\S]*?)\n/.exec(types)
assert.ok(pageUnion, 'types.ts must declare `export type Page = ...`')
const declared = new Set([...pageUnion[1].matchAll(/'([a-z-]+)'/g)].map(match => match[1]))
assert.ok(declared.size > 0, 'the Page union must list at least one page')

// ── the sidebar ─────────────────────────────────────────────────────────────
const shell = read('components/shell.tsx')
const navigationBlock = /const navigation = \[([\s\S]*?)\n\] as const/.exec(shell)
assert.ok(navigationBlock, 'shell.tsx must declare `const navigation = [...] as const`')
const listed = [...navigationBlock[1].matchAll(/\bid:\s*'([a-z-]+)'/g)].map(match => match[1])
assert.ok(listed.length > 0, 'the sidebar must list at least one page')

check('every page the Page type allows is reachable from the sidebar', () => {
  const missing = [...declared].filter(page => !listed.includes(page))
  assert.deepEqual(missing, [], `unreachable pages: ${missing.join(', ')}`)
})

check('and the sidebar lists no page outside the Page type', () => {
  const extra = listed.filter(page => !declared.has(page))
  assert.deepEqual(extra, [], `sidebar entries missing from the type: ${extra.join(', ')}`)
})

check('the sidebar has no duplicate entries', () => {
  const duplicates = listed.filter((page, index) => listed.indexOf(page) !== index)
  assert.deepEqual([...new Set(duplicates)], [], `duplicated: ${[...new Set(duplicates)].join(', ')}`)
})

// ── the whitelist must be derived, never restated ───────────────────────────
const app = read('app.tsx')

check('App navigates against the sidebar-derived list', () => {
  assert.match(app, /from '\.\/components\/shell'/, 'app.tsx must import from the shell')
  // 白名单可以按 `lite` 收窄，但必须是侧边栏的函数：`liteNavigationPages`
  // 仍从 `navigation` 推导，`app.tsx` 自己不维护名单。
  assert.match(app, /\bliteNavigationPages\b/, 'app.tsx must use `liteNavigationPages`')
  assert.doesNotMatch(app, /\bpageNames\b/, 'app.tsx must not keep its own page-name list')
})

check('and shell.tsx actually exports it', () => {
  assert.match(shell, /export const navigationPages: Page\[\] = navigation\.flatMap\(/, 'shell.tsx must export `navigationPages` derived from `navigation`')
  assert.match(shell, /export const liteNavigationPages = \(lite: boolean\): Page\[\] =>\s*\n?\s*lite \? navigationPages\.filter/, '`liteNavigationPages` must filter `navigationPages`, never a new list')
})

// ── 精简导航的页面集合 ──────────────────────────────────────────────────────
// 精简模式只剩「账号渠道 / 网关与 API 接入 / 请求日志」三页：模型清单已并入
// 网关页（在那里选模型看示例），独立的「模型与开关」页不再需要。
check('the lite navigation drops 模型与开关 but keeps the other three', () => {
  const lite = /const LITE_PAGES: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/.exec(shell)
  assert.ok(lite, 'shell.tsx must declare LITE_PAGES')
  const ids = [...lite[1].matchAll(/'([a-z-]+)'/g)].map(([, id]) => id)
  assert.deepEqual(ids.sort(), ['channels', 'connection', 'requests'],
    `精简导航只应有账号渠道/网关/请求日志，实际：${ids.join(', ')}`)
  assert.ok(!ids.includes('models'), '「模型与开关」不得出现在精简导航里')
})

console.log(`\nok ${checks}/${checks} navigation invariants hold`)
