/**
 * 渠道领取历史（claims-history.json，方案 §2.2 / PRD FR-8）。
 *
 * 事实约束：channel-pack 的 auto-checkin.json 只保存最近一次运行的摘要
 * （business.mjs:60869-60961，禁改），按天历史物理缺失 —— 由 standalone 层
 * 新增本独立 JsonStore 记录：
 * - a. 经 management 转发的 `credits.claim*` 手动领取：按 value.results[] 逐账号落事件；
 * - b. 渠道包内部自动签到：5 分钟轮询 `usage.autoCheckin` 状态快照，
 *      `lastAt` 变化时逐 provider 落事件（启动以当前 lastAt 初始化，不回填）。
 *
 * schema `standalone/claims-history/v1`；`days[dayKey].events[{at, provider, text,
 * kind, source, amount?, unit?}]`；本地时区 dayKey（与 stats 一致）；裁剪 120 天
 * （对齐 stats pruneDays）；每日每 provider 最多 8 条（超出丢最旧）；text ≤120
 * 对齐渠道包 auto-checkin 的 text 上限。失败静默：记录层任何异常不得影响领取
 * 与推理主流程（NFR-9）。本层**绝不读写** auto-checkin.json（那是渠道包自己的文件）。
 */
import path from 'node:path'
import { dayKey, JsonStore, pruneDays } from '../../src/store.js'

export const CLAIMS_HISTORY_SCHEMA = 'standalone/claims-history/v1'
export const CLAIMS_HISTORY_FILE = 'claims-history.json'

const KEEP_DAYS = 120
const MAX_PER_PROVIDER_PER_DAY = 8
const TEXT_MAX = 120
const DEFAULT_POLL_MS = 5 * 60_000
const RANGE_MAX_DAYS = 400
const DEFAULT_WINDOW_DAYS = 62
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const fail400 = message => Object.assign(new Error(message), { statusCode: 400 })

const dayMs = day => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))

/** 单条事件的运行时形状；非法字段一律修复或拒绝，坏数据不污染按天聚合。 */
function normalizeEvent(raw, fallbackAt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const at = Number.isFinite(raw.at) && raw.at > 0 ? Math.round(raw.at) : fallbackAt
  if (provider === '' || !Number.isFinite(at) || at <= 0) return null
  const kind = typeof raw.kind === 'string' && raw.kind !== '' ? raw.kind : 'failed'
  const source = raw.source === 'auto' ? 'auto' : 'manual'
  const text = typeof raw.text === 'string' && raw.text !== '' ? raw.text.slice(0, TEXT_MAX) : kind
  const event = { at, provider, text, kind, source }
  // 结构化金额：渠道包在 outcome 上给出 credit/unit 时才带（FR-8.3 金额可得才写）。
  const amount = Number(raw.amount)
  if (Number.isFinite(amount) && amount > 0) event.amount = amount
  if (typeof raw.unit === 'string' && raw.unit !== '') event.unit = raw.unit
  return event
}

/** outcome → 事件字段：kind 取 outcome.kind，text 优先 outcome.message（缺失时按 credit 概括）。 */
export function claimOutcomeEvent(provider, result, { at, source = 'manual' } = {}) {
  const outcome = result?.outcome && typeof result.outcome === 'object' ? result.outcome : {}
  const who = typeof result?.nickname === 'string' && result.nickname !== '' ? result.nickname
    : typeof result?.accountId === 'string' ? result.accountId : '账号'
  let text = typeof outcome.message === 'string' && outcome.message !== '' ? outcome.message : ''
  if (text === '') {
    const credit = Number(outcome.credit)
    text = outcome.kind === 'claimed' && Number.isFinite(credit)
      ? `领取成功 ${credit}${typeof outcome.unit === 'string' && outcome.unit !== '' ? ` ${outcome.unit}` : ''}`
      : String(outcome.kind ?? 'failed')
  }
  const credit = Number(outcome.credit)
  return normalizeEvent({
    at,
    provider,
    text: `${who}：${text}`,
    kind: typeof outcome.kind === 'string' && outcome.kind !== '' ? outcome.kind : 'failed',
    source,
    ...(outcome.kind === 'claimed' && Number.isFinite(credit) && credit > 0 ? { amount: credit } : {}),
    ...(typeof outcome.unit === 'string' && outcome.unit !== '' ? { unit: outcome.unit } : {}),
  }, at)
}

