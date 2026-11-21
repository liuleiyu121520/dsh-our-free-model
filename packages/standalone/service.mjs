import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { createModelRuntime, createRuntimeStores } from '../../src/core/runtime.js'
import { generateKey, rankLanAddresses, startForwardServer, startLanRelay } from '../../src/forward.js'
import { isLoopbackHost } from '../../src/trust.js'
import { createManagement } from './management.mjs'
import { createStandaloneEac } from './eac.mjs'
import { createChannelRuntime } from './channels/runtime.mjs'
import { createSmartScheduler } from './smart-schedule.mjs'
import { createClaimsHistory } from './claims-history.mjs'
import { createRequestLog } from './request-log.mjs'
import { createSelfUpdate, runRestartSequence, passthroughArgs } from './self-update.mjs'

const PRODUCT = 'o-free-model'
const VERSION = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export function resolveStandaloneDataDir(env = process.env, home = os.homedir()) {
  const configured = typeof env.OFM_HOME === 'string' ? env.OFM_HOME.trim() : ''
  return configured === '' ? path.join(home, '.our-free-model') : path.resolve(configured)
}

/** 内核自动释放的互斥端点，串行化同一数据目录的锁检查与回收。 */
async function acquireProcessGuard(dataDir) {
  // 其他平台保留原来的保守文件锁行为，不使用会遗留文件的 Unix Socket。
  if (process.platform !== 'win32' && process.platform !== 'linux') return null
  let canonical = fs.realpathSync.native(dataDir)
  if (process.platform === 'win32') canonical = canonical.toLowerCase()
  const id = crypto.createHash('sha256').update(canonical).digest('hex')
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\ofm-service-lock-${id}` : `\0ofm-service-lock-${id}`
  const server = net.createServer(socket => socket.destroy())
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(address, resolve)
    })
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw Object.assign(new Error('数据目录已被服务占用'), { code: 'EEXIST', cause: error })
    }
    throw error
  }
  server.unref()
  return () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

async function acquireServiceLock(dataDir) {
  const releaseGuard = await acquireProcessGuard(dataDir)
  const lockFile = path.join(dataDir, 'service.lock')
  const token = crypto.randomUUID()
  let lock
  let ownedStat
  const removeOwnedLock = () => {
    try {
      const current = fs.lstatSync(lockFile)
      if (current.isFile() && current.dev === ownedStat.dev && current.ino === ownedStat.ino) {
        fs.unlinkSync(lockFile)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  try {
    try { lock = fs.openSync(lockFile, 'wx', 0o600) }
    catch (error) {
      if (error.code !== 'EEXIST' || !releaseGuard) throw error
      const previousStat = fs.lstatSync(lockFile)
      if (!previousStat.isFile()) throw error
      const previous = fs.readFileSync(lockFile, 'utf8')
      let owner
      try { owner = JSON.parse(previous) } catch { throw error }
      if (owner?.product !== PRODUCT || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw error
      // 只有 ESRCH 能证明进程已经退出；无权限、PID 复用等情况均保留原锁。
      let exited = false
      try { process.kill(owner.pid, 0) }
      catch (probeError) { exited = probeError.code === 'ESRCH' }
      if (!exited) throw error
      const current = fs.lstatSync(lockFile)
      if (current.dev !== previousStat.dev || current.ino !== previousStat.ino ||
          fs.readFileSync(lockFile, 'utf8') !== previous) throw error
      fs.unlinkSync(lockFile)
      lock = fs.openSync(lockFile, 'wx', 0o600)
    }
    ownedStat = fs.fstatSync(lock)
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, product: PRODUCT, token }))
  } catch (error) {
    try {
      if (lock !== undefined) {
        fs.closeSync(lock)
        if (ownedStat) removeOwnedLock()
      }
    } finally { await releaseGuard?.() }
    throw error
  }
  return async () => {
    try {
      // 在关闭文件句柄前核对归属，避免异常替换的锁被本实例清理。
      const current = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
      if (current?.token === token && current.pid === process.pid && current.product === PRODUCT) removeOwnedLock()
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    } finally {
      try { fs.closeSync(lock) } finally { await releaseGuard?.() }
    }
  }
}

/** 直接创建核心和 HTTP 服务，不加载插件入口、Cordis 或 DSH 凭据。 */
export async function startStandalone({
  dataDir = resolveStandaloneDataDir(), host = '127.0.0.1', port,
  logger = console, refresh = true, probe, lanEnabled, lanPort,
  startRelay = startLanRelay,
} = {}) {
  if (!isLoopbackHost(host)) throw new TypeError('the standalone service binds a loopback address only')
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new TypeError('dataDir must be an absolute path')
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new TypeError('port must be an integer between 0 and 65535')
  }
  if (lanEnabled !== undefined && typeof lanEnabled !== 'boolean') throw new TypeError('lanEnabled must be a boolean')
  if (lanPort !== undefined && (!Number.isInteger(lanPort) || lanPort < 0 || lanPort > 65535)) {
    throw new TypeError('lanPort must be an integer between 0 and 65535')
  }
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const releaseLock = await acquireServiceLock(dataDir)
  let stores
  let runtime
  let listener
  let management
  let channels
  let scheduler
  let claims
  let gatewayModelRows
  let eac
  let requestLog
  let timer
  let selfUpdate
  let serviceRef
  let refreshInFlight
  let closing
  let stopped = false
  let relay
  let relayTarget
  let relayRequestedPort
  let relayError = null
  let relayChanges = Promise.resolve()
  const lanState = () => {
    const value = stores.settings.get()
    const addresses = rankLanAddresses(os.networkInterfaces())
    return {
      enabled: value.standaloneLanEnabled === true,
      running: relay !== undefined,
      host: relay?.host ?? '0.0.0.0',
      requestedPort: value.standaloneLanPort ?? 0,
      port: relay?.port ?? null,
      addresses,
      baseUrls: relay ? addresses.map(address => `http://${address}:${relay.port}/v1`) : [],
      error: relayError,
    }
  }
  async function closeRelay() {
    const current = relay
    const target = relayTarget
    relay = undefined
    relayTarget = undefined
    relayRequestedPort = undefined
    await Promise.all([current?.close(), target?.close()])
  }
  function reconcileRelay() {
    relayChanges = relayChanges.then(async () => {
      const value = stores.settings.get()
      const wantedPort = value.standaloneLanPort ?? 0
      relayError = null
      if (stopped || value.enabled === false || value.standaloneLanEnabled !== true) {
        await closeRelay()
        return
      }
      if (relay && relayRequestedPort === wantedPort) return
      await closeRelay()
      try {
        if (typeof value.standaloneLanKey !== 'string' || value.standaloneLanKey === '' ||
            value.standaloneLanKey === value.forwardKey) {
          settingsPersist({ standaloneLanKey: generateKey() })
        }
        // The shared relay targets IPv4 loopback. An IPv6 management bind needs
        // a separate inference-only loopback target, with no management handler.
        if (listener.server.address().address !== '127.0.0.1') {
          relayTarget = await startForwardServer({
            config: () => ({
              host: '127.0.0.1', port: 0,
              enabled: !stopped && stores.settings.get().enabled !== false,
              key: stores.settings.get().forwardKey,
            }),
            complete: runtime.complete, modelRows: gatewayModelRows,
          })
        }
        const targetPort = relayTarget?.port ?? listener.port
        const started = await startRelay({
          config: () => ({
            enabled: !stopped && stores.settings.get().enabled !== false && stores.settings.get().standaloneLanEnabled === true,
            host: '0.0.0.0', port: wantedPort, targetPort,
            lanKey: stores.settings.get().standaloneLanKey,
            localKey: stores.settings.get().forwardKey,
          }),
          log: message => logger.warn?.(`our-free-model standalone LAN: ${message}`),
        })
        relay = started
        relayRequestedPort = wantedPort
        if (stopped || stores.settings.get().enabled === false || stores.settings.get().standaloneLanEnabled !== true) await closeRelay()
      } catch (error) {
        await closeRelay()
        relayError = `LAN relay could not start (${/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'START_FAILED'})`
        logger.warn?.(relayError)
      }
    })
    return relayChanges
  }
  function settingsPersist(patch) {
    const previous = stores.settings.get()
    stores.settings.update(patch)
    stores.settings.flush()
    if (stores.settings.writeFailed) {
      stores.settings.value = previous
      throw new Error('could not persist the standalone LAN settings')
    }
  }
  try {
    stores = createRuntimeStores({ dataDir, logger })
    const { settings } = stores
    const savedPort = settings.get().standalonePort
    const requestedPort = port ?? (Number.isInteger(savedPort) && savedPort >= 0 && savedPort <= 65535 ? savedPort : 18900)
    const existingKey = settings.get().forwardKey
    const key = typeof existingKey === 'string' && existingKey !== '' ? existingKey : generateKey()
    const savedLanPort = settings.get().standaloneLanPort
    settings.update({
      forwardKey: key,
      managementKey: typeof settings.get().managementKey === 'string' && settings.get().managementKey !== ''
        && settings.get().managementKey !== key ? settings.get().managementKey : generateKey(),
      standaloneLanEnabled: lanEnabled ?? settings.get().standaloneLanEnabled === true,
      standaloneLanPort: lanPort ?? (Number.isInteger(savedLanPort) && savedLanPort >= 0 && savedLanPort <= 65535 ? savedLanPort : 0),
      ...probe === undefined ? {} : { standaloneProbe: probe === true },
    })
    settings.flush()
    if (settings.writeFailed) throw new Error('could not persist the standalone API key')
    eac = createStandaloneEac({
      dataDir,
      ...process.env.OFM_TEST_UPSTREAM ? { openExternal: async () => false } : {},
      onSaved: () => { void runtime?.refreshSealedLane().catch(error => logger.warn?.(`EAC 清单刷新失败：${error.message}`)) },
    })
    requestLog = createRequestLog({ dataDir, logger })
    runtime = createModelRuntime({
      ...stores, logger, attributionUserAgent: `${PRODUCT}/${VERSION}`,
      sealedCredential: eac.credential,
    })
    channels = await createChannelRuntime({ dataDir, logger, stats: stores.stats })
    // 智能调度器：auto / ourfreemodel 保留名的顺序接力（方案 §3）。
    // 分发顺序 = isSmartAlias → scheduler → channels.handles → core。
    scheduler = createSmartScheduler({ settings, channels, logger })
    // `/v1/models` 的 auto 注入面只覆盖对外网关（主 listener 与 LAN relay target）：
    // catalog/state、management 的 routable、workbench、gateway.getEnabled 等内部
    // 消费点继续读 publicModelRows，保持不含 auto（方案 §3.8）。
    // 注意 gatewayModelRows/scheduler 都要挂在外层作用域：reconcileRelay 定义在
    // try 块之外，看不见 try 块内的 const（否则 LAN relay 启动即 ReferenceError）。
    gatewayModelRows = () => [scheduler.autoRow(), ...runtime.publicModelRows()]
    // 领取历史记录器（FR-8）：手动 credits.claim* 包装 + auto-checkin 快照轮询，
    // 独立 claims-history.json；渠道包自己的 auto-checkin.json 零触碰。
    claims = createClaimsHistory({ dataDir, channels, logger })
    const core = runtime
    runtime = {
      ...core,
      get egress() { return core.egress },
      get gatewayLatency() { return core.gatewayLatency },
      get catalog() { return [...core.catalog, ...channels.publicModelRows().map(row => ({ ...row, contextWindow: row.context_window, maxOutput: row.max_tokens }))] },
      state: () => ({ ...core.state(), catalog: [...core.catalog, ...channels.publicModelRows()] }),
      publicModelRows: () => [...core.publicModelRows(), ...channels.publicModelRows()],
      // 请求日志在 service 层观测：插件侧的 src/core 与渠道包保持逐字节不变
      // （它们的 sha256 在签名清单里），独立端要记日志只需包一层。
      // auto 请求在日志里记 `auto→真实模型`，token 用量仍按真实命中模型记账。
      // 2026-11-20 起同时记录请求正文（输入/输出文本）：id 关联元数据行与独立
      // detail 文件（3 天滚动清理，见 request-log.mjs）。捕获层只抽文本增量，
      // 工具调用等非文本块记紧凑占位，两侧各 512KB 截断防撑爆。
      complete: async (request, onChunk) => {
        const started = Date.now()
        let first = 0
        const logId = `${started}-${Math.random().toString(36).slice(2, 8)}`
        let sawDelta = false
        let answerText = ''
        let reasoningText = ''
        const toolCalls = []
        const capture = chunk => {
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') { sawDelta = true; answerText += chunk.text; return }
          if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') { sawDelta = true; reasoningText += chunk.text; return }
          if (chunk.type === 'tool-call-delta') {
            sawDelta = true
            let call = toolCalls.find(row => row.slot === chunk.index)
            if (call === undefined) { call = { slot: chunk.index, name: '', args: '' }; toolCalls.push(call) }
            if (typeof chunk.argumentsDelta === 'string') call.args += chunk.argumentsDelta
            if (typeof chunk.name === 'string' && chunk.name !== '') call.name = chunk.name
            return
          }
          if (chunk.type === 'block-end' && chunk.block?.type === 'tool-call') {
            sawDelta = true
            const call = toolCalls.find(row => row.slot === chunk.index)
            if (call === undefined) toolCalls.push({ slot: chunk.index, name: String(chunk.block.name ?? ''), args: String(chunk.block.arguments ?? '') })
            else {
              if (typeof chunk.block.name === 'string' && chunk.block.name !== '') call.name = chunk.block.name
              if (typeof chunk.block.arguments === 'string') call.args = chunk.block.arguments
            }
          }
        }
        const tracked = onChunk === undefined ? undefined : chunk => { if (!first) first = Date.now(); capture(chunk); onChunk(chunk) }
        const smart = scheduler.handles(request.model)
        const routed = smart ? { model: '' } : undefined
        const loggedModel = () => routed?.model ? `${request.model}→${routed.model}` : request.model
        // 输入记原始入站形态：OpenAI 入口的 body.messages（Responses 入口的 body.input），
        // 或 Anthropic 入口已归一的 harness messages（system 已并入首行）。
        const detailInput = () => {
          const source = request.openAi?.messages ?? request.openAi?.input ?? request.messages
          if (source === undefined) return ''
          // 结构化落盘（2026-11-20 抽屉按字段拆开展示）：顶层带 model 与关键标量参数，
          // messages 为本体；序列化失败原样兜底。旧记录的裸数组形态由前端解析兼容。
          const detail = { model: request.model }
          const body = request.openAi
          for (const key of ['max_tokens', 'stream', 'temperature']) {
            const value = body?.[key]
            if (value !== undefined) detail[key] = value
          }
          try { return JSON.stringify({ ...detail, messages: source }) } catch { return String(source) }
        }
        // 输出：流式走 chunk 增量拼接（含思考前缀与工具调用占位）；非流式（调用方
        // 不订阅 chunk）回落完整 outcome.text。失败时追加失败标记。
        const detailOutput = failure => {
          let text = sawDelta
            ? (reasoningText === '' ? '' : `【思考】\n${reasoningText}\n\n【回答】\n`) + answerText
              + toolCalls.map(call => `\n[工具调用 ${call.name || '?'} args=${call.args}]`).join('')
            : (typeof outcome?.text === 'string' ? outcome.text : '')
          if (failure !== undefined) text += `${text === '' ? '' : '\n\n'}[请求失败] ${failure}`
          return text
        }
        let outcome
        try {
          outcome = smart
            ? await scheduler.complete(request, tracked, routed)
            : channels.handles(request.model)
              ? await channels.complete(request, tracked)
              : await core.complete(request, tracked)
        } catch (error) {
          const message = String(error?.message ?? error).slice(0, 200)
          requestLog?.append({
            id: logId, at: started, model: loggedModel(), ok: false,
            elapsedMs: Date.now() - started,
            error: message,
            inputText: detailInput(),
            outputText: detailOutput(message),
          })
          throw error
        }
        const usage = outcome?.usage
        requestLog?.append({
          id: logId, at: started, model: loggedModel(), ok: outcome?.error === undefined,
          input: usage?.prompt_tokens ?? 0, output: usage?.completion_tokens ?? 0,
          reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
          cacheRead: usage?.prompt_tokens_details?.cached_tokens ?? 0,
          ttftMs: first ? first - started : undefined,
          elapsedMs: Date.now() - started,
          ...outcome?.error === undefined ? {} : { error: String(outcome.error).slice(0, 200) },
          inputText: detailInput(),
          outputText: detailOutput(outcome?.error === undefined ? undefined : String(outcome.error).slice(0, 200)),
        })
        return outcome
      },
      async refreshCatalog(options) {
        if (stopped) return
        const [result, channelResult] = await Promise.all([core.refreshCatalog(options), channels.refresh(options).catch(error => { if (!stopped) throw error })])
        if (options?.report) return { ...result, sources: { ...result.sources, ...channelResult?.sources } }
      },
    }
    // 自更新检查器（FR-17）：检查结果纯内存态，30s 首检 + 60min 周期、unref。
    // performRestart 闭包经 serviceRef 回绑最终服务对象——自重启时先完整 close
    // （含 service.lock 释放）再派生新进程（方案 §V11.4，锁竞态证据见方案）。
    selfUpdate = createSelfUpdate({
      currentVersion: VERSION,
      dataDir,
      logger,
      performRestart: options => runRestartSequence({
        ...options,
        close: () => serviceRef?.close(),
        passthroughArgs: passthroughArgs(process.argv, serviceRef?.port),
      }),
    })
    management = createManagement({
      stores, runtime, channels, requestLog,
      scheduler, claims, selfUpdate,
      info: () => ({
        product: PRODUCT, version: VERSION, dataDir,
        baseUrl: `http://${host === '::1' ? '[::1]' : host}:${listener?.port ?? requestedPort}`,
        automaticRefresh: refresh,
        networkMode: process.env.OFM_TEST_UPSTREAM ? 'fixture' : 'live',
        capabilities: { anonymous: true, kilo: true, eac: true, accountChannels: true, webUi: true, lan: true },
        lan: lanState(),
      }),
      onSettingsChanged: async () => {
        if (!refreshInFlight) scheduleRefresh()
        await reconcileRelay()
      },
    })
    listener = await startForwardServer({
      config: () => ({ host, port: requestedPort, enabled: settings.get().enabled !== false, key: settings.get().forwardKey }),
      complete: runtime.complete,
      modelRows: gatewayModelRows,
      health: () => ({
        ok: true, service: PRODUCT, product: 'standalone', version: VERSION,
        capabilities: { anonymous: true, kilo: true, eac: true, accountChannels: true, webUi: true },
      }),
      handleRequest: management.handleRequest,
      log: message => logger.warn?.(`our-free-model standalone: ${message}`),
    })
    management.setPort(listener.port)
    settings.update({ standalonePort: listener.port })
    settings.flush()
    await reconcileRelay()
    selfUpdate.start()

    function scheduleRefresh() {
      clearTimeout(timer)
      if (stopped || !refresh) return
      const minutes = Number(settings.get().probeIntervalMinutes)
      timer = setTimeout(() => { void refreshModels() }, (Number.isFinite(minutes) && minutes > 0 ? Math.max(1, minutes) : 15) * 60_000)
      timer.unref?.()
    }
    function refreshModels(force = false) {
      if (refreshInFlight) return refreshInFlight
      // Automatic availability probing is disabled by owner policy: periodic and
      // boot refreshes only reload the listing. The management "probe" action
      // still asks for an explicit probe through the runtime API.
      refreshInFlight = runtime.refreshCatalog({ probe: false, force })
        .catch(error => {
          if (!stopped) logger.warn?.(`our-free-model standalone: catalog refresh failed (${error?.message ?? error})`)
        })
        .finally(() => { refreshInFlight = undefined; scheduleRefresh() })
      return refreshInFlight
    }
    // 启动与周期刷新只更新清单，不自动探测；手动“探测可用性”仍走运行时 API。
    const ready = Promise.all([channels.ready, refresh ? refreshModels(false) : Promise.resolve()])
    const handle = {
      product: PRODUCT, version: VERSION, dataDir,
      url: `http://${host === '::1' ? '[::1]' : host}:${listener.port}`,
      managementUrl: `http://${host === '::1' ? '[::1]' : host}:${listener.port}/${management.bootstrapFragment}`,
      port: listener.port,
      keyFile: path.join(dataDir, 'settings.json'),
      runtime, channels, scheduler, claims, ready,
      get lan() { return lanState() },
      close() {
        if (closing !== undefined) return closing
        stopped = true
        clearTimeout(timer)
        // 只停检查定时器：updating 中被关（如 Ctrl-C）时 npm 事务性保证无半升级，
        // 内存态下次启动重建（§V11.9-R16-d）。
        selfUpdate?.stop()
        const managementClosing = management.dispose()
        eac.dispose()
        scheduler?.dispose()
        claims?.dispose()
        runtime.dispose()
        closing = (async () => {
          try {
            await relayChanges
            await Promise.all([managementClosing, closeRelay(), listener.close(), channels.close()])
          } finally {
            try { stores.dispose() } finally { await releaseLock() }
          }
        })()
        return closing
      },
    }
    serviceRef = handle
    return handle
  } catch (error) {
    stopped = true
    clearTimeout(timer)
    selfUpdate?.stop()
    await management?.dispose()
    eac?.dispose()
    scheduler?.dispose()
    claims?.dispose()
    runtime?.dispose()
    await relayChanges
    await closeRelay()
    if (listener) await listener.close()
    await channels?.close()
    try { stores?.dispose() } finally { await releaseLock() }
    throw error
  }
}
