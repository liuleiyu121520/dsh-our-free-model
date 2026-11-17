import { modelAvailability } from '../../src/model-test.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { buildStats } from '../../src/core/stats.js'
import { generateKey } from '../../src/forward.js'
import { structuralRejection } from '../../src/trust.js'
import { openLoginTerminal } from './login-terminal.mjs'
import { publicModelVisibility, validateModelVisibility, isModelHidden } from '../../src/store.js'
import { detectDshChannels } from './dsh-import.mjs'
// ⚠️ 独立服务用**自己的**免责声明（STANDALONE_*）：插件那份讲的是「本分支与
// 上游的差异」（恢复了哪些渠道），而独立服务的用户根本没装 DSH、也没见过上游，
// 那份文案对他是噪音。两者的版本号独立，互不影响已确认状态。
import { STANDALONE_DISCLAIMER, STANDALONE_DISCLAIMER_VERSION, standaloneDisclaimerAcknowledged } from '../../src/disclaimer.js'

const PREFIX = '/api/management'
const BOOTSTRAP_MS = 10 * 60_000
const SESSION_MS = 8 * 60 * 60_000
const MAX_BODY_BYTES = 16 * 1024
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
])
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
}

function fail(statusCode, message) {
  return Object.assign(new Error(message), { statusCode })
}

function matches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected === '') return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

async function readBody(req, limit = MAX_BODY_BYTES) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw fail(415, '请求必须使用 application/json')
  }
  let bytes = 0
  const chunks = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > limit) throw fail(413, '请求内容过大')
    chunks.push(chunk)
  }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw fail(400, '请求不是有效 JSON') }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw fail(400, '请求必须是 JSON 对象')
  return value
}

/** 智能调度池条目：必须是 `provider/model` 形式（provider 不含 / 与空白，model 不含空白）。 */
const SMART_MODEL_PATTERN = /^[^/\s]+\/[^\s]+$/
const SMART_POOL_MAX = 32
const SMART_MODEL_MAX = 300

/** 校验调度池：逐条 `provider/model`、去重（保序）、上限 32。未知模型不拒绝 —— 失效条目在页面上置灰展示。 */
function validateSmartPool(models) {
  if (!Array.isArray(models)) throw fail(400, 'models 必须是字符串数组')
  for (const raw of models) {
    if (typeof raw !== 'string' || !SMART_MODEL_PATTERN.test(raw)) {
      throw fail(400, `模型 id 必须是 provider/model 形式：${String(raw).slice(0, 80)}`)
    }
    if (raw.length > SMART_MODEL_MAX) throw fail(400, `模型 id 过长（上限 ${SMART_MODEL_MAX} 字符）`)
  }
  const unique = [...new Set(models)]
  if (unique.length > SMART_POOL_MAX) throw fail(400, `调度池最多 ${SMART_POOL_MAX} 个模型`)
  return unique
}

function validateSettings(patch) {
  const visibility = validateModelVisibility(patch)
  const booleans = new Set(['enabled', 'exposeRegionModels', 'streamRecovery', 'standaloneProbe', 'standaloneLanEnabled', 'dshImportAsked'])
  const numbers = { probeIntervalMinutes: [1, 1440], defaultMaxTokens: [512, 131072], standaloneLanPort: [0, 65535] }
  const result = {}
  for (const [key, value] of Object.entries(patch)) {
    if (Object.hasOwn(visibility, key)) { result[key] = visibility[key]; continue }
    if (key === 'smartSchedulePool') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'smartSchedulePool 必须是 { models: [...] }')
      result[key] = { models: validateSmartPool(value.models) }
      continue
    }
    if (booleans.has(key)) {
      if (typeof value !== 'boolean') throw fail(400, `${key} 必须是布尔值`)
    } else if (Object.hasOwn(numbers, key)) {
      const [min, max] = numbers[key]
      if (!Number.isInteger(value) || value < min || value > max) throw fail(400, `${key} 必须是 ${min} 到 ${max} 的整数`)
    } else throw fail(400, `不支持的设置字段：${key}`)
    result[key] = value
  }
  return result
}

