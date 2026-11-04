/**
 * 首次启动时探测「DSH 插件那边」已有的账号渠道，供网页一键导入。
 *
 * 只做两件事：**读** DSH 数据目录，把结果组装成独立端现成的 `backup.import`
 * 载荷。它不写 DSH 目录、不改插件数据、不联网。
 *
 * 为什么需要它：独立服务用自己的数据目录，默认不读取 DSH 的凭据。用户装了
 * 插件、又想要脱离 DSH 用同一批账号时，只能手工导出再导入。这里把那次手工
 * 操作变成一次确认弹窗。
 *
 * 数据来源（都是插件侧的本地文件）：
 *   <dshHome>/channel-pack/state.json   账号索引 + 模型黑名单
 *   <dshHome>/.credentials.yaml         账号凭据（明文 JSON 字符串，按 ref 索引）
 *
 * 安全边界：
 * - 只返回「有多少个账号、来自哪个渠道」这类可展示的统计；凭据原文只在内存里
 *   组装成载荷，不写日志、不落盘、不进错误信息。
 * - 任何一条读不出来都只跳过该条并计入 `skipped`，不让整个探测失败。
 * - 探测结果不缓存：每次调用都重新读，避免用户改完插件账号后看到旧数字。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 与独立端 `BACKUP_FORMAT` / `BACKUP_VERSION` 一致，否则导入会被拒。 */
const BACKUP_FORMAT = 'channel-pack/backup'
const BACKUP_VERSION = 1

/** DSH 的主数据目录：优先显式环境变量，其次 ~/.dsh。 */
export function resolveDshHome(env = process.env, home = os.homedir()) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return configured === '' ? path.join(home, '.dsh') : path.resolve(configured)
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8')
  const value = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
  return value
}

/**
 * 解析 `.credentials.yaml` 的 `refs` 段。
 *
 * 这份文件由 DSH 自己写，格式固定为 `refs:` 下面若干 `  <REF>: <JSON 字符串>`。
 * 不是通用 YAML 解析器：只认这一种形态，遇到别的结构就当读不出来。
 *
 * 值有两种形态，必须都认：
 * 1. 单行、首尾单引号包裹（多数账号）；
 * 2. **多行折叠**：值以单个 `'` 开头，内容里的换行在 YAML 侧被写成缩进续行
 *    （例如 Gemini 的 scopes 数组逐行展开）。少了续行处理会静默丢掉这些账号，
 *    所以这里按「缩进的非键行 = 上一值的续行」拼接，再按 YAML 折叠规则把
 *    「换行 + 缩进」还原成一个空格。
 */
export function parseCredentialRefs(raw) {
  const refs = {}
  let inRefs = false
  let current = null
  const commit = () => {
    if (!current) return
    const { name, parts } = current
    current = null
    let value = parts.join(' ').trim()
    if (value === '' || value === '~' || value === 'null') return
    // 去掉 YAML 单引号包裹（单引号内的 '' 表示一个字面单引号）。
    if (value.startsWith("'")) {
      if (value.endsWith("'") && value.length > 1) value = value.slice(1, -1)
      else value = value.slice(1)
      value = value.replaceAll("''", "'")
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    try { refs[name] = JSON.parse(value) } catch { /* 非 JSON 的 ref 不是账号凭据，跳过 */ }
  }
  for (const line of String(raw).split('\n')) {
    if (/^refs:\s*$/.test(line)) { inRefs = true; continue }
    // 顶层非缩进键结束 refs 段。
    if (inRefs && /^\S/.test(line)) { inRefs = false }
    if (!inRefs) continue
    const key = /^  ([A-Za-z0-9_.:@/-]{1,200}):\s?(.*)$/.exec(line)
    if (key) {
      commit()
      current = { name: key[1], parts: [key[2]] }
      continue
    }
    // 缩进的续行：属于上一个值。
    if (current && /^\s{2,}\S/.test(line)) current.parts.push(line.trim())
  }
  commit()
  return refs
}

/**
 * 探测 DSH 侧可导入的账号渠道。
 *
 * @returns {{available:boolean, reason?:string, accounts:number, providers:object,
 *   expired:number, payload?:object}}
 *   `available:false` 时只给 `reason`（不含路径、不含凭据），用于「没装 DSH」的
 *   正常情形 —— 这不是错误，界面据此不弹窗。
 */
export function detectDshChannels({ dshHome = resolveDshHome(), now = Date.now() } = {}) {
  const stateFile = path.join(dshHome, 'channel-pack', 'state.json')
  const credentialsFile = path.join(dshHome, '.credentials.yaml')
  if (!fs.existsSync(stateFile) && !fs.existsSync(credentialsFile)) {
    return { available: false, reason: 'missing', accounts: 0, providers: {}, expired: 0 }
  }
  let state
  try { state = readJson(stateFile) } catch {
    return { available: false, reason: 'unreadable', accounts: 0, providers: {}, expired: 0 }
  }
  const accounts = Array.isArray(state.accounts) ? state.accounts : []
  if (accounts.length === 0) {
    return { available: false, reason: 'empty', accounts: 0, providers: {}, expired: 0 }
  }
  let refs = {}
  try { refs = parseCredentialRefs(fs.readFileSync(credentialsFile, 'utf8')) } catch { /* 凭据读不到就只报索引 */ }

  const credentials = {}
  const skipped = []
  const providers = {}
  let expired = 0
  const usable = []
  for (const entry of accounts) {
    if (!entry || typeof entry !== 'object') { skipped.push('invalid'); continue }
    const ref = typeof entry.credentialRef === 'string' ? entry.credentialRef : ''
    const provider = typeof entry.provider === 'string' ? entry.provider : ''
    if (ref === '' || provider === '') { skipped.push('invalid'); continue }
    const value = refs[ref]
    if (value === undefined) { skipped.push(`${entry.id ?? provider}: 凭据缺失`); continue }
    if (typeof entry.expiresAt === 'number' && entry.expiresAt < now) expired++
    credentials[ref] = typeof value === 'string' ? value : JSON.stringify(value)
    providers[provider] = (providers[provider] ?? 0) + 1
    usable.push(entry)
  }
  if (usable.length === 0) {
    return { available: false, reason: 'no-credentials', accounts: accounts.length, providers, expired: 0 }
  }
  return {
    available: true,
    accounts: usable.length,
    expired,
    providers,
    skipped: skipped.length,
    payload: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date(now).toISOString(),
      credentials,
      accounts: usable,
      disabledModels: state.disabledModels ?? {},
      loomyPermanentLocked: state.loomyPermanentLocked ?? {},
    },
  }
}
