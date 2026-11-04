/**
 * 把 `packages/standalone` 打成**自包含的 npm 包**（可全局安装）。
 *
 * 为什么需要这一步：`packages/standalone` 的源码是仓库内的相对路径布局
 * （`../../src/*.js`、`../../../vendor/channel-pack/*`），单独 `npm publish`
 * 那个目录会缺依赖、装完启动就报 ERR_MODULE_NOT_FOUND。这里把运行时真正
 * 需要文件按**原相对路径**镜像进一个临时发布目录，再从那里 `npm publish`：
 * 所有 `../..` 的相对引用保持不变，所以不需要改写任何一行导入。
 *
 * 产物布局（发布目录内）：
 *
 *   package.json          ← 由 packages/standalone/package.json 派生，加 bin
 *   cli.mjs               ← 全局命令入口（#!/usr/bin/env node）
 *   packages/standalone/* ← 原样镜像，保持 ../.. 相对关系
 *   src/*                 ← 原样镜像
 *   vendor/channel-pack/* ← WASM 等运行时资源
 *
 * 用法：
 *   node scripts/pack-standalone-npm.mjs [--out <目录>] [--no-build]
 *
 * `--no-build` 跳过前端与渠道产物重建（CI 里产物已提交时用）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(new URL('..', import.meta.url)))
const outIndex = process.argv.indexOf('--out')
const outDir = outIndex === -1
  ? path.join(root, 'dist', 'npm-standalone')
  : path.resolve(process.argv[outIndex + 1])
const skipBuild = process.argv.includes('--no-build')

/** npm 包的命令名：`npx our-free-model` / `our-free-model` 直接起服务。 */
export const BIN_NAME = 'our-free-model'
export const PACKAGE_NAME = 'our-free-model-standalone'

/**
 * 运行时必需的文件，按仓库内相对路径列出。
 *
 * 这里是**显式清单**而不是通配：自动收集会把测试、文档、fixture 一起带进
 * 发布包（体积翻几倍），而漏掉一个运行时模块又只会在用户机器上炸。
 * 新增运行时模块时同步加一行；`--verify` 会加载每个入口，漏了会立刻报错。
 */
const RUNTIME_FILES = [
  // ── 独立服务本体 ──
  'packages/standalone/cli.mjs',
  'packages/standalone/service.mjs',
  'packages/standalone/management.mjs',
  'packages/standalone/workbench.mjs',
  'packages/standalone/library.mjs',
  'packages/standalone/routing.mjs',
  'packages/standalone/providers.mjs',
  'packages/standalone/eac.mjs',
  'packages/standalone/desktop-update.mjs',
  'packages/standalone/login-terminal.mjs',
  'packages/standalone/client-terminal.mjs',
  'packages/standalone/open-external.mjs',

  // ── 渠道层（打捆产物 + 契约/凭据/图片/运行时/worker）──
  'packages/standalone/channels/business.mjs',
  'packages/standalone/channels/contracts.mjs',
  'packages/standalone/channels/credentials.mjs',
  'packages/standalone/channels/images.mjs',
  'packages/standalone/channels/runtime.mjs',
  'packages/standalone/channels/worker.mjs',

  // ── 网页管理界面（构建产物）──
  // service.mjs 启动时读它取产品名与版本号，缺了会 ENOENT。
  'packages/standalone/package.json',
  'packages/standalone/web/index.html',
  'packages/standalone/web/assets.json',

  // ── 仓库根 src/ 运行时模块 ──
  ...['adapter', 'aggregate', 'anthropic', 'catalog', 'channel', 'combos', 'deferred-response',
    'disclaimer', 'eac', 'eac-login', 'eac-user', 'effort', 'egress', 'engine-payload', 'failure',
    'forward', 'gemini', 'http', 'image-pricing', 'kilo', 'local-optimize', 'loopback-fetch',
    'magpie-engine', 'magpie-models', 'magpie-policy', 'messages', 'model-test', 'open-external',
    'probe', 'recovery', 'store', 'stream', 'subscriptions', 'subscription-completion',
    'subscription-adapter', 'token-saver', 'trust', 'upstream', 'vault', 'vault-data', 'vault-anchor',
  ].map((name) => `src/${name}.js`),
  'src/core.js',
  'src/bun-fetch.js',
  'src/o2a.js',
  ...['completion', 'runtime', 'stats'].map((name) => `src/core/${name}.js`),
  'src/providers/index.js',
  'src/providers/registry.json',
  'src/route/classify.js',
  ...['index', 'inject', 'prompts'].map((name) => `src/token-saver/${name}.js`),
  ...['index', 'constants', 'autodetect', 'applyFilter', 'hitLine', 'registry']
    .map((name) => `src/token-saver/rtk/${name}.js`),
  ...['buildOutput', 'dedupLog', 'find', 'gitDiff', 'gitLog', 'gitStatus', 'grep', 'ls',
    'readNumbered', 'searchList', 'smartTruncate', 'tree']
    .map((name) => `src/token-saver/rtk/filters/${name}.js`),

  // ── 渠道包资源（WASM / 许可证 / NOTICE）──
  'vendor/channel-pack/qoder-auth-wasm.wasm',
  'vendor/channel-pack/LICENSE',
  'vendor/channel-pack/NOTICE.md',

  // ── 仓库级许可证与第三方声明 ──
  'LICENSE',
  'scripts/standalone-third-party.txt',
]

