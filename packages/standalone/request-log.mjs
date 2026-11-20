/**
 * 网关请求日志：把每次推理请求落成一条可翻阅的记录。
 *
 * 与 `stats` 的区别：`stats` 是聚合数字（按天、按模型累加），这里保留**逐条
 * 原始记录**，用来回答「刚才那次为什么慢 / 为什么失败 / 用了多少 token」。
 *
 * 存储契约：
 * - 元数据与正文**分文件**：`request-log.jsonl` 一行一条元数据（模型、时间、
 *   耗时、token、成败、错误码），列表接口只读它，载荷恒小；`request-log-detail.jsonl`
 *   一行一条正文（`{id, at, input, output}`，2026-11-20 起按用户要求记录请求
 *   输入与回答输出的正文文本），只有点开详情时才按 id 取这一行。
 * - 追加写；一行一条，格式稳定，坏行只跳过不影响其余。
 * - 环形保留：超过 `maxEntries` 时从最老的开始裁掉（默认 2000 条），另有
 *   **3 天滚动清理**（服务启动时 + 每次写入时检查，元数据与正文两个文件同策略）。
 * - 除正文文件按上述约定外，其余记录**只有**元数据：不记录请求头或任何凭据。
 *   正文只落本机盘（数据目录）、只保留 3 天，`id` 是随机标识不含敏感信息。
 *
 * 失败策略：写不进去（磁盘满、权限、只读盘）不影响推理本身 —— 日志是观测，
 * 不是业务。调用方拿到 `false` 后照常继续。
 */
import fs from 'node:fs'
import path from 'node:path'

export const REQUEST_LOG_FILE = 'request-log.jsonl'
export const REQUEST_LOG_DETAIL_FILE = 'request-log-detail.jsonl'
const DEFAULT_MAX = 2000
/** 正文滚动保留期：3 天（用户 2026-11-20 需求）。 */
const RETAIN_MS = 3 * 24 * 60 * 60 * 1000
/** 每侧正文（输入/输出）的截断上限：512KB，防极端超长（如 base64 图）撑爆文件。 */
export const DETAIL_TEXT_LIMIT = 512 * 1024
/** 关联正文的行 id 白名单：`时间戳-随机串`，顺带挡住路径注入类构造。 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/

/** 敏感字段一律不落盘；这里用白名单而不是黑名单，避免以后新增字段被误记。 */
const FIELDS = [
  'id', 'at', 'model', 'effort', 'ok', 'status', 'errorCode', 'error',
  'input', 'output', 'reasoning', 'cacheRead',
  'ttftMs', 'elapsedMs', 'decodeMs', 'attempt', 'recoveryAttempt', 'origin',
]

const numberOrNull = value => Number.isFinite(value) ? Math.round(value) : null

/** 正文按字节截断，尾部加截断标记；截半个多字节字符产生的 U+FFFD 一并去掉。 */
export function clipDetailText(value, limit = DETAIL_TEXT_LIMIT) {
  if (typeof value !== 'string') return ''
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= limit) return value
  return buffer.subarray(0, limit).toString('utf8').replace(/\uFFFD+$/, '') + '…[截断]'
}

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
  // id 只在合法形态时透传：它是正文行的关联键，旧版本写入的行没有 id（前端
  // 对无 id 行提示「早于内容记录功能上线」）。
  if (typeof record.id === 'string' && ID_PATTERN.test(record.id)) row.id = record.id
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

