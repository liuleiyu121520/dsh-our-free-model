/**
 * 受控实验：buddy（国内版 copilot.tencent.com）直连请求为什么被
 * `11128 Illegal API invocation from an unapproved channel` 拦下。
 *
 * 依据本机账本：10-21/10-24/10-25 同一 UA、同一头族在 direct 路径成功过，
 * 11-01 全部 400；同日 gateway 路径（短 system）成功。故对"现状请求"做
 * 单变量切换，逐组找出腾讯国内端点此刻真正校验的那一项。
 *
 * 只发 max_tokens=1 的最小请求；被拦（HTTP 400）的请求不进业务层、不耗积分。
 * 凭据仅在本机进程内使用，任何 token 不写入输出。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const credFile = path.join(home, '.credentials.yaml')

// 解析 YAML 里 `REF: '{"json":...}'` 的单引号折行标量（值内不含单引号，实测）。
function readCredential(ref) {
  const raw = fs.readFileSync(credFile, 'utf8')
  const start = raw.indexOf(`  ${ref}: '`)
  if (start < 0) throw new Error(`credential ref ${ref} not found`)
  const bodyStart = raw.indexOf(`'`, start) + 1
  // 单引号标量到下一个行首单引号结束（YAML 折叠多行）。
  const m = raw.slice(bodyStart).match(/^([\s\S]*?)'\n(?=  \S|\S)/)
  if (!m) throw new Error('credential scalar not terminated')
  return JSON.parse(m[1].replace(/\n    /g, ' ').trim())
}

// 同上：不预设账号。
const REF = process.env.OFM_PROBE_REF
if (!REF) throw new Error('请设置 OFM_PROBE_REF=<你机器上的 BUDDY_ACCOUNT_XXXX>')
const credential = readCredential(REF)
const token = credential.access_token
if (!token || token.length < 40) throw new Error('unexpected credential shape')
const exp = Number(credential.expires_at)
const daysLeft = ((Number.isFinite(exp) ? exp : 0) - Date.now()) / 86400000
console.log(`credential ${REF}: domain=${credential.domain} token=*** (${daysLeft.toFixed(0)}d)`)

const MODEL = process.env.OFM_PROBE_MODEL ?? 'deepseek-v4.1-flash'
const ENDPOINT = 'https://copilot.tencent.com/v2/chat/completions'

function baseBody(systemText) {
  return {
    model: MODEL,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: 'hi' },
    ],
    stream: true,
    prompt_cache_key: randomUUID().replace(/-/g, ''),
    max_tokens: 1,
  }
}

function baseHeaders() {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    'X-Domain': 'copilot.tencent.com',
    'X-Product-Code': 'codebuddy',
    'X-Agent-Purpose': 'conversation',
    'X-IDE-Name': 'CodeBuddy',
    'X-IDE-Type': 'CodeBuddy',
    'X-IDE-Version': '1.106.1',
    'X-Product': 'CodeBuddy',
    'User-Agent': 'CodeBuddyIDE/1.106.1',
  }
}

async function attempt(label, headers, body) {
  let res
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error' })
  } catch (error) {
    console.log(`${label.padEnd(34)} TRANSPORT ${String(error).slice(0, 80)}`)
    return null
  }
  const text = await res.text().catch(() => '')
  const code = /"code"\s*:\s*(\d+)/.exec(text)?.[1] ?? ''
  const brief = code ? `code ${code}` : (res.ok ? 'ok' : text.slice(0, 90).replace(/\s+/g, ' '))
  console.log(`${label.padEnd(34)} HTTP ${res.status}  ${brief}`)
  return { status: res.status, code, body: text }
}

// 中性 system（无已知内容指纹），隔离"渠道校验"与"内容风控"两个变量。
const NEUTRAL = 'You are a helpful assistant.'
// DSH 直连真实 system 的前 400 字符（真实失败现场的内容变量）。
const realSystem = fs.existsSync('/tmp/buddy_system.txt')
  ? fs.readFileSync('/tmp/buddy_system.txt', 'utf8').slice(0, 400)
  : null

const sessionId = randomUUID().replace(/-/g, '')
function withConversation(h) {
  return { ...h,
    'X-Conversation-ID': sessionId,
    'X-Conversation-Message-ID': randomUUID(),
    'X-Conversation-Request-ID': randomUUID() }
}

console.log('\n===== 单变量矩阵 =====')
// A：现状复现（中性短 system）
await attempt('A 现状(短system)', baseHeaders(), baseBody(NEUTRAL))
// B：现状 + workbuddy 同款会话头族
await attempt('B 会话头族', withConversation(baseHeaders()), baseBody(NEUTRAL))
// C：真实长 system（DSH 前 400 字符），其余同现状
if (realSystem) await attempt('C 长system', baseHeaders(), baseBody(realSystem))
// D：真实长 system + 会话头族
if (realSystem) await attempt('D 长system+会话头', withConversation(baseHeaders()), baseBody(realSystem))
console.log('\n(DSH system length used:', realSystem ? realSystem.length : 'n/a', ')')