function sanitizeDoc(value) {
  const days = value?.days && typeof value.days === 'object' && !Array.isArray(value.days) ? value.days : {}
  const clean = {}
  for (const [day, bucket] of Object.entries(days)) {
    if (!DAY_PATTERN.test(day)) continue
    const raw = Array.isArray(bucket?.events) ? bucket.events : Array.isArray(bucket) ? bucket : []
    const events = raw.map(event => normalizeEvent(event, 0)).filter(Boolean)
    if (events.length > 0) clean[day] = { events }
  }
  return { schema: CLAIMS_HISTORY_SCHEMA, days: clean }
}

/** 每 provider 每日保留最近 8 条（超出丢同 provider 最旧）。 */
function capPerProvider(events) {
  const counts = new Map()
  for (const event of events) counts.set(event.provider, (counts.get(event.provider) ?? 0) + 1)
  if (![...counts.values()].some(count => count > MAX_PER_PROVIDER_PER_DAY)) return events
  const lastIndexes = new Map()
  events.forEach((event, index) => {
    const list = lastIndexes.get(event.provider) ?? []
    list.push(index)
    lastIndexes.set(event.provider, list)
  })
  const keep = new Set()
  for (const [, list] of lastIndexes) for (const index of list.slice(-MAX_PER_PROVIDER_PER_DAY)) keep.add(index)
  return events.filter((_, index) => keep.has(index))
}


