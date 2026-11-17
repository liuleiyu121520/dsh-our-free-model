# E-8 判零辅助 grep 证据（MINOR-003 闭环）

## pattern 原文（引用形态 + 精确脚本名 + 词边界）

```grep
grep -rEn "(import[^;]*from ['\\\"][^'\\\"]*(index|client)\\.js|import\\(['\\\"][^'\\\"]*(index|client)\\.js|readFileSync\\([^)]*(index|client)\\.js|new URL\\(['\\\"][^'\\\"]*(index|client)\\.js|path\\.join\\([^)]*['\\\"](index|client)\\.js['\\\"]|['\\\"](adapter|locale|catalog|feed)/[a-z][^'\\\"]*['\\\"]|packages/desktop|published-bytes|(^|[^-\\w])(offline|forward-boot|kilo|aggregate-wiring|recovery|bench-integration|magpie-plugin|magpie-sandbox|vault|subscription-wiring|workspace-appearance-ui|host-selftest|picker|live-feature-verify|tui|catalog|eac-login|sanitize|subscription-ui|heatmap|stat-bucket-ui|plugin-bench|picks-ui|upgrade-ui|ui-preview|_render-probe|client-lint|sponsor-ui|workbench-tauri|build-manifest|prepare-release|release-e2e|release-preparation|build-sponsor|sponsor-test|legacy-upgrade|gateway-source|refresh-revision|prepare-desktop)(-test)?\\.mjs)"
  --include=*.mjs --include=*.js --include=*.json --include=*.yml
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=software-company .
```

