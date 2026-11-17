import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { computeMembership } from '../src/core/runtime.js'
import { publicModelVisibility, validateModelVisibility } from '../src/store.js'
import { filterModels } from '../packages/standalone/frontend/models-data.mjs'

// S12-A：对比集收缩到仍在 standalone 前端真实使用的共享组件——渠道页的
// ChannelCard 与 DICT。快照（E-10）里冻结的其余插件组件（Shell/FreePage/
// Roster/ModelCard/Preferences/ModelPicker/ChainEditor* 等）不再进入对比集。
const source = fs.readFileSync(new URL('./lib/standalone-shared-ui.source.js', import.meta.url), 'utf8')
  .replace('exports.__test = {', 'exports.__test = { ChannelCard, DICT,')
let bundle
const window = {
  __ModuleLoader__: { load: value => { bundle = value } },
  localStorage: { getItem: () => null },
}
let cursor = 0
const cells = []
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: 'fragment',
  useState(initial) {
    const at = cursor++
    if (!(at in cells)) cells[at] = typeof initial === 'function' ? initial() : initial
    return [cells[at], value => { cells[at] = typeof value === 'function' ? value(cells[at]) : value }]
  },
  useRef(initial) { const at = cursor++; return cells[at] ??= { current: initial } },
  useEffect() {},
  useMemo: callback => callback(),
  useCallback: callback => callback,
}
new Function('window', 'fetch', source)(window, async () => ({ ok: true, text: async () => '{}' }))
const { ChannelCard, DICT } = bundle.factory(() => react).__test
const t = key => DICT.zh[key] ?? key
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.children)] : []
const render = (Component, props) => { cursor = 0; return Component(props) }

cells.length = 0
let models = [{ id: 'retired', dead: true, disabled: true }]
let accounts = [{ id: 'account', nickname: 'Fixture', enabled: true }]
const rpcCalls = []
let changed = 0
const channelProps = {
  t, channel: { id: 'lobsterai', name: 'LobsterAI' }, status: {},
  onError: (_provider, error) => { throw error },
  onChanged: () => { changed++ },
  rpc: async (method, payload) => {
    rpcCalls.push({ method, payload })
    if (method === 'model.clearDead') models = models.map(model => ({ ...model, dead: false }))
    if (method === 'model.setDisabled') models = models.map(model => ({ ...model, disabled: payload.disabled }))
    if (method === 'account.update') accounts = accounts.map(row => ({ ...row, ...payload.patch }))
    return { models, accounts }
  },
}
const button = (tree, text) => nodes(tree).find(node => node.type === 'button' && node.children.includes(text))
let card = render(ChannelCard, channelProps)
await button(card, '模型').props.onClick()
card = render(ChannelCard, channelProps)
assert.ok(nodes(card).some(node => node.children.includes('已隐藏')))
await button(card, '恢复显示').props.onClick()
assert.equal(rpcCalls.find(call => call.method === 'model.clearDead').payload.modelId, 'retired')
assert.equal(models[0].disabled, true, 'restoring a retired model preserves the user blacklist')
assert.equal(rpcCalls.some(call => call.method === 'model.setDisabled'), false)
card = render(ChannelCard, channelProps)
await button(card, '开启').props.onClick()
assert.equal(models[0].disabled, false)
card = render(ChannelCard, channelProps)
await button(card, '账号').props.onClick()
card = render(ChannelCard, channelProps)
assert.ok(nodes(card).some(node => node.children.includes('已启用')))
await button(card, '停用').props.onClick()
card = render(ChannelCard, channelProps)
assert.ok(nodes(card).some(node => node.children.includes('已停用')))
assert.ok(button(card, '启用'))
assert.equal(changed, 3)
console.log('ok  client account action labels, hidden status and retired model restoration')

const catalog = [
  { id: 'free' }, { id: 'region' }, { id: 'kilo', channel: 'kilo' },
  { id: 'eac', channel: 'eac' }, { id: 'aggregate', channel: 'aggregate' },
  { id: 'combo', channel: 'combo' }, { id: 'account', channel: 'lobsterai' },
]
const refused = { results: { free: { state: 'unavailable' }, region: { state: 'unavailable' } } }
const membership = settings => Object.values(computeMembership(catalog, refused, settings)).flat()
assert.deepEqual(membership({}), catalog.map(row => row.id), 'default fallback preserves the advertised catalog')
assert.deepEqual(membership({ hideFreeModels: true }), ['eac', 'aggregate', 'combo', 'account'])
assert.deepEqual(membership({ hideEacModels: true, hiddenModelIds: ['free'] }), ['region', 'kilo', 'aggregate', 'combo', 'account'])
assert.deepEqual(membership({ hideFreeModels: true, hideEacModels: true, hiddenModelIds: ['combo'] }), ['aggregate', 'account'],
  'refusedAll cannot restore preferences; unrelated channels remain isolated')
const region = computeMembership(catalog, { results: { region: { state: 'region-blocked' } } }, { hiddenModelIds: ['region'] })
assert.equal(Object.values(region).flat().includes('region'), false)
for (const patch of [{ hideFreeModels: 1 }, { hideEacModels: null }, { hiddenModelIds: [''] }, { hiddenModelIds: [3] }, null, []]) {
  assert.throws(() => validateModelVisibility(patch), error => error.statusCode === 400)
}
assert.deepEqual(publicModelVisibility({ hiddenModelIds: ['free', 'free', null], forwardKey: 'private' }),
  { hiddenModelIds: ['free'], hideFreeModels: false, hideEacModels: false })
assert.equal(filterModels(catalog.map(row => ({ ...row, routable: true })), { channel: 'eac' }).length, 1, 'filterModels 渠道过滤仍与共享目录口径一致')
console.log('ok  visibility fallback isolation, validation and shared catalog filter')