export function createClaimsHistory({ dataDir, channels, logger = console, pollMs = DEFAULT_POLL_MS, now = Date.now } = {}) {
  const store = new JsonStore(path.join(dataDir, CLAIMS_HISTORY_FILE), sanitizeDoc(undefined), {
    log: message => logger.warn?.(`claims-history: ${message}`),
  })
  let timer
  let disposed = false
  let initialized = false
  let lastSeenAt = 0

  const readDoc = () => sanitizeDoc(store.get())

  const persist = doc => {
    // pruneDays 只裁剪 days 键（store.js:558），schema 原样保留。
    const pruned = pruneDays(doc, KEEP_DAYS)
    store.update({ schema: CLAIMS_HISTORY_SCHEMA, days: pruned.days })
    store.flush()
    if (store.writeFailed) logger.warn?.('claims-history: 领取历史写入失败，本次记录仅保留在内存')
    return pruned
  }

  /**
   * 追加事件。events 至少含 provider/text/kind/source；at 缺省取当前时间，
   * dayKey 按**事件自身时间**落（本地时区，与 stats 同口径）。
   */
  function record(events, { at } = {}) {
    if (disposed || !Array.isArray(events)) return false
    const fallbackAt = at ?? now()
    const normalized = events.map(event => normalizeEvent(event, fallbackAt)).filter(Boolean)
    if (normalized.length === 0) return false
    const doc = readDoc()
    const days = { ...doc.days }
    for (const event of normalized) {
      const day = dayKey(event.at)
      const previous = Array.isArray(days[day]?.events) ? days[day].events : []
      days[day] = { events: capPerProvider([...previous, event]) }
    }
    persist({ schema: CLAIMS_HISTORY_SCHEMA, days })
    return true
  }

  /** 手动领取包装：claim 类 RPC 的 value.results[] 逐账号 → per-provider 事件。 */
  function recordManualClaim(provider, value) {
    if (disposed) return false
    const providerName = typeof provider === 'string' ? provider.trim() : ''
    if (providerName === '' || !value || typeof value !== 'object') return false
    const at = now()
    const events = (Array.isArray(value.results) ? value.results : [])
      .map(result => claimOutcomeEvent(providerName, result, { at, source: 'manual' }))
      .filter(Boolean)
    if (events.length === 0) return false
    return record(events)
  }

  /**
   * 按日期范围查询。返回 `{ schema, since, days }`：
   * - days 只包含**库内有记录**且落在 [from, to] 的日，形状 `days[day] = { providers, claimedCount, events }`；
   * - claimedCount = 当日存在 kind='claimed' 事件的去重渠道数（FR-7.2 领取成功口径）；
   * - since = 库内最早记录日（三态 join 的「记录起始」锚点；库空为 null）。
   * 校验：from/to 必须是 YYYY-MM-DD、from ≤ to、跨度 ≤400 天；缺省窗口 = 最近 62 天。
   */
  function query({ from, to } = {}) {
    for (const [label, value] of [['from', from], ['to', to]]) {
      if (value !== undefined && !DAY_PATTERN.test(String(value))) throw fail400(`${label} 必须是 YYYY-MM-DD 格式`)
    }
    const doc = readDoc()
    const allDays = Object.keys(doc.days).sort()
    const since = allDays[0] ?? null
    const effectiveTo = to ?? dayKey(now())
    const effectiveFrom = from ?? dayKey(dayMs(effectiveTo) - (DEFAULT_WINDOW_DAYS - 1) * 86_400_000)
    if (!DAY_PATTERN.test(effectiveFrom) || !DAY_PATTERN.test(effectiveTo)) throw fail400('查询日期超出可表示范围')
    if (dayMs(effectiveFrom) > dayMs(effectiveTo)) throw fail400('from 不能晚于 to')
    if ((dayMs(effectiveTo) - dayMs(effectiveFrom)) / 86_400_000 > RANGE_MAX_DAYS) {
      throw fail400(`查询跨度最多 ${RANGE_MAX_DAYS} 天`)
    }
    const days = {}
    for (const day of allDays) {
      if (day < effectiveFrom || day > effectiveTo) continue
      const events = doc.days[day].events
      const providers = []
      const claimed = new Set()
      for (const event of events) {
        if (!providers.includes(event.provider)) providers.push(event.provider)
        if (event.kind === 'claimed') claimed.add(event.provider)
      }
      days[day] = { providers, claimedCount: claimed.size, events }
    }
    return { schema: CLAIMS_HISTORY_SCHEMA, since, days }
  }

  /** 轮询一轮 `usage.autoCheckin`：启动首轮回填 lastSeenAt（不落记录），此后 lastAt 变化才落事件。 */
  async function poll() {
    if (disposed || !channels) return
    try {
      const reply = await channels.rpc({ method: 'usage.autoCheckin', payload: {} })
      const state = reply?.ok === true && reply?.value && typeof reply.value === 'object' ? reply.value.autoCheckin : undefined
      const lastAt = Number(state?.lastAt)
      // lastAt=0（从未运行过）也是合法快照：首轮必须完成初始化锚定，否则
      // 服务启动后渠道包的首次运行会被误判为「启动回填」而漏记。
      if (!Number.isFinite(lastAt) || lastAt < 0) return
      if (!initialized) {
        initialized = true
        lastSeenAt = lastAt
        return
      }
      if (lastAt === lastSeenAt) return
      lastSeenAt = lastAt
      const events = (Array.isArray(state?.channels) ? state.channels : [])
        .map(entry => normalizeEvent({
          at: lastAt,
          provider: typeof entry?.provider === 'string' ? entry.provider : '',
          text: typeof entry?.text === 'string' ? entry.text : '',
          // 渠道包把本轮触达的每个渠道记进 channels[]，text 是该渠道的结果摘要；
          // 粒度下限（provider+摘要文本）由 text 承载，kind 标记本轮运行（FR-8.2b）。
          kind: 'claimed',
          source: 'auto',
        }, lastAt))
        .filter(Boolean)
      if (events.length > 0) record(events)
    } catch {
      // 轮询失败静默（NFR-9）：渠道不可用时不阻塞、不告警刷屏，下一个周期再试。
    }
  }

  timer = setInterval(() => { void poll() }, Math.max(1000, pollMs))
  timer.unref?.()
  void poll()

  function dispose() {
    if (disposed) return
    disposed = true
    clearInterval(timer)
  }

  return { schema: CLAIMS_HISTORY_SCHEMA, record, recordManualClaim, query, poll, dispose }
}
