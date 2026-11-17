/**
 * 智能调度（Smart / auto 网关别名）：顺序接力调度器。
 *
 * 语义（PRD FR-4，方案 §3）：
 * - 对外暴露 `auto`（规范名）与 `ourfreemodel`（别名，小写归一后等价）；
 * - 按调度池顺序取第一个「可用」模型分发，命中后仅改写 `request.model`，
 *   管线与直连该模型逐字节一致（多账号轮换 / 配额标记 / recordUsage 全沿用）；
 * - 接力触发条件唯一 = 配额耗尽（channelCode='QUOTA_EXCEEDED' 或消息兜底），
 *   其他错误（网络、5xx、能力不匹配）原样上抛；
 * - 预检（30s 快照 + modelRateLimits 内存推导）跳过已耗尽模型，不发任何上游请求；
 *   跳过状态由持久化的 modelRateLimits 派生（D12），重启后自动正确（AC-12）；
 * - 流式保护：一旦向客户端下发过任何字节（首 chunk 已出），不再切换模型（AC-9）；
 * - 全池耗尽 → HTTP 429 信封（code=RATE_LIMIT + 各模型解禁明细，AC-8）；
 *   空池 / 池内全部失效 → HTTP 400 invalid_request_error（AC-10）。
 *
 * 快照来源：对 channels.providers 并行 rpc `model.list` / `account.list`
 * （channels/runtime.mjs 的既有 RPC 面），失败静默保留旧值（NFR-9）。
 * 刷新时机：启动拉取 → 30s 定时（unref）→ 请求时快照超过 60s 异步刷新 →
 * 运行时接力后即时刷新。
 *
 * 视觉路由（FR-15，方案 §V10.1）：含图请求（hasImageInput 三入口检测）只把
 * `vision === true` 的池内模型纳入候选；vision 单一事实源 = channels.publicModelRows()
 * 行的 vision 布尔（与接入页徽章同一份 rows，R14 零漂移），非显式 true 保守跳过（D31）。
 * 池内不存在任何 vision=true → 400 配置指引（FR-15.4a）；存在但全耗尽/不可用 →
 * 429 信封 details 增 filteredBy:'vision' 且 models 仅列视觉候选（FR-15.4b）。
 * 纯文本路径（visionOnly === false）与 1.2.0 逐字节一致（AC-41 场景二）。
 */

const SMART_ALIASES = new Set(['auto', 'ourfreemodel'])
/** 消息兜底（W1 的第二条通道）：渠道包内以明文抛出、未带 channelCode 的配额类错误。 */
const QUOTA_MESSAGE_PATTERN = /所有账号均受限|所有账号均不可用/
const SNAPSHOT_INTERVAL_MS = 30_000
const SNAPSHOT_STALE_MS = 60_000

/** auto / ourfreemodel 保留名（小写归一后精确匹配，不匹配任何带 provider/ 前缀的渠道模型）。 */
export function isSmartAlias(model) {
  const name = String(model ?? '').trim().toLowerCase()
  return SMART_ALIASES.has(name)
}

/** 配额耗尽判据（正确性锚点）：channelCode 等值匹配优先，消息兜底其次，与抛出位置无关。 */
export function isQuotaExhaustion(error) {
  if (error?.channelCode === 'QUOTA_EXCEEDED') return true
  return QUOTA_MESSAGE_PATTERN.test(String(error?.message ?? ''))
}

/**
 * 含图检测（FR-15.3，纯函数）：调度器拿到的是 service 包装层的**原始** request，
 * 三入口与 worker.mjs 的 `request.responsesBody ?? request.openAi ?? harnessBody(request)`
 * 三形态一一对应，必须全部检查：
 * ① OpenAI chat：openAi.messages[].content[] 元素 type === 'image_url'；
 * ② Responses：responsesBody.input[] 元素 type === 'input_image'（含嵌套 content[] 递归一层）；
 * ③ Anthropic harness：messages[].content[] 元素 type === 'image'（image block）。
 * 漏检语义安全（SR-14）：检测遗漏 → 不过滤 → 行为与 1.2.0 纯文本路径一致（无回归面）。
 */
