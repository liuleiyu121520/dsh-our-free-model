/**
 * 自更新检查器（FR-17 / 方案 §V11.2）。
 *
 * 三件导出：compareVersions / detectInstallKind 两个纯函数（可单测），
 * 以及 createSelfUpdate 工厂（生产由 service.mjs 接线，测试注入假 npm）。
 *
 * 检查结果**纯内存态**（FR-17.1）：重启后下一周期重建，不落 settings。
 * 失败一律静默（FR-17.5-④）：记 lastError、保留上次 latest，下一周期自动重试。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SELF_UPDATE_PACKAGE = 'our-free-model-standalone'
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/
const DEFAULT_MODULE_DIR = fileURLToPath(new URL('.', import.meta.url))

const envString = name => {
  const value = process.env[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}
const envInt = name => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms) })
const tail = (text, limit = 4096) => String(text ?? '').slice(-limit).trim()

/**
 * 三段语义版本比较（semver 核心子集；方案 §V11.2-1 / SR-16）。
 *
 * - `x.y.z` 三段数字逐段比（1.2.10 > 1.2.9）；
 * - 同三段时有 prerelease 后缀（1.2.5-rc.1）< 无后缀（1.2.5）——覆盖 rc→正式场景；
 * - 两个 prerelease 之间不再细分（返回 0，同三段同视为候选等价）；
 * - 任一输入非法 → null（保守视为不可比，不提示更新；漏报安全、误报为零）。
 */
export function compareVersions(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null
  const left = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(a)
  const right = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(b)
  if (!left || !right) return null
  for (let index = 1; index <= 3; index++) {
    const x = Number(left[index])
    const y = Number(right[index])
    if (x !== y) return x > y ? 1 : -1
  }
  if (left[4] !== undefined && right[4] === undefined) return -1
  if (left[4] === undefined && right[4] !== undefined) return 1
  return 0
}

/**
 * 安装来源判定（FR-17.5-②；判据用 moduleDir 而非 argv[1]：__dirname 恒指向
 * 实际加载的包内路径，argv[1] 在 wrapper 启动时会指向 wrapper）。
 *
 * global 是唯一允许自更新的形态；其余一律保守禁用（D36②：判定不可得 → 禁）。
 */
export function detectInstallKind({ platform, moduleDir }) {
  if (platform === 'win32') return 'unsupported'
  if (typeof moduleDir !== 'string' || moduleDir === '') return 'source'
  const normalized = moduleDir.split(path.sep).join('/')
  if (normalized.includes('/.npm/_npx/')) return 'npx'
  if (/(^|\/)lib\/node_modules\/our-free-model-standalone\//.test(normalized)) return 'global'
  if (/(^|\/)node_modules\/our-free-model-standalone\//.test(normalized)) return 'local'
  return 'source'
}

/** 追加型诊断日志（R16 载体）：写不进也不能影响更新流程本身。 */
export function appendUpdateLog(dataDir, text) {
  if (typeof dataDir !== 'string' || dataDir === '') return
  try {
    fs.appendFileSync(path.join(dataDir, 'update.log'), `[${new Date().toISOString()}] ${text}\n`)
  } catch { /* 诊断日志失败静默 */ }
}

/**
 * 强制版 releaseLock（方案 §V11.4-2 兜底 b 步 / R9O-001）：读 service.lock，
 * 校验 pid+product 归属后 unlink——与 close 链 finally 的锁释放不变式对齐。
 * 读取/unlink 失败或归属不符 → 留痕「请手动删除 <dataDir>/service.lock 后重启」。
 * 不变式：兜底路径「锁必释放（返回 true）或留痕含删锁指引（返回 false）」。
 */
export function forceReleaseLock({ dataDir, log = () => {}, logger = console } = {}) {
  const lockFile = path.join(dataDir, 'service.lock')
  try {
    if (!fs.existsSync(lockFile)) return true
    const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
    if (owner?.pid === process.pid && owner?.product === SELF_UPDATE_PACKAGE) {
      fs.unlinkSync(lockFile)
      log(`已强制释放服务锁：${lockFile}`)
      return true
    }
    log(`service.lock 归属校验未通过（pid/product 不符），未自动删除。请手动删除 ${lockFile} 后重启服务`)
    return false
  } catch (error) {
    log(`读取或删除 service.lock 失败（${error?.message ?? error}）。请手动删除 ${lockFile} 后重启服务`)
    logger.warn?.(`our-free-model standalone self-update: force release lock failed (${error?.message ?? error})`)
    return false
  }
}

/**
 * 从旧进程 argv 提取需透传给新进程的关键启动参数（方案 §V11.4-2 表）：
 * --port 透传**实际端口**（原 `--port 0` 透 0 会换随机端口，违背端口延续）；
 * --data-dir / --no-refresh 原样透传；--lan 系持久化于 settings 不透传；
 * --probe（停用兼容）与 --no-open（由重启序列强制附加）不透传。
 */
export function passthroughArgs(argv, actualPort) {
  const args = []
  let hasPort = false
  for (let index = 2; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--port') {
      hasPort = true
      index++
      continue
    }
    if (flag === '--data-dir') {
      if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) args.push('--data-dir', argv[index + 1])
      index++
      continue
    }
    if (flag === '--no-refresh') args.push(flag)
  }
  if (hasPort && Number.isInteger(actualPort) && actualPort > 0) args.unshift('--port', String(actualPort))
  return args
}

