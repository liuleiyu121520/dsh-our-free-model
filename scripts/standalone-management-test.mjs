import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { verifyLoginLaunchers, verifyLoginTerminal } from './standalone-login-terminal-test.mjs'

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-management-')))
const dataDir = path.join(scratch, 'data')
const model = 'mimo-v2.6-flash-free'
const kilo = 'nvidia/nemotron-3.5-lightning:free'
let calls = 0
let failedListing = ''
let emptyFreeListing = false
let holdNextCall = false
let notifyCall
let notifyClosed
const upstream = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    if (req.method === 'GET') {
      const source = req.url === '/models' ? 'kilo' : 'free'
      if (failedListing === source) {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: '模拟清单刷新失败' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: source === 'kilo'
        ? [{ id: kilo, isFree: true, name: '测试免费模型' }]
        : emptyFreeListing ? [] : [{ id: model }] }))
    } else {
      calls++
      if (holdNextCall) {
        holdNextCall = false
        res.once('close', () => notifyClosed())
        notifyCall()
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end([
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7 } })}\n\n`,
        'data: [DONE]\n\n',
      ].join(''))
    }
  })
})
upstream.listen(0, '127.0.0.1')
await once(upstream, 'listening')
const base = `http://127.0.0.1:${upstream.address().port}`
process.env.OUR_FREE_MODEL_BASE = base
process.env.OUR_FREE_MODEL_KILO_BASE = base
const { startStandalone } = await import('../packages/standalone/service.mjs')
let service
let cookie
let key
let failures = 0
let checks = 0
const check = async (name, run) => {
  checks++
  try { await run(); console.log(`ok   ${name}`) }
  catch (error) { failures++; console.log(`FAIL ${name}: ${error.stack}`) }
}
const getKey = () => JSON.parse(fs.readFileSync(service.keyFile, 'utf8')).forwardKey
const request = async (route, { body, cookie: cookieValue = cookie, headers = {}, method } = {}) => {
  if (headers.host) {
    // fetch 会自行设置 Host；用真实 HTTP 请求验证恶意 Host，不误测客户端归一化。
    return new Promise((resolve, reject) => {
      const raw = http.request(service.url + route, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { cookie: cookieValue ?? '', 'content-type': 'application/json', ...headers },
      }, res => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode }))
      })
      raw.once('error', reject)
      raw.end(body === undefined ? undefined : JSON.stringify(body))
    })
  }
  const response = await fetch(service.url + route, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...cookieValue ? { cookie: cookieValue } : {},
      ...body === undefined ? {} : { 'content-type': 'application/json' },
      connection: 'close',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  return response
}
const login = async body => {
  const response = await request('/api/management/session', { body, cookie: '' })
  assert.equal(response.status, 200)
  const setCookie = response.headers.get('set-cookie')
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Strict/)
  assert.match(setCookie, /Path=\/api\/management/)
  return setCookie.split(';')[0]
}