export function hasImageInput(request) {
  const blocks = value => Array.isArray(value) ? value : []
  for (const message of blocks(request?.openAi?.messages)) {
    for (const part of blocks(message?.content)) {
      if (part?.type === 'image_url') return true
    }
  }
  for (const item of blocks(request?.responsesBody?.input)) {
    if (item?.type === 'input_image') return true
    for (const part of blocks(item?.content)) {
      if (part?.type === 'input_image') return true
    }
  }
  for (const message of blocks(request?.messages)) {
    for (const part of blocks(message?.content)) {
      if (part?.type === 'image') return true
    }
  }
  return false
}

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode })

/** 拆分首个 '/'：渠道模型 id 一律 `provider/model`。 */
function splitModelId(modelId) {
  const slash = String(modelId).indexOf('/')
  if (slash <= 0) return { provider: '', model: '' }
  return { provider: String(modelId).slice(0, slash), model: String(modelId).slice(slash + 1) }
}

const nowMs = () => Date.now()

/**
 * 创建调度器。`channels` 是 channels/runtime.mjs 的运行时（providers / rpc / complete），
 * `settings` 是 JsonStore（读 smartSchedulePool）。
 */
export function createSmartScheduler({ settings, channels, logger = console }) {
  let snapshot = { at: 0, models: new Map(), accounts: new Map(), vision: new Map() }
  let refreshing
  let timer

  const poolModels = () => {
    const pool = settings.get().smartSchedulePool?.models
    return Array.isArray(pool) ? pool.filter(id => typeof id === 'string' && id !== '') : []
  }

  /** 对全部渠道供应商并行拉取模型与账号清单；失败静默（保留旧值）。 */
  function refreshSnapshot() {
    if (refreshing) return refreshing
    const providers = [...(channels?.providers ?? [])]
    const first = snapshot.at === 0
    refreshing = Promise.all([
      Promise.all(providers.map(async provider => {
        const [models, accounts] = await Promise.all([
          channels.rpc({ method: 'model.list', payload: { provider } }),
          channels.rpc({ method: 'account.list', payload: { provider } }),
        ])
        return { provider, models: models?.ok === false ? [] : (models?.value?.models ?? []), accounts: accounts?.ok === false ? [] : (accounts?.value?.accounts ?? []) }
      })),
      // 视觉单一事实源（FR-15.1/R14）：publicModelRows 是内存函数（worker 'changed'
      // 后 refresh 已更新），与接入页徽章读的是同一份 rows——结构上零漂移。
      // 首次刷新先 await channels.ready 再读：启动空窗期 rows 仍为 []，会让含图
      // 请求误判「池内无视觉模型」而 400（R8O-001 收口）。
      (async () => {
        if (first) { try { await channels?.ready } catch { /* 渠道未就绪：按当前 rows（可能为空）继续 */ } }
        return channels?.publicModelRows?.() ?? []
      })(),
    ]).then(([rows, catalogRows]) => {
      const models = new Map()
      const accounts = new Map()
      for (const { provider, models: modelRows, accounts: accountRows } of rows) {
        models.set(provider, modelRows)
        accounts.set(provider, accountRows)
      }
      const vision = new Map()
      for (const row of catalogRows) {
        // 仅显式 true 肯定（D31）：false / undefined / 键不存在一律按无视觉保守跳过。
        if (typeof row?.id === 'string' && row.id !== '') vision.set(row.id, row.vision === true)
      }
      snapshot = { at: nowMs(), models, accounts, vision }
    }).catch(() => {
      // 快照刷新失败不阻塞主流程（NFR-9）：保留旧快照，下一个周期再试。
    }).finally(() => { refreshing = undefined })
    return refreshing
  }

  function ensureSnapshot() {
    if (snapshot.at === 0) { void refreshSnapshot(); return }
    if (nowMs() - snapshot.at > SNAPSHOT_STALE_MS) void refreshSnapshot()
  }

  /**
   * 某模型的启用账号集与其中仍在未来的解禁时刻。modelAvailability 的 429 resetAtMs
   * 与 accountStats 的 accounts.earliestResetAtMs 共用这一份派生（SR-15 零第二实现）。
   */
  function enabledAccountsAndResets(provider, model, now) {
    const enabled = (snapshot.accounts.get(provider) ?? []).filter(account => account.enabled !== false)
    const resets = enabled
      .map(account => Number(account.modelRateLimits?.[model] ?? 0))
      .filter(resetAt => Number.isFinite(resetAt) && resetAt > now)
    return { enabled, resets }
  }

  /** 某模型按快照推导的可用性。预检纯内存计算，不发任何上游网络请求（AC-7/NFR-1）。 */
  function modelAvailability(modelId) {
    const now = nowMs()
    const { provider, model } = splitModelId(modelId)
    const row = (snapshot.models.get(provider) ?? []).find(entry => entry.id === model)
    if (!row || row.disabled === true || row.dead === true) return { usable: false, reason: 'invalid' }
    const { enabled, resets } = enabledAccountsAndResets(provider, model, now)
    if (enabled.length === 0) return { usable: false, reason: 'invalid' }
    if (resets.length === enabled.length) return { usable: false, reason: 'exhausted', resetAtMs: Math.min(...resets) }
    return { usable: true }
  }

  /** 绑定账号面统计：total/available 都只统计 enabled 账号；earliestResetAtMs 为
   *  可选新增字段（FR-16.3）——未来解禁时刻的最小值，无未来解禁时缺省。 */
  function accountStats(modelId) {
    const now = nowMs()
    const { provider, model } = splitModelId(modelId)
    const { enabled, resets } = enabledAccountsAndResets(provider, model, now)
    return {
      total: enabled.length,
      available: enabled.length - resets.length,
      ...(resets.length > 0 ? { earliestResetAtMs: Math.min(...resets) } : {}),
    }
  }

  /**
   * 全量池评估（单次遍历，不提前 return）：empty / hit（附 attemptOrder）/ exhausted。
   * visionOnly（FR-15，含图请求）：statuses 仍全量覆盖池并带 vision 标记，但
   * usable/attemptOrder 仅含 vision === true 的候选（非显式 true 保守跳过，D31）；
   * 池内不存在任何 vision=true 时按 empty 返回（→ 400 配置指引，FR-15.4a）。
   */
  function evaluatePool({ visionOnly = false } = {}) {
    const pool = poolModels()
    const statuses = []
    const usable = []
    for (const modelId of pool) {
      const availability = modelAvailability(modelId)
      const vision = snapshot.vision.get(modelId) === true
      statuses.push({ modelId, ...availability, vision, accounts: accountStats(modelId) })
      if (availability.usable && (!visionOnly || vision)) usable.push(modelId)
    }
    const allInvalid = pool.length > 0 && statuses.every(status => status.reason === 'invalid')
    if (pool.length === 0 || allInvalid) return { kind: 'empty', statuses }
    if (visionOnly && statuses.every(status => !status.vision)) return { kind: 'empty', statuses }
    if (usable.length > 0) return { kind: 'hit', hit: usable[0], statuses, attemptOrder: usable }
    return { kind: 'exhausted', statuses }
  }

  /**
   * 全池耗尽的 429 信封（AC-8）。resetAtMs 已知的给 ms+ISO，积分型（运行时才发现）给 resetUnknown。
   * filteredBy:'vision'（FR-15.4b）：含图场景细节仅列视觉候选时的标记——扩展字段，
   * SDK 忽略，纯文本 429 形状不变。
   */
  function exhaustedFailure(statuses, { filteredBy } = {}) {
    const now = nowMs()
    const models = statuses.map(status => status.resetAtMs !== undefined && status.resetAtMs > now
      ? { model: status.modelId, resetAtMs: status.resetAtMs, resetAtIso: new Date(status.resetAtMs).toISOString() }
      : { model: status.modelId, resetUnknown: true })
    const resets = statuses.map(status => status.resetAtMs).filter(resetAt => Number.isFinite(resetAt) && resetAt > now)
    const retryAfterMs = resets.length === statuses.length && statuses.length > 0 ? Math.min(...resets) - now : undefined
    return Object.assign(
      new Error('调度池内全部模型当日配额耗尽，请稍后再试、更换模型，或在管理台「智能调度」页调整调度池'),
      {
        statusCode: 429,
        code: 'RATE_LIMIT',
        ...(retryAfterMs !== undefined && retryAfterMs > 0 ? { providerRetryAfterMs: retryAfterMs } : {}),
        details: { type: 'smart_pool_exhausted', models, ...(filteredBy !== undefined ? { filteredBy } : {}) },
      },
    )
  }

  /** 运行时接力后被耗尽的候选（积分型无 resetAtMs）标记进状态明细。 */
  function markExhausted(statuses, runtimeExhausted) {
    const hit = new Set(runtimeExhausted)
    return statuses.map(status => hit.has(status.modelId) ? { ...status, usable: false, reason: 'exhausted', resetAtMs: undefined } : status)
  }

  /**
   * auto 请求主入口。`context`（可选）是调用方的观测对象：
   * 每次实际派发时写回 `context.model = 候选模型`，供 requestLog 记 `auto→真实模型`。
   */
  async function complete(request, onChunk, context) {
    const visionOnly = hasImageInput(request)
    ensureSnapshot()
    // R8O-001 收口：含图请求在首份快照落定前等待其完成（refreshSnapshot 内部已去重），
    // 消除启动空窗对视觉 Map 的误读（误 400）；纯文本路径保持 1.2.0 的非阻塞语义。
    if (visionOnly && snapshot.at === 0) await refreshSnapshot()
    const evaluation = evaluatePool(visionOnly ? { visionOnly: true } : undefined)
    if (evaluation.kind === 'empty') {
      // 含图细分（FR-15.4a）：池空 / 全失效 / 池内不存在任何 vision=true → 400 配置指引（含图场景专属文案）。
      throw fail(400, visionOnly
        ? '调度池内没有支持视觉的模型，请在智能调度页将视觉模型加入调度池'
        : '调度池为空或无可用模型：请在管理台「智能调度」页配置调度池')
    }
    // 含图细分（FR-15.4b）：存在视觉候选但全部耗尽/不可用 → 429，明细仅列视觉候选并带 filteredBy。
    const visionFailure = statuses => exhaustedFailure(statuses.filter(status => status.vision), { filteredBy: 'vision' })
    if (evaluation.kind === 'exhausted') throw visionOnly ? visionFailure(evaluation.statuses) : exhaustedFailure(evaluation.statuses)
    let emitted = false
    const runtimeExhausted = []
    for (const candidate of evaluation.attemptOrder) {
      if (context) context.model = candidate
      try {
        return await channels.complete({ ...request, model: candidate }, chunk => {
          emitted = true
          onChunk?.(chunk)
        })
      } catch (error) {
        if (emitted) throw error                      // AC-9 流式保护：已下发字节不再接力
        if (!isQuotaExhaustion(error)) throw error    // D9/AC-11：非配额错误原样上抛
        runtimeExhausted.push(candidate)
        void refreshSnapshot()                        // 接力后即时刷新（A 类写盘的 modelRateLimits 尽快可见）
      }
    }
    const finalStatuses = markExhausted(evaluation.statuses, runtimeExhausted)
    throw visionOnly ? visionFailure(finalStatuses) : exhaustedFailure(finalStatuses)
  }

  /** 全池状态（S4 GET /smart/state 的数据面）：池、当前命中、全池明细、候选清单。 */
  function state() {
    const evaluation = evaluatePool()
    const candidates = []
    for (const [provider, rows] of snapshot.models) {
      for (const row of rows) {
        candidates.push({
          id: `${provider}/${row.id}`,
          provider,
          model: row.id,
          name: row.name,
          disabled: row.disabled === true,
          dead: row.dead === true,
          accounts: accountStats(`${provider}/${row.id}`),
        })
      }
    }
    return {
      pool: poolModels(),
      hit: evaluation.kind === 'hit' ? evaluation.hit : null,
      statuses: evaluation.statuses,
      candidates,
    }
  }

  /** `/v1/models` 头部注入的 auto 条目（始终暴露，即使池空；字段形态与渠道行一致）。 */
  function autoRow() {
    return {
      id: 'auto',
      object: 'model',
      created: Math.floor(nowMs() / 1000),
      owned_by: 'our-free-model',
      name: 'OurFreeModel 智能调度',
    }
  }

  timer = setInterval(() => { void refreshSnapshot() }, SNAPSHOT_INTERVAL_MS)
  timer.unref?.()
  void refreshSnapshot()

  return {
    handles: isSmartAlias,
    complete,
    state,
    autoRow,
    refreshSnapshot,
    dispose() { clearInterval(timer) },
  }
}
