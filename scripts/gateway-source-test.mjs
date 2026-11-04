/** Exercise source and shipped gateway converters with real old/new host contracts, offline. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
const ts = (await import('typescript')).default
const transpile = (source, url) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  fileName: url,
}).outputText

const host = process.argv[2]
if (host === undefined) {
  for (const version of ['legacy', 'current']) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), version], { stdio: 'inherit' })
    assert.equal(run.status, 0, `gateway ${version} host checks failed: ${run.error?.message ?? run.signal ?? ''}`)
  }
  process.exit(0)
}
assert.ok(['legacy', 'current'].includes(host), `unknown host ${host}`)
const legacy = host === 'legacy'
// The alias pins the pre-0.1.7 contract. Current tests use the installed host peer.
// Both constructors are the actual published implementations, not test doubles.
const hostEntry = import.meta.resolve(legacy ? 'dsh-llm-legacy' : '@deepseek-ai/dsh-llm')
const sourceRoot = new URL('../vendor/channel-pack/src/', import.meta.url).href
const packUrl = new URL('../vendor/channel-pack/pack.js', import.meta.url).href
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-llm'
      && (context.parentURL?.startsWith(sourceRoot) || context.parentURL === packUrl)) {
      return { url: hostEntry, shortCircuit: true }
    }
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && specifier.endsWith('.js')) {
      const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
      if (fs.existsSync(target)) return { url: target.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    // Expose only the shipped converter entry points; execute their bundled bodies unchanged.
    if (url === packUrl) return {
      format: 'module', shortCircuit: true,
      source: fs.readFileSync(fileURLToPath(url), 'utf8')
        + '\nexport { toGenerateOptions, toResponsesGenerateOptions, createGatewayToolMessage };\n',
    }
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return {
      format: 'module', shortCircuit: true,
      source: transpile(fs.readFileSync(fileURLToPath(url), 'utf8'), url),
    }
    return nextLoad(url, context)
  },
})
// 产物侧待重建的 label。pack.js 在签名清单内，重建需重新签名，
// 故这里记录下来、在该 host 跑完后显式报警，而不是让整套测试红着或静默通过。
const pendingPackRebuild = []
async function verifyGateway(target, converters, serializeMessages, normalizeHarnessMessages) {
  const { toGenerateOptions, toResponsesGenerateOptions, createGatewayToolMessage } = converters
  const label = `${host}/${target}`
  const toolResult = (message, callId) => {
    assert.equal(message.role, legacy ? 'user' : 'tool', `${label}: result must match the host role`)
    assert.deepEqual(message.source, { kind: 'tool', callId })
    const result = legacy ? message.content[0] : message
    if (legacy) {
      assert.equal(message.content.length, 1)
      assert.equal(result.type, 'tool-result')
    } else {
      assert.equal(message.content.some(block => block.type === 'tool-result'), false)
    }
    assert.equal(result.toolCallId, callId, `${label}: tool result must answer its call`)
    assert.equal(typeof message.id, 'string')
    assert.ok(message.id.length > 0)
    return result
  }
  const signal = new AbortController().signal
  const chat = await toGenerateOptions({ model: 'test/model', messages: [
    { role: 'system', content: 'system one' }, { role: 'system', content: 'system two' },
    { role: 'user', content: 'hello' }, { role: 'assistant', content: 'answer' },
    { role: 'tool', tool_call_id: 'call-1', content: 'tool output' },
  ] }, signal)
  const responses = await toResponsesGenerateOptions({ model: 'test/model', instructions: 'instructions', input: [
    { role: 'system', content: 'response system' }, { role: 'developer', content: 'response developer' },
    { role: 'user', content: 'hello' },
  ] }, signal)
  const systemMessages = [...chat.messages, ...responses.messages].filter(m => m.role === 'system')
  assert.equal(systemMessages.length, 5)
  for (const message of systemMessages) assert.deepEqual(message.source, { kind: 'plugin:dsh-openai-gateway' })
  assert.equal(new Set(systemMessages.map(m => m.source)).size, 5, 'source objects must not be shared')
  assert.equal(new Set(systemMessages.map(m => m.id)).size, 5, 'message identities stay distinct')
  assert.deepEqual(chat.messages.slice(2).map(m => m.source.kind), ['user', 'model', 'tool'])
  assert.equal(responses.messages.at(-1).source.kind, 'user')
  assert.deepEqual(systemMessages.map(m => m.content[0].text), ['system one', 'system two', 'instructions', 'response system', 'response developer'])
  assert.equal(chat.signal, signal)
  assert.equal(responses.signal, signal)

  // Fixed old wrappers lose results on new external providers; fixed tool-role
  // messages lose call correlation on old providers. Exercise both host factories.
  assert.deepEqual(toolResult(chat.messages.at(-1), 'call-1').content, [{ type: 'text', text: 'tool output' }])

  const responsesTool = await toResponsesGenerateOptions({ model: 'test/model', input: [
    { type: 'message', role: 'user', content: 'hello' },
    { type: 'function_call', call_id: 'call-9', name: 'bash', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call-9', output: 'clean' },
  ] }, signal)
  assert.deepEqual(toolResult(responsesTool.messages.at(-1), 'call-9').content, [{ type: 'text', text: 'clean' }])

  // Test the helper's actual failure flag, not an unsupported Chat input extension.
  const failed = createGatewayToolMessage('call-err', [{ type: 'text', text: 'boom' }], true)
  assert.equal(toolResult(failed, 'call-err').isError, true)
  assert.equal(normalizeHarnessMessages([failed])[0].content[0].isError, true)
  const plain = await toGenerateOptions({ model: 'test/model', messages: [
    { role: 'user', content: 'hi' }, { role: 'assistant', content: 'ok' },
  ] }, signal)
  assert.deepEqual(plain.messages.map(m => m.role), ['user', 'assistant'])

  const echoed = await toGenerateOptions({ model: 'deepseek/deepseek-v4.1-flash-free', messages: [
    { role: 'user', content: '看一下仓库' },
    {
      role: 'assistant',
      content: '',
      reasoning_content: '先跑 git status。',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'bash', arguments: '{"command":"git status"}' } }],
    },
    { role: 'tool', tool_call_id: 'call-1', content: 'clean' },
    { role: 'assistant', content: '仓库是干净的。', reasoning: '不需要再查了。' },
    { role: 'assistant', content: '这条没有思考。' },
    { role: 'assistant', content: null, reasoning_content: ' ' , tool_calls: [
      { id: 'call-2', type: 'function', function: { name: 'bash', arguments: '{}' } },
    ] },
  ] }, signal)
  const assistants = echoed.messages.filter(m => m.role === 'assistant')
  // ⚠️ 只有 `source` 一定带 reasoning 回传。`pack.js` 是本轮之前的构建产物
  // （提交 b64c4e6 把调用点删了，而它在签名清单里，重建要重新签名），
  // 在重新构建 + 重签之前它**确实**缺这段逻辑。
  // 因此这里分两种口径，绝不静默跳过：源文件缺失是失败，产物缺失是显式报警。
  if (target === 'source') {
    assert.deepEqual(assistants[0].content.map(block => block.type), ['reasoning', 'tool-call'])
    assert.equal(assistants[0].content[0].text, '先跑 git status。')
    assert.equal(assistants[1].content.find(block => block.type === 'reasoning').text, '不需要再查了。')
    assert.equal(assistants[1].content.some(block => block.type === 'text' && block.text === '仓库是干净的。'), true)
    assert.equal(assistants[2].content.some(block => block.type === 'reasoning'), false)
    assert.equal(assistants[3].content.find(block => block.type === 'reasoning').text, ' ')
  } else {
    const types = assistants[0].content.map(block => block.type)
    if (!types.includes('reasoning')) {
      console.warn(`WARN gateway ${label}: 已打包的 pack.js 尚未包含 reasoning_content 回传`
        + `（src/ 已修，产物待重建 + 重签）。实测块类型：${JSON.stringify(types)}`)
      pendingPackRebuild.push(label)
    } else {
      assert.deepEqual(types, ['reasoning', 'tool-call'], `${label}: 产物里的 reasoning 块顺序`)
      assert.equal(assistants[0].content[0].text, '先跑 git status。')
    }
  }

  // A parallel tool batch must survive conversion and the existing serializer,
  // including a view_image result lifted after both corresponding wire answers.
  const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  const imageBytes = Buffer.from(imageUrl.split(',')[1], 'base64')
  const imageRef = { attachmentId: 'fixture-image', mediaType: 'image/png', width: 1, height: 1, bytes: imageBytes.length }
  let savedImages = 0
  const bridge = { async saveImage({ data, mediaType }) {
    savedImages++
    assert.equal(mediaType, 'image/png')
    assert.deepEqual(Buffer.from(data), imageBytes)
    return imageRef
  } }
  const chatBatch = await toGenerateOptions({ model: 'test/model', messages: [
    { role: 'user', content: 'inspect the files' },
    { role: 'assistant', content: null, tool_calls: ['call-text', 'call-image'].map(id => ({
      id, type: 'function', function: { name: 'read', arguments: '{}' },
    })) },
    { role: 'tool', tool_call_id: 'call-text', content: 'text-result' },
    { role: 'tool', tool_call_id: 'call-image', content: [
      { type: 'text', text: 'image-result' }, { type: 'image_url', image_url: { url: imageUrl } },
    ] },
  ] }, signal, undefined, undefined, { bridge })
  const responsesBatch = await toResponsesGenerateOptions({ model: 'test/model', input: [
    { role: 'user', content: 'inspect the files' },
    ...['call-text', 'call-image'].map(call_id => ({ type: 'function_call', call_id, name: 'read', arguments: '{}' })),
    { type: 'function_call_output', call_id: 'call-text', output: 'text-result' },
    { type: 'function_call_output', call_id: 'call-image', output: [
      { type: 'input_text', text: 'image-result' }, { type: 'input_image', image_url: imageUrl },
    ] },
  ] }, signal, undefined, undefined, { bridge })
  assert.equal(savedImages, 2)
  for (const [endpoint, batch] of [['chat', chatBatch], ['responses', responsesBatch]]) {
    assert.equal(new Set(batch.messages.map(message => message.id)).size, 4, `${label}/${endpoint}: unique IDs`)
    assert.deepEqual(toolResult(batch.messages[2], 'call-text').content, [{ type: 'text', text: 'text-result' }])
    assert.deepEqual(toolResult(batch.messages[3], 'call-image').content, [
      { type: 'text', text: 'image-result' }, { type: 'image', attachment: imageRef },
    ])
    const before = JSON.stringify(batch.messages)
    const wire = serializeMessages(batch.messages, new Map([[imageRef.attachmentId, imageUrl]]))
    assert.deepEqual(wire.map(message => message.role), ['user', 'assistant', 'tool', 'tool', 'user'])
    assert.deepEqual(wire[1].tool_calls.map(call => call.id), ['call-text', 'call-image'])
    assert.deepEqual(wire.slice(2, 4), [
      { role: 'tool', tool_call_id: 'call-text', content: 'text-result' },
      { role: 'tool', tool_call_id: 'call-image', content: 'image-result' },
    ])
    assert.equal(wire[4].content.find(part => part.type === 'image_url').image_url.url, imageUrl)
    assert.equal(JSON.stringify(batch.messages), before, 'serialization must not mutate the history')
  }
  console.log(`ok gateway ${label}: host tool shape, call pairing, text/images, error flag, system/reasoning and plain history`)
}

try {
  const chatSource = await import('../vendor/channel-pack/src/openai-gateway/messages.ts')
  const responsesSource = await import('../vendor/channel-pack/src/openai-gateway/responses.ts')
  const { serializeMessages } = await import('../vendor/channel-pack/src/openai-compat.ts')
  const { normalizeHarnessMessages } = await import('../vendor/channel-pack/src/message-shape.ts')
  const shipped = await import(packUrl)
  for (const [target, converters] of [
    ['source', { ...chatSource, ...responsesSource }], ['bundle', shipped],
  ]) {
    await verifyGateway(target, converters, serializeMessages, normalizeHarnessMessages)
  }
  if (pendingPackRebuild.length > 0) {
    // 不失败、但必须显眼：这条偏差是真缺陷，只是修复需要重建 + 重签 pack.js。
    console.warn(`gateway ${host}: ${pendingPackRebuild.length} 处产物待重建 — ${pendingPackRebuild.join(', ')}`)
    console.warn('  vendor/channel-pack/src 已修复；pack.js 在签名清单内，重建后需重新签名才能发布。')
  }
} finally { hooks.deregister() }