export function managementSettings(value) {
  return {
    ...publicModelVisibility(value),
    enabled: value.enabled !== false,
    exposeRegionModels: value.exposeRegionModels !== false,
    streamRecovery: value.streamRecovery !== false,
    standaloneProbe: value.standaloneProbe === true,
    standaloneLanEnabled: value.standaloneLanEnabled === true,
    standaloneLanPort: value.standaloneLanPort ?? 0,
    // 首次启动的「导入 DSH 账号」提示是否已问过：问过就不再打扰，
    // 但用户仍可在渠道页手动触发导入。
    dshImportAsked: value.dshImportAsked === true,
    probeIntervalMinutes: value.probeIntervalMinutes ?? 15,
    defaultMaxTokens: value.defaultMaxTokens ?? 32768,
    // 智能调度池：只读回显（写走 POST /smart/pool 与 settings 校验透传）。
    smartSchedulePool: { models: [...(Array.isArray(value.smartSchedulePool?.models) ? value.smartSchedulePool.models : [])] },
  }
}

/**
 * 连接是否来自本机回环地址。
 *
 * 只看 `req.socket.remoteAddress`（TCP 层事实），**不看 `Host` 头**——后者可伪造。
 * IPv4-mapped IPv6（`::ffff:127.0.0.1`）在双栈监听下很常见，必须一并认。
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const value = address.toLowerCase()
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}

/** 管理读写要求鉴权；登录恢复仅允许同源页面触发固定本机动作。 */
export function createManagement({ stores, runtime, channels, requestLog, scheduler, claims, info, onSettingsChanged, loginTerminal = openLoginTerminal }) {
  let bootstrap = { token: crypto.randomBytes(32).toString('base64url'), until: Date.now() + BOOTSTRAP_MS }
  const sessions = new Map()
  let cookieName
  let closed = false
  let terminalOpening = false
  let terminalOpenedAt = null
  const loginPlatform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'unsupported'
  const assets = new Map([...ASSETS].map(([url, [file, type]]) => [
    url, { type, body: file === 'index.html'
      ? Buffer.from(fs.readFileSync(new URL(`./web/${file}`, import.meta.url), 'utf8')
        .replace('data-login-platform="unsupported"', `data-login-platform="${loginPlatform}"`))
      : fs.readFileSync(new URL(`./web/${file}`, import.meta.url)) },
  ]))
  // 只公开构建清单中经过路径校验的 JS/CSS，绝不按请求路径读取磁盘。
  const manifest = JSON.parse(fs.readFileSync(new URL('./web/assets.json', import.meta.url), 'utf8'))
  if (!Array.isArray(manifest) || manifest.some(name => typeof name !== 'string' || !/^[\w-]+\.(js|css)$/.test(name))) {
    throw new Error('独立端资源清单无效')
  }
  for (const name of manifest) assets.set(`/assets/${name}`, {
    type: name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
    body: fs.readFileSync(new URL(`./web/${name}`, import.meta.url)),
  })
  const json = (res, status, payload, headers = {}) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers })
    res.end(JSON.stringify(payload))
  }
  const cookie = req => {
    const parts = String(req.headers.cookie ?? '').split(';')
    return parts.map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  }
  const clearCookie = () => `${cookieName}=; Path=${PREFIX}; HttpOnly; SameSite=Strict; Max-Age=0`
  const revokedSessions = new Set()
  const revokeSession = id => { if (id) { revokedSessions.add(id); sessions.delete(id) } }
  const pruneSessions = () => {
    for (const [id, until] of sessions) if (until <= Date.now()) revokeSession(id)
  }
  /**
   * 本机直连（回环地址）且没开 LAN 时视为已登录。
   *
   * 这个页面本来就跑在用户自己的机器上、只监听回环地址，让用户再从
   * `settings.json` 里翻一个令牌贴进来，只是**一层没有防护价值的摩擦**：
   * 能打开这个端口的人本来就已经在这台机器上（或已能读那份文件）。
   *
   * ⚠️ 三条边界必须同时成立才免登录，缺一不可：
   * 1. **请求来自回环地址**（`127.0.0.1` / `::1` / IPv4-mapped），外部地址不放行；
   * 2. **没有开启 LAN 暴露**（`standaloneLanEnabled !== true`）—— 一旦监听 0.0.0.0，
   *    同网段的任何人都能访问，此时必须回到令牌鉴权，否则等于把账号操作敞开；
   * 3. 仍然是**同源页面**发起的请求（下面 `route()` 里已有的 Origin / Sec-Fetch-Site 校验）。
   *
   * 注意 `Host` 头不可作为判据 —— 它可以被伪造；这里看的是**连接来源地址**
   * （`req.socket.remoteAddress`），那是 TCP 层的事实。
   */
  /**
   * 是否走「本机直连」这条免登录路径。
   *
   * ⚠️ 只在请求**没有携带任何显式凭证**时成立。带了 `Authorization: Bearer …` 或
   * 会话 cookie 的请求，必须按它自己那份凭证去校验 —— 否则「推理密钥」或一个
   * 已过期的会话 cookie 都会因为「反正来自本机」而被当成管理员。
   */
  const hasExplicitCredential = req => {
    if (typeof req.headers.authorization === 'string' && req.headers.authorization !== '') return true
    return typeof cookie(req) === 'string' && cookie(req) !== ''
  }
  const localDirectAllowed = req => {
    if (stores.settings.get().standaloneLanEnabled === true) return false
    if (hasExplicitCredential(req)) return false
    return isLoopbackAddress(req.socket?.remoteAddress)
  }
  const authenticated = req => {
    const bearer = /^Bearer (.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]
    if (matches(bearer, stores.settings.get().forwardKey)) return true
    if (localDirectAllowed(req)) return true
    pruneSessions()
    if (sessions.has(cookie(req))) return true
    // 免登录回落：本机直连（回环 + 未开 LAN）时，**未知**的失效会话 cookie（如旧进程
    // 遗留）不应把本机用户锁在登录页——它与「不带任何凭证的回环请求」等价（261f953 边界）。
    // 但本进程内明确吊销过的会话（到期/登出/轮换）不回落：那些语义要求旧凭证 401。
    const sid = cookie(req)
    if (sid && revokedSessions.has(sid)) return false
    if (stores.settings.get().standaloneLanEnabled !== true && isLoopbackAddress(req.socket?.remoteAddress)) return true
    return false
  }
  const persist = patch => {
    const previous = stores.settings.get()
    stores.settings.update(patch)
    stores.settings.flush()
    if (stores.settings.writeFailed) {
      // 不向页面谎报保存成功；保留原运行配置并由后续写入重试落盘。
      stores.settings.value = previous
      throw fail(500, '无法保存设置，请检查数据目录权限和磁盘空间')
    }
  }
  const summary = () => {
    const state = runtime.state()
    const available = stores.availability.get()
    const routable = new Set(runtime.publicModelRows().map(entry => entry.id))
    // 智能调度徽标：池内当前可用（未当日耗尽且未失效）的模型数（FR-2.2）。
    const smartView = scheduler ? (() => {
      const view = scheduler.state()
      return { pool: view.pool.length, available: view.statuses.filter(row => row.usable === true).length }
    })() : undefined
    return {
      ...info(),
      channels: channels?.state(),
      settings: managementSettings(stores.settings.get()),
      catalogSyncedAt: stores.settings.get().catalogSyncedAt ?? 0,
      probedAt: available.at ?? 0,
      ...(smartView ? { smart: smartView } : {}),
      catalog: state.catalog.map(entry => {
        const measured = modelAvailability(entry.id, available, Boolean(entry.channel))
        return ({
        id: entry.id, name: entry.name, channel: entry.channel ?? 'anonymous',
        vision: entry.vision === true, reasoning: entry.reasoning === true || (entry.reasoning !== null && typeof entry.reasoning === 'object'),
        contextWindow: entry.contextWindow ?? entry.context_window, maxOutput: entry.maxOutput ?? entry.max_tokens,
        routable: routable.has(entry.id),
        hiddenByUser: isModelHidden(entry, state.settings),
        hiddenByGroup: isModelHidden(entry, { ...state.settings, hiddenModelIds: [] }),
        ...measured, availability: measured.availabilitySource === 'listing' ? 'listed' : measured.availability,
      }) }),
    }
  }

  async function route(req, res, pathname) {
    const method = req.method ?? 'GET'
    if (method === 'POST' && pathname === `${PREFIX}/login/terminal`) {
      // 此入口发生在登录前，必须有浏览器的同源 Origin，拒绝跨站和无来源调用。
      if (req.headers.origin !== new URL(`http://${req.headers.host}`).origin ||
          req.headers['sec-fetch-site'] !== 'same-origin') {
        throw fail(403, '请从本机登录页面点击获取令牌')
      }
      const body = await readBody(req)
      if (Object.keys(body).length !== 0) throw fail(400, '获取令牌不接受路径或命令参数')
      if (terminalOpening || (terminalOpenedAt !== null && Date.now() - terminalOpenedAt < 30_000)) {
        throw fail(429, '已请求打开终端，请检查弹出的窗口，30 秒后可重试')
      }
      terminalOpening = true
      try {
        await loginTerminal(info().dataDir)
        terminalOpenedAt = Date.now()
        json(res, 200, { ok: true })
      } finally { terminalOpening = false }
      return
    }
    if (method === 'POST' && pathname === `${PREFIX}/session`) {
      const body = await readBody(req)
      const validBootstrap = bootstrap !== null && bootstrap.until > Date.now() && matches(body.bootstrapToken, bootstrap.token)
      const validManagementKey = matches(body.key, stores.settings.get().managementKey)
      if (!validBootstrap && !validManagementKey && !matches(body.key, stores.settings.get().forwardKey)) throw fail(401, '登录链接已失效或登录令牌不正确')
      pruneSessions()
      if (sessions.size >= 64) throw fail(429, '管理会话过多，请稍后重试')
      if (validBootstrap) bootstrap = null
      const id = crypto.randomBytes(32).toString('base64url')
      sessions.set(id, Date.now() + SESSION_MS)
      json(res, 200, { ok: true }, {
        'set-cookie': `${cookieName}=${id}; Path=${PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`,
      })
      return
    }
    if (!authenticated(req)) throw fail(401, '请先登录管理页面')
    if (method === 'POST' && pathname === `${PREFIX}/logout`) {
      await readBody(req)
      revokeSession(cookie(req))
      json(res, 200, { ok: true }, { 'set-cookie': clearCookie() })
    } else if (method === 'GET' && pathname === `${PREFIX}/summary`) {
      json(res, 200, summary())
    } else if (method === 'GET' && pathname === `${PREFIX}/stats`) {
      json(res, 200, buildStats(stores.stats.get(), runtime.catalog))
    } else if (method === 'GET' && pathname === `${PREFIX}/claims/history` && claims) {
      // 领取历史查询（FR-8.5）：按日期范围返回按日聚合（providers/claimedCount/events）。
      // from/to 校验（YYYY-MM-DD、跨度 ≤400 天）在记录器内部，错误带 400 状态码。
      const params = new URL(req.url, 'http://localhost').searchParams
      json(res, 200, claims.query({
        ...(params.get('from') !== null ? { from: params.get('from') } : {}),
        ...(params.get('to') !== null ? { to: params.get('to') } : {}),
      }))
    } else if (method === 'GET' && pathname === `${PREFIX}/smart/state` && scheduler) {
      // 智能调度页数据面：池、当前命中、全池状态、候选清单。读取前先对齐一次
      // 快照（refreshSnapshot 内部去重且失败静默，channels 不可用时回旧值）。
      await scheduler.refreshSnapshot()
      json(res, 200, scheduler.state())
    } else if (method === 'POST' && pathname === `${PREFIX}/smart/pool` && scheduler) {
      const body = await readBody(req)
      const models = validateSmartPool(body?.models)
      persist({ smartSchedulePool: { models } })
      await scheduler.refreshSnapshot()
      const view = scheduler.state()
      json(res, 200, { pool: view.pool, hit: view.hit, statuses: view.statuses, candidates: view.candidates })
    } else if (method === 'POST' && pathname === `${PREFIX}/channels/rpc` && channels) {
      // 渠道备份导入包含多账号凭据，仍限制总大小，但不能套设置表单的 16KB。
      const body = await readBody(req, 8 * 1024 * 1024)
      if (body.method === 'gateway.getEnabled' || body.method === 'gateway.setEnabled') {
        if (body.method === 'gateway.setEnabled') {
          if (typeof body.payload?.enabled !== 'boolean') throw fail(400, 'enabled 必须是布尔值')
          persist({ enabled: body.payload.enabled })
          await onSettingsChanged()
        }
        const base = new URL(info().baseUrl)
        json(res, 200, { ok: true, value: {
          enabled: stores.settings.get().enabled !== false, running: stores.settings.get().enabled !== false,
          blockedByEnv: false, address: { host: base.hostname, port: Number(base.port) },
          apiKey: { value: stores.settings.get().forwardKey, path: `${info().dataDir}/settings.json`, fromEnv: false },
          models: runtime.publicModelRows(), modelsSource: 'catalog',
        } })
      } else {
        const controller = new AbortController()
        const abort = () => controller.abort()
        res.once('close', abort)
        try {
          const reply = await channels.rpc(body, controller.signal)
          // 领取历史（FR-8.2a）：credits.claim* 成功返回时按 results[] 逐账号落事件。
          // 记录失败不影响原响应；渠道包自己的 auto-checkin.json 零触碰。
          if (claims && typeof body.method === 'string' && body.method.startsWith('credits.claim') && reply?.ok === true) {
            try { claims.recordManualClaim(body.payload?.provider, reply.value) } catch { /* 观测层失败静默 */ }
          }
          json(res, 200, reply)
        }
        finally { res.removeListener('close', abort) }
      }
    } else if (method === 'GET' && pathname === `${PREFIX}/requests` && requestLog) {
      const params = new URL(req.url, 'http://localhost').searchParams
      const limit = params.get('limit')
      json(res, 200, requestLog.list({ limit: limit === null ? 100 : Number(limit) }))
    } else if (method === 'POST' && pathname === `${PREFIX}/requests/clear` && requestLog) {
      await readBody(req)
      json(res, 200, { ok: requestLog.clear() })
    } else if (method === 'GET' && pathname === `${PREFIX}/dsh/import`) {
      // 首次启动探测 DSH 插件侧的账号渠道。只读本地文件；未安装 DSH 属于
      // 正常情形，返回 available:false。
      //
      // ⚠️ 只报计数，**不下发** backup 载荷：载荷里是明文凭据，把它随预览
      // 一起回给浏览器，等于让凭据为了一次「看一眼有多少个账号」而多绕一圈
      // （还会落在浏览器缓存/开发者工具里）。确认导入时由下面的 POST 分支
      // 在服务端重新探测，凭据全程不经过客户端。
      const detected = detectDshChannels()
      // 本服务**已经有账号**时不再提示：导入是整体替换，会把用户现有的
      // 登录状态冲掉。这条比「问过一次」更可靠 —— 用户点了「稍后」、
      // 或换了台机器但没有账号时，仍应再次被问到。
      // 「问过没有」只用于**自动弹窗**的判据；手动导入不受影响。
      const asked = stores.settings.get().dshImportAsked === true
      let existing = 0
      if (channels) {
        try {
          const status = await channels.rpc({ method: 'backup.status', payload: {} })
          existing = Number(status?.value?.accounts ?? 0) || 0
        } catch { /* 查不到就按「没有账号」处理，最多多问一次 */ }
      }
      json(res, 200, {
        // ⚠️ 只在「**首次**且没有绑定任何账号」时提示（2026-11-04 修订）。
        // 原判据只有 `existing === 0`，于是用户点「稍后」之后，只要本服务仍
        // 没有账号，**每次打开控制台都会再弹一次** —— 那是个骚扰，不是提示。
        // 现在把 `dshImportAsked` 一并纳入：问过一次（点稍后或导完）就不再自动
        // 弹，用户想导入可去渠道页手动触发。
        available: detected.available === true && existing === 0 && asked !== true,
        existing,
        reason: detected.reason,
        accounts: detected.accounts,
        providers: detected.providers,
        expired: detected.expired,
        skipped: detected.skipped ?? 0,
      })
    } else if (method === 'POST' && pathname === `${PREFIX}/dsh/import` && channels) {
      const body = await readBody(req, 8 * 1024 * 1024)
      if (body?.confirm !== true) throw fail(400, '导入需要显式确认')
      const detected = detectDshChannels()
      if (!detected.available || !detected.payload) throw fail(409, '没有可导入的 DSH 账号渠道')
      // 复用现成的 backup.import：整体替换，与网页导出导入走同一条路径。
      json(res, 200, await channels.rpc({ method: 'backup.import', payload: { payload: detected.payload } }))
    } else if (method === 'GET' && pathname === `${PREFIX}/disclaimer`) {
      json(res, 200, { ...STANDALONE_DISCLAIMER, acknowledged: standaloneDisclaimerAcknowledged(stores.settings.get()) })
    } else if (method === 'POST' && pathname === `${PREFIX}/disclaimer/ack`) {
      persist({ disclaimerAck: STANDALONE_DISCLAIMER_VERSION })
      json(res, 200, { ok: true, acknowledged: true })
    } else if (method === 'POST' && pathname === `${PREFIX}/settings`) {
      const patch = validateSettings(await readBody(req))
      persist(patch)
      await onSettingsChanged()
      json(res, 200, { settings: managementSettings(stores.settings.get()), lan: info().lan })
    } else if (method === 'GET' && pathname === `${PREFIX}/lan/key`) {
      json(res, 200, { key: stores.settings.get().standaloneLanKey ?? '' })
    } else if (method === 'POST' && pathname === `${PREFIX}/lan/key/rotate`) {
      const body = await readBody(req)
      if (body.confirm !== true || Object.keys(body).length !== 1) throw fail(400, 'LAN key rotation requires only confirm: true')
      persist({ standaloneLanKey: generateKey() })
      json(res, 200, { key: stores.settings.get().standaloneLanKey })
    } else if (method === 'GET' && pathname === `${PREFIX}/key`) {
      json(res, 200, { key: stores.settings.get().forwardKey })
    } else if (method === 'POST' && pathname === `${PREFIX}/key/rotate`) {
      const body = await readBody(req)
      if (body.confirm !== true) throw fail(400, '请确认轮换 API Key')
      const id = cookie(req)
      persist({ forwardKey: generateKey() })
      // 仅当前管理会话保留；旧密钥与其他会话立即失效（且记入吊销——吊销过的
      // 会话 cookie 不适用本机免登录回落，见 authenticated() 的注释）。
      const until = sessions.get(id)
      for (const sid of sessions.keys()) revokeSession(sid)
      sessions.clear()
      if (until) sessions.set(id, until)
      bootstrap = null
      json(res, 200, { key: stores.settings.get().forwardKey })
    } else throw fail(404, '管理接口不存在')
  }

  return {
    setPort(port) { cookieName = `ofm_management_${port}` },
    get bootstrapFragment() { return bootstrap === null ? '' : `#login=${bootstrap.token}` },
    async handleRequest(req, res) {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      const asset = assets.get(pathname)
      const isApi = pathname === PREFIX || pathname.startsWith(`${PREFIX}/`)
      if (!asset && !isApi) return false
      // 不接受插件专用 dsh-app Referer；独立管理只允许本页面的 HTTP 来源。
      const referer = req.headers.referer
      const origin = req.headers.origin
      const malformedSource = [referer, origin].some(value => value !== undefined && (
        typeof value !== 'string' || !value.startsWith('http://')
      ))
      if (closed || !cookieName) json(res, 503, { error: '服务正在停止或启动' })
      else if (malformedSource || structuralRejection(req) !== undefined) json(res, 403, { error: '管理接口仅允许本机同源访问' })
      else if (asset) {
        if (req.method !== 'GET' && req.method !== 'HEAD') json(res, 405, { error: '资源仅支持 GET 或 HEAD' })
        else {
          res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': asset.type })
          res.end(req.method === 'HEAD' ? undefined : asset.body)
        }
      } else {
        try { await route(req, res, pathname) } catch (error) {
          if (!res.destroyed && !res.headersSent) json(res, error.statusCode ?? 500, {
            error: error.statusCode ? error.message : '管理操作失败，请查看服务日志',
          })
        }
      }
      return true
    },
    dispose() { closed = true; bootstrap = null; sessions.clear() },
  }
}