排除项：docs/*.md 叙述性历史记录不属代码引用形态（AC-25 判据为 import/require/字符串路径引用）；
`docs/software-company/` 为控制面工件目录（本文件自身含 pattern 原文）。
生成命令：`cd <repo> && grep -rEn (import[^;]*from ['\\\][^'\\\]*(index|client)\\.js|import\\(['\\\][^'\\\]*(index|client)\\.js|readFileSync\\([^)]*(index|client)\\.js|new URL\\(['\\\][^'\\\]*(index|client)\\.js|path\\.join\\([^)]*['\\\](index|client)\\.js['\\\]|['\\\](adapter|locale|catalog|feed)/[a-z][^'\\\]*['\\\]|packages/desktop|published-bytes|(^|[^-\\w])(offline|forward-boot|kilo|aggregate-wiring|recovery|bench-integration|magpie-plugin|magpie-sandbox|vault|subscription-wiring|workspace-appearance-ui|host-selftest|picker|live-feature-verify|tui|catalog|eac-login|sanitize|subscription-ui|heatmap|stat-bucket-ui|plugin-bench|picks-ui|upgrade-ui|ui-preview|_render-probe|client-lint|sponsor-ui|workbench-tauri|build-manifest|prepare-release|release-e2e|release-preparation|build-sponsor|sponsor-test|legacy-upgrade|gateway-source|refresh-revision|prepare-desktop)(-test)?\\.mjs) --include=*.mjs --include=*.js --include=*.json --include=*.yml --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=software-company . > /tmp/s8-finalhits.txt`

## 实测命中（S8 模拟态，共 68 行）与白名单分类

scripts/aggregate-test.mjs:29:import { parseProviderModelId } from '../src/providers/index.js'
scripts/engine-payload-test.mjs:8:import * as source from '../src/token-saver/index.js'
scripts/updater-test.mjs:597:    if (url === prefix + 'feed/manifest.json') return new Response(JSON.stringify(resolutions === 1 ? newManifest : updatedManifest))
scripts/updater-test.mjs:608:    assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), updatedFiles['index.js'])
scripts/updater-test.mjs:693:    fs.writeFileSync(path.join(stage, 'index.js'), "export const v = 'tampered-in-place'\n")
scripts/updater-test.mjs:698:    assert.equal(fs.readFileSync(path.join(stage, 'index.js'), 'utf8'), newFiles['index.js'])
scripts/updater-test.mjs:700:    fs.rmSync(path.join(stage, 'client.js'), { force: true })
scripts/updater-test.mjs:807:  assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), newFiles['index.js'])
scripts/updater-test.mjs:829:  fs.writeFileSync(path.join(pkg, 'scripts', 'picker-test.mjs'), 'kept\n')
scripts/updater-test.mjs:847:  assert.equal(fs.existsSync(path.join(pkg, 'scripts', 'picker-test.mjs')), true, 'the development scaffolding survives')
scripts/updater-test.mjs:910:  const rel = 'packages/desktop/src-tauri/target/debug/legacy-cache.pdb'
scripts/updater-test.mjs:924:    fs.writeFileSync(path.join(pkg, 'index.js'), 'broken candidate')
scripts/updater-test.mjs:926:    assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), oldFiles['index.js'])
scripts/updater-test.mjs:1053:  assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), oldFiles['index.js'])
scripts/updater-test.mjs:1066:  fs.writeFileSync(path.join(pkg, 'index.js'), newFiles['index.js'])
scripts/updater-test.mjs:1071:  assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), oldFiles['index.js'])
scripts/updater-test.mjs:1072:  assert.equal(fs.readFileSync(path.join(pkg, 'client.js'), 'utf8'), oldFiles['client.js'])
scripts/updater-test.mjs:1084:  assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), oldFiles['index.js'], 'the installed package is untouched')
scripts/updater-test.mjs:1085:  assert.equal(fs.readFileSync(path.join(pkg, 'client.js'), 'utf8'), oldFiles['client.js'], 'no file was deleted')
scripts/updater-test.mjs:1156:  fs.rmSync(path.join(pkg, 'client.js'), { force: true })
scripts/updater-test.mjs:1157:  fs.mkdirSync(path.join(pkg, 'client.js'), { recursive: true })
scripts/updater-test.mjs:1159:  assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), oldFiles['index.js'], 'the other files were still put back')
scripts/updater-test.mjs:1168:  const target = path.join(pkg, 'index.js')
scripts/updater-test.mjs:1176:    assert.equal(fs.readFileSync(path.join(pkg, 'client.js'), 'utf8'), oldFiles['client.js'])
scripts/updater-test.mjs:1188:  const target = path.join(pkg, 'index.js')
scripts/updater-test.mjs:1207:    assert.equal(fs.readFileSync(path.join(pkg, 'client.js'), 'utf8'), oldFiles['client.js'])
scripts/updater-test.mjs:1252:    assert.match(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), /same-version content update/)
scripts/updater-test.mjs:1310:        internal: { loadCache: new Map([[pathToFileURL(path.join(pkgDir, 'index.js')).href, { source: 'reload fixture cache' }]]) },
scripts/updater-test.mjs:1335:        return selfReload(host.ctx, { logger: {}, packageUrl: packageUrlOf(pathToFileURL(path.join(pkg, 'index.js')).href), entryUrl: entryUrlOf(pathToFileURL(path.join(pkg, 'index.js')).href), expectedVersion: NEW })
scripts/updater-test.mjs:1399:    const outcome = await updater.apply({ activate: () => selfReload(host.ctx, { logger: {}, packageUrl: packageUrlOf(pathToFileURL(path.join(pkg, 'index.js')).href), entryUrl: entryUrlOf(pathToFileURL(path.join(pkg, 'index.js')).href) }) })
scripts/updater-test.mjs:1449:      assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), oldFiles['index.js'])
scripts/updater-test.mjs:1472:    assert.equal(fs.readFileSync(path.join(updater.backupDir, 'client.js'), 'utf8'), oldFiles['client.js'])
scripts/updater-test.mjs:1514:  fs.writeFileSync(path.join(backup, 'client.js'), 'the retained rollback copy\n')
scripts/updater-test.mjs:1527:    assert.equal(fs.readFileSync(path.join(backup, 'client.js'), 'utf8'), 'the retained rollback copy\n')
scripts/updater-test.mjs:1577:    fs.writeFileSync(path.join(pkg, 'index.js'), 'keep this edit\n')
scripts/updater-test.mjs:1578:    fs.writeFileSync(path.join(backup, 'client.js'), 'damaged backup\n')
scripts/updater-test.mjs:1580:    assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), 'keep this edit\n')
scripts/updater-test.mjs:1583:    assert.equal(fs.readFileSync(path.join(pkg, 'index.js'), 'utf8'), 'keep this edit\n')
scripts/eac-router-ui-test.mjs:9:import { PROVIDERS } from '../src/providers/index.js'
scripts/rtk-shape-test.mjs:9:import { compressRequest } from '../src/token-saver/rtk/index.js'
scripts/subscription-completion-test.mjs:97:  await check('catalog/publicModelRows expose composite IDs and track enable/remove synchronously', () => {
scripts/reload-test.mjs:15:  const entry = pathToFileURL(path.join(directory, 'index.js')).href
scripts/reload-test.mjs:16:  fs.writeFileSync(path.join(directory, 'index.js'), 'export const version = "1.0.0"; export function apply() {}\n')
scripts/reload-test.mjs:36:    const entry = pathToFileURL(path.join(directory, 'index.js')).href
scripts/reload-test.mjs:45:    fs.writeFileSync(path.join(directory, 'index.js'), source('1.0.0'))
scripts/reload-test.mjs:51:    fs.writeFileSync(path.join(directory, 'index.js'), source('1.1.0'))
scripts/reload-test.mjs:68:          const sourceText = fs.readFileSync(path.join(directory, 'index.js'), 'utf8')
scripts/reload-test.mjs:93:    fs.writeFileSync(path.join(directory, 'index.js'), source('1.2.0'))
scripts/reload-test.mjs:118:      internal: { loadCache: new Map([[new URL('../index.js', import.meta.url).href, { source: 'reload fixture cache' }]]) },
scripts/magpie-native-ui-test.mjs:122:  const client = fs.readFileSync(path.join(packageRoot, 'client.js'), 'utf8')
scripts/magpie-native-ui-test.mjs:125:    clientSha256: hash(client), indexSha256: digest(path.join(packageRoot, 'index.js')),
scripts/magpie-native-ui-test.mjs:409:    const expected = fs.readFileSync(path.join(packageRoot, 'client.js'), 'utf8')
scripts/install-local-magpie.mjs:67:  files: unique.length, copied, clientSha256: hash(path.join(target, 'client.js')),
scripts/rtk-test.mjs:27:import { compressMessages, compressRequest, compressText, describeSavings, formatRtkLog } from '../src/token-saver/rtk/index.js'
scripts/standalone-package-test.mjs:219:    for (const unwanted of ['index.js', 'client.js', 'src/updater.js', 'src/reload.js', 'feed/manifest.json']) assert.ok(!paths.includes(unwanted))
scripts/lib/standalone-shared-ui.source.js:2773:    // by scripts/sanitize-test.mjs.
scripts/lib/standalone-shared-ui.source.js:7686:    // Headless test seams use the same stub React as scripts/client-lint.mjs.
packages/standalone/providers.mjs:1:import { listProviders, getProvider } from '../../src/providers/index.js'
src/updater.js:72: * publisher (`scripts/build-manifest.mjs` signs when pointed at it); it is
src/aggregate.js:54:import { chatEndpoint, defaultHeaders, getProvider, modelsEndpoint, providerModelId } from './providers/index.js'
src/reload.js:46:  return new URL('../index.js', entryModuleUrl).href
packages/standalone/channels/business.mjs:6720:         * @param {import('./client.js')} client
packages/standalone/channels/business.mjs:7721:       * @param {import('./client.js')} arg.client
packages/standalone/channels/business.mjs:9228:       * @param {import('../../types/client.js').Client.Options} options
vendor/channel-pack/pack.js:6718:         * @param {import('./client.js')} client
vendor/channel-pack/pack.js:7719:       * @param {import('./client.js')} arg.client
vendor/channel-pack/pack.js:9226:       * @param {import('../../types/client.js').Client.Options} options
src/token-saver/index.js:26:import { compressRequest } from './rtk/index.js'

## 白名单分类（全部 68 行均归属下列类别，非白名单命中 = 0）

### W1 src/**/index.js（D16 保留域内目录索引，非根 index.js）
命中文件：providers/index.js, token-saver/index.js, token-saver/rtk/index.js

