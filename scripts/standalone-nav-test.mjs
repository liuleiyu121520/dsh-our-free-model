/**
 * The sidebar is the only list of pages — nothing may restate it.
 *
 * 「模型工作台」在 2.7.1 里是个死入口：侧边栏有这一项，`App` 的 `host.navigate`
 * 却拿另一份手写数组当白名单，`navigate('workspace')` 被 `includes` 直接短路，
 * 于是点击无反应、无报错、无 loading（#678）。
 *
 * 修法不是往白名单里补一个字符串，而是让它**从侧边栏推导**。S12 之后控制台
 * 收缩为 6 页（FR-13），双模（--lite/--full）架构删除，这份脚本守住：
 *
 * 1. `Page` 联合类型与侧边栏条目是同一个集合 —— 类型允许的页面必须真的能点到，
 *    侧边栏也不能列出类型里没有的页面（未知 page 不可达）；
 * 2. `app.tsx` 不再自己写一份名单，而是用 `shell.tsx` 导出的 `navigationPages`；
 * 3. 导航是三分组六页（D30）：渠道与模型 / 数据 / 管理；
 * 4. 双模符号（LITE_PAGES / liteNavigationPages / --lite / --full / hasDesktopBridge）清零；
 * 5. 懒加载集合 = smart / calendar / settings，且从 LAZY_PAGE_NAMES 单一来源推导。
 *
 * 纯静态检查：不需要浏览器，不构建前端产物。
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
assert.deepEqual([...declared], ['channels', 'smart', 'connection', 'calendar', 'requests', 'settings'],
  'Page 联合必须收缩为 6 页（FR-13.1）')

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

// ── three groups, six pages, in order (D30) ────────────────────────────────
check('navigation is the three-group six-page layout', () => {
  const groups = [...navigationBlock[1].matchAll(/label:\s*'([^']+)'/g)].map(match => match[1])
  assert.deepEqual(groups, ['渠道与模型', '数据', '管理'], `分组应为三分组，实际：${groups.join(' / ')}`)
  assert.deepEqual(listed, ['channels', 'smart', 'connection', 'calendar', 'requests', 'settings'],
    `页面顺序应为 channels→smart→connection→calendar→requests→settings，实际：${listed.join(' → ')}`)
})

// ── the whitelist must be derived, never restated ───────────────────────────
const app = read('app.tsx')

check('App navigates against the sidebar-derived list', () => {
  assert.match(app, /from '\.\/components\/shell'/, 'app.tsx must import from the shell')
  assert.match(app, /\bnavigationPages\b/, 'app.tsx must use `navigationPages`')
  assert.doesNotMatch(app, /\bpageNames\b/, 'app.tsx must not keep its own page-name list')
})

check('and shell.tsx actually exports it', () => {
  assert.match(shell, /export const navigationPages: Page\[\] = navigation\.flatMap\(/, 'shell.tsx must export `navigationPages` derived from `navigation`')
})

// ── hash routing: refresh lands on the current page (C 项) ─────────────────
// 页面切换从纯内存 state 升级为 #/page-id 双向同步：navigate 写 hash、启动读
// hash、hashchange 兜底。白名单必须仍从 navigationPages 推导（不另写名单）。
check('hash routing syncs #/page-id without restating the page list', () => {
  assert.match(app, /navigationPages\.includes\(id as Page\)/, '合法页判定必须复用 navigationPages，不得另写 hash 白名单')
  assert.match(app, /useState<Page>\(\(\) => pageFromHash\(\) \?\? 'channels'\)/, '初始页必须从 location.hash 读取，非法/缺失回落 channels')
  assert.match(app, /history\.replaceState\(null, '', `#\/\$\{next\}`\)/, 'navigate 必须用 replaceState 同步 #/page（不产生多余历史记录）')
  assert.match(app, /addEventListener\('hashchange'/, '必须监听 hashchange 兜底切页')
})

// ── dual-mode architecture is gone ─────────────────────────────────────────
check('no lite/full dual-mode symbols anywhere in the console sources', () => {
  for (const rel of ['components/shell.tsx', 'app.tsx', 'types.ts']) {
    const source = read(rel)
    for (const symbol of ['LITE_PAGES', 'liteNavigationPages', 'hasDesktopBridge']) {
      assert.equal(source.includes(symbol), false, `${rel} must not contain ${symbol}`)
    }
  }
  const cli = fs.readFileSync(path.join(root, 'packages', 'standalone', 'cli.mjs'), 'utf8')
  assert.equal(cli.includes('--lite'), false, 'cli.mjs must not document --lite')
  assert.equal(cli.includes('--full'), false, 'cli.mjs must not document --full')
})

// ── lazy pages: single source of truth ──────────────────────────────────────
check('the lazy-page set is smart/calendar/settings and drives both type and render', () => {
  const names = /const LAZY_PAGE_NAMES = \[([^\]]*)\] as const/.exec(app)
  assert.ok(names, 'app.tsx must declare `const LAZY_PAGE_NAMES = [...] as const`')
  const lazy = [...names[1].matchAll(/'([a-z-]+)'/g)].map(([, id]) => id)
  assert.deepEqual(lazy.sort(), ['calendar', 'settings', 'smart'],
    `懒加载集合应为 smart/calendar/settings，实际：${lazy.join(', ')}`)
  for (const page of lazy) {
    assert.ok(declared.has(page), `lazy page ${page} must be a Page`)
    assert.ok(listed.includes(page), `lazy page ${page} must be reachable from the sidebar`)
  }
  // 渲染数组必须由 navigationPages ∩ LAZY_PAGES 推导，而不是另一份手写枚举。
  assert.match(app, /navigationPages\.filter\(\(name\): name is LazyPageName => LAZY_PAGES\.has\(name\)/,
    '渲染数组必须从 navigationPages.filter + LAZY_PAGES 推导')
})

console.log(`\nok ${checks}/${checks} navigation invariants hold`)
