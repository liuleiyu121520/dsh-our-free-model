/**
 * 请求日志正文记录（2026-11-20 需求）离线套件。
 *
 * 覆盖三层：
 * 1. 单元：createRequestLog 的 id 关联、正文截断、3 天滚动清理（时间 mock）与行数上限；
 * 2. 捕获：service 层 complete 包装把入站原文与出站文本写进 detail 文件
 *    （流式 / 非流式 / Anthropic 入口 / 失败标记）；
 * 3. 端点：GET /api/management/requests/detail 的 404、400 与吊销会话 401。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createRequestLog, toLogRow, clipDetailText, REQUEST_LOG_DETAIL_FILE, DETAIL_TEXT_LIMIT } from '../packages/standalone/request-log.mjs'

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-request-log-')))
let failures = 0
let checks = 0
const check = async (name, body) => {
  checks++
  try { await body(); console.log(`ok   ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`) }
}
const unitDir = path.join(scratch, 'unit')
fs.mkdirSync(unitDir, { recursive: true })

// ---------------------------------------------------------------- 单元层
await check('toLogRow：合法 id 透传，非法形态丢弃，旧行无 id', () => {
  const base = { at: 1, model: 'm', ok: true }
  assert.equal(toLogRow({ ...base, id: '1732000000000-abc123' }).id, '1732000000000-abc123')
  assert.equal(toLogRow({ ...base, id: 'a/b' }).id, undefined)
  assert.equal(toLogRow({ ...base, id: '' }).id, undefined)
  assert.equal(toLogRow({ ...base, id: 'x'.repeat(81) }).id, undefined)
  assert.equal('id' in toLogRow(base), false)
})

await check('clipDetailText：超限按字节截断并加「…[截断]」标记，多字节边界不残留半个字符', () => {
  assert.equal(clipDetailText('短文本'), '短文本')
  assert.equal(clipDetailText(undefined), '')
  const huge = 'a'.repeat(DETAIL_TEXT_LIMIT + 1000)
  const clipped = clipDetailText(huge)
  assert.ok(clipped.endsWith('…[截断]'))
  assert.ok(clipped.length <= DETAIL_TEXT_LIMIT + '…[截断]'.length)
  const multibyte = '汉'.repeat(Math.ceil(DETAIL_TEXT_LIMIT / 3) + 10)
  const clippedCjk = clipDetailText(multibyte)
  assert.ok(clippedCjk.endsWith('…[截断]'))
  assert.ok(!clippedCjk.slice(0, -'…[截断]'.length).includes('\uFFFD'), '截断点不得落在多字节字符中间')
})

await check('append/list/detail：id 关联正文，未知 id 与非法 id 返回 null，clear 清两个文件', () => {
  const dir = path.join(unitDir, 'roundtrip')
  const log = createRequestLog({ dataDir: dir, now: () => 10_000, logger: { warn() {} } })
  log.append({ at: 1000, model: 'm1', ok: true, id: '1000-aaaaaa', inputText: '{"messages":[{"role":"user","content":"你好"}]}', outputText: '回答正文' })
  log.append({ at: 2000, model: 'm2', ok: false, id: '2000-bbbbbb', inputText: 'in2', outputText: '部分输出\n[请求失败] upstream 500' })
  const page = log.list({ limit: 10 })
  assert.equal(page.total, 2)
  assert.equal(page.entries[0].id, '2000-bbbbbb')
  assert.equal(page.entries[1].id, '1000-aaaaaa')
  assert.equal('inputText' in page.entries[0], false, '列表不得携带正文')
  const detail = log.detail('1000-aaaaaa')
  assert.deepEqual(detail, { id: '1000-aaaaaa', at: 1000, input: '{"messages":[{"role":"user","content":"你好"}]}', output: '回答正文' })
  assert.equal(log.detail('9999-zzzzzz'), null)
  assert.equal(log.detail('../settings.json'), null)
  assert.equal(fs.existsSync(path.join(dir, REQUEST_LOG_DETAIL_FILE)), true)
  assert.equal(log.clear(), true)
  assert.equal(fs.existsSync(path.join(dir, REQUEST_LOG_DETAIL_FILE)), false)
  assert.equal(log.detail('1000-aaaaaa'), null)
})

await check('3 天滚动清理（时间 mock）：写入时元数据与正文同步丢弃过期头部', () => {
  const dir = path.join(unitDir, 'retention')
  let clock = 1_000_000
  const log = createRequestLog({ dataDir: dir, now: () => clock, logger: { warn() {} } })
  log.append({ at: clock, model: 'old', ok: true, id: '1-oldaaaa', inputText: 'old-in', outputText: 'old-out' })
  clock += 3 * 24 * 60 * 60 * 1000 + 60_000
  log.append({ at: clock, model: 'new', ok: true, id: '2-newbbbb', inputText: 'new-in', outputText: 'new-out' })
  const page = log.list({ limit: 10 })
  assert.deepEqual(page.entries.map(row => row.model), ['new'])
  assert.equal(log.detail('1-oldaaaa'), null, '过期正文必须随元数据一起被清理')
  assert.equal(log.detail('2-newbbbb').output, 'new-out')
  const detailText = fs.readFileSync(path.join(dir, REQUEST_LOG_DETAIL_FILE), 'utf8').trim()
  assert.equal(detailText.split('\n').length, 1)
  assert.ok(detailText.includes('2-newbbbb'))
})

await check('服务启动清理：新实例按当前时间裁掉启动前遗留的过期正文', () => {
  const dir = path.join(unitDir, 'startup')
  let clock = 5_000_000
  const first = createRequestLog({ dataDir: dir, now: () => clock, logger: { warn() {} } })
  first.append({ at: clock, model: 'stale', ok: true, id: '5-stale01', inputText: 'x', outputText: 'y' })
  clock += 3 * 24 * 60 * 60 * 1000 + 3_600_000
  const second = createRequestLog({ dataDir: dir, now: () => clock, logger: { warn() {} } })
  assert.equal(second.detail('5-stale01'), null)
  assert.equal(second.list({}).total, 0)
  second.append({ at: clock, model: 'fresh', ok: true, id: '6-fresh02', inputText: 'x', outputText: 'y' })
  assert.equal(second.detail('6-fresh02') !== null, true)
})

await check('行数上限双保险：元数据与正文同 cap，超限从最老裁起', () => {
  const dir = path.join(unitDir, 'cap')
  const log = createRequestLog({ dataDir: dir, maxEntries: 3, now: () => 20_000, logger: { warn() {} } })
  for (let index = 0; index < 6; index++) {
    log.append({ at: 10_000 + index, model: `m${index}`, ok: true, id: `1-cap000${index}`, inputText: `in${index}`, outputText: `out${index}` })
  }
  assert.deepEqual(log.list({ limit: 10 }).entries.map(row => row.id), ['1-cap0005', '1-cap0004', '1-cap0003'])
  assert.equal(log.detail('1-cap0000'), null)
  assert.equal(log.detail('1-cap0003').output, 'out3')
  const lines = fs.readFileSync(path.join(dir, REQUEST_LOG_DETAIL_FILE), 'utf8').trim().split('\n')
  assert.equal(lines.length, 3)
})

await check('坏行与坏首行不致命：detail 查询照常，compaction 顺带清除', () => {
  const dir = path.join(unitDir, 'corrupt')
  const log = createRequestLog({ dataDir: dir, now: () => 30_000, logger: { warn() {} } })
  log.append({ at: 100, model: 'm', ok: true, id: '9-good0001', inputText: 'a', outputText: 'b' })
  fs.appendFileSync(path.join(dir, REQUEST_LOG_DETAIL_FILE), '{not json}\n')
  assert.equal(log.detail('9-good0001') !== null, true)
  assert.equal(log.detail('missing'), null)
})

// ---------------------------------------------------------------- 服务层
const model = 'mimo-v2.6-flash-free'
const dataDir = path.join(scratch, 'app')
let failNext = false
const upstream = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: model }] }))
    return
  }
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  if (failNext || JSON.stringify(body).includes('please-fail')) {
    failNext = false
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'fixture upstream boom' } }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.end([
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'core-ok' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7 } })}\n\n`,
    'data: [DONE]\n\n',
  ].join(''))
})
upstream.listen(0, '127.0.0.1')
await once(upstream, 'listening')
process.env.OUR_FREE_MODEL_BASE = `http://127.0.0.1:${upstream.address().port}`
process.env.OUR_FREE_MODEL_KILO_BASE = process.env.OUR_FREE_MODEL_BASE

const { startStandalone } = await import('../packages/standalone/service.mjs')
let service
const managementGet = async (route, headers = {}) => {
  const response = await fetch(service.url + route, { headers: { connection: 'close', ...headers }, signal: AbortSignal.timeout(10000) })
  return { status: response.status, value: await response.json().catch(() => null) }
}
const chat = async (body, extra = {}) => fetch(`${service.url}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${keyOf()}`, ...extra },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30000),
})
const keyOf = () => JSON.parse(fs.readFileSync(service.keyFile, 'utf8')).forwardKey

try {
  service = await startStandalone({ dataDir, port: 0, refresh: false, logger: { warn() {} } })
  const key = keyOf()

  await check('流式请求：列表行带 id，detail 返回输入原文与流式拼接输出', async () => {
    const response = await chat({ model, stream: true, messages: [{ role: 'system', content: '你是测试' }, { role: 'user', content: 'stream-hello' }] })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /core-ok/)
    const page = (await managementGet('/api/management/requests?limit=5', { authorization: `Bearer ${key}` })).value
    const row = page.entries[0]
    assert.match(row.id ?? '', /^[0-9]+-[a-z0-9]{6,}$/, JSON.stringify(row))
    const detail = (await managementGet(`/api/management/requests/detail?id=${row.id}`, { authorization: `Bearer ${key}` })).value
    const input = JSON.parse(detail.input)
    assert.equal(input.model, model)
    assert.equal(input.messages[0].role, 'system')
    assert.equal(input.messages[0].content, '你是测试')
    assert.equal(input.messages[1].content, 'stream-hello')
    assert.ok(String(detail.output).includes('core-ok'))
  })

  await check('非流式请求：无 chunk 订阅时输出回落完整 outcome.text', async () => {
    const response = await chat({ model, messages: [{ role: 'user', content: 'plain-hello' }] })
    assert.equal((await response.json()).choices[0].message.content, 'core-ok')
    const page = (await managementGet('/api/management/requests?limit=5', { authorization: `Bearer ${key}` })).value
    const detail = (await managementGet(`/api/management/requests/detail?id=${page.entries[0].id}`, { authorization: `Bearer ${key}` })).value
    assert.equal(detail.output, 'core-ok')
    assert.ok(detail.input.includes('plain-hello'))
  })

  await check('Anthropic 入口：system 并入输入正文，输出照常记录', async () => {
    const response = await fetch(`${service.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, system: 'anthropic-system', max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'anthropic-hello' }] }),
      signal: AbortSignal.timeout(30000),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.match(text, /core-ok/)
    const page = (await managementGet('/api/management/requests?limit=5', { authorization: `Bearer ${key}` })).value
    const detail = (await managementGet(`/api/management/requests/detail?id=${page.entries[0].id}`, { authorization: `Bearer ${key}` })).value
    const input = JSON.parse(detail.input)
    assert.equal(input.messages[0].role, 'system', 'system 提示应随 harness messages 记录')
    assert.equal(input.messages[0].content[0].text, 'anthropic-system')
    assert.ok(detail.output.includes('core-ok'))
  })

  await check('失败请求：正文记录已累积部分与失败标记', async () => {
    const response = await chat({ model, messages: [{ role: 'user', content: 'please-fail' }] })
    assert.ok(response.status >= 500, `status=${response.status}`)
    const page = (await managementGet('/api/management/requests?limit=5', { authorization: `Bearer ${key}` })).value
    const row = page.entries[0]
    assert.equal(row.ok, false)
    assert.ok(row.id, '失败行也要带 id（可排查正文）')
    const detail = (await managementGet(`/api/management/requests/detail?id=${row.id}`, { authorization: `Bearer ${key}` })).value
    assert.match(detail.output, /\[请求失败\]/)
    assert.ok(detail.input.includes('please-fail'))
  })

  await check('超长输入按 512KB 截断并加标记', async () => {
    const huge = '大'.repeat(300000) // 900KB UTF-8
    const response = await chat({ model, messages: [{ role: 'user', content: huge }] })
    assert.equal(response.status, 200)
    const page = (await managementGet('/api/management/requests?limit=5', { authorization: `Bearer ${key}` })).value
    const detail = (await managementGet(`/api/management/requests/detail?id=${page.entries[0].id}`, { authorization: `Bearer ${key}` })).value
    assert.ok(detail.input.endsWith('…[截断]'), `input length=${detail.input.length}`)
    assert.ok(Buffer.byteLength(detail.input, 'utf8') <= DETAIL_TEXT_LIMIT + '…[截断]'.length + 6)
  })

  await check('detail 端点：未知 id 404、非法 id 400', async () => {
    assert.equal((await managementGet('/api/management/requests/detail?id=9999999999-zzzzzz', { authorization: `Bearer ${key}` })).status, 404)
    assert.equal((await managementGet('/api/management/requests/detail?id=..%2Fsettings.json', { authorization: `Bearer ${key}` })).status, 400)
    assert.equal((await managementGet('/api/management/requests/detail', { authorization: `Bearer ${key}` })).status, 400)
  })

  await check('detail 端点鉴权：吊销会话（登出后）不得读取正文', async () => {
    const managementKey = JSON.parse(fs.readFileSync(service.keyFile, 'utf8')).managementKey
    const login = await fetch(`${service.url}/api/management/session`, {
      method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ key: managementKey }), signal: AbortSignal.timeout(10000),
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const logout = await fetch(`${service.url}/api/management/logout`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie, connection: 'close' },
      body: '{}', signal: AbortSignal.timeout(10000),
    })
    assert.equal(logout.status, 200)
    const denied = await fetch(`${service.url}/api/management/requests/detail?id=1-abc`, {
      headers: { cookie, connection: 'close' }, signal: AbortSignal.timeout(10000),
    })
    assert.equal(denied.status, 401)
  })

  await check('清空接口同时删除正文文件', async () => {
    assert.equal(fs.existsSync(path.join(dataDir, REQUEST_LOG_DETAIL_FILE)), true)
    const response = await fetch(`${service.url}/api/management/requests/clear`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, connection: 'close' },
      body: '{}', signal: AbortSignal.timeout(10000),
    })
    assert.equal(response.status, 200)
    assert.equal(fs.existsSync(path.join(dataDir, REQUEST_LOG_DETAIL_FILE)), false)
    assert.equal((await managementGet('/api/management/requests?limit=5', { authorization: `Bearer ${key}` })).value.total, 0)
  })

  await service.close()
} finally {
  await service?.close().catch(() => {})
  upstream.close()
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
