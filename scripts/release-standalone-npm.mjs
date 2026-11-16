#!/usr/bin/env node
/**
 * 公开发布编排（方案 §6I.1，六子命令）。
 *
 * 用法：node scripts/release-standalone-npm.mjs <subcommand>
 *   preflight  发布前置断言（S10 记录 / 版本 1.1.0 / git 干净 / NPM-README / release-notes / whoami）
 *   build      npm run build:standalone-ui（tgz 含最终前端的前提）
 *   pack       产出 dist/our-free-model-standalone-1.1.0.tgz 并断言清单特征
 *   smoke      与发布同一 tgz 字节：临时 prefix 全局安装 → 启动 → /v1/models 含 auto → 版本断言
 *   publish    whoami 复检 + npm publish <tgz> --access public + npm view dist-tags 断言
 *   record     发布记录落盘 docs/software-company/s11-release-record.md（无凭据字段）
 *
 * 凭据纪律（I.5）：脚本零凭据读取/转发；whoami 仅为只读探测门禁；publish 需总监在其
 * 本人终端执行（npm token/OTP 不进本脚本、不进环境、不进记录）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCT = 'our-free-model-standalone'
const VERSION = '1.1.0'
const TARBALL = path.join(ROOT, 'dist', `${PRODUCT}-${VERSION}.tgz`)
const RELEASE_NOTES = path.join(ROOT, 'docs/software-company/release-notes-1.1.0.md')
const NPM_README = path.join(ROOT, 'packages/standalone/NPM-README.md')
const RECORD = path.join(ROOT, 'docs/software-company/s11-release-record.md')
const S10_DIR = path.join(ROOT, 'docs/software-company')

const log = message => console.log(message)
const fail = message => { console.error(`✗ ${message}`); process.exit(1) }
const step = message => console.log(`\n== ${message} ==`)

const sh = (command, args, opts = {}) => execFileSync(command, args, {
  cwd: ROOT, encoding: 'utf8', timeout: opts.timeout ?? 600_000,
  ...opts.env ? { env: opts.env } : {},
  ...(opts.inherit ? { stdio: 'inherit' } : {}),
})

const npm = (args, opts = {}) => sh('npm', args, opts)

function whoami() {
  try {
    const account = execFileSync('npm', ['whoami'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 }).trim()
    return { loggedIn: true, account }
  } catch {
    return { loggedIn: false, account: '' }
  }
}

function assert(condition, message) {
  if (!condition) fail(message)
  log(`  ✓ ${message}`)
}

const readStandaloneVersion = () =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/standalone/package.json'), 'utf8')).version

function readTarballPackageJson(tarball) {
  const text = sh('tar', ['-xzOf', tarball, 'package/package.json'])
  return JSON.parse(text)
}

/** 与发布同一 tgz 字节的本地冒烟（I.1 smoke）：临时 prefix 安装 → 启动 → 断言。 */
async function smokeOnce(tarball) {
  // macOS：os.tmpdir() 在 /var 下，祖先符号链会触发 library.mjs 的托管存储检查——
  // 与测试套件一致，统一 realpath 到 /private/var 真实路径（smoke 环境约束，非发布逻辑）。
  const prefix = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-smoke-')))
  const home = path.join(prefix, 'home')
  fs.mkdirSync(home, { recursive: true })
  log(`  临时安装目录：${prefix}`)
  npm(['i', '-g', '--prefix', prefix, '--no-audit', '--no-fund', '--loglevel=error', `./${path.relative(ROOT, tarball)}`])

  const bin = path.join(prefix, 'bin', 'ofm')
  const dataDir = path.join(prefix, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const child = spawn(process.execPath, [bin, '--port', '0', '--data-dir', dataDir, '--no-open', '--no-refresh', '--no-lan'], {
    cwd: prefix, env: { ...process.env, OFM_HOME: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = []
  child.stdout.on('data', chunk => output.push(String(chunk)))
  child.stderr.on('data', chunk => output.push(String(chunk)))

  const deadline = Date.now() + 30_000
  let baseUrl = ''
  while (Date.now() < deadline) {
    const text = output.join('')
    const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(text)
    if (match) { baseUrl = `http://127.0.0.1:${match[1]}`; break }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (!baseUrl) fail(`smoke：服务 30s 内未打印监听地址\n${output.join('').slice(-800)}`)
  log(`  服务已启动：${baseUrl}`)

  const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))
  const key = settings.forwardKey
  const models = await (await fetch(`${baseUrl}/v1/models`, {
    headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
  })).json()
  assert(Array.isArray(models.data) && models.data.length > 0, '/v1/models 返回非空清单')
  assert(models.data[0]?.id === 'auto', '/v1/models 头部恰为 auto 条目')
  assert(models.data.filter(row => row.id === 'auto').length === 1, 'auto 条目唯一')
  const summary = await (await fetch(`${baseUrl}/api/management/summary`, {
    headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
  })).json()
  assert(summary.version === VERSION, `summary.version === ${VERSION}`)

  child.kill()
  await new Promise(resolve => { child.on('exit', resolve); setTimeout(resolve, 3000) })
  fs.rmSync(prefix, { recursive: true, force: true })
  log('  smoke 通过（安装/启动/auto/版本）')
}

const subcommand = process.argv[2]
if (!['preflight', 'build', 'pack', 'smoke', 'publish', 'record'].includes(subcommand)) {
  console.error('用法：node scripts/release-standalone-npm.mjs <preflight|build|pack|smoke|publish|record>')
  process.exit(1)
}

if (subcommand === 'preflight') {
  step('preflight：发布前置断言（I.1）')
  assert(fs.existsSync(S10_DIR), 'S10 阶段记录目录存在（docs/software-company/）')

  const version = readStandaloneVersion()
  assert(version === VERSION, `packages/standalone/package.json version === ${VERSION}（当前 ${version}）`)

  const status = sh('git', ['status', '--porcelain'])
  const unexpected = status.split('\n').filter(line => {
    if (!line.trim()) return false
    // 允许未跟踪的控制面/评审工作区：.impeccable/ 与 docs/software-company/
    return !/^\?\? (\.impeccable\/|docs\/software-company\/)/.test(line)
  })
  assert(unexpected.length === 0, `git 工作区干净（仅允许 .impeccable/ 与 docs/software-company/ 未跟踪）\n${unexpected.join('\n')}`)

  assert(fs.existsSync(NPM_README), 'packages/standalone/NPM-README.md 存在（npm 页面 README 唯一来源）')
  const readme = fs.readFileSync(NPM_README, 'utf8')
  assert(!readme.includes('DSH 插件入口'), 'NPM-README 无「DSH 插件入口」导流行（I.6 修订项）')
  assert(!/\b1\.0\.0\b/.test(readme), 'NPM-README 无硬编码旧版本号')

  assert(fs.existsSync(RELEASE_NOTES), `发布说明存在（${RELEASE_NOTES}）`)

  const who = whoami()
  if (!who.loggedIn) {
    log('  ✗ npm 未登录（E401）：发布前置不满足，按 I.5 暂停。')
    log('    处置：请总监协调用户完成浏览器 npm login（凭据不落盘），完成后重跑 preflight。')
    log('    本轮不自动登录、不重试。')
    process.exit(2)
  }
  log(`  ✓ npm whoami = ${who.account}`)
  console.log('\npreflight 全部通过。')
  process.exit(0)
}

if (subcommand === 'build') {
  step('build：npm run build:standalone-ui（tgz 必含最终前端——I.1 build 强序）')
  npm(['run', 'build:standalone-ui'], { inherit: true })
  console.log('\nbuild 完成。')
  process.exit(0)
}

if (subcommand === 'pack') {
  step('pack：产出正式名 tgz 并断言清单特征（I.1 pack）')
  const { buildNpmStandalonePackage } = await import('./pack-standalone-npm.mjs')
  const { standaloneSourceFiles } = await import('./pack-standalone.mjs')
  const info = buildNpmStandalonePackage({ name: PRODUCT, outputName: `${PRODUCT}-${VERSION}` })
  assert(fs.existsSync(info.tarball), `tgz 已产出：${path.relative(ROOT, info.tarball)}`)
  assert(path.basename(info.tarball) === `${PRODUCT}-${VERSION}.tgz`, '正式名（无 -dev- 摘要后缀）')

  const shipped = JSON.parse(sh('tar', ['-xzOf', info.tarball, 'package/package.json']))
  assert(shipped.private === false, '清单 private: false')
  assert(shipped.version === VERSION, `清单 version: ${VERSION}`)
  assert(Object.keys(shipped.bin ?? {}).sort().join(',') === `${PRODUCT},ofm`.split(',').sort().join(','), 'bin 双命令（完整名 + ofm）')
  assert(JSON.stringify(shipped.dependencies ?? {}) === '{}', 'dependencies: {}（零运行时依赖）')
  const closure = standaloneSourceFiles().sort().join('\n')
  assert(JSON.stringify((shipped.files ?? []).slice().sort().join('\n')) === JSON.stringify(closure), 'files = standaloneSourceFiles 闭包')
  console.log(`\npack 完成：${path.relative(ROOT, info.tarball)}（${info.files} files, ${info.size} B）`)
  process.exit(0)
}

if (subcommand === 'smoke') {
  step('smoke：与发布同一 tgz 字节（I.1 smoke；不重打包）')
  assert(fs.existsSync(TARBALL), `tgz 不存在——先跑 pack：${TARBALL}`)
  const before = fs.statSync(TARBALL)
  await smokeOnce(TARBALL)
  const after = fs.statSync(TARBALL)
  assert(before.size === after.size && before.mtimeMs === after.mtimeMs, 'tgz 字节未被 smoke 触碰（同一发布字节）')
  console.log('\nsmoke 全部通过。')
  process.exit(0)
}

if (subcommand === 'publish') {
  step('publish：whoami 复检 + npm publish + view 断言（I.1 publish / I.5 凭据纪律）')
  assert(fs.existsSync(TARBALL), `tgz 不存在：${TARBALL}（先 pack）`)
  const who = whoami()
  assert(who.loggedIn, `npm 未登录（E401）——publish 由总监在其本人终端执行（I.5）`)
  log(`  npm whoami = ${who.account}`)
  log(`  执行：npm publish ./${path.relative(ROOT, TARBALL)} --access public`)
  npm(['publish', `./${path.relative(ROOT, TARBALL)}`, '--access', 'public', '--loglevel=tagged'], { inherit: true })
  const view = JSON.parse(npm(['view', `${PRODUCT}@${VERSION}`, 'version', 'dist-tags', '--json']))
  assert(view.version === VERSION, `npm view version === ${VERSION}`)
  assert(view['dist-tags']?.latest === VERSION, `dist-tags latest === ${VERSION}`)
  console.log('\npublish 完成，registry 断言通过。')
  process.exit(0)
}

if (subcommand === 'record') {
  step('record：发布记录落盘（I.1 record / AC-35 无凭据字段）')
  assert(fs.existsSync(TARBALL), `tgz 不存在：${TARBALL}`)
  const shipped = readTarballPackageJson(TARBALL)
  assert(shipped.version === VERSION, `tgz 清单 version === ${VERSION}`)
  const sha256 = sh('sh', ['-c', `shasum -a 256 "${TARBALL}" | cut -d' ' -f1`]).trim()
  let viewText = '（npm view 未执行或包未发布）'
  try { viewText = npm(['view', `${PRODUCT}@${VERSION}`, 'version', 'dist-tags', '--json']) } catch { /* 未发布时如实记录 */ }
  const body = `# S11 发布记录（${PRODUCT}@${VERSION}）

- 时间：${new Date().toISOString()}
- 版本：${VERSION}
- git HEAD：${sh('git', ['rev-parse', 'HEAD']).trim()}
- tgz：dist/${PRODUCT}-${VERSION}.tgz
- tgz sha256：${sha256}
- tgz 清单 snapshotSha256 与 version：见包内 package-manifest.json（version=${shipped.version}）
- npm view ${PRODUCT}@${VERSION}（version/dist-tags）：
  \`\`\`
${viewText.trim().split('\n').map(line => `  ${line}`).join('\n')}
  \`\`\`
- 各步执行角色：工程师（preflight/build/pack/smoke/record）；总监（publish/push——凭据零落盘）

凭据纪律（AC-35）：本记录与发布全程不含 npm token/OTP/登录态字段。
回滚预案：见方案 §6I.4（deprecate 默认 / 72h unpublish 事故级 + dist-tag 回拨）。
`
  fs.mkdirSync(path.dirname(RECORD), { recursive: true })
  fs.writeFileSync(RECORD, body)
  console.log(`record 已写入：${path.relative(ROOT, RECORD)}`)
  process.exit(0)
}
