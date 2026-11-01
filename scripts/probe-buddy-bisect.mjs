/**
 * 二分定位：DSH 系统提示词的哪一段触发腾讯国内端点 11128。
 * 以「空行分隔的段落」为单位，请求 max_tokens=1；被拦请求不进业务层不耗额度。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const raw = fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8')
// 凭据 ref 必须显式给出，脚本不预设任何账号（机器特定，且避免误刷他人凭据）。
const ref = process.env.OFM_PROBE_REF
if (!ref) throw new Error('请设置 OFM_PROBE_REF=<你机器上的 BUDDY_ACCOUNT_XXXX>')
const at = raw.indexOf(`  ${ref}: '`)
if (at < 0) throw new Error('credential ref not found')
const bodyStart = raw.indexOf("'", at) + 1
const m = raw.slice(bodyStart).match(/^([\s\S]*?)'\n(?=  \S|\S)/)
if (!m) throw new Error('credential scalar not terminated')
let credential
try {
  credential = JSON.parse(m[1].replace(/\n    /g, ' ').trim())
} catch {
  // 绝不回显凭据内容本身。
  throw new Error('credential JSON parse failed (content withheld)')
}

const MODEL = 'deepseek-v4.1-flash'
const ENDPOINT = 'https://copilot.tencent.com/v2/chat/completions'
const headers = {
  Authorization: `Bearer ${credential.access_token}`,
  Accept: 'text/event-stream', 'Content-Type': 'application/json',
  'X-Domain': 'copilot.tencent.com', 'X-Product-Code': 'codebuddy',
  'X-Agent-Purpose': 'conversation', 'X-IDE-Name': 'CodeBuddy', 'X-IDE-Type': 'CodeBuddy',
  'X-IDE-Version': '1.106.1', 'X-Product': 'CodeBuddy', 'User-Agent': 'CodeBuddyIDE/1.106.1',
}

const text = fs.readFileSync('/tmp/buddy_system.txt', 'utf8')
const paragraphs = text.split(/\n\n+|\n(?=\n)/).map(p => p.trim()).filter(p => p.length > 0)
console.log(`paragraphs: ${paragraphs.length}, total ${text.length} chars`)

async function blocked(sys) {
  const body = { model: MODEL, messages: [
    { role: 'system', content: sys }, { role: 'user', content: 'hi' }],
    stream: true, prompt_cache_key: randomUUID().replace(/-/g, ''), max_tokens: 1 }
  let res
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(90_000) })
  } catch (error) {
    return `TRANSPORT ${String(error).slice(0, 60)}`
  }
  const t = await res.text().catch(() => '')
  const code = /"code"\s*:\s*(\d+)/.exec(t)?.[1]
  if (res.ok) return false
  if (code === '11128') return true
  if (typeof res === 'string') return true
  throw new Error(`unexpected HTTP ${res.status} code=${code ?? '-'} ${t.slice(0, 120)}`)
}

const join = idxs => idxs.map(i => paragraphs[i]).join('\n\n')
const all = paragraphs.map((_, i) => i)
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function ask(label, sys) {
  await sleep(2500)
  const b = await blocked(sys)
  console.log(`${label.padEnd(46)} ${b ? 'BLOCKED' : 'pass'}`)
  return b === true
}

// 1) 前缀二分：第一个"含它即被拦"的段落
console.log('prefix bisect over paragraphs…')
let lo = 0, hi = all.length - 1
while (lo < hi) {
  const mid = (lo + hi) >> 1
  if (await ask(`prefix[0..${mid}]`, join(all.slice(0, mid + 1)))) hi = mid
  else lo = mid + 1
}
const culprit = paragraphs[lo]
console.log(`\n>>> first blocking paragraph #${lo}:\n${culprit}\n`)

// 2) 段内二分到最小触发句
const sentences = culprit.split(/(?<=.)\n+/).flatMap(s => s.split(/(?<=\.)\s+/)).filter(Boolean)
console.log(`intra-paragraph bisect over ${sentences.length} sentences…`)
let slo = 0, shi = sentences.length - 1
while (slo < shi) {
  const mid = (slo + shi) >> 1
  if (await ask(`sentences[0..${mid}]`, sentences.slice(0, mid + 1).join(' '))) shi = mid
  else slo = mid + 1
}
console.log(`\n>>> minimal blocking sentence: ${JSON.stringify(sentences[slo])}`)

// 3) 验证修复方向：全文删掉该句 → 应放行；单独该句 → 应被拦
const without = text.replace(sentences[slo], ' ').replace(/\s{2,}/g, ' ')
await ask('full text MINUS that sentence', without)
await ask('that sentence alone', sentences[slo])