try {
  await check('macOS 与 Windows 固定启动器安全引用路径，令牌只经 stdin 复制', verifyLoginLaunchers)
  await check('本机取令牌入口限制来源与参数，拒绝并发且不泄露密钥或创建会话', verifyLoginTerminal)
  service = await startStandalone({ dataDir, port: 0, refresh: false, logger: { warn() {} } })
  key = getKey()
  await check('页面资源本地提供且不包含密钥，健康接口仍兼容', async () => {
    const page = await request('/', { cookie: '' })
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type'), /text\/html/)
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer')
    const body = await page.text()
    // 标题不再带产品名（品牌位已按使用反馈移除），这里只验证确实是控制台页面。
    assert.match(body, /<title>[^<]*控制台[^<]*<\/title>/)
    assert.match(page.headers.get('content-security-policy'), /script-src 'self';/)
    const scripts = [...body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    assert.ok(scripts.length > 0)
    assert.ok(scripts.every(([, attributes, content]) => /\bsrc=/.test(attributes) && !content.trim()),
      '管理页脚本必须通过同源外部资源加载，不能依赖被 CSP 禁止的内联脚本')
    const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'unsupported'
    assert.ok(body.includes(`data-login-platform="${platform}"`))
    assert.ok(!body.includes(key))
    const manifest = JSON.parse(fs.readFileSync(new URL('../packages/standalone/web/assets.json', import.meta.url), 'utf8'))
    assert.ok(manifest.includes('app.js') && manifest.includes('app.css'))
    assert.ok(manifest.some(name => /^channels-.+\.js$/.test(name)))
    for (const asset of manifest) {
      const response = await request(`/assets/${asset}`, { cookie: '' })
      assert.equal(response.status, 200, asset)
      assert.match(response.headers.get('content-type'), asset.endsWith('.css') ? /text\/css/ : /javascript/)
      assert.ok(!(await response.text()).includes(key), asset)
      assert.equal((await request(`/assets/${asset}`, { method: 'HEAD' })).status, 200)
      assert.equal((await request(`/assets/${asset}`, { method: 'POST' })).status, 405)
    }
    for (const route of ['/assets/settings.json', '/assets/assets.json', '/assets/unknown.js', '/frontend/app.tsx', '/assets/%2e%2e%2fservice.mjs']) {
      assert.equal((await request(route, { cookie: '', headers: { authorization: `Bearer ${key}` } })).status, 404, route)
    }
    const health = await (await request('/health')).json()
    assert.equal(health.product, 'standalone')
    assert.equal(health.capabilities.webUi, true)
  })
  await check('本机回环直连免登录；非回环来源与开启 LAN 后仍必须鉴权', async () => {
    // 这页面本来就只监听回环，本机用户不该再去 settings.json 里翻令牌。
    const { isLoopbackAddress } = await import('../packages/standalone/management.mjs')
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::FFFF:127.0.0.1']) {
      assert.equal(isLoopbackAddress(address), true, `${address} 必须认作本机`)
    }
    for (const address of ['192.168.1.3', '10.0.0.2', '::ffff:192.168.1.3', '', undefined, null, 'localhost', 'evil.test']) {
      assert.equal(isLoopbackAddress(address), false, `${String(address)} 不得认作本机`)
    }
    // 本机直连：不带头也不带 cookie 就能读管理数据。
    for (const route of ['summary', 'stats', 'key']) {
      assert.equal((await request(`/api/management/${route}`, { cookie: '' })).status, 200, `${route} 本机应放行`)
    }
    // OPTIONS 仍然不放行跨域预检（这条与登录无关，是 CORS 边界）。
    const response = await request('/api/management/settings', { cookie: '', method: 'OPTIONS' })
    assert.notEqual(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  })
  await check('一次性链接只兑换一次，错误凭证不消耗有效凭证', async () => {
    const bootstrapToken = new URLSearchParams(new URL(service.managementUrl).hash.slice(1)).get('login')
    assert.ok(bootstrapToken)
    assert.ok(!service.managementUrl.includes(key))
    assert.equal((await request('/api/management/session', { cookie: '', body: { bootstrapToken: 'wrong' } })).status, 401)
    cookie = await login({ bootstrapToken })
    assert.equal((await request('/api/management/session', { cookie: '', body: { bootstrapToken } })).status, 401)
    const secondCookie = await login({ key })
    assert.notEqual(cookie, secondCookie)
  })
  await check('摘要与统计不泄露密钥，管理会话不能调用推理接口', async () => {
    const response = await request('/api/management/summary')
    assert.equal(response.status, 200)
    const summary = await response.json()
    assert.equal(summary.dataDir, dataDir)
    assert.equal(summary.automaticRefresh, false)
    assert.equal(summary.networkMode, 'live')
    assert.equal(summary.capabilities.eac, true)
    assert.ok(!JSON.stringify(summary).includes(key))
    const stats = await (await request('/api/management/stats')).json()
    assert.equal(stats.requests, 0)
    assert.ok(!JSON.stringify(stats).includes(key))
    assert.equal((await request('/v1/models')).status, 401)
    assert.equal((await request('/api/management/summary', { cookie: '', headers: { authorization: `Bearer ${key}` } })).status, 200)
  })
  await check('同源防护覆盖登录、读取和写入，拒绝伪造 Host 及插件来源', async () => {
    for (const headers of [
      { origin: 'https://evil.example' },
      { origin: 'http://127.0.0.1:1' },
      { referer: 'http://evil.example/' },
      { referer: 'dsh-app://app' },
      { 'sec-fetch-site': 'cross-site' },
      { host: 'evil.example' },
    ]) {
      assert.equal((await request('/api/management/summary', { headers })).status, 403, JSON.stringify(headers))
      assert.equal((await request('/api/management/settings', { headers, body: { enabled: false } })).status, 403)
      assert.equal((await request('/api/management/session', { headers, body: { key } })).status, 403)
    }
    const response = await request('/api/management/settings', { body: {}, headers: { origin: service.url, referer: `${service.url}/` } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  })
  await check('设置严格校验字段类型范围和请求体，不发生部分保存', async () => {
    for (const body of [
      null, [], { enabled: 'false' }, { enabled: false, unknown: 1 },
      { forwardKey: 'injected' }, { standalonePort: 80 }, { defaultMaxTokens: 0 },
      { defaultMaxTokens: 131073 }, { probeIntervalMinutes: 0 },
      { probeIntervalMinutes: 1441 }, { probeIntervalMinutes: '15' },
      { standaloneProbe: {} }, { enabled: false, probeIntervalMinutes: 0 },
      { hideFreeModels: 'true' }, { hideEacModels: 1 }, { hiddenModelIds: null },
      { hiddenModelIds: [1] }, { hiddenModelIds: [''] }, { hiddenModelIds: [' x'] },
      { hiddenModelIds: ['x\n'] }, { hiddenModelIds: ['x'.repeat(301)] },
      { hiddenModelIds: Array(1001).fill('model') },
      { enabled: false, hiddenModelIds: [false] },
    ]) assert.equal((await request('/api/management/settings', { body })).status, 400)
    assert.equal(getKey(), key)
    assert.equal(service.runtime.state().settings.enabled, true)
    const malformed = await fetch(service.url + '/api/management/settings', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{',
    })
    assert.equal(malformed.status, 400)
    assert.equal((await request('/api/management/settings', { body: {}, headers: { 'content-type': 'text/plain' } })).status, 415)
    assert.equal((await request('/api/management/settings', { body: { huge: 'x'.repeat(17000) } })).status, 413)
  })
  await check('设置保存后立即落盘，推理暂停时管理页面可恢复服务', async () => {
    const patch = { enabled: false, exposeRegionModels: false, streamRecovery: false, standaloneProbe: true, defaultMaxTokens: 8192, probeIntervalMinutes: 12 }
    assert.equal((await request('/api/management/settings', { body: patch })).status, 200)
    const saved = JSON.parse(fs.readFileSync(service.keyFile, 'utf8'))
    for (const [name, value] of Object.entries(patch)) assert.equal(saved[name], value)
    assert.equal((await request('/v1/models', { headers: { authorization: `Bearer ${key}` } })).status, 503)
    assert.equal((await request('/')).status, 200)
    assert.equal((await request('/api/management/summary')).status, 200)
    assert.equal((await request('/api/management/settings', { body: { enabled: true } })).status, 200)
    assert.equal((await request('/v1/models', { headers: { authorization: `Bearer ${key}` } })).status, 200)
  })
  await check('持久化失败不谎报成功且保留原配置与密钥', async () => {
    const nativeRename = fs.renameSync
    fs.renameSync = (source, target) => {
      if (target === service.keyFile) throw Object.assign(new Error('模拟磁盘不可写'), { code: 'EACCES' })
      return nativeRename(source, target)
    }
    try {
      assert.equal((await request('/api/management/settings', { body: { enabled: false } })).status, 500)
      assert.equal(service.runtime.state().settings.enabled, true)
      assert.equal((await request('/api/management/key/rotate', { body: { confirm: true } })).status, 500)
      assert.equal(service.runtime.state().settings.forwardKey, key)
      assert.equal(getKey(), key)
    } finally { fs.renameSync = nativeRename }
    assert.equal((await request('/api/management/settings', { body: { enabled: true } })).status, 200)
  })
  await check('刷新不默认推理，主动探测和单模型测试执行核心并写入统计', async () => {
    // /models/refresh 与 /models/test 管理端点已随「模型与开关」页删除（S12-A）；
    // 运行时行为（刷新/探测/单测）仍由 service.runtime 直接承载，此处直连验证。
    const before = calls
    await service.runtime.refreshCatalog({ probe: false })
    assert.equal(calls, before)
    const models = (await (await request('/api/management/summary')).json()).catalog
    assert.deepEqual(models.map(row => row.id), [model, kilo])
    await service.runtime.refreshCatalog({ probe: true })
    assert.equal(calls, before + 1)
    const testResult = await service.runtime.testModel(model)
    assert.equal(testResult.text, 'OK')
    assert.equal(testResult.persisted, true)
    const measured = (await (await request('/api/management/summary')).json()).catalog.find(row => row.id === model)
    assert.equal(measured.availabilitySource, 'manual')
    assert.equal(measured.availability, 'available')
    assert.equal(measured.ttftMs, testResult.ttftMs)
    assert.equal(measured.latencyMs, testResult.totalMs)
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'availability.json'), 'utf8'))
    assert.equal(saved.manualResults[model].ttftMs, testResult.ttftMs)
    assert.equal(calls, before + 2)
    await assert.rejects(service.runtime.testModel('missing'), '未知模型不得静默成功')
    assert.equal(calls, before + 2)
    const stats = await (await request('/api/management/stats')).json()
    assert.equal(stats.requests, 1)
    assert.equal(stats.turns, 1)
    assert.equal(stats.grand.input, 11)
    assert.equal(stats.grand.output, 7)
  })
  await check('刷新逐来源报告失败与保留的行数，恢复后不残留失败状态', async () => {
    const before = calls
    const refresh = async () => {
      const sources = (await service.runtime.refreshCatalog({ report: true })).sources
      const models = (await (await request('/api/management/summary')).json()).catalog
      assert.deepEqual(models.map(row => row.id), [model, kilo])
      assert.ok(!JSON.stringify(sources).includes(key))
      return sources
    }
    try {
      for (const source of ['free', 'kilo']) {
        failedListing = source
        const sources = await refresh()
        assert.deepEqual(sources[source], { ok: false, count: 1 })
        assert.deepEqual(sources[source === 'free' ? 'kilo' : 'free'], { ok: true, count: 1 })
        assert.deepEqual(sources.sealed, { ok: true, count: 0, skipped: true })
      }
      failedListing = ''
      emptyFreeListing = true
      assert.deepEqual((await refresh()).free, { ok: false, count: 1 })
      emptyFreeListing = false
      const sources = await refresh()
      assert.deepEqual(sources.free, { ok: true, count: 1 })
      assert.deepEqual(sources.kilo, { ok: true, count: 1 })
      assert.equal(calls, before, '清单失败不能触发推理或探测')
    } finally { failedListing = ''; emptyFreeListing = false }
  })
  await check('账号渠道刷新逐供应商返回失败、行数和恢复结果', async () => {
    const channelDir = path.join(scratch, 'channel-refresh')
    fs.mkdirSync(channelDir, { recursive: true })
    const fixtureFile = path.join(channelDir, 'refresh-fixture.json')
    const fixture = {
      trae: { models: [{ id: 'fixture-trae', name: 'TRAE 测试模型' }] },
      qodercn: { models: [{ id: 'fixture-qoder', name: 'Qoder 测试模型' }] },
    }
    const save = () => fs.writeFileSync(fixtureFile, JSON.stringify(fixture))
    save()
    const argv = [...process.execArgv]
    let instance
    try {
      process.execArgv.push('--import', new URL('./lib/standalone-refresh-fixture.mjs', import.meta.url).href)
      instance = await startStandalone({ dataDir: channelDir, port: 0, refresh: false, logger: { warn() {} } })
      await instance.ready
      const forwardKey = JSON.parse(fs.readFileSync(instance.keyFile, 'utf8')).forwardKey
      for (const failed of [false, true, false]) {
        fixture.trae.fail = failed
        save()
        const result = await instance.runtime.refreshCatalog({ report: true })
        assert.deepEqual(result.sources.trae, { ok: !failed, count: failed ? 0 : 1 })
        assert.deepEqual(result.sources.qodercn, { ok: true, count: 1 })
        assert.deepEqual(result.sources.free, { ok: true, count: 1 })
        assert.equal(instance.runtime.state().catalog.filter(row => row.channel === 'trae').length, failed ? 0 : 1)
        assert.equal(JSON.stringify(result.sources).includes('fixture-private-token'), false)
      }
      assert.equal(forwardKey, JSON.parse(fs.readFileSync(instance.keyFile, 'utf8')).forwardKey)
      const listing = instance.channels.refresh()
      const report = instance.channels.refresh({ report: true })
      assert.ok(Array.isArray(await listing), '既有渠道调用仍返回模型数组')
      assert.deepEqual((await report).sources.trae, { ok: true, count: 1 })
    } finally {
      process.execArgv.splice(0, process.execArgv.length, ...argv)
      await instance?.close()
    }
  })
  await check('EAC 清单成功或失败前授权已切换时，返回跳过且不覆盖当前目录', async () => {
    const { createRuntimeStores, createModelRuntime } = await import('../src/core/runtime.js')
    const { lane } = await import('../src/eac.js')
    const stores = createRuntimeStores({ dataDir: path.join(scratch, 'sealed-refresh'), logger: { warn() {} } })
    stores.catalogStore.update({ sealIds: ['fixture-cached'] })
    let credential = { mode: 'direct', base, apiKey: 'fixture-sealed-key', userToken: 'fixture-old-user' }
    const runtime = createModelRuntime({ ...stores, sealedCredential: () => credential, logger: { warn() {} } })
    const cached = runtime.catalog.filter(row => row.channel === 'eac').map(row => row.id)
    const originalFetch = lane.fetch
    try {
      assert.equal(cached.length, 1)
      for (const failed of [false, true]) {
        credential = { ...credential, userToken: 'fixture-old-user' }
        lane.fetch = async () => {
          credential = { ...credential, userToken: 'fixture-new-user' }
          return new Response(JSON.stringify(failed ? { error: { message: 'refused' } } : { data: [{ id: 'fixture-stale' }] }), { status: failed ? 401 : 200 })
        }
        const result = await runtime.refreshCatalog({ report: true })
        assert.deepEqual(result.sources.sealed, { ok: false, count: 1, skipped: true })
        assert.deepEqual(runtime.catalog.filter(row => row.channel === 'eac').map(row => row.id), cached)
        assert.equal(JSON.stringify(result.sources).includes('fixture-old-user'), false)
        assert.equal(JSON.stringify(result.sources).includes('fixture-new-user'), false)
      }
    } finally {
      lane.fetch = originalFetch
      runtime.dispose()
      stores.dispose()
    }
  })
  await check('取消单模型测试会关闭真实上游请求且管理会话仍可使用', async () => {
    const started = new Promise(resolve => { notifyCall = resolve })
    const closed = new Promise(resolve => { notifyClosed = resolve })
    const controller = new AbortController()
    const before = calls
    holdNextCall = true
    const pending = service.runtime.testModel(model, undefined, { signal: controller.signal })
    const cancelled = pending.then(() => null, error => error)
    const deadline = AbortSignal.timeout(5000)
    const wait = promise => Promise.race([promise, new Promise((_, reject) => {
      deadline.addEventListener('abort', () => reject(new Error('取消测试未在五秒内关闭上游')), { once: true })
    })])
    try {
      await wait(started)
      controller.abort()
      assert.equal((await cancelled)?.name, 'AbortError')
      await wait(closed)
      assert.equal(calls, before + 1)
      assert.equal((await request('/api/management/summary')).status, 200)
    } finally { controller.abort(); holdNextCall = false }
  })
  await check('模型隐藏只过滤公开清单，保留管理入口和历史调用并持久化', async () => {
    // /v1/models 头部恒有 auto 条目（智能调度 FR-5，始终暴露）；隐藏断言只看直连模型行。
    const listing = async () => (await (await request('/v1/models', { headers: { authorization: `Bearer ${key}` } })).json()).data
      .filter(row => row.id !== 'auto')
    assert.equal((await request('/api/management/settings', { body: { hiddenModelIds: [model, model] } })).status, 200)
    assert.deepEqual((await listing()).map(row => row.id), [kilo])
    const summary = await (await request('/api/management/summary')).json()
    assert.deepEqual(summary.settings.hiddenModelIds, [model])
    assert.equal(summary.catalog.find(row => row.id === model).hiddenByUser, true)
    assert.equal(summary.catalog.find(row => row.id === model).routable, false)
    assert.equal(JSON.stringify(summary).includes(key), false)
    assert.equal((await service.runtime.testModel(model)).ok, true, 'hidden history ids remain callable')
    assert.equal((await request('/api/management/settings', { body: { hiddenModelIds: [], hideFreeModels: true, hideEacModels: true } })).status, 200)
    assert.deepEqual(await listing(), [])
    assert.equal((await (await request('/api/management/summary')).json()).catalog.length, 2)
    const hiddenSettings = { hiddenModelIds: [model], hideFreeModels: false, hideEacModels: true }
    assert.equal((await request('/api/management/settings', { body: hiddenSettings })).status, 200)
    const stored = JSON.parse(fs.readFileSync(service.keyFile, 'utf8'))
    for (const [name, value] of Object.entries(hiddenSettings)) assert.deepEqual(stored[name], value)
  })
  await check('轮换要求确认，旧密钥与其他会话失效，当前管理会话保留', async () => {
    const other = await login({ key })
    assert.equal((await request('/api/management/key/rotate', { body: {} })).status, 400)
    const rotated = await request('/api/management/key/rotate', { body: { confirm: true } })
    assert.equal(rotated.status, 200)
    const nextKey = (await rotated.json()).key
    assert.notEqual(nextKey, key)
    assert.equal(getKey(), nextKey)
    // 本机直连始终可用（新语义：回环 + 未开 LAN 不需要会话），
    // 真正该失效的是**旧密钥**与旧会话自身的特权，下面两行覆盖后者。
    assert.equal((await request('/api/management/summary')).status, 200)
    // ⚠️ 带着**显式会话 cookie** 的请求必须按那份 cookie 校验：
    // 轮换后旧会话失效，所以这里仍是 401。免登录只覆盖「没带凭证」的请求，
    // 否则一个过期的 cookie 会被当成管理员（那是特权路由的鉴权漏洞）。
    assert.equal((await request('/api/management/summary', { cookie: other })).status, 401,
      '轮换后旧会话的显式 cookie 必须失效')
    assert.equal((await request('/v1/models', { headers: { authorization: `Bearer ${key}` } })).status, 401)
    assert.equal((await request('/v1/models', { headers: { authorization: `Bearer ${nextKey}` } })).status, 200)
    assert.equal((await request('/api/management/session', { cookie: '', body: { key } })).status, 401)
    key = nextKey
  })
  await check('会话到期和登出后不能读管理数据', async () => {
    const nativeNow = Date.now
    const started = nativeNow()
    try {
      Date.now = () => started + 8 * 60 * 60_000 + 1000
      // 带**显式会话 cookie** 时按该会话校验：过期后必须失效。
      // （免登录只覆盖「没带凭证」的请求。）
      assert.equal((await request('/api/management/summary')).status, 401)
      // 不带凭证：本机直连仍可用。
      assert.equal((await request('/api/management/summary', { cookie: '' })).status, 200)
    } finally { Date.now = nativeNow }
    cookie = await login({ key })
    const response = await request('/api/management/logout', { body: {} })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/)
    // 登出清掉的是会话：继续带旧 cookie 必须失效；不带凭证则是本机直连。
    assert.equal((await request('/api/management/summary')).status, 401)
    assert.equal((await request('/api/management/summary', { cookie: '' })).status, 200)
    cookie = await login({ key })
  })
  await check('重启保留设置与密钥但清除会话，新的登录链接独立生成', async () => {
    const oldUrl = service.managementUrl
    const previousPort = service.port
    await service.close()
    service = await startStandalone({ dataDir, refresh: false, logger: { warn() {} } })
    assert.equal(service.port, previousPort)
    assert.equal(getKey(), key)
    assert.notEqual(service.managementUrl, oldUrl)
    assert.equal(service.runtime.state().settings.defaultMaxTokens, 8192)
    assert.equal(service.runtime.state().settings.standaloneProbe, true)
    assert.deepEqual(service.runtime.state().settings.hiddenModelIds, [model])
    assert.equal(service.runtime.state().settings.hideEacModels, true)
    assert.equal(service.runtime.state().settings.hideFreeModels, false)
    // 重启清掉的是**会话**；浏览器遗留的旧 cookie 属于「未知」凭证——本机直连
    // （回环 + 未开 LAN）免登录回落放行（1.2.1 语义：升级/重启后不再把本机用户
    // 锁在登录页，用户 2026-11-17 明确要求；到期/登出/轮换的显式吊销仍严格 401）。
    assert.equal((await request('/api/management/summary')).status, 200)
    assert.equal((await request('/api/management/summary', { cookie: '' })).status, 200)
    const token = new URLSearchParams(new URL(service.managementUrl).hash.slice(1)).get('login')
    const nativeNow = Date.now
    const started = nativeNow()
    try {
      Date.now = () => started + 10 * 60_000 + 1000
      assert.equal((await request('/api/management/session', { cookie: '', body: { bootstrapToken: token } })).status, 401)
    } finally { Date.now = nativeNow }
    cookie = await login({ key })
    const visible = await (await request('/v1/models', { headers: { authorization: `Bearer ${key}` } })).json()
    assert.equal(visible.data.some(row => row.id === model), false)
    assert.equal((await request('/api/management/settings', { body: { hiddenModelIds: [], hideEacModels: false } })).status, 200)
    assert.equal((await (await request('/v1/models', { headers: { authorization: `Bearer ${key}` } })).json()).data.some(row => row.id === model), true)
  })
  await check('智能调度 API：状态读取、池校验（形状/去重/上限）、保存持久化重启不丢、徽标计数进摘要、注入面不含 auto', async () => {
    const smartState = async () => (await (await request('/api/management/smart/state')).json())
    const initial = await smartState()
    assert.deepEqual(initial.pool, [])
    assert.equal(initial.hit, null)
    assert.equal(Array.isArray(initial.candidates), true)
    // 校验：非数组、缺 provider 前缀（auto 是保留名不能入池）、带空白、超上限 32
    for (const invalid of [
      { models: 'auto' },
      { models: ['auto'] },
      { models: ['norow/模型 id 带空格'] },
      { models: [42] },
      { models: Array.from({ length: 33 }, (_, index) => `p/m${index}`) },
      {},
    ]) assert.equal((await request('/api/management/smart/pool', { body: invalid })).status, 400, JSON.stringify(invalid))
    // 去重保序 + 保存；未知模型允许入池（失效条目由页面置灰、调度时跳过）
    const saved = await (await request('/api/management/smart/pool', { body: {
      models: ['kilo/nvidia/nemotron-3.5-lightning:free', 'kilo/nvidia/nemotron-3.5-lightning:free', 'free/mimo-v2.6-flash-free'],
    } })).json()
    assert.deepEqual(saved.pool, ['kilo/nvidia/nemotron-3.5-lightning:free', 'free/mimo-v2.6-flash-free'])
    assert.equal(Array.isArray(saved.statuses), true)
    // 徽标计数进摘要（池 2、无账号 → 可用 0）；内部清单面不含 auto
    const summary = await (await request('/api/management/summary')).json()
    assert.deepEqual(summary.smart, { pool: 2, available: 0 })
    assert.equal(summary.catalog.some(row => row.id === 'auto'), false)
    assert.equal(summary.settings.smartSchedulePool.models.length, 2)
    const gateway = await (await request('/api/management/channels/rpc', { body: { method: 'gateway.getEnabled', payload: {} } })).json()
    assert.equal(gateway.value.models.some(row => row.id === 'auto'), false)
    // settings 透传：合法保存 / 非法拒绝
    assert.equal((await request('/api/management/settings', { body: { smartSchedulePool: { models: ['free/mimo-v2.6-flash-free'] } } })).status, 200)
    assert.equal((await request('/api/management/settings', { body: { smartSchedulePool: { models: ['bad'] } } })).status, 400)
    // 重启持久化（AC-4）；/v1/models 头部恰一条 auto 始终存在
    await service.close()
    service = await startStandalone({ dataDir, refresh: false, logger: { warn() {} } })
    cookie = await login({ key: getKey() })
    const persisted = await smartState()
    assert.deepEqual(persisted.pool, ['free/mimo-v2.6-flash-free'])
    // FR-16.3/FR-16.5（S16 兼容回归）：accounts 仅**可选新增** earliestResetAtMs——
    // 既有 total/available 原样保留；无未来解禁时刻时新字段必须缺省（不出现键）。
    // 正向透出（有未来解禁 → earliestResetAtMs=最小值）在 standalone-channels-test
    // 的真实渠道账号面覆盖（本套件无渠道账号，只能验证兼容半边）。
    for (const row of [...(persisted.statuses ?? []), ...(persisted.candidates ?? [])]) {
      assert.equal(typeof row.accounts.total, 'number', '既有字段 total 不得变化')
      assert.equal(typeof row.accounts.available, 'number', '既有字段 available 不得变化')
      assert.equal('earliestResetAtMs' in row.accounts, false, '无未来解禁时不得透出 earliestResetAtMs')
    }
    const visible = await (await request('/v1/models', { headers: { authorization: `Bearer ${getKey()}` } })).json()
    assert.equal(visible.data?.[0]?.id, 'auto')
    assert.equal((visible.data ?? []).filter(row => row.id === 'auto').length, 1)
    // 清理：恢复空池，不影响后续用例
    await request('/api/management/smart/pool', { body: { models: [] } })
    assert.deepEqual((await smartState()).pool, [])
  })
  await check('渠道模型启停 RPC 通道（FR-13.4 唯一入口）：载荷直达渠道包，smart 状态面完整', async () => {
    // 「模型与开关」页删除后，启停唯一入口 = smart 页行内开关 → /channels/rpc
    // 的 model.setDisabled（payload {provider, modelId, disabled}）。真实往返
    // （落盘 + 候选联动）在 standalone-channels-test 的渠道替身下覆盖；这里钉住
    // 管理面的通道完整性与候选状态形状。
    const rejected = await request('/api/management/channels/rpc', { body: { method: 'model.setDisabled', payload: { provider: 'no-such-provider', modelId: 'x', disabled: true } } })
    assert.equal(rejected.status, 200)
    const reply = await rejected.json()
    assert.equal(reply.ok, false, '未知供应商必须由渠道包结构化拒绝')
    assert.equal(reply.error.code, 'provider-unsupported')
    const state = await (await request('/api/management/smart/state')).json()
    assert.ok(Array.isArray(state.candidates), 'smart 状态必须始终暴露候选数组')
    for (const row of state.candidates ?? []) {
      assert.equal(typeof row.disabled, 'boolean', '候选必须带 disabled 标记（行内启停的 UI 依据）')
      assert.equal(typeof row.dead, 'boolean')
      assert.ok(typeof row.provider === 'string' && typeof row.model === 'string', '启停 RPC 需要 provider/model 字段')
    }
  })
  await check('claims 领取历史：claimAll 包装落记录（AC-17）、人为推进 lastAt 落记录（AC-18）、范围校验 400、auto-checkin.json 零触碰', async () => {
    const localDay = (at = Date.now()) => {
      const date = new Date(at)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
    const today = localDay()
    // —— AC-18（模块级，可编程 lastAt）：首轮回填不落记录，lastAt 变化才落，重复 lastAt 不重复落 ——
    const { createClaimsHistory } = await import('../packages/standalone/claims-history.mjs')
    let lastAt = 0
    let pollRounds = 0
    const poller = createClaimsHistory({
      dataDir: path.join(scratch, 'claims-poller'),
      channels: { rpc: async () => { pollRounds++; return { ok: true, value: { autoCheckin: {
        enabled: true, lastDate: '2026-11-17', lastResult: '2 个账号领取成功（500 credit）', lastAt,
        channels: [{ provider: 'trae', text: '1 个账号领取成功（500 credit）' }, { provider: 'qoder', text: '1 个账号今日已签到' }],
      } } } } },
      logger: { warn() {} },
      pollMs: 3_600_000,
    })
    await poller.poll()
    let view = poller.query({})
    assert.equal(Object.keys(view.days).length, 0, '首轮只初始化 lastSeenAt，不回填历史')
    lastAt = Date.now()
    await poller.poll()
    view = poller.query({})
    assert.equal(Object.keys(view.days).length, 1, 'lastAt 推进后必须落当日记录')
    const pollerDay = view.days[today]
    assert.ok(pollerDay, 'auto 运行记录落在本地时区当日')
    assert.deepEqual(pollerDay.providers, ['trae', 'qoder'])
    assert.equal(pollerDay.claimedCount, 2)
    assert.equal(pollerDay.events.length, 2)
    assert.equal(pollerDay.events[0].source, 'auto')
    assert.equal(pollerDay.events[0].at, lastAt)
    await poller.poll()
    assert.equal(poller.query({}).days[today].events.length, 2, 'lastAt 未变不得重复落记录')
    assert.ok(pollRounds >= 3, '每次 poll 必须真实调用 usage.autoCheckin')
    poller.dispose()

    // —— AC-17（服务级）：种子 loomy 账号走真实 credits.claimAll RPC 包装 ——
    const claimsDir = path.join(scratch, 'claims')
    fs.mkdirSync(path.join(claimsDir, 'channel-pack'), { recursive: true })
    // 模型进黑名单：claims 替身账号不得把 fixture-free 泄漏进目录，影响既有清单断言。
    fs.writeFileSync(path.join(claimsDir, 'channel-pack', 'state.json'), JSON.stringify({
      accounts: [{ id: 'loomy-fixture', provider: 'loomy', nickname: 'claims 替身账号', enabled: true, refreshable: false,
        createdAt: Date.now(), expiresAt: Date.now() + 86400000, credentialRef: 'LOOMY_ACCOUNT_FIXTURE' }],
      disabledModels: { loomy: { 'fixture-free': true } },
    }))
    const { createCredentials } = await import('../packages/standalone/channels/credentials.mjs')
    const seed = createCredentials(claimsDir)
    await seed.set('LOOMY_ACCOUNT_FIXTURE', JSON.stringify({ access_token: 'fixture-loomy', userid: 'fixture-user', phone: '13000000000', expires_at: String(Date.now() + 86400000) }))
    seed.dispose()
    // 关掉渠道包自身的自动签到首跑（环境变量仅作用于本实例的 worker），auto-checkin.json 全程零写入。
    process.env.DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS = '99999999'
    let claimsService
    try {
      claimsService = await startStandalone({ dataDir: claimsDir, port: 0, refresh: false, logger: { warn() {} } })
      await claimsService.ready
      const claimsKey = JSON.parse(fs.readFileSync(claimsService.keyFile, 'utf8')).forwardKey
      const rpc = async (method, payload) => {
        const response = await fetch(claimsService.url + '/api/management/channels/rpc', {
          method: 'POST', headers: { authorization: `Bearer ${claimsKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ method, payload }), signal: AbortSignal.timeout(20000),
        })
        return { status: response.status, value: await response.json() }
      }
      const history = async query => {
        const response = await fetch(claimsService.url + `/api/management/claims/history${query ?? ''}`, {
          headers: { authorization: `Bearer ${claimsKey}` }, signal: AbortSignal.timeout(10000),
        })
        return { status: response.status, value: await response.json() }
      }
      const autoPath = path.join(claimsDir, 'channel-pack', 'auto-checkin.json')
      const autoBefore = fs.existsSync(autoPath) ? fs.readFileSync(autoPath, 'utf8') : null
      const claim = await rpc('credits.claimAll', { provider: 'loomy' })
      assert.equal(claim.status, 200)
      assert.equal(claim.value.ok, true, JSON.stringify(claim.value))
      const outcomeKind = claim.value.value?.results?.[0]?.outcome?.kind
      assert.ok(typeof outcomeKind === 'string' && outcomeKind !== '', '替身账号必须产生 claim outcome')
      assert.equal(fs.existsSync(autoPath) ? fs.readFileSync(autoPath, 'utf8') : null, autoBefore,
        '领取历史层绝不读写渠道包的 auto-checkin.json')
      const afterClaim = await history(`?from=${today}&to=${today}`)
      assert.equal(afterClaim.status, 200)
      assert.equal(afterClaim.value.schema, 'standalone/claims-history/v1')
      const claimedDay = afterClaim.value.days[today]
      assert.ok(claimedDay, 'claimAll 后当日必须出现记录（AC-17）')
      assert.deepEqual(claimedDay.providers, ['loomy'])
      assert.equal(claimedDay.events.length, claim.value.value.results.length)
      assert.equal(claimedDay.events[0].source, 'manual')
      assert.equal(claimedDay.events[0].kind, outcomeKind)
      assert.ok(claimedDay.events[0].text.includes('claims 替身账号'))
      assert.equal(claimedDay.events.filter(row => row.kind === 'claimed').length, claimedDay.claimedCount,
        'claimedCount 只统计 kind=claimed 的渠道')
      assert.ok(fs.existsSync(path.join(claimsDir, 'claims-history.json')), '记录必须持久化落盘')
      // since 锚点：最早记录日 = 今天（三态 join 的「无数据」判据依赖它）
      assert.equal(afterClaim.value.since, today)

      // —— 范围校验 400 ——
      assert.equal((await history('?from=2026/01/01')).status, 400)
      assert.equal((await history('?from=2026-13-01')).status, 400)
      assert.equal((await history(`?from=${today}&to=2020-01-01`)).status, 400)
      assert.equal((await history('?from=2000-01-01&to=2099-12-31')).status, 400)
      assert.equal((await history('?from=2020-01-01&to=2020-01-01')).status, 200)
      // 缺省窗口（62 天）可用
      assert.equal((await history()).status, 200)
      // 日历三态：since 之后的无记录日 = 0，不是「无数据」
      const yesterday = localDay(Date.now() - 86_400_000)
      const window = await (async () => {
        // 今天有记录；昨天无记录但 since=today → 昨天属「无数据」；查询窗口内应只含今天的键
        return history(`?from=${yesterday}&to=${today}`)
      })()
      assert.deepEqual(Object.keys(window.value.days), [today])
    } finally {
      delete process.env.DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS
      await claimsService?.close()
    }
  })
  await check('设置变更重新安排周期任务且 --no-refresh 保持无自动请求', async () => {
    const nativeTimeout = globalThis.setTimeout
    let scheduled
    globalThis.setTimeout = (callback, delay, ...args) => {
      const handle = nativeTimeout(callback, delay, ...args)
      if ([12, 5].some(minutes => minutes * 60_000 === delay)) scheduled = { handle, delay }
      return handle
    }
    try {
      const before = calls
      assert.equal((await request('/api/management/settings', { body: { probeIntervalMinutes: 5 } })).status, 200)
      assert.equal(scheduled, undefined)
      assert.equal(calls, before)
      await service.close()
      service = await startStandalone({ dataDir, refresh: true, logger: { warn() {} } })
      await service.ready
      cookie = await login({ key })
      assert.equal(scheduled.delay, 5 * 60_000)
      const oldHandle = scheduled.handle
      assert.equal((await request('/api/management/settings', { body: { probeIntervalMinutes: 12, standaloneProbe: false } })).status, 200)
      assert.equal(scheduled.delay, 12 * 60_000)
      assert.equal(oldHandle._destroyed, true)
    } finally {
      globalThis.setTimeout = nativeTimeout
    }
  })
} finally {
  await service?.close()
  upstream.closeAllConnections()
  await new Promise(resolve => upstream.close(resolve))
  const cleanupTarget = fs.realpathSync(scratch)
  assert.ok(cleanupTarget.startsWith(fs.realpathSync(os.tmpdir()) + path.sep))
  fs.rmSync(cleanupTarget, { recursive: true, force: true })
}
console.log(`\nstandalone-management: ${checks - failures}/${checks} checks passed`)
process.exitCode = failures ? 1 : 0
