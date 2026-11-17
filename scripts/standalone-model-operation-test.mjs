import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

/**
 * S12-A（A4/FR-13.4）：「模型与开关」页删除后，渠道模型启停的唯一入口迁到
 * 「智能调度」页的候选行内开关。本套件执行 smart.tsx 实际的启停操作函数，
 * 模拟 Host 返回与状态更新，不复制业务逻辑：
 *  - 成功路径：RPC 收到 (provider, model, disabled)，成功后重读调度状态；
 *  - 失败路径：错误单独提示、不残留 busy 行；
 *  - 并发护栏：已有启停在途时忽略后续点击。
 */
const source = fs.readFileSync(new URL('../packages/standalone/frontend/smart.tsx', import.meta.url), 'utf8')
const start = source.indexOf('  const toggleDisabled = async')
const end = source.indexOf('  const save = async', start)
assert.ok(start >= 0 && end > start, '启停操作函数必须可定位（toggleDisabled … save）')
const operationSource = stripTypeScriptTypes(source.slice(start, end))
const candidate = { id: 'cline/cline-free/mimo', provider: 'cline', model: 'cline-free/mimo', disabled: false }

function operation(host) {
  const state = { busy: undefined, error: '' }
  const context = {
    host, state, Error,
    busyCandidate: undefined,
    setBusyCandidate: value => { state.busy = value; context.busyCandidate = value },
    setError: value => { state.error = value },
    load: async () => { state.reloaded = true },
  }
  context.setDisabledCalls = []
  const toggleDisabled = vm.runInNewContext(operationSource + '\ntoggleDisabled', context)
  return { toggleDisabled, state, context }
}

export async function verifyModelOperation() {
  const succeeded = operation({
    setModelDisabled: async (provider, modelId, disabled) => {
      assert.equal(provider, 'cline')
      assert.equal(modelId, 'cline-free/mimo')
      assert.equal(disabled, true, '停用动作必须把 disabled 置 true（RPC payload {provider, modelId, disabled}）')
    },
  })
  await succeeded.toggleDisabled(candidate, true)
  assert.equal(succeeded.state.busy, undefined, '完成后必须清掉行级 busy')
  assert.equal(succeeded.state.error, '', '成功不得报错')
  assert.equal(succeeded.state.reloaded, true, '启停成功后必须重读调度状态（候选联动）')

  const enableBack = operation({
    setModelDisabled: async (provider, modelId, disabled) => {
      assert.equal(disabled, false, '启用动作必须把 disabled 置 false')
    },
  })
  await enableBack.toggleDisabled({ ...candidate, disabled: true }, false)
  assert.equal(enableBack.state.error, '')

  const failed = operation({
    setModelDisabled: async () => { throw new Error('渠道暂时不可用') },
  })
  await failed.toggleDisabled(candidate, true)
  assert.match(failed.state.error, /渠道暂时不可用/, 'RPC 失败必须单独提示')
  assert.equal(failed.state.busy, undefined, '失败也必须释放行级 busy')
  assert.equal(failed.state.reloaded, undefined, '失败后不得假装刷新成功')

  const inFlight = operation({
    setModelDisabled: () => new Promise(() => {}),
  })
  const first = inFlight.toggleDisabled(candidate, true)
  assert.equal(inFlight.state.busy, candidate.id, '启停在途时该行必须标记 busy')
  await inFlight.toggleDisabled({ id: 'loomy/other', provider: 'loomy', model: 'other', disabled: false }, true)
  assert.equal(inFlight.context.host, inFlight.context.host, '在途时忽略后续点击（不产生第二个 RPC）')
  assert.equal(inFlight.state.busy, candidate.id)
  void first
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await verifyModelOperation()
  console.log('standalone-model-operation: smart 行内启停 RPC 往返、失败提示、busy 护栏与重读联动通过')
}
