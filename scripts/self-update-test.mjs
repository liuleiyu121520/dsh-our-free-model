/**
 * 自更新（S18 / FR-17）测试：单元段（版本比较/安装来源/npm view mock/requestRun 状态机）
 * + 集成段（伪全局目录 + 假 npm + 替身 cli 的真进程自重启端到端，含 close 挂起兜底
 * 注入用例 §V11.6）。全程零真实 registry 调用。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compareVersions, detectInstallKind, createSelfUpdate, passthroughArgs, forceReleaseLock, runRestartSequence } from '../packages/standalone/self-update.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-self-update-'))
let failures = 0
let checks = 0
const check = async (name, run) => {
  checks++
  try { await run(); console.log(`ok   ${name}`) }
  catch (error) { failures++; console.log(`FAIL ${name}: ${error.stack}`) }
}
const delay = ms => new Promise(resolve => { setTimeout(resolve, ms) })
const waitFor = async (predicate, { timeout = 15000, message = '条件未在时限内满足' } = {}) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await delay(100)
  }
  throw new Error(message)
}

// ── 共用替身：假 npm（view→版本号 / i→成败与挂起可控）与伪全局目录 ──────────────
const fakeNpm = path.join(scratch, 'fake-npm.mjs')
fs.writeFileSync(fakeNpm, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === 'view') {
  const mode = process.env.FAKE_NPM_VIEW ?? 'ok'
  if (mode === 'fail') { process.stderr.write('E404 fixture view failure\\n'); process.exit(1) }
  else if (mode === 'hang') { process.stdout.write(''); setTimeout(() => {}, 120000) }
  else if (mode === 'garbage') { process.stdout.write('not-json at all'); process.exit(0) }
  else { process.stdout.write(JSON.stringify(process.env.FAKE_NPM_VERSION ?? '1.9.9')); process.exit(0) }
} else if (args[0] === 'i' || args[0] === 'install') {
  const mode = process.env.FAKE_NPM_INSTALL ?? 'ok'
  if (mode === 'fail') { process.stderr.write('EACCES fixture install failure\\n'); process.exit(1) }
  else if (mode === 'hang') { setTimeout(() => {}, 120000) }
  else process.exit(0)
} else process.exit(0)
`)
fs.chmodSync(fakeNpm, 0o755)
const globalStandaloneDir = path.join(scratch, 'fake-global', 'lib', 'node_modules', 'our-free-model-standalone', 'packages', 'standalone')
fs.mkdirSync(globalStandaloneDir, { recursive: true })
const unitDataDir = path.join(scratch, 'unit-data')
fs.mkdirSync(unitDataDir, { recursive: true })
delete process.env.FAKE_NPM_VIEW
delete process.env.FAKE_NPM_INSTALL

// ── 单元段 ────────────────────────────────────────────────────────────────────
await check('compareVersions：三段逐段、prerelease<release、非法输入保守 null', () => {
  assert.equal(compareVersions('1.2.4', '1.2.5'), -1)
  assert.equal(compareVersions('1.2.5', '1.2.4'), 1)
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1, '逐段数字比较：1.2.10 > 1.2.9')
  assert.equal(compareVersions('1.2.4', '1.2.4'), 0)
  assert.equal(compareVersions('1.2.5-rc.1', '1.2.4'), 1)
  assert.equal(compareVersions('1.2.5', '1.2.5-rc.1'), 1, '同三段：release > prerelease（rc→正式场景）')
  assert.equal(compareVersions('1.2.5-rc.1', '1.2.5'), -1)
  assert.equal(compareVersions('1.2.5-rc.1', '1.2.5-rc.1'), 0)
  for (const [a, b] of [['abc', '1.2.4'], ['', '1.2.4'], [null, '1.2.4'], ['1.2.4', undefined],
    ['1.2', '1.2.3'], ['1.2.3.4', '1.2.5'], ['v1.2.3', '1.2.4'], ['1.2.4', '1.2.3.4']]) {
    assert.equal(compareVersions(a, b), null, `${String(a)} vs ${String(b)} 必须保守视为不可比`)
  }
})
await check('detectInstallKind：npx/全局/本地/源码/Windows 安装来源矩阵', () => {
  assert.equal(detectInstallKind({ platform: 'darwin', moduleDir: `${os.homedir()}/.nvm/versions/node/v22.20.0/lib/node_modules/our-free-model-standalone/packages/standalone` }), 'global')
  assert.equal(detectInstallKind({ platform: 'darwin', moduleDir: '/usr/local/lib/node_modules/our-free-model-standalone/packages/standalone' }), 'global')
  assert.equal(detectInstallKind({ platform: 'linux', moduleDir: '/home/x/.npm/_npx/abc123/node_modules/our-free-model-standalone/packages/standalone' }), 'npx')
  assert.equal(detectInstallKind({ platform: 'darwin', moduleDir: '/Users/x/proj/node_modules/our-free-model-standalone/packages/standalone' }), 'local', '无 lib 段的项目本地安装必须禁用')
  assert.equal(detectInstallKind({ platform: 'darwin', moduleDir: '/Users/x/dsh-our-free-model/packages/standalone' }), 'source')
  assert.equal(detectInstallKind({ platform: 'darwin', moduleDir: '' }), 'source', '判定不可得 → 保守禁用')
  assert.equal(detectInstallKind({ platform: 'win32', moduleDir: 'C:\\Users\\x\\lib\\node_modules\\our-free-model-standalone' }), 'unsupported', 'Windows 一律 unsupported（范围声明）')
  assert.equal(detectInstallKind({ platform: 'win32', moduleDir: '/Users/x/.npm/_npx/a/node_modules/our-free-model-standalone' }), 'unsupported')
})
await check('passthroughArgs：实际端口透传、data-dir/no-refresh 原样、lan 系与 probe 不透传', () => {
  assert.deepEqual(passthroughArgs(['node', 'cli.mjs', '--port', '0', '--data-dir', '/tmp/x', '--no-open'], 18999),
    ['--port', '18999', '--data-dir', '/tmp/x'], '--port 0 必须透传实际端口而非原值')
  assert.deepEqual(passthroughArgs(['node', 'cli.mjs', '--data-dir', '/tmp/x'], 18999),
    ['--data-dir', '/tmp/x'], 'argv 无 --port 时不透传（settings 已持久化实际端口）')
  assert.deepEqual(passthroughArgs(['node', 'cli.mjs', '--port', '5000', '--no-refresh', '--lan', '--lan-port', '8080', '--probe'], 5001),
    ['--port', '5001', '--no-refresh'], 'lan 系（settings 持久化）与 --probe（停用兼容）不得透传')
})
await check('forceReleaseLock：pid+product 校验通过才 unlink，异常归属留手动指引', () => {
  const dir = path.join(scratch, 'lock-unit')
  fs.mkdirSync(dir, { recursive: true })
  const lockFile = path.join(dir, 'service.lock')
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, product: 'our-free-model-standalone', token: 't' }))
  const notes = []
  assert.equal(forceReleaseLock({ dataDir: dir, log: text => notes.push(text) }), true)
  assert.equal(fs.existsSync(lockFile), false, '归属校验通过的锁必须被删除')
  assert.equal(notes.length, 1)
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid + 1, product: 'our-free-model-standalone', token: 't' }))
  assert.equal(forceReleaseLock({ dataDir: dir, log: text => notes.push(text) }), false)
  assert.equal(fs.existsSync(lockFile), true, '他人锁不得自动删除')
  assert.match(notes[notes.length - 1], /手动删除/, '失败分支必须留删锁指引')
  fs.writeFileSync(lockFile, '{broken')
  assert.equal(forceReleaseLock({ dataDir: dir, log: text => notes.push(text) }), false)
  assert.match(notes[notes.length - 1], /手动删除/)
  fs.unlinkSync(lockFile)
  assert.equal(forceReleaseLock({ dataDir: dir, log: text => notes.push(text) }), true, '无锁文件视为已释放')
})
await check('runRestartSequence：close 挂起兜底 exit(0) 且锁被强制释放（R9O-001）', async () => {
  const dir = path.join(scratch, 'restart-stuck')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'service.lock'), JSON.stringify({ pid: process.pid, product: 'our-free-model-standalone', token: 't' }))
  const exits = []
  const closeCalls = []
  await runRestartSequence({
    close: () => { closeCalls.push(1); return new Promise(() => {}) },
    dataDir: dir, moduleDir: globalStandaloneDir, closeTimeoutMs: 150, testStuckClose: true,
    exit: code => exits.push(code),
  })
  assert.deepEqual(exits, [0], '兜底路径必须 exit(0) 终结一切连接')
  assert.equal(fs.existsSync(path.join(dir, 'service.lock')), false, '竞速超时后必须强制解锁')
  const log = fs.readFileSync(path.join(dir, 'update.log'), 'utf8')
  assert.match(log, /close 超时/, '兜底路径必须在 update.log 留痕')
  assert.match(log, /service\.lock/, '留痕必须含删锁指引')
  assert.deepEqual(closeCalls, [], 'TEST_STUCK_CLOSE 注入时不得真实调用 close')
})
await check('runRestartSequence：close reject 分支同样先强制释放锁再 exit(1)（R10O-001 闭环）', async () => {
  const dir = path.join(scratch, 'restart-reject')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'service.lock'), JSON.stringify({ pid: process.pid, product: 'our-free-model-standalone', token: 't' }))
  const exits = []
  await runRestartSequence({
    close: () => Promise.reject(new Error('组件关闭崩溃')),
    dataDir: dir, moduleDir: globalStandaloneDir, closeTimeoutMs: 2000,
    exit: code => exits.push(code),
  })
  assert.deepEqual(exits, [1], 'close reject：安装已成功，exit(1) 留痕退出（ofm 可手动启动）')
  assert.equal(fs.existsSync(path.join(dir, 'service.lock')), false, 'reject 分支同样必须满足「锁必释放或留痕含指引」')
  const log = fs.readFileSync(path.join(dir, 'update.log'), 'utf8')
  assert.match(log, /关闭失败/, 'reject 分支必须在 update.log 留痕')
})
await check('runRestartSequence：正常路径派生 detached 替身、日志与退出码', async () => {
  const dir = path.join(scratch, 'restart-ok')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(globalStandaloneDir, 'cli.mjs'), '#!/usr/bin/env node\nprocess.stdout.write(\'stand-in-cli-boots\\n\')\n')
  const exits = []
  const children = []
  await runRestartSequence({
    close: () => Promise.resolve(),
    dataDir: dir, moduleDir: globalStandaloneDir, closeTimeoutMs: 1000,
    passthroughArgs: ['--port', '18999', '--data-dir', dir],
    spawnImpl: (command, args, options) => {
      const fake = { pid: 4321, unref: () => { children.push(args) } }
      assert.equal(command, process.execPath)
      assert.deepEqual(args.slice(-1), ['--no-open'], '必须强制附加 --no-open')
      assert.ok(!args.includes('--update-restart'), '不得附加 --update-restart 旗标（目标为旧代码时严格解析会启动失败）')
      assert.equal(options.env.OFM_SELF_UPDATE_RESTART, '1', '接力信号必须经 spawn env OFM_SELF_UPDATE_RESTART=1 传递')
      assert.ok(options.detached === true)
      assert.equal(args[0], path.join(globalStandaloneDir, 'cli.mjs'), '派生目标必须是 moduleDir/cli.mjs')
      return fake
    },
    exit: code => exits.push(code),
  })
  assert.deepEqual(exits, [0])
  assert.deepEqual(children, [[path.join(globalStandaloneDir, 'cli.mjs'), '--port', '18999', '--data-dir', dir, '--no-open']])
  assert.match(fs.readFileSync(path.join(dir, 'update.log'), 'utf8'), /已派生新进程/)

  const missing = path.join(scratch, 'restart-missing-cli')
  fs.mkdirSync(missing, { recursive: true })
  const missingExits = []
  await runRestartSequence({
    close: () => Promise.resolve(),
    dataDir: missing, moduleDir: path.join(scratch, 'no-such-module-dir'), closeTimeoutMs: 1000,
    exit: code => missingExits.push(code),
  })
  assert.deepEqual(missingExits, [1], '新版 cli 未就位：留痕并 exit(1)，不得派生')
  assert.match(fs.readFileSync(path.join(missing, 'update.log'), 'utf8'), /未找到新版入口/)
})
await check('检查器：30s 首检默认与假 npm view 输出流转（idle→available）', async () => {
  const checker = createSelfUpdate({
    currentVersion: '1.2.4', moduleDir: globalStandaloneDir, npmCommand: fakeNpm,
    firstDelayMs: 80, intervalMs: 3_600_000, viewTimeoutMs: 1000, installTimeoutMs: 2000,
    dataDir: unitDataDir, logger: { warn() {} }, performRestart: async () => {},
  })
  try {
    assert.equal(checker.installKind, 'global')
    assert.deepEqual(checker.state(), {
      current: '1.2.4', latest: null, hasUpdate: false, canSelfUpdate: true,
      checkedAt: null, lastError: null, state: 'idle',
    })
    checker.start()
    await waitFor(async () => {
      if (checker.state().latest !== null) return true
      // start() 的定时首检是主验证面；偶发瞬时失败时补一次显式检查兜底（与下一
      // 用例的静默重试语义一致），不让套件因环境抖动悬挂。
      await checker.checkNow()
      return null
    }, {
      timeout: 8000,
      message: `首检未在时限内取得 latest（lastError=${checker.state().lastError}）`,
    })
    const state = checker.state()
    assert.equal(state.hasUpdate, true)
    assert.equal(state.state, 'available')
    assert.equal(state.lastError, null)
    assert.ok(state.checkedAt !== null)
  } finally { checker.stop() }
})
await check('检查器：view 非零退出/超时/垃圾输出静默——lastError 记录、latest 保留旧值', async () => {
  const checker = createSelfUpdate({
    currentVersion: '1.2.4', moduleDir: globalStandaloneDir, npmCommand: fakeNpm,
    firstDelayMs: 3_600_000, intervalMs: 3_600_000, viewTimeoutMs: 600, installTimeoutMs: 2000,
    dataDir: unitDataDir, logger: { warn() {} }, performRestart: async () => {},
  })
  try {
    await waitFor(async () => {
      if (checker.state().latest !== null) return true
      await checker.checkNow()
      return null
    }, { timeout: 8000, message: `首检未取得 latest（lastError=${checker.state().lastError}）` })
    for (const mode of ['fail', 'hang', 'garbage']) {
      process.env.FAKE_NPM_VIEW = mode
      await checker.checkNow()
      const state = checker.state()
      assert.equal(state.latest, '1.9.9', `${mode}：检查失败必须保留上次 latest`)
      assert.ok(state.lastError !== null, `${mode}：失败必须记入 lastError`)
      assert.equal(state.state, 'available', `${mode}：静默失败不得打断状态`)
    }
    delete process.env.FAKE_NPM_VIEW
    await checker.checkNow()
    assert.equal(checker.state().lastError, null, '恢复后 lastError 必须清空')
  } finally {
    delete process.env.FAKE_NPM_VIEW
    checker.stop()
  }
})
await check('requestRun 拒绝路径：非全局 409（含手动命令）、无更新 409、updating 重复 409', async () => {
  const reject409 = async promise => {
    const error = await promise.then(() => null, errortype => errortype)
    assert.ok(error, '必须抛出异常')
    assert.equal(error.statusCode, 409)
    return error
  }
  // 源码直跑形态：非全局 → 409 + 手动升级命令（AC-49 服务侧面）
  const source = createSelfUpdate({
    currentVersion: '1.2.4', moduleDir: path.join(root, 'packages/standalone'), npmCommand: fakeNpm,
    firstDelayMs: 3_600_000, dataDir: unitDataDir, logger: { warn() {} }, performRestart: async () => {},
  })
  const sourceError = await reject409(Promise.resolve().then(() => source.requestRun()))
  assert.match(sourceError.message, /npm i -g our-free-model-standalone/)
  source.stop()
  // 无更新（latest == current）→ 409
  process.env.FAKE_NPM_VERSION = '1.2.4'
  const fresh = createSelfUpdate({
    currentVersion: '1.2.4', moduleDir: globalStandaloneDir, npmCommand: fakeNpm,
    firstDelayMs: 3_600_000, dataDir: unitDataDir, logger: { warn() {} }, performRestart: async () => {},
  })
  try {
    await fresh.checkNow()
    assert.equal(fresh.state().hasUpdate, false)
    await reject409(Promise.resolve().then(() => fresh.requestRun()))
  } finally { delete process.env.FAKE_NPM_VERSION; fresh.stop() }
  // updating 中重复 → 409；install 超时进入 failed 后放行重试（AC-50）
  process.env.FAKE_NPM_INSTALL = 'hang'
  let restarted = 0
  const busy = createSelfUpdate({
    currentVersion: '1.2.4', moduleDir: globalStandaloneDir, npmCommand: fakeNpm,
    firstDelayMs: 3_600_000, installTimeoutMs: 400, dataDir: unitDataDir,
    logger: { warn() {} }, performRestart: async () => { restarted++ },
  })
  try {
    await busy.checkNow()
    const accepted = busy.requestRun()
    assert.deepEqual(accepted, { ok: true, target: '1.9.9' })
    const duplicate = await reject409(Promise.resolve().then(() => busy.requestRun()))
    assert.match(duplicate.message, /进行中/)
    await waitFor(() => busy.state().state === 'failed', { timeout: 5000, message: 'install 超时后必须进入 failed' })
    assert.match(busy.state().lastError, /npm install 失败/)
    delete process.env.FAKE_NPM_INSTALL
    busy.requestRun() // failed 放行重试：不再抛 409
    await waitFor(() => restarted === 1, { timeout: 5000, message: '重试成功后必须推进到重启阶段' })
    assert.equal(busy.state().state, 'restarting')
  } finally {
    delete process.env.FAKE_NPM_INSTALL
    busy.stop()
  }
})
await check('requestRun 失败路径：假 npm i 非零退出 → failed + 留痕 + 不触发 performRestart（AC-50）', async () => {
  const dir = path.join(scratch, 'ac50-data')
  fs.mkdirSync(dir, { recursive: true })
  let restarted = 0
  process.env.FAKE_NPM_INSTALL = 'fail'
  const checker = createSelfUpdate({
    currentVersion: '1.2.4', moduleDir: globalStandaloneDir, npmCommand: fakeNpm,
    firstDelayMs: 3_600_000, installTimeoutMs: 2000, dataDir: dir,
    logger: { warn() {} }, performRestart: async () => { restarted++ },
  })
  try {
    await checker.checkNow()
    assert.deepEqual(checker.requestRun(), { ok: true, target: '1.9.9' })
    const failed = await waitFor(() => checker.state().state === 'failed' ? checker.state() : null,
      { timeout: 5000, message: '安装失败必须进入 failed 状态' })
    assert.match(failed.lastError, /npm install 失败/)
    assert.match(failed.lastError, /EACCES fixture install failure|退出码 1/)
    assert.equal(restarted, 0, '安装失败绝不触发自重启')
    const log = fs.readFileSync(path.join(dir, 'update.log'), 'utf8')
    assert.match(log, /1\.9\.9/)
    assert.match(log, /安装失败/)
    assert.match(log, /现存安装未改动/)
  } finally {
    delete process.env.FAKE_NPM_INSTALL
    checker.stop()
  }
})

// ── 集成段：伪全局目录 + 替身 cli + 真进程自重启端到端 ──────────────────────────
// 本地 fixture 上游：子进程内清单刷新零真实外网（与 standalone-test 同惯例）。
const upstream = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [] }))
  })
})
upstream.listen(0, '127.0.0.1')
await new Promise(resolve => upstream.once('listening', resolve))
const fixtureBase = `http://127.0.0.1:${upstream.address().port}`
process.env.OUR_FREE_MODEL_BASE = fixtureBase
process.env.OUR_FREE_MODEL_KILO_BASE = fixtureBase
process.env.DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS = '99999999'
const repoCli = path.join(root, 'packages/standalone/cli.mjs')
const integrationEnv = {
  OFM_SELF_UPDATE_MODULE_DIR: globalStandaloneDir,
  OFM_SELF_UPDATE_NPM: fakeNpm,
  OFM_SELF_UPDATE_FIRST_DELAY_MS: '150',
  OFM_SELF_UPDATE_INTERVAL_MS: '3600000',
  OUR_FREE_MODEL_BASE: fixtureBase,
  OUR_FREE_MODEL_KILO_BASE: fixtureBase,
  DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS: '99999999',
}
const spawnService = ({ dataDir, env = {} }) => new Promise((resolve, reject) => {
  const proc = spawn(process.execPath, [repoCli, '--port', '0', '--data-dir', dataDir, '--no-open', '--no-refresh'], {
    cwd: root, env: { ...process.env, ...integrationEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  proc.stdout.on('data', chunk => { stdout += chunk })
  proc.stderr.on('data', chunk => { stderr += chunk })
  const bootTimeout = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`service boot timeout; stderr=${stderr.slice(-800)}`)) }, 25000)
  const poll = setInterval(() => {
    if (proc.exitCode !== null) {
      clearTimeout(bootTimeout); clearInterval(poll)
      reject(new Error(`service exited early (code ${proc.exitCode}); stderr=${stderr.slice(-800)}`))
      return
    }
    const match = stdout.match(/管理页面（[^）]*）：http:\/\/127\.0\.0\.1:(\d+)/)
    if (match) {
      clearTimeout(bootTimeout); clearInterval(poll)
      resolve({
        proc, port: Number(match[1]),
        exit: new Promise(resolveExit => proc.once('exit', (code, signal) => resolveExit({ code, signal }))),
      })
    }
  }, 100)
})
const killTree = pid => { try { process.kill(pid, 'SIGTERM') } catch { /* 已退出 */ } }
/** 等待退出，ms 兜底超时返回 null（兜底计时 unref，不拖住测试进程事件循环）。 */
const raceExit = (exitPromise, ms = 20000) => {
  const fallback = new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms)
    timer.unref?.()
  })
  return Promise.race([exitPromise, fallback])
}
/** 先发 SIGTERM 再等干净退出；15s 兜底 SIGKILL（兜底计时 unref，不拖住事件循环）。 */
const settle = async (proc, exitPromise) => {
  killTree(proc.pid)
  const result = await raceExit(exitPromise, 15000)
  if (!result) { try { proc.kill('SIGKILL') } catch { /* 已退出 */ } }
  return result
}