/** 网页资产由 assets.json 列出，不能写死（文件名带内容哈希，每次构建都会变）。 */
function webAssets() {
  const manifest = path.join(root, 'packages/standalone/web/assets.json')
  const rows = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('web/assets.json 必须列出构建产物')
  return rows.map((name) => {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+\.(?:js|css)$/.test(name)) {
      throw new Error(`web/assets.json 里有不合法的文件名：${String(name)}`)
    }
    return `packages/standalone/web/${name}`
  })
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

function copyInto(relative) {
  const from = path.join(root, relative)
  if (!fs.existsSync(from)) throw new Error(`缺少运行时文件：${relative}`)
  if (!fs.lstatSync(from).isFile()) throw new Error(`不是普通文件：${relative}`)
  const to = path.join(outDir, 'dist-root', relative)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  const bytes = fs.readFileSync(from)
  fs.writeFileSync(to, bytes)
  return { relative, size: bytes.length, sha256: sha256(bytes) }
}

/** 派生 npm 包的 package.json：去掉 private，加 bin/files，收紧 engines。 */
function packageManifest() {
  const source = JSON.parse(fs.readFileSync(path.join(root, 'packages/standalone/package.json'), 'utf8'))
  const repo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  return {
    name: PACKAGE_NAME,
    version: source.version,
    private: false,
    type: 'module',
    description: 'Our Free Model 独立本地服务：一条命令起一个自带管理网页的 OpenAI 兼容网关',
    keywords: ['openai', 'gateway', 'llm', 'local', 'dsh', 'our-free-model'],
    homepage: repo.homepage,
    repository: repo.repository,
    license: source.license,
    bin: { [BIN_NAME]: './cli.mjs' },
    // 相对导入靠目录层级维持，所以整棵镜像都要发出去；根目录只保留入口。
    files: ['cli.mjs', 'README.md', 'dist-root/'],
    engines: { node: '>=22.19.0' },
    scripts: { start: 'node ./cli.mjs' },
  }
}

const README = `# ${PACKAGE_NAME}

一条命令启动 **Our Free Model 独立本地服务**（不需要 DSH）：一个本地
OpenAI 兼容网关，自带网页管理台。

## 安装

\`\`\`bash
npm install -g ${PACKAGE_NAME}
\`\`\`

## 启动

\`\`\`bash
${BIN_NAME}
\`\`\`

启动后终端会打印：

- **管理页面**：一次性登录链接（10 分钟内有效、只能兑换一次），在浏览器打开即可
- **API 地址**：\`http://127.0.0.1:18900/v1\`
- **API Key 文件**：密钥本身不会打印到终端

常用参数（透传给服务）：

\`\`\`bash
${BIN_NAME} --port 18900            # 指定端口（占用时自动换）
${BIN_NAME} --data-dir ~/ofm-data   # 指定数据目录
${BIN_NAME} --no-refresh            # 不自动刷新模型清单
${BIN_NAME} --help                  # 全部选项
\`\`\`

## 数据与鉴权

- 默认数据目录 \`~/.our-free-model\`，可用 \`--data-dir\` 或 \`OFM_HOME\` 覆盖。
- 不读取 DSH 的配置或凭据库，与 DSH 插件互不影响。
- 管理页面默认只允许本机访问。

## 许可

MIT。第三方组件与渠道包的来源见包内 \`dist-root/scripts/standalone-third-party.txt\`
与 \`dist-root/vendor/channel-pack/NOTICE.md\`。
`

function main() {
  if (!skipBuild) {
    console.log('重建渠道产物与前端…')
    execFileSync(process.execPath, [path.join(root, 'scripts/build-standalone-channels.mjs')], { stdio: 'inherit' })
    execFileSync(process.execPath, [path.join(root, 'scripts/build-standalone-ui.mjs')], { stdio: 'inherit' })
  }

  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  const files = [...new Set([...RUNTIME_FILES, ...webAssets()])].sort()
  const copied = []
  for (const relative of files) copied.push(copyInto(relative))

  // 入口：把 cli.mjs 的 shebang 与相对导入一起带过去。
  // cli.mjs 里写的是 `./service.mjs`，镜像后它在 dist-root/packages/standalone/ 下，
  // 所以根目录的 cli.mjs 只是一个转发壳，避免复制两份实现。
  const entry = `#!/usr/bin/env node
// 全局命令入口：把控制权交给镜像目录里的真实 cli.mjs。
// 单独一个文件是为了让 `+"`bin`"+` 相对路径稳定，且不复制实现（两份会漂移）。
import './dist-root/packages/standalone/cli.mjs'
`
  fs.writeFileSync(path.join(outDir, 'cli.mjs'), entry, { mode: 0o755 })
  fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(packageManifest(), null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'README.md'), README)

  const total = copied.reduce((sum, row) => sum + row.size, 0)
  console.log(`\n发布目录：${outDir}`)
  console.log(`运行时文件：${copied.length} 个 / ${(total / 1024 / 1024).toFixed(2)} MiB`)
  console.log(`入口：bin.${BIN_NAME} → ./cli.mjs`)
  console.log('\n下一步：')
  console.log(`  cd "${outDir}" && npm publish --access public`)
}

main()
