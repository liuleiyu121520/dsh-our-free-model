/**
 * 网关请求日志：把每次推理请求落成一条可翻阅的记录。
 *
 * 与 `stats` 的区别：`stats` 是聚合数字（按天、按模型累加），这里保留**逐条
 * 原始记录**，用来回答「刚才那次为什么慢 / 为什么失败 / 用了多少 token」。
 *
 * 存储契约：
 * - 单个 JSONL 文件，追加写；一行一条，格式稳定，坏行只跳过不影响其余。
 * - 环形保留：超过 `maxEntries` 时从最老的开始裁掉。默认 2000 条 ≈ 一台机器
 *   几天的真实调用量，足够排障又不会无限增长。
 * - 只记录元数据：模型、时间、耗时、token、成败、错误码。**不记录** prompt、
 *   completion、请求头或任何凭据。
 *
 * 失败策略：写不进去（磁盘满、权限、只读盘）不影响推理本身 —— 日志是观测，
 * 不是业务。调用方拿到 `false` 后照常继续。
 */
import fs from 'node:fs'
import path from 'node:path'

export const REQUEST_LOG_FILE = 'request-log.jsonl'
const DEFAULT_MAX = 2000

/** 敏感字段一律不落盘；这里用白名单而不是黑名单，避免以后新增字段被误记。 */
const FIELDS = [
  'at', 'model', 'effort', 'ok', 'status', 'errorCode', 'error',
  'input', 'output', 'reasoning', 'cacheRead',
  'ttftMs', 'elapsedMs', 'decodeMs', 'attempt', 'recoveryAttempt', 'origin',
]

const numberOrNull = value => Number.isFinite(value) ? Math.round(value) : null

/** 把适配器/渠道的原始 record 裁剪成日志行。 */
export function toLogRow(record, now = Date.now()) {
  if (!record || typeof record !== 'object') return null
  const model = typeof record.model === 'string' ? record.model.slice(0, 200) : ''
  if (model === '') return null
  const row = {
    at: Number.isFinite(record.at) ? Math.round(record.at) : now,
    model,
    ok: record.ok === true,
  }
  for (const key of ['effort', 'errorCode', 'origin']) {
    if (typeof record[key] === 'string' && record[key] !== '') row[key] = record[key].slice(0, 120)
  }
  if (Number.isFinite(record.status)) row.status = Math.round(record.status)
  // 错误信息只留短前缀：完整堆栈可能夹带上游 URL 或响应片段。
  if (typeof record.error === 'string' && record.error !== '') row.error = record.error.slice(0, 200)
  for (const key of ['input', 'output', 'reasoning', 'cacheRead', 'ttftMs', 'elapsedMs', 'decodeMs', 'attempt']) {
    const value = numberOrNull(record[key])
    if (value !== null && value >= 0) row[key] = value
  }
  if (record.recoveryAttempt === true) row.recoveryAttempt = true
  return row
}

export function createRequestLog({ dataDir, maxEntries = DEFAULT_MAX, logger = console } = {}) {
  const file = path.join(dataDir, REQUEST_LOG_FILE)
  let rows = []
  let loaded = false
  let disabled = false

  const load = () => {
    if (loaded) return
    loaded = true
    try {
      if (!fs.existsSync(file)) return
      const text = fs.readFileSync(file, 'utf8')
      const parsed = []
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        try {
          const row = JSON.parse(line)
          if (row && typeof row === 'object' && typeof row.model === 'string') parsed.push(row)
        } catch { /* 坏行跳过：手改过的文件不应让整个日志不可用 */ }
      }
      rows = parsed.slice(-maxEntries)
    } catch (error) {
      logger.warn?.(`请求日志读取失败：${error.message}`)
    }
  }

  const persist = () => {
    const temp = `${file}.${process.pid}.tmp`
    try {
      // 首次写入时数据目录可能还没建（例如单独调用日志模块做诊断）。
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      fs.writeFileSync(temp, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), { mode: 0o600 })
      fs.renameSync(temp, file)
      return true
    } catch (error) {
      logger.warn?.(`请求日志写入失败：${error.message}`)
      try { if (fs.existsSync(temp)) fs.unlinkSync(temp) } catch { /* best effort */ }
      return false
    } finally {
      disabled = false
    }
  }

  return {
    file,
    /** 追加一条；返回是否真的写进去了。 */
    append(record) {
      if (disabled) return false
      const row = toLogRow(record)
      if (!row) return false
      load()
      rows.push(row)
      if (rows.length > maxEntries) rows = rows.slice(-maxEntries)
      return persist()
    },
    /** 最近的记录，新的在前。 */
    list({ limit = 100 } = {}) {
      load()
      const safe = Math.max(1, Math.min(Number(limit) || 100, maxEntries))
      const newestFirst = [...rows].reverse()
      return { total: rows.length, entries: newestFirst.slice(0, safe) }
    },
    clear() {
      load()
      rows = []
      try { if (fs.existsSync(file)) fs.unlinkSync(file) } catch (error) { logger.warn?.(`请求日志清理失败：${error.message}`); return false }
      return true
    },
  }
}