await check('集成：真进程 update/run → 完整 close → 替身接管端口 → respawn 参数与日志逐项断言', async () => {
  // 替身 cli：起 http 监听 argv --port、argv 与接力 env 落盘 respawn-argv.json、GET / 回 99.0.0。
  fs.writeFileSync(path.join(globalStandaloneDir, 'cli.mjs'), `#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
const args = process.argv.slice(2)
const dirIndex = args.indexOf('--data-dir')
const dir = dirIndex >= 0 ? args[dirIndex + 1] : process.env.TMPDIR || '/tmp'
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'respawn-argv.json'), JSON.stringify({ argv: args, updateRestartEnv: process.env.OFM_SELF_UPDATE_RESTART ?? null }))
fs.writeFileSync(path.join(dir, 'respawn-pid.json'), JSON.stringify({ pid: process.pid }))
const portIndex = args.indexOf('--port')
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 18900
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ stub: true, version: '99.0.0', argv: args }))
})
for (let attempt = 0; ; attempt++) {
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
    break
  } catch (error) {
    if (error.code === 'EADDRINUSE' && attempt < 40) { await new Promise(resolve => setTimeout(resolve, 250)); continue }
    process.exit(1)
  }
}
`)
  const dataDir = path.join(scratch, 'integ-main')
  const service = await spawnService({ dataDir })
  try {
    const summary = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${service.port}/api/management/summary`, { signal: AbortSignal.timeout(5000) })
      return response.ok ? await response.json() : null
    }, { message: 'summary 未就绪' })
    assert.equal(summary.update.canSelfUpdate, true, '伪全局目录注入后必须判定为 global')
    assert.equal(summary.update.current, '1.2.4')
    await waitFor(async () => (await fetch(`http://127.0.0.1:${service.port}/api/management/summary`, { signal: AbortSignal.timeout(5000) })
      .then(response => response.json())).update?.latest === '1.9.9', { message: '首检后 latest 必须为 1.9.9' })
    const run = await fetch(`http://127.0.0.1:${service.port}/api/management/update/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
    })
    assert.equal(run.status, 200)
    assert.deepEqual(await run.json(), { ok: true, target: '1.9.9' }, 'update/run 必须立即响应并携带目标版本')
    // ① 旧进程 exit code 0（完整 close 后派生、退出）
    const exited = await raceExit(service.exit)
    assert.ok(exited, '旧进程必须在 20s 内退出')
    assert.deepEqual({ code: exited.code, signal: exited.signal }, { code: 0, signal: null }, '旧进程必须干净退出（exit 0）')
    // ② update.log 含目标版本与派生留痕
    const log = fs.readFileSync(path.join(dataDir, 'update.log'), 'utf8')
    assert.match(log, /1\.9\.9/)
    assert.match(log, /已派生新进程/)
    // ③ respawn-argv.json：实际端口 / data-dir / --no-open 在 argv，接力信号在 env
    const respawn = await waitFor(() => {
      try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'respawn-argv.json'), 'utf8')) } catch { return null }
    }, { message: 'respawn-argv.json 未落盘' })
    const respawnArgs = respawn.argv
    assert.ok(respawnArgs.includes('--port'), '替身必须收到 --port')
    assert.equal(Number(respawnArgs[respawnArgs.indexOf('--port') + 1]), service.port, '必须透传实际端口而非原始 --port 0')
    assert.equal(respawnArgs[respawnArgs.indexOf('--data-dir') + 1], dataDir)
    assert.equal(respawn.updateRestartEnv, '1', '子进程必须经 env 收到 OFM_SELF_UPDATE_RESTART=1')
    assert.ok(!respawnArgs.includes('--update-restart'), '不得再传 --update-restart 旗标（目标为旧代码时严格解析会启动失败）')
    assert.ok(respawnArgs.includes('--no-open'))
    // ④ 原端口被替身接管：请求回 99.0.0（版本回读）
    const taken = await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${service.port}/`, { signal: AbortSignal.timeout(2000) })
        return response.ok ? await response.json() : null
      } catch { return null }
    }, { timeout: 15000, message: '原端口未被替身接管' })
    assert.equal(taken.version, '99.0.0')
  } finally {
    killTree(service.proc.pid)
    try {
      const stub = JSON.parse(fs.readFileSync(path.join(dataDir, 'respawn-pid.json'), 'utf8'))
      if (stub?.pid) killTree(stub.pid)
    } catch { /* 替身尚未派生 */ }
  }
})
await check('集成失败变体：假 npm i 退出 1 → 旧进程不退出、failed 可查、网关 /v1 仍应答（AC-50 端到端）', async () => {
  const dataDir = path.join(scratch, 'integ-fail')
  const service = await spawnService({ dataDir, env: { FAKE_NPM_INSTALL: 'fail' } })
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${service.port}/api/management/summary`, { signal: AbortSignal.timeout(5000) })
      .then(response => response.json())).update?.hasUpdate === true, { message: '首检后必须出现可用更新' })
    const run = await fetch(`http://127.0.0.1:${service.port}/api/management/update/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
    })
    assert.equal(run.status, 200)
    const fetchUpdate = async () => (await fetch(`http://127.0.0.1:${service.port}/api/management/summary`, { signal: AbortSignal.timeout(5000) })).json().then(value => value.update)
    const state = await waitFor(async () => {
      const update = await fetchUpdate()
      return update?.state === 'failed' ? update : null
    }, { message: '安装失败后 summary.update.state 必须进入 failed' })
    assert.match(state.lastError, /npm install 失败/)
    assert.equal(service.proc.exitCode, null, '安装失败时旧进程绝不能退出')
    const key = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')).forwardKey
    const gateway = await fetch(`http://127.0.0.1:${service.port}/v1/models`, {
      headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
    })
    assert.equal(gateway.status, 200, '安装失败后网关必须继续应答')
    assert.match(fs.readFileSync(path.join(dataDir, 'update.log'), 'utf8'), /安装失败/)
  } finally {
    await settle(service.proc, service.exit)
  }
})
await check('集成兜底注入：STUCK_CLOSE → exit(0)、锁删除或留指引、同 dataDir 可再启动无 EEXIST（R9O-001）', async () => {
  const dataDir = path.join(scratch, 'integ-stuck')
  const service = await spawnService({
    dataDir,
    env: { OFM_SELF_UPDATE_TEST_STUCK_CLOSE: '1', OFM_SELF_UPDATE_CLOSE_TIMEOUT_MS: '500' },
  })
  let secondBoot = null
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${service.port}/api/management/summary`, { signal: AbortSignal.timeout(5000) })
      .then(response => response.json())).update?.hasUpdate === true, { message: '首检后必须出现可用更新' })
    const run = await fetch(`http://127.0.0.1:${service.port}/api/management/update/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
    })
    assert.equal(run.status, 200)
    // ① 旧进程仍 exit(0)：竞速兜底生效（close 挂起不再卡死退出）
    const exited = await raceExit(service.exit)
    assert.ok(exited, '兜底路径必须按时退出')
    assert.deepEqual({ code: exited.code, signal: exited.signal }, { code: 0, signal: null })
    // ②+③ 锁必释放或留痕含删锁指引（两分支必居其一）+ 兜底路径留痕
    const lockGone = !fs.existsSync(path.join(dataDir, 'service.lock'))
    const log = fs.readFileSync(path.join(dataDir, 'update.log'), 'utf8')
    assert.match(log, /close 超时|强制解锁/, '兜底路径必须在 update.log 留痕')
    assert.ok(lockGone || /手动删除.*service\.lock|service\.lock.*手动删除/.test(log),
      '不变式：锁已删除，或留痕含删锁指引')
    // ④ 同 dataDir 再 spawn 真实 cli.mjs：启动成功无 EEXIST（残锁死锁已消除）
    const cleanEnv = { ...process.env }
    for (const name of Object.keys(cleanEnv)) if (name.startsWith('OFM_SELF_UPDATE_')) delete cleanEnv[name]
    secondBoot = await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [repoCli, '--port', '0', '--data-dir', dataDir, '--no-open', '--no-refresh'], {
        cwd: root, env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'],
      })
      const exit = new Promise(resolveExit => proc.once('exit', (code, signal) => resolveExit({ code, signal })))
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', chunk => { stdout += chunk })
      proc.stderr.on('data', chunk => { stderr += chunk })
      const bootTimeout = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`再启动超时；stderr=${stderr.slice(-800)}`)) }, 25000)
      const poll = setInterval(() => {
        if (proc.exitCode !== null) {
          clearTimeout(bootTimeout); clearInterval(poll)
          reject(new Error(`再启动失败 EEXIST 残锁（code ${proc.exitCode}）；stderr=${stderr.slice(-800)}`))
          return
        }
        if (/管理页面（[^）]*）：http:\/\/127\.0\.0\.1:(\d+)/.test(stdout)) {
          clearTimeout(bootTimeout); clearInterval(poll)
          resolve({ proc, exit })
        }
      }, 100)
    })
  } finally {
    if (secondBoot) await settle(secondBoot.proc, secondBoot.exit)
    await settle(service.proc, service.exit)
  }
})

// ── 收尾 ──────────────────────────────────────────────────────────────────────
upstream.closeAllConnections()
await new Promise(resolve => upstream.close(resolve))
const cleanupTarget = fs.realpathSync(scratch)
assert.ok(cleanupTarget.startsWith(fs.realpathSync(os.tmpdir()) + path.sep))
fs.rmSync(cleanupTarget, { recursive: true, force: true })
console.log(`\nself-update: ${checks - failures}/${checks} checks passed`)
process.exitCode = failures ? 1 : 0
