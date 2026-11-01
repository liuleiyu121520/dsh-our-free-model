/**
 * The restored account channels stay *in*, and the policy mechanism stays inert.
 *
 * Upstream excludes WorkBuddy's China and international builds (and Huawei
 * Cloud) at this application's management boundary. This branch restores all
 * three: the deny sets in `src/magpie-policy.js` are empty, so no listing is
 * filtered, no mutation is refused with the policy message, and no name is
 * rewritten out of third-party prose.
 *
 * The suite therefore asserts the *inverse* of upstream's contract: whatever
 * the engine answers for these channels must reach the caller untouched. It
 * also pins the mechanism itself — the filters and refusals must stay wired to
 * an empty deny set, so a later edit that repopulates it is a visible,
 * deliberate change rather than a silent regression in either direction.
 *
 * Runs against the real pinned executable, like magpie-engine-test.
 * Build first: node scripts/build-magpie-engine.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createMagpieEngine, MAGPIE_UI_PREFIX as prefix } from '../src/magpie-engine.js'
import { createMagpieModels } from '../src/magpie-models.js'
import {
  assertEngineMutation, deniedModel, filterEngineJSON, isDeniedChannel,
  policyMutation, policyResponse, POLICY_REFUSED,
} from '../src/magpie-policy.js'
import { pinnedEngineEntry } from './lib/engine-binary.mjs'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-magpie-policy-'))
const saved = new Map()
for (const [name, value] of Object.entries({
  HOME: path.join(scratch, 'native-home'),
  USERPROFILE: path.join(scratch, 'native-home'),
  XDG_CONFIG_HOME: path.join(scratch, 'native-config'),
  XDG_CACHE_HOME: path.join(scratch, 'native-cache'),
  XDG_DATA_HOME: path.join(scratch, 'native-data'),
  XDG_STATE_HOME: path.join(scratch, 'native-state'),
})) {
  saved.set(name, process.env[name])
  process.env[name] = value
  fs.mkdirSync(value, { recursive: true })
}

const PACKAGE = '@magpie-community/opencode-workbuddy-auth'
const IDS = ['workbuddy', 'workbuddy-ai']
const engine = createMagpieEngine({ dataDir: path.join(scratch, 'data'), logger: {} })
let checks = 0
const check = async (name, run) => {
  await run()
  checks++
  console.log(`ok ${checks} - ${name}`)
}
const server = http.createServer((req, res) => {
  const subpath = req.url.startsWith(prefix) ? req.url.slice(prefix.length) : req.url
  engine.proxy(req, res, subpath).catch(() => { try { res.destroy() } catch {} })
})
const listen = () => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
})
// With the deny sets emptied on this branch, no mutation may come back as a
// policy refusal. This helper keeps that distinct from any 403 the engine
// itself raises for an unrelated reason.
const refusedByPolicy = async (method, route, body) => {
  try {
    const response = await engine.request(method, route, body === undefined ? {} : { body })
    await response.text()
    return false
  } catch (error) {
    return error.statusCode === 403 && error.message === POLICY_REFUSED
  }
}

try {
  // The engine-backed groups need this platform's pinned binary; the pure-function
  // groups at the end do not, so they still run on a platform with no binary.
  const hasEngine = pinnedEngineEntry() !== null
  if (hasEngine) await engine.start()
  else console.log(`ok  engine-backed policy groups skipped: no pinned engine binary for ${process.platform}-${process.arch}`)
  const origin = hasEngine ? await listen() : null
  const base = origin === null ? null : origin + prefix
  const read = async route => {
    const response = await fetch(base + route)
    assert.equal(response.status, 200, route)
    return response.json()
  }
  const post = async (route, body) => fetch(base + route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const engineCheck = async (name, run) => {
    if (!hasEngine) return
    await check(name, run)
  }

  await engineCheck('the plugin market is served unfiltered', async () => {
    const listings = await read('api/plugins/listings')
    assert(listings.listings.length > 5, 'listings are served')
    const market = await read('api/plugins/market')
    assert(market.listings.length > 5, 'market listings are served')
    assert(Array.isArray(market.state.plugins), 'market state stays intact')
  })

  await engineCheck('search and detail pages answer for the package', async () => {
    const search = await read('api/plugins/search?q=' + encodeURIComponent('workbuddy'))
    assert(Array.isArray(search.hits), 'a search is answered, not emptied')
    const page = await fetch(base + 'api/plugins/page?name=' + encodeURIComponent(PACKAGE))
    assert.notEqual(page.status, 403, 'the detail page is no longer refused by policy')
    await page.text()
  })

  await engineCheck('provider answers reach the caller without policy removal', async () => {
    const providers = await read('api/providers')
    assert(providers.presets.length > 5, 'presets are served')
    const upstream = await read('api/upstream')
    assert(upstream && typeof upstream === 'object', 'vendor status is answered')
    // The boundary itself must add no removal of its own.
    for (const id of IDS) assert(!isDeniedChannel(id), `${id} is not denied by the restored policy`)
    assert(!isDeniedChannel('huaweicloud'), 'huaweicloud is not denied')
    assert(!isDeniedChannel('codebuddy'), 'codebuddy is not denied')
    assert(!isDeniedChannel('codearts'), 'codearts is not denied')
  })

  await engineCheck('no mutation onto a restored channel is refused by policy', async () => {
    for (const [route, body] of [
      ['/api/plugins/add', { spec: PACKAGE }],
      ['/api/plugins/upgrade', { spec: PACKAGE }],
      ['/api/plugins/off', { spec: PACKAGE, off: false }],
      ['/api/plugin-signin', { provider: IDS[0], method: 0 }],
      ['/api/plugin-signin/prompt', { provider: IDS[1], method: 0 }],
      ['/api/signin', { agent: IDS[0] }],
      ['/api/signin', { agent: IDS[1] }],
      ['/api/login/use', { agent: IDS[0], user: 'fixture' }],
      ['/api/provider/move', { id: IDS[0] }],
      ['/api/provider/save', { preset: 'huaweicloud', key: 'fixture' }],
      ['/api/provider/save', { id: 'huaweicloud', name: 'Huawei Cloud', key: 'fixture' }],
      ['/api/provider/save', { preset: 'codebuddy', key: 'fixture' }],
      ['/api/provider/save', { preset: 'codearts', key: 'fixture' }],
    ]) assert(!await refusedByPolicy('POST', route, body), `${route} ${JSON.stringify(body)} is not policy-refused`)
  })

  await engineCheck('the browser proxy passes these routes through too', async () => {
    for (const [route, body] of [
      ['api/plugins/add', { spec: PACKAGE }],
      ['api/signin', { agent: IDS[0] }],
      ['api/provider/move', { id: IDS[1] }],
    ]) {
      const response = await post(route, body)
      const text = await response.text()
      assert.doesNotMatch(text, /not offered by this build/, route)
    }
  })

  await engineCheck('unrelated work on the same routes still reaches the engine', async () => {
    const discovery = await post('api/settings/account-discovery', { off: true })
    assert.equal(discovery.status, 200, 'settings still writable')
    const settings = await read('api/settings')
    assert.equal(typeof settings.noAccountDiscovery, 'boolean', 'settings still answered')
  })

  await engineCheck('a model served through a restored channel is not dropped', async () => {
    const models = createMagpieModels({
      engine,
      stats: { record() {} },
      logger: {},
      onChanged: () => {},
    })
    try {
      await models.refresh()
      const catalog = models.catalog()
      assert(Array.isArray(catalog), 'the catalog is an array')
      assert.equal(catalog.some(row => deniedModel(row)), false, 'no catalog row is denied')
    } finally { models.close() }
  })

  await check('the policy mechanism is intact but inert', async () => {
    // The filters and refusal paths are still wired to the same routes — that is
    // what keeps the plugin and desktop surfaces in agreement — but an empty
    // deny set makes every one of them a pass-through.
    assert.equal(isDeniedChannel('workbuddy'), false, 'the china build is offered')
    assert.equal(isDeniedChannel('workbuddy-ai', 'WorkBuddy 国际版'), false, 'the international build is offered')
    assert.equal(isDeniedChannel('huaweicloud', '华为云 Huawei Cloud MaaS'), false, 'Huawei is offered')
    assert.equal(isDeniedChannel('codearts', 'CodeArts 码道'), false, 'CodeArts is offered')
    assert.equal(deniedModel({ id: 'glm-5.3-flash', owned_by: 'workbuddy' }), false, 'models are not dropped')
    const listings = { listings: [
      { package: PACKAGE, name: 'WorkBuddy', providers: IDS },
      { package: '@magpie-community/opencode-zcode-auth', name: 'ZCode', providers: ['zcode'] },
    ] }
    const filtered = filterEngineJSON('/api/plugins/listings', structuredClone(listings))
    assert.deepEqual(filtered.listings.map(row => row.package),
      [PACKAGE, '@magpie-community/opencode-zcode-auth'], 'every listing passes through')
    const unknown = { anything: 1 }
    assert.equal(filterEngineJSON('/api/settings', unknown), unknown, 'other routes pass through')
    assert.doesNotThrow(() => assertEngineMutation('POST', '/api/plugins/add', { spec: PACKAGE }), 'no refusal')
    assert.doesNotThrow(() => assertEngineMutation('POST', '/api/provider/save', { preset: 'huaweicloud', key: 'k' }))
    // Routes that used to need body buffering still answer the same way, so the
    // wiring (and its tests) did not silently disappear with the deny set.
    assert.equal(policyMutation('POST', '/api/plugins/add'), true, 'the route is still recognised')
    assert.equal(policyResponse('/api/providers'), true, 'the filter table is still in place')
  })

  await check('third-party prose keeps its own wording, unredacted', async () => {
    // The rewrite existed only because the names had to stay out of the user's
    // sight. Restored, the boundary passes text through verbatim.
    const agentOffice = {
      package: '@magpie-community/page-agent-office', name: 'Agent Office', community: true, kind: 'page',
      summary: {
        en: 'Reads the session files of Claude Code, Codex, WorkBuddy and CodeBuddy on this computer.',
        zh: '读取本机 Claude Code、Codex、WorkBuddy、CodeBuddy 的会话文件。',
      },
    }
    const filtered = filterEngineJSON('/api/plugins/listings', {
      listings: [structuredClone(agentOffice), { package: PACKAGE, name: 'WorkBuddy', providers: IDS }],
    })
    assert.equal(filtered.listings.length, 2, 'nothing is dropped')
    assert.match(filtered.listings[0].summary.en, /WorkBuddy/, 'the english prose is untouched')
    assert.match(filtered.listings[0].summary.zh, /WorkBuddy/, 'the chinese prose is untouched')
    const npm = filterEngineJSON('/api/plugins/npm',
      { npm: { [agentOffice.package]: { description: agentOffice.summary.en } } })
    assert.equal(npm.npm[agentOffice.package].description.includes('WorkBuddy'), true, 'npm prose is untouched')
  })

  await check('the disclaimer names the restored channels and the risk boundary', async () => {
    const { DISCLAIMER, DISCLAIMER_VERSION, EXCLUDED_CHANNELS, RESTORED_CHANNELS } = await import('../src/disclaimer.js')
    assert.equal(DISCLAIMER.version, DISCLAIMER_VERSION)
    assert.deepEqual(EXCLUDED_CHANNELS, [], 'nothing is withheld on this branch')
    const named = RESTORED_CHANNELS.join(' ').toLowerCase()
    for (const channel of ['workbuddy', 'workbuddy-ai', 'codebuddy', 'huaweicloud', 'codearts']) {
      assert.match(named, new RegExp(channel), `the disclaimer names ${channel}`)
    }
    const body = DISCLAIMER.sections.map(section => section.body).join(' ')
    assert.match(body, /重新提供/, 'it says the build offers them again')
    assert.match(body, /与本项目作者及团队无关/, 'it states the team is not responsible')
    assert.match(body, /个人学习/, 'it states the project purpose')
    assert.match(body, /自行承担/, 'it places the consequences on the user')
  })

  console.log(`magpie-policy: ${checks} checks passed`)
} finally {
  await engine.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  fs.rmSync(scratch, { recursive: true, force: true })
}
