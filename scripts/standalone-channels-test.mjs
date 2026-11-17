import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { openSeal } from '../src/vault.js'
import { signSealedRequest, lane } from '../src/eac.js'
import { createStandaloneEac } from '../packages/standalone/eac.mjs'
import { createCredentials } from '../packages/standalone/channels/credentials.mjs'
import { attachments } from '../packages/standalone/channels/images.mjs'
import { createSmartScheduler, isSmartAlias, isQuotaExhaustion } from '../packages/standalone/smart-schedule.mjs'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-channels-'))
const dataDir = path.join(scratch, 'app')
const dshHome = path.join(scratch, 'dsh')
const otherDir = path.join(scratch, 'other')
const warnings = []
const requests = []
let service, other
let checks = 0, failures = 0
let hold
let cancelled = false
let loginReady = true
const check = async (name, body) => {
  checks++
  try { await body(); console.log(`ok   ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`) }
}
const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const frames = (text, tool = false) => {
  const parts = [{ choices: [{ delta: { content: text } }] }]
  if (tool) {
    parts.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name: 'lookup', arguments: '{"q":' } }] } }] })
    parts.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"fixture"}' } }] } }] })
  }
  parts.push({ choices: [{ delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })
  return parts.map(part => `data: ${JSON.stringify(part)}\n\n`).join('') + 'data: [DONE]\n\n'
}
const token = domain => ({
  access_token: `fixture-${domain}`, refresh_token: 'fixture-refresh', domain,
  expires_at: String(Date.now() + 86400000), refresh_expires_at: String(Date.now() + 7 * 86400000),
  user_id: 'fixture-user', nickname: '替身账号', account_type: 'personal',
})
const upstream = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const pathname = new URL(req.url, 'http://localhost').pathname
  const raw = Buffer.concat(chunks).toString()
  const body = raw ? req.headers['content-type']?.includes('application/x-www-form-urlencoded')
    ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw) : {}
  requests.push({ pathname, body, headers: req.headers })
  const signed = typeof req.headers['x-ofm-signature'] === 'string'
  if (signed) {
    const expected = signSealedRequest(openSeal().signingSecret, { method: req.method, path: pathname.replace(/^\/remote/, ''), body: raw }, Number(req.headers['x-ofm-timestamp']))
    if (expected['x-ofm-signature'] !== req.headers['x-ofm-signature']) { json(res, { error: 'bad-signature' }, 401); return }
  }
  if (pathname.endsWith('/auth/status')) {
    json(res, { configured: true, required: true, authorized: req.headers['x-ofm-user'] === 'fixture-eac-user', starred: true, login: 'fixture-github', repo: 'Ebony-Vinyl/dsh-our-free-model' })
  } else if (pathname.endsWith('/auth/github/start')) {
    res.writeHead(302, { location: 'https://github.com/login/oauth/authorize' }); res.end()
  } else if (pathname.endsWith('/auth/poll')) {
    json(res, { status: 'ok', token: 'fixture-eac-user', login: 'fixture-github', avatar: '', ackRequired: true })
  } else if (pathname.endsWith('/auth/logout') || pathname.endsWith('/auth/ack')) {
    json(res, { ok: true })
  } else if (pathname.endsWith('/pool')) {
    json(res, { ok: true, inflight: 3, pool: 100, active24h: 5, poolSource: 'configured' })
  } else if (pathname.endsWith('/user_management/authorize/device')) {
    json(res, { device_code: 'fixture-device', user_code: 'FIXTURE', verification_uri: `${fixture}/login`, verification_uri_complete: `${fixture}/login?code=FIXTURE`, expires_in: 300, interval: 1 })
  } else if (pathname.endsWith('/user_management/authenticate')) {
    assert.equal(body.device_code, 'fixture-device')
    assert.equal(body.grant_type, 'urn:ietf:params:oauth:grant-type:device_code')
    if (!loginReady) { json(res, { error: 'authorization_pending' }, 400); return }
    json(res, { access_token: 'fixture-workos', refresh_token: 'fixture-workos-refresh' })
  } else if (pathname.endsWith('/api/v1/auth/register')) {
    assert.equal(body.accessToken, 'fixture-workos')
    assert.equal(body.refreshToken, 'fixture-workos-refresh')
    json(res, { success: true, data: { accessToken: 'fixture-new', refreshToken: 'fixture-refresh', expiresAt: new Date(Date.now() + 86400000).toISOString(), userInfo: { clineUserId: 'fixture-user', email: 'fixture@example.invalid' } } })
  } else if (pathname.endsWith('/recommended-models')) {
    json(res, { free: [{ id: 'cline-free/mimo-v2.6-flash', name: '本机 Cline 模型' }], recommended: [], clinePass: [] })
  } else if (pathname.endsWith('/api.json')) {
    json(res, {})
  } else if (pathname.endsWith('/points/records')) {
    json(res, { code: '000000', data: { balance: 500, dailyBalance: 0, availableBalance: 500 } })
  } else if (pathname.endsWith('/models')) {
    if (signed) json(res, { data: [{ id: 'fixture-eac-model' }] })
    else if (req.headers['x-ofm-fixture-host'] === 'api.cline.bot') json(res, { data: [{ id: 'cline-free/mimo-v2.6-flash' }] })
    else if (req.headers['x-ofm-fixture-host'] === 'loomyad.xunfei.cn') {
      assert.equal(req.headers.token, 'fixture-loomy')
      json(res, { data: [{ id: 'fixture-free', name: '本机 Loomy 模型', type: 'chat', context_length: 128000, capabilities: { input_modalities: ['text', 'image'], reasoning: true }, reasoning_efforts: ['low', 'high'], default_reasoning_effort: 'high' }] })
    } else json(res, { data: [] })
  } else if (pathname.endsWith('/chat/completions')) {
    if (req.headers['x-ofm-fixture-host'] === 'api.cline.bot') {
      assert.match(req.headers.authorization ?? '', /^Bearer workos:fixture-/)
      assert.equal(body.model, 'cline-free/mimo-v2.6-flash')
    }
    if (req.headers['x-ofm-fixture-host'] === 'loomyad.xunfei.cn') {
      assert.equal(req.headers.authorization, 'Bearer fixture-loomy')
      assert.equal(req.headers.token, 'fixture-loomy')
      assert.equal(body.model, 'fixture-free')
    }
    if (signed && req.headers['x-ofm-user'] !== 'fixture-eac-user') { json(res, { error: { message: 'AuthorizationRequired' } }, 401); return }
    if (JSON.stringify(body.messages).includes('server-fixture')) {
      json(res, { error: { message: '模拟上游 500', type: 'server_error' } }, 500)
      return
    }
    if (JSON.stringify(body.messages).includes('cancel-fixture')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'first' } }] })}\n\n`)
      hold?.()
      res.on('close', () => { cancelled = true })
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(frames(signed ? 'eac-ok' : 'account-ok', Array.isArray(body.tools) && body.tools.length > 0))
  } else json(res, { data: { Response: { Data: { Accounts: [] } } } })
})
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
const fixture = `http://127.0.0.1:${upstream.address().port}`
process.env.OFM_TEST_UPSTREAM = fixture
process.env.OUR_FREE_MODEL_BASE = fixture
process.env.OUR_FREE_MODEL_KILO_BASE = fixture
process.env.DSH_HOME = dshHome
fs.mkdirSync(path.join(dshHome, 'our-free-model'), { recursive: true })
fs.writeFileSync(path.join(dshHome, 'our-free-model', 'eac-user.json'), JSON.stringify({ token: 'dsh-sentinel', login: 'dsh-user' }))
fs.writeFileSync(path.join(dshHome, '.credentials.yaml'), 'SENTINEL_DO_NOT_READ')
const fixtureImport = new URL('./lib/standalone-channel-fixture.mjs', import.meta.url).href
process.execArgv.push('--import', fixtureImport)
await import('./lib/standalone-channel-fixture.mjs')
const { startStandalone } = await import('../packages/standalone/service.mjs')
fs.mkdirSync(path.join(dataDir, 'channel-pack'), { recursive: true })
const unsupportedProviders = ['unsupported-alpha', 'unsupported-beta']
const unsupportedAccounts = unsupportedProviders.map(provider => ({
  id: `${provider}-fixture`, provider, nickname: '历史账号保留', enabled: true, refreshable: false,
  createdAt: Date.now(), expiresAt: Date.now() + 86400000, credentialRef: `${provider.toUpperCase()}_ACCOUNT_FIXTURE`,
}))
const activeAccounts = ['cline', 'loomy'].map(provider => ({
  id: `${provider}-fixture`, provider, nickname: '本机替身账号', enabled: true, refreshable: false,
  createdAt: Date.now(), expiresAt: Date.now() + 86400000, credentialRef: `${provider.toUpperCase()}_ACCOUNT_FIXTURE`,
}))
fs.writeFileSync(path.join(dataDir, 'channel-pack', 'state.json'), JSON.stringify({
  accounts: [...unsupportedAccounts, ...activeAccounts], disabledModels: {},
}))
const unsupportedCredentials = Object.fromEntries(unsupportedAccounts.map(account => [account.credentialRef,
  JSON.stringify(token(account.provider === 'unsupported-alpha' ? 'unsupported.invalid' : 'unsupported-beta.invalid'))]))
