/**
 * S12-A（A4/FR-13.4）：「模型与开关」页删除后，启停断言迁移到「智能调度」页。
 * 在内存构建 smart.tsx，对着真实 startStandalone 服务（渠道替身 + loomy 账号种子）
 * 验证行内启停开关的 RPC 往返与候选联动；无需生成 web 资源。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const standaloneRequire = createRequire(new URL('../packages/standalone/package.json', import.meta.url))
const { build } = standaloneRequire('esbuild')
let chromium = null
try {
  ;({ chromium } = require(process.env.OFM_PLAYWRIGHT_MODULE ?? 'playwright'))
} catch {
  console.log('ok  standalone-model-row skipped: playwright is not installed (browser-dependent check)')
  process.exit(0)
}

const frontend = fileURLToPath(new URL('../packages/standalone/frontend/', import.meta.url))
const logger = { warn() {} }

// —— 本机替身上游：loomy 风格 /models 清单 + 空缺省，零外网。 ——
const fixtureServer = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.url.endsWith('/models')) {
      json({ data: [{ id: 'fixture-free', name: '本机 Loomy 模型', type: 'chat', context_length: 128000 }] })
      return
    }
    if (req.url.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end([`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\n`,
        'data: [DONE]\n\n'].join(''))
      return
    }
    json({ data: [] })
  })
})
await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve))
const fixture = `http://127.0.0.1:${fixtureServer.address().port}`

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-smart-row-'))
const dataDir = path.join(scratch, 'data')
const dshHome = path.join(scratch, 'dsh')
fs.mkdirSync(path.join(dshHome, 'our-free-model'), { recursive: true })
fs.writeFileSync(path.join(dshHome, '.credentials.yaml'), 'SENTINEL_DO_NOT_READ')
process.env.OFM_TEST_UPSTREAM = fixture
process.env.OUR_FREE_MODEL_BASE = fixture
process.env.OUR_FREE_MODEL_KILO_BASE = fixture
process.env.DSH_HOME = dshHome
process.execArgv.push('--import', new URL('./lib/standalone-channel-fixture.mjs', import.meta.url).href)
await import('./lib/standalone-channel-fixture.mjs')
const { startStandalone } = await import('../packages/standalone/service.mjs')
fs.mkdirSync(path.join(dataDir, 'channel-pack'), { recursive: true })
fs.writeFileSync(path.join(dataDir, 'channel-pack', 'state.json'), JSON.stringify({
  accounts: [{ id: 'loomy-fixture', provider: 'loomy', nickname: '启停替身账号', enabled: true, refreshable: false,
    createdAt: Date.now(), expiresAt: Date.now() + 86400000, credentialRef: 'LOOMY_ACCOUNT_FIXTURE' }],
  disabledModels: {},
}))
const { createCredentials } = await import('../packages/standalone/channels/credentials.mjs')
const seed = createCredentials(dataDir)
await seed.set('LOOMY_ACCOUNT_FIXTURE', JSON.stringify({ access_token: 'fixture-loomy', userid: 'fixture-user', phone: '13000000000', expires_at: String(Date.now() + 86400000) }))
seed.dispose()

let service
let browser
try {
  service = await startStandalone({ dataDir, port: 0, refresh: false, logger })
  await service.ready
  const key = JSON.parse(fs.readFileSync(service.keyFile, 'utf8')).forwardKey
  const statePath = path.join(dataDir, 'channel-pack/state.json')
  const disabledMap = () => JSON.parse(fs.readFileSync(statePath, 'utf8')).disabledModels?.loomy ?? {}

  const bundle = await build({
    stdin: {
      resolveDir: frontend, sourcefile: 'smart-row-fixture.tsx', loader: 'tsx', contents: [
        "import { createRoot } from 'react-dom/client'",
        "import { Smart } from './smart'",
        "const root = createRoot(document.getElementById('root'))",
        'async function request(endpoint, body, timeoutMs, signal) {',
        '  const response = await fetch("/api/management" + endpoint, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs ?? 10000)]) : AbortSignal.timeout(timeoutMs ?? 10000) })',
        '  const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error ?? "请求失败"), { status: response.status }); return value',
        '}',
        'async function loadData() {}',
        'const host = { navigate() {}, refresh: loadData, copy: async () => {}, getApiKey: async () => "", rotateKey: async () => "", logout: async () => {}, error: error => { window.rowError = String(error?.message ?? error) },',
        '  setModelDisabled: (provider, modelId, disabled) => request("/channels/rpc", { method: "model.setDisabled", payload: { provider, modelId, disabled } }, 20000),',
        '  saveSettings: async () => { throw new Error("unexpected settings write") },',
        '  smartState: () => request("/smart/state", undefined, 20000),',
        '  saveSmartPool: async models => request("/smart/pool", { models }, 20000),',
        '  claimsHistory: (from, to) => request(`/claims/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, undefined, 20000) }',
        'let summary = await request("/summary"); window.rowSummary = summary',
        'const render = () => root.render(<Smart summary={summary} stats={{}} host={host} active={true} />)',
        'window.rowReload = async () => { summary = await request("/summary"); render() }',
        'render()',
      ].join('\n'),
    },
    bundle: true, write: false, outfile: path.join(frontend, 'smart-row-fixture.js'), format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).contents
  const smartCss = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
  const baseCss = fs.readFileSync(path.join(frontend, 'app.css'), 'utf8').replace(/^@import[^\n]*\n/, '')

  browser = await chromium.launch({ headless: true, ...(process.env.OFM_BROWSER_PATH ? { executablePath: process.env.OFM_BROWSER_PATH } : {}) })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const errors = []
  const external = []
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== service.url) { external.push(route.request().url()); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  // 页面挂在真实服务域下（/row-test 由 management 之外的兜底 404 提供不行——
  // 这里直接用 playwright fulfill 两个 URL），API 相对路径自然同源。
  await page.route(`${service.url}/row-test`, route => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseCss}\n${smartCss}</style></head><body><div id="root"></div><script src="/row-test.js"></script></body></html>`,
  }))
  await page.route(`${service.url}/row-test.js`, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: script }))

  await page.goto(`${service.url}/row-test`)
  const row = page.locator('.smart-candidate').filter({ hasText: 'loomy/fixture-free' })
  await row.waitFor()
  await page.getByTestId('smart-ready').waitFor()
  assert.equal(await row.locator('.smart-accounts').textContent(), '1/1 账号可用')

  // 启停开关键盘可达（真实 <button> + aria-label），停用 → RPC 落盘 → 行内状态翻转。
  const disable = row.getByRole('button', { name: '停用 loomy/fixture-free', exact: true })
  await disable.focus()
  await page.keyboard.press('Enter')
  await row.getByRole('button', { name: '启用 loomy/fixture-free', exact: true }).waitFor()
  assert.equal(disabledMap()['fixture-free'], true, '停用必须经 model.setDisabled 落盘到 channel-pack state')
  assert.ok(await row.locator('.smart-tag.is-disabled-tag').textContent() === '已停用')
  assert.equal(await row.getByRole('button', { name: '把 loomy/fixture-free 加入调度池', exact: true }).count(), 0,
    '停用条目不得再提供「加入调度池」')

  const enable = row.getByRole('button', { name: '启用 loomy/fixture-free', exact: true })
  await enable.click()
  await row.getByRole('button', { name: '停用 loomy/fixture-free', exact: true }).waitFor()
  assert.equal(disabledMap()['fixture-free'], undefined, '启用必须清除停用标记')
  assert.equal(await row.locator('.smart-tag.is-disabled-tag').count(), 0)

  // 池状态与候选联动：停用后 smart 状态面必须反映（候选 disabled 标记）。
  await row.getByRole('button', { name: '停用 loomy/fixture-free', exact: true }).click()
  await row.getByRole('button', { name: '启用 loomy/fixture-free', exact: true }).waitFor()
  const smartState = await (await fetch(`${service.url}/api/management/smart/state`)).json()
  const candidate = smartState.candidates.find(row => row.id === 'loomy/fixture-free')
  assert.equal(candidate?.disabled, true, 'smart 状态候选必须反映停用（调度面随之跳过）')
  await row.getByRole('button', { name: '启用 loomy/fixture-free', exact: true }).click()
  await row.getByRole('button', { name: '停用 loomy/fixture-free', exact: true }).waitFor()

  assert.deepEqual(errors, [], '真实 React 不得出现运行错误')
  assert.deepEqual(external, [], '测试仅访问本机')
  console.log('ok  smart 行内启停：RPC 往返落盘、候选联动、键盘可达、按钮 aria 语义完整')
  await context.close()
} finally {
  await browser?.close()
  await service?.close()
  fixtureServer.closeAllConnections()
  await new Promise(resolve => fixtureServer.close(resolve))
  assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()))
  fs.rmSync(scratch, { recursive: true, force: true })
}