/**
 * 自重启序列（方案 §V11.4；顺序为「先完整 close（含锁释放）→ 再派生 → 旧进程
 * exit(0)」——macOS 上旧进程持锁至 close 尾部，先派生必撞 EEXIST）：
 *
 * 1. sleep 300ms——让 update/run 的 HTTP 响应先 flush；
 * 2. close 与 closeTimeoutMs 竞速：
 *    - close 挂起超时 → 留痕（含删锁指引）→ forceReleaseLock → exit(0)；
 *    - close reject → 留痕 → forceReleaseLock（R10O-001 闭环：两异常分支均
 *      「锁必释放或留痕含指引」）→ exit(1)（安装已成功，ofm 命令可手动启动）；
 * 3. 新版 cli 就位校验（fs.accessSync），失败留痕 + exit(1)；
 * 4. detached 派生 `node <moduleDir>/cli.mjs <关键参数> --no-open --update-restart`，
 *    stdio 重定向 dataDir/update-restart.log（新进程崩溃可诊断，R16-c）；
 *    spawn 同步异常 → 留痕 + exit(1)（服务不复活，但安装完好、可手动 ofm）；
 * 5. child.unref() + exit(0)。
 */
export async function runRestartSequence({
  close, passthroughArgs: restartArgs = [], moduleDir = DEFAULT_MODULE_DIR, dataDir,
  logger = console, closeTimeoutMs = 5_000, testStuckClose = false,
  execPath = process.execPath, env = process.env, spawnImpl = spawn,
  exit = code => process.exit(code),
} = {}) {
  await sleep(300)
  try {
    await Promise.race([
      testStuckClose
        ? new Promise(() => {}) // 测试钩子：模拟 close 组件挂起（§V11.2 deps 表）
        : typeof close === 'function' ? close() : Promise.resolve(),
      sleep(closeTimeoutMs).then(() => { throw Object.assign(new Error(`close 超时（${closeTimeoutMs}ms）`), { code: 'OFM_CLOSE_TIMEOUT' }) }),
    ])
  } catch (error) {
    const stuck = error?.code === 'OFM_CLOSE_TIMEOUT'
    appendUpdateLog(dataDir, stuck
      ? `close 超时（组件挂起，新进程输出见 update-restart.log），执行强制解锁后退出；如服务仍无法启动，请删除 ${path.join(dataDir, 'service.lock')} 后重试`
      : `更新已安装完成，但服务关闭失败（${error?.message ?? error}）；执行强制解锁后退出。新版本可手动运行 ofm 启动；如服务仍无法启动，请删除 ${path.join(dataDir, 'service.lock')} 后重试`)
    // R10O-001 闭环点：close-reject（exit(1)）分支同样先执行 forceReleaseLock，
    // 与超时分支一起满足「锁必释放或留痕含删锁指引」。
    forceReleaseLock({ dataDir, log: text => appendUpdateLog(dataDir, text), logger })
    logger.error?.(`our-free-model standalone self-update: ${error?.message ?? error}`)
    exit(stuck ? 0 : 1)
    return
  }
  const cliPath = path.join(moduleDir, 'cli.mjs')
  try {
    fs.accessSync(cliPath)
  } catch {
    appendUpdateLog(dataDir, `更新后未找到新版入口 ${cliPath}；新版本已安装完成，可手动运行 ofm 启动`)
    logger.error?.(`our-free-model standalone self-update: cli.mjs missing after install (${cliPath})`)
    exit(1)
    return
  }
  let child
  let logFd
  try {
    logFd = fs.openSync(path.join(dataDir, 'update-restart.log'), 'a')
    child = spawnImpl(execPath, [cliPath, ...restartArgs, '--no-open', '--update-restart'], {
      detached: true, stdio: ['ignore', logFd, logFd], env,
    })
  } catch (error) {
    if (logFd !== undefined) { try { fs.closeSync(logFd) } catch { /* fd 已失效 */ } }
    appendUpdateLog(dataDir, `派生新进程失败（${error?.message ?? error}）；新版本已安装完成，可手动运行 ofm 启动`)
    logger.error?.(`our-free-model standalone self-update: respawn failed (${error?.message ?? error})`)
    exit(1)
    return
  }
  child.unref()
  try { fs.closeSync(logFd) } catch { /* fd 已失效 */ }
  appendUpdateLog(dataDir, `已派生新进程（pid ${child.pid}，参数 ${restartArgs.concat('--no-open', '--update-restart').join(' ')}），旧进程退出`)
  exit(0)
}