const seed = createCredentials(dataDir)
for (const [ref, value] of Object.entries(unsupportedCredentials)) await seed.set(ref, value)
await seed.set('CLINE_ACCOUNT_FIXTURE', JSON.stringify({ access_token: 'workos:fixture-cline', expire_time: Date.now() + 86400000, account_id: 'fixture-user' }))
await seed.set('LOOMY_ACCOUNT_FIXTURE', JSON.stringify({ access_token: 'fixture-loomy', userid: 'fixture-user', phone: '13000000000', expires_at: String(Date.now() + 86400000) }))
seed.dispose()
const assertUnsupportedDataPreserved = () => {
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'channel-pack/state.json'), 'utf8'))
  const credentials = JSON.parse(fs.readFileSync(path.join(dataDir, 'channel-credentials.json'), 'utf8'))
  for (const account of unsupportedAccounts) assert.deepEqual(state.accounts.find(row => row.id === account.id), account)
  for (const [ref, value] of Object.entries(unsupportedCredentials)) assert.equal(credentials[ref], value)
}

let key
const api = async (suffix, body, extra = {}) => {
  const response = await fetch(service.url + suffix, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key}`, ...body === undefined ? {} : { 'content-type': 'application/json' }, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  })
  const value = await response.json()
  return { response, value }
}
const rpc = async (method, payload = {}) => {
  const { response, value } = await api('/api/management/channels/rpc', { method, payload })
  assert.equal(response.status, 200)
  if (!value.ok) throw new Error(value.error.message)
  return value.value
}
try {
  await check('独立业务产物的 Chat / Responses 保留工具调用关联与结果', async () => {
    const { toGenerateOptions, toResponsesGenerateOptions } = await import('../packages/standalone/channels/business.mjs')
    const signal = new AbortController().signal
    const chat = await toGenerateOptions({ model: 'fixture/model', messages: [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-result', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call-result', content: 'fixture-tool-output' },
    ] }, signal)
    const responses = await toResponsesGenerateOptions({ model: 'fixture/model', input: [
      { type: 'function_call', call_id: 'call-result', name: 'lookup', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call-result', output: 'fixture-tool-output' },
    ] }, signal)
    for (const result of [chat, responses]) {
      assert.equal(result.messages[0].content[0].id, 'call-result')
      const answer = result.messages[1]
      assert.equal(answer.role, 'tool')
      assert.equal(answer.toolCallId, 'call-result')
      assert.deepEqual(answer.source, { kind: 'tool', callId: 'call-result' })
      assert.deepEqual(answer.content, [{ type: 'text', text: 'fixture-tool-output' }])
      assert.notEqual(answer.id, result.messages[0].id)
    }
  })
  await check('smart 调度器单元：别名归一、配额判据三形态、流式保护、B 类接力、非配额上抛、快照刷新与 429/400 信封', async () => {
    assert.equal(isSmartAlias('auto'), true)
    assert.equal(isSmartAlias('AUTO'), true)
    assert.equal(isSmartAlias(' ourfreemodel '), true)
    assert.equal(isSmartAlias('ourfreemodel'), true)
    assert.equal(isSmartAlias('auto/x'), false)
    assert.equal(isSmartAlias('claude/auto'), false)
    assert.equal(isSmartAlias(undefined), false)
    // 配额判据：channelCode 等值 + 消息兜底（渠道包三形态：trae 积分 / gemini 账号 / qoder 上游）
    assert.equal(isQuotaExhaustion({ channelCode: 'QUOTA_EXCEEDED', message: 'trae: 积分不足（balance 0）' }), true)
    assert.equal(isQuotaExhaustion({ message: 'gemini: 模型 m 的所有账号均不可用（限流或额度耗尽），请稍后再试' }), true)
    assert.equal(isQuotaExhaustion({ message: '产品：模型 m 所有账号均受限，请稍后再试' }), true)
    assert.equal(isQuotaExhaustion({ message: 'qoder: HTTP 500 upstream exploded' }), false)
    assert.equal(isQuotaExhaustion(new Error('网络超时')), false)

    // 可编程假渠道：记录派发顺序与 rpc 次数；p/a 按 content 剧本失败，p/b 可切换成败
    let bFails = false
    const attempts = []
    const rpcCalls = []
    let rpcRounds = 0
    const fakeSettings = { get: () => ({ smartSchedulePool: { models: ['p/a', 'p/b'] } }) }
    const fakeChannels = {
      providers: ['p'],
      rpc: async body => {
        rpcCalls.push(body.method)
        if (body.method === 'model.list') {
          rpcRounds++
          return { ok: true, value: { models: [
            { id: 'a', name: 'A', disabled: false, dead: false },
            { id: 'b', name: 'B', disabled: false, dead: false },
          ] } }
        }
        return { ok: true, value: { accounts: [{ id: 'u1', enabled: true, modelRateLimits: {} }] } }
      },
      complete: async (request, onChunk) => {
        attempts.push(request.model)
        const content = String(request.openAi?.messages?.[0]?.content ?? '')
        if (request.model === 'p/a') {
          if (content.includes('emit-first')) {
            onChunk?.({ type: 'text-delta', text: 'half' })
            throw Object.assign(new Error('p: 所有账号均受限，请稍后再试'), { channelCode: 'QUOTA_EXCEEDED' })
          }
          if (content.includes('boom')) throw new Error('p: upstream 500')
          throw Object.assign(new Error('trae: 积分不足（balance 0）'), { channelCode: 'QUOTA_EXCEEDED' })
        }
        if (bFails) throw Object.assign(new Error('p: 所有账号均不可用，请稍后再试'), { channelCode: 'QUOTA_EXCEEDED' })
        return { text: 'b-ok', toolCalls: [], usage: { prompt_tokens: 1, completion_tokens: 1, completion_tokens_details: { reasoning_tokens: 0 } } }
      },
    }
    const unit = createSmartScheduler({ settings: fakeSettings, channels: fakeChannels, logger: { warn() {}, info() {} } })
    await unit.refreshSnapshot()

    // 流式保护（AC-9）：已向客户端下发字节后，配额错误原样上抛，不切换候选
    const chunks = []
    const streamedFailure = await unit.complete(
      { model: 'auto', openAi: { messages: [{ role: 'user', content: 'emit-first' }] } },
      chunk => chunks.push(chunk),
    ).then(() => null, error => error)
    assert.equal(streamedFailure?.channelCode, 'QUOTA_EXCEEDED')
    assert.deepEqual(attempts, ['p/a'])
    assert.equal(chunks.length, 1)

    // B 类（积分型，预检看不到）运行时接力：落到下一候选，接力后即时刷新快照
    attempts.length = 0
    const roundsBefore = rpcRounds
    const relayed = await unit.complete({ model: 'auto', openAi: { messages: [{ role: 'user', content: 'hi' }] } })
    assert.deepEqual(attempts, ['p/a', 'p/b'])
    assert.equal(relayed.text, 'b-ok')
    assert.ok(rpcRounds > roundsBefore, '运行时接力后必须即时刷新快照')

    // 非配额错误不接力（AC-11）：错误对象按直接调用该模型的语义返回
    attempts.length = 0
    const boom = await unit.complete({ model: 'auto', openAi: { messages: [{ role: 'user', content: 'boom' }] } }).then(() => null, error => error)
    assert.equal(boom?.message, 'p: upstream 500')
    assert.deepEqual(attempts, ['p/a'])

    // 全池耗尽（积分型）：429 信封，code=RATE_LIMIT，明细 resetUnknown
    bFails = true
    attempts.length = 0
    const exhausted = await unit.complete({ model: 'auto', openAi: { messages: [{ role: 'user', content: 'hi' }] } }).then(() => null, error => error)
    assert.equal(exhausted?.statusCode, 429)
    assert.equal(exhausted?.code, 'RATE_LIMIT')
    assert.match(exhausted?.message ?? '', /调度池/)
    assert.equal(exhausted?.details?.type, 'smart_pool_exhausted')
    assert.deepEqual(exhausted?.details?.models, [
      { model: 'p/a', resetUnknown: true },
      { model: 'p/b', resetUnknown: true },
    ])
    bFails = false
    unit.dispose()

    // 预检（A 类，modelRateLimits 已知解禁时刻）：零派发、明细带 resetAtMs/ISO
    const presetChannels = {
      providers: ['p'],
      rpc: async body => body.method === 'model.list'
        ? { ok: true, value: { models: [{ id: 'a', name: 'A', disabled: false, dead: false }] } }
        : { ok: true, value: { accounts: [{ id: 'u1', enabled: true, modelRateLimits: { a: Date.now() + 3600_000 } }] } },
      complete: async () => { throw new Error('预检已判耗尽，不应派发') },
    }
    const preset = createSmartScheduler({ settings: { get: () => ({ smartSchedulePool: { models: ['p/a'] } }) }, channels: presetChannels, logger: { warn() {}, info() {} } })
    await preset.refreshSnapshot()
    const presetFailure = await preset.complete({ model: 'auto', openAi: { messages: [{ role: 'user', content: 'hi' }] } }).then(() => null, error => error)
    assert.equal(presetFailure?.statusCode, 429)
    assert.equal(presetFailure?.code, 'RATE_LIMIT')
    const presetDetail = presetFailure?.details?.models?.[0]
    assert.equal(presetDetail?.model, 'p/a')
    assert.ok(Number.isFinite(presetDetail?.resetAtMs) && presetDetail.resetAtMs > Date.now())
    assert.equal(presetDetail?.resetAtIso, new Date(presetDetail.resetAtMs).toISOString())
    assert.equal(typeof presetDetail?.resetUnknown, 'undefined')
    // 池状态面：全池 statuses + 当前命中 + 候选清单
    const view = preset.state()
    assert.equal(view.pool.join(','), 'p/a')
    assert.equal(view.hit, null)
    assert.equal(view.statuses[0]?.reason, 'exhausted')
    assert.equal(view.candidates[0]?.id, 'p/a')
    preset.dispose()

    // 空池与全失效 → 400（配置错误，不是限流）
    const empty = createSmartScheduler({ settings: { get: () => ({ smartSchedulePool: { models: [] } }) }, channels: fakeChannels, logger: { warn() {}, info() {} } })
    const emptyFailure = await empty.complete({ model: 'auto', openAi: { messages: [{ role: 'user', content: 'hi' }] } }).then(() => null, error => error)
    assert.equal(emptyFailure?.statusCode, 400)
    assert.match(emptyFailure?.message ?? '', /智能调度/)
    empty.dispose()
    const allInvalid = createSmartScheduler({ settings: { get: () => ({ smartSchedulePool: { models: ['p/ghost'] } }) }, channels: fakeChannels, logger: { warn() {}, info() {} } })
    await allInvalid.refreshSnapshot()
    const invalidFailure = await allInvalid.complete({ model: 'ourfreemodel', openAi: { messages: [{ role: 'user', content: 'hi' }] } }).then(() => null, error => error)
    assert.equal(invalidFailure?.statusCode, 400)
    allInvalid.dispose()
  })
  service = await startStandalone({ dataDir, port: 0, refresh: false, logger: { warn: message => warnings.push(message), info() {} } })
  await service.ready
  key = JSON.parse(fs.readFileSync(service.keyFile)).forwardKey
  await check('十三个真实渠道注册，独立目录、统一模型目录和机读能力可用', async () => {
    assert.equal(service.channels.providers.length, 13)
    assert.equal(service.channels.providers.includes('opencode'), false)
    assert.equal((await rpc('account.list', { provider: 'cline' })).accounts.length, 1)
    const { value } = await api('/v1/models')
    assert.ok(value.data.some(row => row.id === 'cline/cline-free/mimo-v2.6-flash'))
    assert.ok(value.data.some(row => row.id === 'loomy/fixture-free'))
    assert.ok(value.data.find(row => row.id === 'cline/cline-free/mimo-v2.6-flash').input.includes('image'))
    assert.equal(value.data.find(row => row.id === 'cline/cline-free/mimo-v2.6-flash').context_window, 1048576)
    assert.equal(value.data.find(row => row.id === 'cline/cline-free/mimo-v2.6-flash').max_tokens, 131072)
    const summary = (await api('/api/management/summary')).value
    assert.equal(summary.networkMode, 'fixture')
    assert.equal(summary.catalog.find(row => row.id === 'cline/cline-free/mimo-v2.6-flash').maxOutput, 131072)
    assert.equal(summary.channels.state, 'ready')
    assert.equal(JSON.stringify(summary).includes('fixture-refresh'), false)
    assert.equal(fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8'), 'SENTINEL_DO_NOT_READ')
    assert.equal(fs.existsSync(path.join(dshHome, 'channel-pack')), false)
    // 未登录 EAC 时清单不得出现 sealed 行（sentinel 也不得被自动读取）。
    await service.runtime.refreshCatalog()
    assert.equal(service.runtime.catalog.some(row => row.channel === 'eac'), false)
  })
  await check('未知渠道保留历史账号与凭据，但不注册、不列模型、不允许旧 RPC 或网关请求', async () => {
    assertUnsupportedDataPreserved()
    const models = (await api('/v1/models')).value.data
    for (const provider of unsupportedProviders) {
      assert.equal(service.channels.providers.includes(provider), false)
      assert.equal(models.some(row => row.id.startsWith(`${provider}/`)), false)
    }
    const before = requests.length
    for (const provider of unsupportedProviders) {
      const accountId = `${provider}-fixture`
      for (const [method, payload] of [
        ['account.list', { provider }], ['account.create', { provider }],
        ['model.list', { provider }], ['provider.setEnabled', { provider, enabled: false }],
        ['credits.permanentLock', { provider, locked: true }],
        ['login.poll', { accountId }], ['account.update', { accountId, patch: { nickname: '不得修改' } }],
        ['account.delete', { accountId }], ['account.test', { accountId }], ['account.reset', { accountId }],
      ]) {
        const reply = await api('/api/management/channels/rpc', { method, payload })
        assert.equal(reply.response.status, 200)
        assert.equal(reply.value.ok, false, `${provider} ${method}: ${JSON.stringify(reply.value)}`)
        assert.equal(reply.value.error.code, 'provider-unsupported', `${provider} ${method}`)
      }
      for (const [endpoint, payload] of [
        ['/v1/chat/completions', { messages: [{ role: 'user', content: 'unsupported fixture' }] }],
        ['/v1/responses', { input: 'unsupported fixture' }],
        ['/v1/messages', { max_tokens: 16, messages: [{ role: 'user', content: 'unsupported fixture' }] }],
      ]) assert.equal((await api(endpoint, { model: `${provider}/fixture-free`, ...payload })).response.status, 404)
    }
    assert.equal(requests.length, before, '未知渠道请求不得触达任何上游端点')
    assertUnsupportedDataPreserved()
  })
  await check('同源鉴权覆盖渠道与管理读取，跨域访问失败、本机直连放行', async () => {
    // 本机回环 + 未开 LAN：不再要求令牌（该页面只监听本机）。
    // 本机直连可达（不再 401）。这两个端点对空载荷各自有正常响应，
    // 所以这里只断言「不是鉴权失败」，不规定具体业务码。
    for (const endpoint of ['/api/management/summary', '/api/management/channels/rpc']) {
      const direct = await fetch(service.url + endpoint, { method: endpoint.endsWith('rpc') ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...endpoint.endsWith('rpc') ? { body: '{}' } : {} })
      assert.notEqual(direct.status, 401, `${endpoint} 本机直连不应要求登录`)
    }
    // 跨站来源必须被拒 —— 这是免登录之后真正的安全边界。
    const crossSite = await fetch(service.url + '/api/management/channels/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.invalid', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ method: 'gateway.getEnabled', payload: {} }),
    })
    assert.equal(crossSite.status, 403, '跨站渠道操作必须被拒')
    assert.equal((await api('/api/management/channels/rpc', { method: 'account.list', payload: { provider: 'cline' } }, { origin: 'http://evil.invalid' })).response.status, 403)
    assert.equal((await api('/api/management/channels/rpc', { method: 'gateway.getEnabled', payload: {} })).value.value.apiKey.value, key)
  })
  await check('真实 Cline / Loomy 适配器非流式、SSE、Responses、工具及用量链路', async () => {
    const body = { model: 'cline/cline-free/mimo-v2.6-flash', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }] }
    const reply = await api('/v1/chat/completions', body)
    assert.equal(reply.response.status, 200)
    assert.equal(reply.value.choices[0].message.content, 'account-ok')
    assert.deepEqual(JSON.parse(reply.value.choices[0].message.tool_calls[0].function.arguments), { q: 'fixture' })
    const response = await fetch(`${service.url}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, model: 'loomy/fixture-free', stream: true }) })
    assert.equal(response.status, 200)
    const stream = await response.text()
    assert.ok(stream.includes('account-ok') && stream.includes('call_fixture') && stream.includes('[DONE]'))
    const responses = await api('/v1/responses', { model: 'cline/cline-free/mimo-v2.6-flash', input: 'hi', tools: [{ type: 'function', name: 'lookup', parameters: {} }] })
    assert.equal(responses.response.status, 200, JSON.stringify(responses.value))
    assert.ok(JSON.stringify(responses.value).includes('call_fixture'))
    const stats = (await api('/api/management/stats')).value
    assert.equal(stats.turns, 3)
    assert.equal(stats.grand.input, 33)
    const ledger = await rpc('usage.tokenLedger', {})
    assert.ok(JSON.stringify(ledger).includes('cline-free/mimo-v2.6-flash'))
    assert.ok(JSON.stringify(ledger).includes('fixture-free'))
  })
  await check('Anthropic Messages 经真实渠道适配器保留消息、系统提示、工具与生成参数', async () => {
    const before = requests.length
    const body = {
      model: 'cline/cline-free/mimo-v2.6-flash',
      max_tokens: 123,
      temperature: 0.2,
      system: 'be brief',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi anthropic' }] }],
      tools: [{ name: 'lookup', description: 'look up', input_schema: { type: 'object', properties: { q: { type: 'string' } } } }],
    }
    const reply = await api('/v1/messages', body)
    assert.equal(reply.response.status, 200, JSON.stringify(reply.value))
    assert.equal(reply.value.type, 'message')
    assert.ok(reply.value.content.some(block => block.type === 'text' && block.text === 'account-ok'), JSON.stringify(reply.value))
    assert.ok(reply.value.content.some(block => block.type === 'tool_use' && block.name === 'lookup'), JSON.stringify(reply.value))
    const sent = requests.slice(before).find(row => row.pathname.endsWith('/chat/completions'))
    assert.ok(sent, 'the channel must receive the converted Anthropic request')
    assert.equal(sent.body.max_tokens, 123)
    assert.equal(sent.body.temperature, 0.2)
    const text = JSON.stringify(sent.body.messages)
    assert.ok(text.includes('be brief'), text)
    assert.ok(text.includes('hi anthropic'), text)
    assert.equal(sent.body.tools[0].function.name, 'lookup')
  })
  await check('内联图片真实传到渠道，远程 URL 与伪造图片被拒绝', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
    const reply = await api('/v1/chat/completions', { model: 'cline/cline-free/mimo-v2.6-flash', messages: [{ role: 'user', content: [{ type: 'text', text: 'what' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] }] })
    assert.equal(reply.response.status, 200)
    assert.ok(JSON.stringify(requests.at(-1).body).includes(png))
    const before = requests.length
    const remote = await api('/v1/chat/completions', { model: 'cline/cline-free/mimo-v2.6-flash', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://127.0.0.1/private' } }] }] })
    assert.equal(remote.response.status, 400)
    assert.equal(requests.length, before, '远程图片不得触发抓取或推理请求')
    await assert.rejects(attachments.saveImage({ data: Buffer.from('not-an-image'), mediaType: 'image/png' }))
  })
  await check('模型开关、供应商开关与永久积分锁定保留业务且立即阻止调用', async () => {
    await rpc('credits.permanentLock', { provider: 'loomy', locked: true })
    assert.equal((await rpc('credits.permanentLock', { provider: 'loomy' })).locked, true)
    const loomyBefore = requests.filter(row => row.pathname.endsWith('/chat/completions')).length
    const locked = await api('/v1/chat/completions', { model: 'loomy/fixture-free', messages: [{ role: 'user', content: 'permanent-only fixture' }] })
    assert.ok(locked.response.status >= 400, JSON.stringify(locked.value))
    assert.match(JSON.stringify(locked.value), /锁定永久积分/)
    assert.equal(requests.filter(row => row.pathname.endsWith('/chat/completions')).length, loomyBefore, '锁定必须阻止仅有永久积分的账号发起推理')
    await rpc('credits.permanentLock', { provider: 'loomy', locked: false })
    const unlocked = await api('/v1/chat/completions', { model: 'loomy/fixture-free', messages: [{ role: 'user', content: 'unlocked fixture' }] })
    assert.equal(unlocked.response.status, 200, JSON.stringify(unlocked.value))
    await rpc('credits.permanentLock', { provider: 'loomy', locked: true })
    await rpc('model.setDisabled', { provider: 'cline', modelId: 'cline-free/mimo-v2.6-flash', disabled: true })
    const before = requests.filter(row => row.pathname.endsWith('/chat/completions')).length
    assert.equal((await api('/v1/chat/completions', { model: 'cline/cline-free/mimo-v2.6-flash', messages: [{ role: 'user', content: 'hi' }] })).response.status, 404)
    assert.equal(requests.filter(row => row.pathname.endsWith('/chat/completions')).length, before)
    // S12-A（A4/FR-13.4）：「模型与开关」页删除后，smart 页行内启停走的就是这条
    // RPC 往返——停用必须联动进 smart 候选状态（页面据此显示「已停用/启用」）。
    const smartState = async () => (await api('/api/management/smart/state')).value
    const disabledView = await smartState()
    assert.equal(disabledView.candidates.find(row => row.id === 'cline/cline-free/mimo-v2.6-flash')?.disabled, true,
      '停用必须联动进 smart 候选状态')
    await rpc('provider.setEnabled', { provider: 'cline', enabled: false })
    assert.equal((await rpc('account.list', { provider: 'cline' })).accounts[0].enabled, false)
    await rpc('provider.setEnabled', { provider: 'cline', enabled: true })
    assert.equal((await rpc('account.list', { provider: 'cline' })).accounts[0].enabled, true)
    assert.equal((await rpc('credits.permanentLock', { provider: 'loomy' })).locked, true)
  })
  await check('批量模型开关仅作用于当前渠道，目录更新且关闭状态落盘', async () => {
    await rpc('model.setAllDisabled', { provider: 'cline', disabled: false })
    const listed = (await rpc('model.list', { provider: 'cline' })).models
    assert.ok(listed.length > 0 && listed.every(model => model.disabled === false))
    const otherBefore = (await rpc('model.list', { provider: 'loomy' })).models
    await rpc('model.setAllDisabled', { provider: 'cline', disabled: true })
    assert.ok((await rpc('model.list', { provider: 'cline' })).models.every(model => model.disabled === true))
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'channel-pack/state.json'), 'utf8'))
    assert.ok(Object.keys(stored.disabledModels.cline).length > 0, '批量关闭必须持久化')
    assert.deepEqual((await rpc('model.list', { provider: 'loomy' })).models, otherBefore)
    await service.channels.refresh()
    assert.ok(!(await api('/v1/models')).value.data.some(model => model.id.startsWith('cline/')))
    assert.ok((await api('/v1/models')).value.data.some(model => model.id === 'loomy/fixture-free'))
    await rpc('model.setAllDisabled', { provider: 'cline', disabled: false })
    await service.channels.refresh()
    assert.ok((await api('/v1/models')).value.data.some(model => model.id === 'cline/cline-free/mimo-v2.6-flash'))
    const restoredView = await (await api('/api/management/smart/state')).value
    assert.equal(restoredView.candidates.find(row => row.id === 'cline/cline-free/mimo-v2.6-flash')?.disabled, false,
      '启用必须恢复 smart 候选状态')
    const restored = JSON.parse(fs.readFileSync(path.join(dataDir, 'channel-pack/state.json'), 'utf8'))
    assert.equal(Object.keys(restored.disabledModels.cline ?? {}).length, 0)
    assert.equal((await rpc('credits.permanentLock', { provider: 'loomy' })).locked, true)
  })
  await check('EAC 原 GitHub 登录、签名、用户 token、清单及退出链路可用', async () => {
    // /eac/* 六管理端点已随 EAC 页删除（S12-A，消费面=被删的 EacPage）；eac.mjs
    // 本体因推理链（sealedCredential）保留，这里用同 dataDir 的直连实例驱动
    // 登录/资源池/登出，服务侧经 refreshCatalog / refreshSealedLane 感知凭据变化。
    const login = createStandaloneEac({ dataDir, openExternal: async () => false })
    try {
      const start = await login.start()
      assert.ok(start.link && /^[\w-]{32}$/.test(start.link))
      assert.equal(start.opened, false)
      const poll = await login.poll(start.link)
      assert.equal(poll.status, 'ok')
      assert.equal(JSON.stringify(poll).includes('fixture-eac-user'), false)
      await service.runtime.refreshCatalog()
      assert.ok(service.runtime.catalog.some(row => row.channel === 'eac'))
      const model = service.runtime.catalog.find(row => row.channel === 'eac').id
      const reply = await api('/v1/chat/completions', { model, messages: [{ role: 'user', content: 'hi' }] })
      assert.equal(reply.response.status, 200)
      assert.equal(reply.value.choices[0].message.content, 'eac-ok')
      assert.equal(requests.at(-1).headers['x-ofm-user'], 'fixture-eac-user')
      assert.equal((await login.pool()).inflight, 3)
      assert.equal((await login.logout()).ok, true)
      await service.runtime.refreshSealedLane()
      assert.equal(service.runtime.catalog.some(row => row.channel === 'eac'), false)
      assert.equal(fs.existsSync(path.join(dataDir, 'eac-user.json')), false)
      assert.equal(JSON.parse(fs.readFileSync(path.join(dshHome, 'our-free-model/eac-user.json'))).token, 'dsh-sentinel')
    } finally {
      login.dispose()
    }
  })
  await check('账号轮询完成后凭据只在后端落盘，可修改、备份和删除', async () => {
    const started = await rpc('account.create', { provider: 'cline' })
    assert.ok(started.accountId && started.loginUrl)
    assert.equal(new URL(started.loginUrl).origin, fixture)
    assert.equal(JSON.stringify(started).includes('fixture-workos'), false)
    const deadline = Date.now() + 12000
    let completed
    while (Date.now() < deadline) {
      completed = await rpc('login.poll', { accountId: started.accountId, provider: 'cline' })
      if (completed.done) break
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    assert.equal(completed.done, true)
    assert.equal(completed.success, true)
    assert.equal(JSON.stringify(completed).includes('fixture-new'), false)
    const loggedIn = (await rpc('account.list', { provider: 'cline' })).accounts.find(row => row.id === started.accountId)
    const credentials = JSON.parse(fs.readFileSync(path.join(dataDir, 'channel-credentials.json'), 'utf8'))
    assert.equal(JSON.parse(credentials[loggedIn.credentialRef]).access_token, 'workos:fixture-new')
    await rpc('account.update', { accountId: started.accountId, patch: { nickname: '新昵称', enabled: false } })
    await rpc('account.reorder', { provider: 'cline', orderedIds: [started.accountId, 'cline-fixture'] })
    const backup = await rpc('backup.export')
    assert.ok(Object.keys(backup.payload.credentials).length > 0)
    await rpc('account.delete', { accountId: started.accountId })
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'channel-credentials.json'), 'utf8'))[loggedIn.credentialRef], undefined)
    assert.equal((await rpc('account.list', { provider: 'cline' })).accounts.length, 1)
    await rpc('backup.import', { payload: backup.payload })
    assert.equal((await rpc('account.list', { provider: 'cline' })).accounts[0].nickname, '新昵称')
    assertUnsupportedDataPreserved()
  })
  await check('并行独立实例不共享账号、目录、授权或账本，重启保存设置', async () => {
    other = await startStandalone({ dataDir: otherDir, port: 0, refresh: false, logger: { warn() {}, info() {} } })
    await other.ready
    assert.equal((await other.channels.rpc({ method: 'account.list', payload: { provider: 'cline' } })).value.accounts.length, 0)
    assert.equal(other.channels.publicModelRows().length, 0)
    await service.close()
    service = await startStandalone({ dataDir, port: 0, refresh: false, logger: { warn() {}, info() {} } })
    await service.ready
    key = JSON.parse(fs.readFileSync(service.keyFile)).forwardKey
    assert.equal((await rpc('account.list', { provider: 'cline' })).accounts[0].nickname, '新昵称')
    assert.equal((await rpc('credits.permanentLock', { provider: 'loomy' })).locked, true)
    assertUnsupportedDataPreserved()
    assert.equal(service.channels.providers.some(provider => unsupportedProviders.includes(provider)), false)
    assert.equal((await api('/v1/models')).value.data.some(row => unsupportedProviders.some(provider => row.id.startsWith(`${provider}/`))), false)
  })
  await check('渠道错误码经 channelCode 旁路透传到 standalone 层，直连响应信封逐字节不变', async () => {
    // 前置：解除 loomy 永久积分锁定（此后的用例不再依赖它为 true），
    // 再经 state.json 预置 loomy 账号的未来 modelRateLimits —— 这是
    // throwIfAllAccountsRateLimited 的确定性抛点（零上游请求）。
    await rpc('credits.permanentLock', { provider: 'loomy', locked: false })
    const statePath = path.join(dataDir, 'channel-pack', 'state.json')
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    const loomy = state.accounts.find(row => row.id === 'loomy-fixture')
    assert.ok(loomy, 'state.json 必须包含 loomy 替身账号')
    loomy.modelRateLimits = { 'fixture-free': Date.now() + 3600_000 }
    fs.writeFileSync(statePath, JSON.stringify(state))
    await service.close()
    service = await startStandalone({ dataDir, port: 0, refresh: false, logger: { warn() {}, info() {} } })
    await service.ready
    key = JSON.parse(fs.readFileSync(service.keyFile)).forwardKey
    // W1 读者侧：runtime 层拿到的错误带 channelCode=QUOTA_EXCEEDED。
    const failure = await service.runtime.complete({
      model: 'loomy/fixture-free', openAi: { messages: [{ role: 'user', content: 'channel-code fixture' }] },
    }).then(() => null, error => error)
    assert.ok(failure instanceof Error, '预检限流必须抛错')
    assert.equal(failure.channelCode, 'QUOTA_EXCEEDED')
    assert.match(failure.message, /均在限流中/)
    // 直连路径字节级不变：kernel 白名单（carryFailure）不读 channelCode，
    // HTTP 信封保持无 code 的 502 兜底形状，也不得出现 channelCode 字段。
    const reply = await api('/v1/chat/completions', { model: 'loomy/fixture-free', messages: [{ role: 'user', content: 'channel-code fixture' }] })
    assert.equal(reply.response.status, 502)
    assert.equal(reply.value.error.type, 'server_error')
    assert.equal(reply.value.error.code, undefined)
    assert.equal(Object.hasOwn(reply.value.error, 'channelCode'), false)
    assert.match(reply.value.error.message, /均在限流中/)
    assertUnsupportedDataPreserved()
  })
  // —— S3 智能调度（auto 网关别名）集成用例 ——
  const chatRequests = () => requests.filter(row => row.pathname.endsWith('/chat/completions'))
  const loomyRequests = () => chatRequests().filter(row => row.headers['x-ofm-fixture-host'] === 'loomyad.xunfei.cn')
  const rewriteState = patch => {
    const statePath = path.join(dataDir, 'channel-pack', 'state.json')
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    patch(state)
    fs.writeFileSync(statePath, JSON.stringify(state))
  }
  const rewriteSettings = patch => {
    const settingsPath = path.join(dataDir, 'settings.json')
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    patch(settings)
    fs.writeFileSync(settingsPath, JSON.stringify(settings))
  }
  const restartService = async () => {
    await service.close()
    service = await startStandalone({ dataDir, port: 0, refresh: false, logger: { warn() {}, info() {} } })
    await service.ready
    key = JSON.parse(fs.readFileSync(service.keyFile)).forwardKey
  }
  await check('auto 网关：/v1/models 头部恰一条 auto（池空也在、无别名重复条目），空池与全大写别名返回 400 配置指引，auto 不进内部清单', async () => {
    const list = await api('/v1/models')
    assert.equal(list.value.data[0]?.id, 'auto')
    assert.equal(list.value.data.filter(row => row.id === 'auto').length, 1)
    assert.equal(list.value.data.some(row => row.id === 'ourfreemodel'), false)
    assert.equal(list.value.data[0].owned_by, 'our-free-model')
    assert.equal(list.value.data.some(row => row.id === 'loomy/fixture-free'), true)
    for (const model of ['auto', 'ourfreemodel', 'AUTO']) {
      const reply = await api('/v1/chat/completions', { model, messages: [{ role: 'user', content: 'hi' }] })
      assert.equal(reply.response.status, 400, `${model}: ${JSON.stringify(reply.value)}`)
      assert.equal(reply.value.error.type, 'invalid_request_error')
      assert.match(reply.value.error.message, /智能调度/)
    }
    // 注入面只在对外网关：管理台 summary/catalog 不含 auto（方案 §3.8）
    const summary = (await api('/api/management/summary')).value
    assert.equal(summary.catalog.some(row => row.id === 'auto'), false)
  })
  await check('auto 顺序接力：预检跳过已耗尽模型（零上游请求）、命中第一可用、别名等价、日志记 auto→真实模型、用量计入真实模型桶', async () => {
    rewriteSettings(settings => { settings.smartSchedulePool = { models: ['loomy/fixture-free', 'cline/cline-free/mimo-v2.6-flash'] } })
    await restartService()
    const loomyBefore = loomyRequests().length
    const reply = await api('/v1/chat/completions', { model: 'ourfreemodel', messages: [{ role: 'user', content: 'smart-fixture' }] })
    assert.equal(reply.response.status, 200, JSON.stringify(reply.value))
    assert.equal(reply.value.choices[0].message.content, 'account-ok')
    assert.equal(loomyRequests().length, loomyBefore, '预检判耗尽的模型不得发出任何上游网络请求')
    // 别名 + 流式等价：model=auto（规范名）流式同样命中池内第一可用
    const stream = await fetch(`${service.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'smart-fixture' }], stream: true }),
    })
    assert.equal(stream.status, 200)
    const text = await stream.text()
    assert.ok(text.includes('account-ok') && text.includes('[DONE]'), text.slice(0, 200))
    assert.equal(loomyRequests().length, loomyBefore)
    // 请求日志可辨识最终命中的真实模型（FR-4.9）
    const log = (await api('/api/management/requests?limit=10')).value
    assert.match(log.entries[0]?.model ?? '', /^auto→cline\/cline-free\/mimo-v2\.6-flash$/)
    assert.match(log.entries[1]?.model ?? '', /^ourfreemodel→cline\/cline-free\/mimo-v2\.6-flash$/)
    // 用量计入真实命中模型的 stats 桶（D13），且不新增 auto 统计桶
    const stats = (await api('/api/management/stats')).value
    assert.ok((stats.days ?? []).some(day => (day.models ?? []).some(row => row.model === 'cline/cline-free/mimo-v2.6-flash' && row.calls > 0)), JSON.stringify(stats.days?.at(-1)))
    assert.equal((stats.days ?? []).some(day => (day.models ?? []).some(row => row.model === 'auto')), false)
  })
  await check('auto 非配额错误（上游 5xx）不接力，错误信封与直连该模型逐字段一致', async () => {
    rewriteState(state => { for (const row of state.accounts) delete row.modelRateLimits })
    rewriteSettings(settings => { settings.smartSchedulePool = { models: ['cline/cline-free/mimo-v2.6-flash', 'loomy/fixture-free'] } })
    await restartService()
    const loomyBefore = loomyRequests().length
    const reply = await api('/v1/chat/completions', { model: 'auto', messages: [{ role: 'user', content: 'server-fixture' }] })
    assert.ok(reply.response.status >= 500, JSON.stringify(reply.value))
    assert.equal(loomyRequests().length, loomyBefore, '非配额错误不得接力到池内下一候选')
    const direct = await api('/v1/chat/completions', { model: 'cline/cline-free/mimo-v2.6-flash', messages: [{ role: 'user', content: 'server-fixture' }] })
    assert.equal(direct.response.status, reply.response.status)
    assert.equal(direct.value.error.type, reply.value.error.type)
  })
  await check('auto 全池耗尽返回 429 信封（各模型解禁明细）且重启后自愈，退出前还原限流与调度池', async () => {
    rewriteState(state => {
      for (const row of state.accounts) {
        if (row.provider === 'loomy') row.modelRateLimits = { 'fixture-free': Date.now() + 3600_000 }
        if (row.provider === 'cline') row.modelRateLimits = { 'cline-free/mimo-v2.6-flash': Date.now() + 7200_000 }
      }
    })
    rewriteSettings(settings => { settings.smartSchedulePool = { models: ['loomy/fixture-free', 'cline/cline-free/mimo-v2.6-flash'] } })
    await restartService()
    const upstreamBefore = chatRequests().length
    const exhausted = await api('/v1/chat/completions', { model: 'auto', messages: [{ role: 'user', content: 'exhausted-fixture' }] })
    assert.equal(exhausted.response.status, 429, JSON.stringify(exhausted.value))
    assert.equal(exhausted.value.error.type, 'rate_limit_error')
    assert.equal(exhausted.value.error.code, 'RATE_LIMIT')
    assert.match(exhausted.value.error.message, /调度池/)
    assert.equal(exhausted.value.error.details?.type, 'smart_pool_exhausted')
    const detail = Object.fromEntries((exhausted.value.error.details?.models ?? []).map(row => [row.model, row]))
    assert.deepEqual(Object.keys(detail), ['loomy/fixture-free', 'cline/cline-free/mimo-v2.6-flash'])
    for (const row of Object.values(detail)) {
      assert.ok(Number.isFinite(row.resetAtMs) && row.resetAtMs > Date.now(), JSON.stringify(row))
      assert.equal(row.resetAtIso, new Date(row.resetAtMs).toISOString())
    }
    assert.equal(chatRequests().length, upstreamBefore, '全池耗尽判定不得发出任何上游网络请求')
    // 重启自愈（AC-12）：跳过状态由持久化 modelRateLimits 派生，无需重新试错
    await restartService()
    const afterRestart = await api('/v1/chat/completions', { model: 'auto', messages: [{ role: 'user', content: 'exhausted-fixture' }] })
    assert.equal(afterRestart.response.status, 429)
    assert.equal(afterRestart.value.error.details?.type, 'smart_pool_exhausted')
    assert.equal(chatRequests().length, upstreamBefore)
    // 还原：清空限流与调度池，后续既有用例（cline 取消传播等）不受影响
    rewriteState(state => { for (const row of state.accounts) delete row.modelRateLimits })
    rewriteSettings(settings => { settings.smartSchedulePool = { models: [] } })
    await restartService()
    assert.equal((await api('/v1/models')).value.data[0].id, 'auto')
  })
  await check('客户端取消传播到真实渠道网络请求，服务关闭不会迟到写入凭据', async () => {
    const controller = new AbortController()
    const started = new Promise(resolve => { hold = resolve })
    const request = service.runtime.complete({ model: 'cline/cline-free/mimo-v2.6-flash', signal: controller.signal, openAi: { messages: [{ role: 'user', content: 'cancel-fixture' }] } })
    request.catch(() => {})
    await Promise.race([started, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('取消测试未收到上游请求')), 10000); timer.unref() })])
    controller.abort()
    await assert.rejects(request)
    loginReady = false
    await rpc('account.create', { provider: 'cline' })
    await service.close()
    loginReady = true
    const before = fs.readFileSync(path.join(dataDir, 'channel-credentials.json'), 'utf8')
    await new Promise(resolve => setTimeout(resolve, 1300))
    assert.equal(cancelled, true)
    assert.equal(fs.readFileSync(path.join(dataDir, 'channel-credentials.json'), 'utf8'), before)
    assert.equal(fs.existsSync(path.join(dataDir, 'service.lock')), false)
  })
  await check('EAC 退出后迟到的状态响应不能恢复页面授权状态', async () => {
    const dir = path.join(scratch, 'status-eac')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'eac-user.json'), JSON.stringify({ token: 'fixture-old', login: 'fixture-old-user' }))
    let answer
    const eac = createStandaloneEac({
      dataDir: dir, credentialOf: () => ({ mode: 'worker', base: 'https://example.invalid/v1' }),
      fetch: async url => url.endsWith('/auth/status')
        ? new Promise(resolve => { answer = resolve })
        : new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
    })
    const reading = eac.status()
    assert.equal((await eac.logout()).ok, true)
    answer(new Response('{"authorized":true,"login":"fixture-old-user"}', { headers: { 'content-type': 'application/json' } }))
    assert.equal((await reading).authorized, false)
    assert.equal(eac.cached().login, '')
    assert.equal(eac.credential(), null)
    eac.dispose()
  })
  await check('EAC 取消会中断正在 prepare 的网络，不保存迟到授权', async () => {
    let resolveStarted
    const began = new Promise(resolve => { resolveStarted = resolve })
    let stored = false
    const dir = path.join(scratch, 'cancel-eac')
    fs.mkdirSync(dir)
    const eac = createStandaloneEac({
      dataDir: dir, credentialOf: () => ({ mode: 'worker', base: 'https://example.invalid/v1', signingSecret: 's'.repeat(32) }),
      fetch: async (_url, { signal }) => new Promise((resolve, reject) => {
        stored = true; resolveStarted(); signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      }),
    })
    const starting = eac.start()
    await began
    eac.dispose()
    assert.equal((await starting).error, 'cancelled')
    assert.equal(stored, true)
    assert.equal(fs.existsSync(path.join(dir, 'eac-user.json')), false)
  })
} finally {
  await service?.close()
  await other?.close()
  upstream.closeAllConnections()
  await new Promise(resolve => upstream.close(resolve))
  lane.fetch = undefined
  fs.rmSync(scratch, { recursive: true, force: true })
}
console.log(`\nstandalone-channels: ${checks - failures}/${checks} checks passed`)
if (failures) process.exitCode = 1