export function createRequestLog({ dataDir, maxEntries = DEFAULT_MAX, logger = console, now = Date.now } = {}) {
  const file = path.join(dataDir, REQUEST_LOG_FILE)
  const detailFile = path.join(dataDir, REQUEST_LOG_DETAIL_FILE)
  let rows = []
  let loaded = false
  let disabled = false
  // 正文文件的轻量游标：首行 at + 行数。只在启动时扫一次，之后随写入递增；
  // 首行过期或行数超上限才触发全量重写（compaction），平时 append 零重写。
  let detailLoaded = false
  let detailFirstAt = null
  let detailCount = 0

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
      const kept = parsed.filter(row => Number.isFinite(row.at) ? row.at >= now() - RETAIN_MS : true).slice(-maxEntries)
      rows = kept
      // 启动即清理 3 天前的旧行（用户 2026-11-20 需求）：内存已裁，文件随之重写一次。
      if (kept.length !== parsed.length) persist()
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

  /** 流式统计正文文件：总行数 + 首行解析出的 at，不做整文件 JSON.parse。 */
  const scanDetail = () => {
    const handle = fs.openSync(detailFile, 'r')
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024)
      let count = 0
      let firstChunks = []
      let firstComplete = false
      let read
      while ((read = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
        const view = buffer.subarray(0, read)
        for (let offset = view.indexOf(10); offset >= 0; offset = view.indexOf(10, offset + 1)) count++
        if (!firstComplete) {
          const firstNewline = view.indexOf(10)
          if (firstNewline >= 0) { firstChunks.push(view.subarray(0, firstNewline)); firstComplete = true }
          else firstChunks.push(Buffer.from(view))
        }
      }
      const firstLine = firstChunks.length ? Buffer.concat(firstChunks).toString('utf8') : ''
      let firstAt = null
      if (firstLine.trim() !== '') {
        try {
          const row = JSON.parse(firstLine)
          if (Number.isFinite(row?.at)) firstAt = Math.round(row.at)
        } catch { /* 首行坏了按无时间处理，交给 compaction 重建 */ }
      }
      return { count, firstAt }
    } finally {
      fs.closeSync(handle)
    }
  }

  /** 全量重写正文文件：丢弃 3 天前与超上限的头部行（追加序 = 时间序）。 */
  const compactDetail = () => {
    try {
      if (!fs.existsSync(detailFile)) { detailCount = 0; detailFirstAt = null; return }
      const cutoff = now() - RETAIN_MS
      const kept = []
      for (const line of fs.readFileSync(detailFile, 'utf8').split('\n')) {
        if (line.trim() === '') continue
        try {
          const row = JSON.parse(line)
          if (row && typeof row === 'object' && Number.isFinite(row.at) && row.at >= cutoff) kept.push(row)
        } catch { /* 坏行借机清除 */ }
      }
      const fresh = kept.slice(-maxEntries)
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      const temp = `${detailFile}.${process.pid}.tmp`
      fs.writeFileSync(temp, fresh.map(row => JSON.stringify(row)).join('\n') + (fresh.length ? '\n' : ''), { mode: 0o600 })
      fs.renameSync(temp, detailFile)
      detailCount = fresh.length
      detailFirstAt = fresh.length > 0 ? fresh[0].at : null
    } catch (error) {
      logger.warn?.(`请求正文日志整理失败：${error.message}`)
    }
  }

  const loadDetail = () => {
    if (detailLoaded) return
    detailLoaded = true
    try {
      if (!fs.existsSync(detailFile)) return
      const stats = scanDetail()
      detailCount = stats.count
      detailFirstAt = stats.firstAt
      // 服务启动时的 3 天清理 + 行数上限兜底（用户 2026-11-20 需求）。
      if (detailCount > maxEntries || (detailFirstAt !== null && detailFirstAt < now() - RETAIN_MS)) compactDetail()
    } catch (error) {
      logger.warn?.(`请求正文日志读取失败：${error.message}`)
    }
  }

  /** 元数据行落盘后追加正文行；廉价检查通过才触发全量重写，平时零重写。 */
  const appendDetail = (record, row) => {
    if (row.id === undefined) return false
    try {
      loadDetail()
      const line = JSON.stringify({
        id: row.id, at: row.at,
        input: clipDetailText(record.inputText),
        output: clipDetailText(record.outputText),
      })
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      fs.appendFileSync(detailFile, `${line}\n`, { mode: 0o600 })
      detailCount += 1
      if (detailFirstAt === null) detailFirstAt = row.at
      if (detailCount > maxEntries || detailFirstAt < now() - RETAIN_MS) compactDetail()
      return true
    } catch (error) {
      logger.warn?.(`请求正文日志写入失败：${error.message}`)
      return false
    }
  }

  return {
    file,
    detailFile,
    /** 追加一条；返回是否真的写进去了。 */
    append(record) {
      if (disabled) return false
      const row = toLogRow(record)
      if (!row) return false
      load()
      rows.push(row)
      if (rows.length > maxEntries) rows = rows.slice(-maxEntries)
      // 3 天滚动：元数据行同样在每次写入时丢弃过期头部（内存时间序，filter 即去头）。
      const cutoff = now() - RETAIN_MS
      if (rows.length > 0 && rows[0].at < cutoff) rows = rows.filter(row => Number.isFinite(row.at) ? row.at >= cutoff : true)
      const persisted = persist()
      appendDetail(record, row)
      return persisted
    },
    /** 最近的记录，新的在前。 */
    list({ limit = 100 } = {}) {
      load()
      const safe = Math.max(1, Math.min(Number(limit) || 100, maxEntries))
      const newestFirst = [...rows].reverse()
      return { total: rows.length, entries: newestFirst.slice(0, safe) }
    },
    /** 按 id 取一条正文；无此 id（含已被 3 天清理）返回 null。 */
    detail(id) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null
      loadDetail()
      try {
        if (!fs.existsSync(detailFile)) return null
        const lines = fs.readFileSync(detailFile, 'utf8').split('\n')
        for (let index = lines.length - 1; index >= 0; index--) {
          const line = lines[index].trim()
          if (line === '') continue
          try {
            const row = JSON.parse(line)
            if (row?.id === id) {
              return {
                id: row.id,
                at: Number.isFinite(row.at) ? Math.round(row.at) : 0,
                input: typeof row.input === 'string' ? row.input : '',
                output: typeof row.output === 'string' ? row.output : '',
              }
            }
          } catch { /* 坏行跳过 */ }
        }
      } catch (error) {
        logger.warn?.(`请求正文日志读取失败：${error.message}`)
      }
      return null
    },
    clear() {
      load()
      rows = []
      detailLoaded = true
      detailCount = 0
      detailFirstAt = null
      try { if (fs.existsSync(file)) fs.unlinkSync(file) } catch (error) { logger.warn?.(`请求日志清理失败：${error.message}`); return false }
      try { if (fs.existsSync(detailFile)) fs.unlinkSync(detailFile) } catch (error) { logger.warn?.(`请求正文日志清理失败：${error.message}`); return false }
      return true
    },
  }
}