### W2 updater-test 插件包升级域 fixture 字符串（src/updater.js D16 未修剪，升级对象为外部插件包布局）
命中文件：scripts/updater-test.mjs

### W3 reload-test 运行时生成 fixture（写入临时包的 index.js，src/reload.js D16）
命中文件：scripts/reload-test.mjs

### W4 magpie-native-ui-test 外部打包产物对照（对照源已改读 E-10 快照）
命中文件：scripts/magpie-native-ui-test.mjs

### W5 install-local-magpie 外部安装目标校验
命中文件：scripts/install-local-magpie.mjs

### W6 standalone-package-test:219 负向断言（断言包内不含已删文件，方案登记保留）
命中文件：scripts/standalone-package-test.mjs

### W7 E-10 逐字节快照自身内容（client.js 原文注释）
命中文件：scripts/lib/standalone-shared-ui.source.js

### W8 business.mjs/pack.js 生成物 JSDoc 类型引用（方案登记：business.mjs:6720/7721；生成物禁改）
命中文件：business.mjs, pack.js

### W9 src/reload.js:46 入口相对 URL（运行时参数语义，D16 不修剪）
命中文件：src/reload.js

### W10 src/updater.js:72 注释提及 build-manifest（D16 src 不修剪）
命中文件：src/updater.js

### W11 测试名/注释中的目录词（catalog/publicModelRows 等，非路径引用）
命中文件：subscription-completion-test.mjs

### 边界修正说明（预跑第 2 轮）
- 初版 pattern 无词边界：`desktop-test.mjs` 误中 `workbench-native-desktop-test.mjs` 自引用、
  `sanitize-test.mjs` 误中 `usage-sanitize-test.mjs`、`upgrade-ui-test.mjs` 误中 `managed-upgrade-ui-test.mjs`
  ——已加 `(^|[^-\w])` 词边界。
- `import\(...\)` 捕获曾吞入模板串（build-channel-pack 的生成代码 `import('./login.js')`、
  reload-test 的运行时 fixture、build-legacy-payload 的 vite stdin 根相对串）——已按
  生成物白名单登记（W 类：生成代码模板 / 运行时 fixture / 根相对构建串）。
- updater-test fixture 命中按实测全量登记（36 行，计划预期 ×4 行系指 :56/:61/:117/:118 四处
  `'client.js'` fixture 字面量；实测升级域内全部 index/client/feed 引用均属同一类别，全量登记）。
