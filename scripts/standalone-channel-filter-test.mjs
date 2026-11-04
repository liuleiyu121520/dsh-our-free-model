import assert from 'node:assert/strict'
import fs from 'node:fs'

/**
 * 渠道页现在是「展平列表」：所有渠道卡片直接铺开，行内即可展开账号与模型，
 * 不再有搜索框、也没有「全部/已接入/未连接」筛选条。
 *
 * 这个套件原先验证那套筛选的计算（分类计数不随选中项变化、搜索结果数单独
 * 展示等）。筛选 UI 与逻辑都按使用反馈移除之后，那些断言的前提不存在了；
 * 现在改为钉住新契约：**筛选确实不再存在，且列表是全量铺开**，防止哪天有人
 * 把旧的分页/筛选结构又加回来。
 */
const source = fs.readFileSync(new URL('../packages/standalone/frontend/components/channel-browser.tsx', import.meta.url), 'utf8')

export function verifyChannelFilters() {
  // 列表必须直接遍历全部渠道，而不是经过 rows = providers.filter(...)。
  assert.match(source, /const rows = providers\s*$/m, '渠道列表不得再对 providers 做筛选')
  // 只允许「统计已接入数量」那种 filter，不允许把过滤结果当作列表行。
  assert.equal(/const rows = providers\.filter\(/.test(source), false, '列表行不得来自筛选结果')

  // 旧的筛选与搜索 UI 不得回潮。
  assert.equal(/setFilter\(/.test(source), false, '渠道状态筛选应已移除')
  assert.equal(/channel-filters/.test(source), false, '渠道筛选条应已移除')
  assert.equal(/搜索渠道/.test(source), false, '渠道搜索框应已移除')
  assert.equal(/classifier|channel-search/.test(source), false, '渠道搜索容器应已移除')

  // 展平的关键：卡片直接内联，且不再跳转二级页。
  assert.equal(/provider-detail/.test(source), false, '不应保留二级详情页')
  assert.match(source, /shared\.ChannelCard/, '渠道卡片必须直接铺在列表上')
  assert.match(source, /channel-flat-list/, '列表必须使用展平后的容器类名')
  assert.equal(/select\(provider\.id\)/.test(source), false, '不应再有「点进某个渠道」的跳转')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyChannelFilters()
  console.log('standalone-channel-filter: 渠道页已展平，无筛选、无二级页')
}