function runNpm(npmCommand, args, timeoutMs) {
  return new Promise(resolve => {
    let child
    try {
      // spawn 继承 env：NPM_CONFIG_REGISTRY / 代理配置天然生效（R17）。
      child = spawn(npmCommand, args, { timeout: timeoutMs })
    } catch (error) {
      resolve({ ok: false, error: `无法启动 npm（${error?.message ?? error}）`, output: '' })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = result => { if (!settled) { settled = true; resolve(result) } }
    child.stdout?.on('data', chunk => { if (stdout.length < 8192) stdout += chunk })
    child.stderr?.on('data', chunk => { if (stderr.length < 8192) stderr += chunk })
    child.once('error', error => finish({ ok: false, error: `npm ${args[0]} 启动失败（${error?.message ?? error}）`, output: tail(stderr) }))
    child.once('close', (code, signal) => {
      const output = tail(`${stdout}\n${stderr}`)
      if (code !== 0) {
        finish({ ok: false, error: `npm ${args[0]} 退出码 ${code ?? signal}`, output })
        return
      }
      finish({ ok: true, output, stdout })
    })
  })
}

/**
 * 自更新实例（方案 §V11.2-3）。生产默认值 + env 注入双轨（OFM_SELF_UPDATE_*，
 * 与 OFM_TEST_UPSTREAM 命名先例一致：测试专用钩子、生产文档不宣传、未设置即全默认）。
 */
export function createSelfUpdate({
  currentVersion,
  moduleDir = envString('OFM_SELF_UPDATE_MODULE_DIR') ?? DEFAULT_MODULE_DIR,
  npmCommand = envString('OFM_SELF_UPDATE_NPM') ?? 'npm',
  firstDelayMs = envInt('OFM_SELF_UPDATE_FIRST_DELAY_MS') ?? 30_000,
  intervalMs = envInt('OFM_SELF_UPDATE_INTERVAL_MS') ?? 3_600_000,
  viewTimeoutMs = envInt('OFM_SELF_UPDATE_VIEW_TIMEOUT_MS') ?? 15_000,
  installTimeoutMs = envInt('OFM_SELF_UPDATE_INSTALL_TIMEOUT_MS') ?? 600_000,
  closeTimeoutMs = envInt('OFM_SELF_UPDATE_CLOSE_TIMEOUT_MS') ?? 5_000,
  dataDir,
  logger = console,
  performRestart = options => runRestartSequence(options),
} = {}) {
  if (typeof currentVersion !== 'string' || currentVersion === '') throw new TypeError('currentVersion is required')
  const installKind = detectInstallKind({ platform: process.platform, moduleDir })
  const canSelfUpdate = installKind === 'global'
  let latest = null
  let checkedAt = null
  let lastError = null
  let phase = 'idle' // idle | available | updating | restarting | failed
  let target = null
  let timer = null
  let stopped = false
  const hasUpdate = () => latest !== null && compareVersions(latest, currentVersion) === 1
  const state = () => ({
    current: currentVersion,
    latest,
    hasUpdate: hasUpdate(),
    canSelfUpdate,
    checkedAt,
    lastError,
    state: phase,
    ...(target !== null ? { target } : {}),
  })
  async function checkNow() {
    const result = await runNpm(npmCommand, ['view', SELF_UPDATE_PACKAGE, 'dist-tags.latest', '--json'], viewTimeoutMs)
    checkedAt = Date.now()
    if (result.ok) {
      try {
        const value = JSON.parse(result.stdout ?? '')
        if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) throw new Error('dist-tags.latest 不是有效版本号')
        latest = value
        lastError = null
      } catch (error) {
        // 垃圾输出：静默记错、保留上次 latest（AC-45 / FR-17.5-④）。
        lastError = `npm view 输出无法解析（${error.message}）`
      }
    } else {
      lastError = result.error
    }
    if (phase === 'idle' || phase === 'available') phase = hasUpdate() ? 'available' : 'idle'
    if (lastError !== null) logger.warn?.(`our-free-model standalone self-update: ${lastError}（保留上次结果，下周期重试）`)
  }
  function tick() {
    void checkNow().finally(() => {
      if (stopped) return
      timer = setTimeout(tick, intervalMs)
      timer.unref?.()
    })
  }
  /** 30s 首检 + 60min 周期（对齐 auto-checkin 调度形态：setTimeout + unref + cancel）。 */
  function start() {
    if (timer !== null || stopped) return
    timer = setTimeout(tick, firstDelayMs)
    timer.unref?.()
  }
  /** close 链首段调用：只取消检查定时器，不阻止进程退出（AC-45）。 */
  function stop() {
    stopped = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  async function runInstall() {
    const targetVersion = target
    appendUpdateLog(dataDir, `开始安装 ${SELF_UPDATE_PACKAGE}@${targetVersion}（npm i -g）`)
    const result = await runNpm(npmCommand, ['i', '-g', `${SELF_UPDATE_PACKAGE}@${targetVersion}`], installTimeoutMs)
    if (!result.ok) {
      // AC-50：失败不重启、现存全局安装未动（npm 安装原子性，无半升级），错误态可重试。
      phase = 'failed'
      lastError = `npm install 失败（${result.error}${result.output ? `：${result.output.slice(-512)}` : ''}）`
      appendUpdateLog(dataDir, `安装失败（${result.error}；输出摘要 ${result.output.slice(-512) || '无'}）；服务未重启，现存安装未改动`)
      return
    }
    phase = 'restarting'
    appendUpdateLog(dataDir, `安装完成（输出摘要 ${result.output.slice(-512) || '无'}），开始自重启（目标版本 ${targetVersion}）`)
    try {
      await performRestart({ moduleDir, dataDir, logger, closeTimeoutMs, testStuckClose: process.env.OFM_SELF_UPDATE_TEST_STUCK_CLOSE === '1' })
    } catch (error) {
      // performRestart 自身负责 exit；这里只兜住未退出的异常路径，防 promise 静默丢失。
      phase = 'failed'
      lastError = `自重启失败（${error?.message ?? error}）`
      appendUpdateLog(dataDir, lastError)
      logger.error?.(`our-free-model standalone self-update: ${lastError}`)
    }
  }
  /**
   * management POST /update/run 入口：同步前置校验并置 updating 后立即返回，
   * 安装异步执行（npm 最长 10 分钟，不能挂 HTTP 等待）。409 语义按方案 §V11.2：
   * 非全局禁用 / 无更新 / updating·restarting 中；failed 放行重试（AC-50）。
   */
  function requestRun() {
    if (!canSelfUpdate) {
      throw Object.assign(
        new Error(`当前不是 npm 全局安装（${installKind === 'unsupported' ? 'Windows 暂不支持自动更新' : `安装来源：${installKind}`}），不支持一键更新；可手动执行：npm i -g ${SELF_UPDATE_PACKAGE}@${latest ?? 'latest'}`),
        { statusCode: 409 },
      )
    }
    if (!hasUpdate()) throw Object.assign(new Error('当前已是最新版本，无需更新'), { statusCode: 409 })
    if (phase === 'updating' || phase === 'restarting') throw Object.assign(new Error('更新正在进行中，请稍候'), { statusCode: 409 })
    target = latest
    phase = 'updating'
    void runInstall()
    return { ok: true, target }
  }
  return { installKind, start, stop, state, requestRun, checkNow }
}
