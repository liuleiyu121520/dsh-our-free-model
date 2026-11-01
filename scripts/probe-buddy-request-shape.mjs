/**
 * 诊断：同一时刻、同一模型、同一套桩凭据下，buddy（国内版）与
 * workbuddy（国际版）两个适配器**实际会发出的请求**逐字段对比。
 * 不碰真实凭据、不发真实请求（fetchImpl 为桩，只抓包不联网）。
 *
 *     node scripts/probe-buddy-request-shape.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ts = (await import('typescript')).default
const sourceRoot = new URL('../vendor/channel-pack/src/', import.meta.url).href
const kernel = new URL('./lib/channel-pack-kernel.mjs', import.meta.url).href
const llmKernel = `data:text/javascript,${encodeURIComponent(`
export * from ${JSON.stringify(kernel)}
export class LlmError extends Error {
  constructor(message, code, options) { super(message, options); this.code = code; this.status = options?.status }
}
`)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-llm') return { url: llmKernel, shortCircuit: true }
    if (specifier.startsWith('@deepseek-ai/')) return { url: kernel, shortCircuit: true }
    if (context.parentURL?.startsWith(sourceRoot) && specifier.endsWith('.js')) {
      const url = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL).href
      if (fs.existsSync(fileURLToPath(url))) return { url, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) {
      const source = fs.readFileSync(fileURLToPath(url), 'utf8')
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName: fileURLToPath(url),
      }).outputText }
    }
    return nextLoad(url, context)
  },
})

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ofm-buddy-shape-'))
process.env.DSH_CHANNEL_PACK_STATE_DIR = scratch
process.env.DSH_HOME = scratch

const { BuddyAdapter } = await import(new URL('buddy-adapter.ts', sourceRoot).href)
const { CODEBUDDY, WORKBUDDY } = await import(new URL('product.ts', sourceRoot).href)

const MODEL = 'deepseek-v4.1-flash'
const credential = {
  access_token: 'FIXED-PROBE-TOKEN', refresh_token: 'FIXED-REFRESH',
  domain: 'probe.invalid', expires_at: String(Date.now() + 86_400_000),
}

const captures = new Map()
function makeFetch(label) {
  return async (url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const body = JSON.parse(init.body)
    // 归一化随机量：会话/消息/请求 id 每次运行都不同，不影响结构对比。
    for (const k of ['X-Conversation-ID', 'X-Conversation-Message-ID', 'X-Conversation-Request-ID']) {
      if (headers[k]) headers[k] = '<uuid>'
    }
    if (body.prompt_cache_key) body.prompt_cache_key = '<session>'
    captures.set(label, { url: String(url), method: init.method, headers, body })
    // 返回一个立刻结束的 SSE 流，让 stream() 正常收尾。
    const sse = 'data: [DONE]\n\n'
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

async function capture(product) {
  const adapter = new BuddyAdapter({
    credentialRef: 'PROBE_REF',
    sessionId: 'fixed-probe-session-id',
    resolveCredential: async () => product.id === 'workbuddy'
      ? { ...credential, access_token: 'FIXED-WB-TOKEN', platform: 'workbuddy-ai' }
      : { ...credential, access_token: 'FIXED-BUDDY-TOKEN' },
    refresh: async () => {},
    fetchImpl: makeFetch(product.id),
    product,
  })
  try {
    for await (const _ of adapter.stream({
      provider: product.id, model: MODEL,
      system: 'You are a helpful assistant. Main branch (you will usually use this for PRs): master',
      messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
    })) { /* drain */ }
  } catch { /* [DONE] 空流可能报"无正文"，请求已抓包，忽略 */ }
  return captures.get(product.id)
}

const buddy = await capture(CODEBUDDY)
const workbuddy = await capture(WORKBUDDY)

const seen = new Set([...Object.keys(buddy.headers), ...Object.keys(workbuddy.headers)])
console.log('================ HEADERS 对比 ================')
for (const k of [...seen].sort()) {
  const a = buddy.headers[k], b = workbuddy.headers[k]
  const mark = a === b ? '  ' : '≠ '
  console.log(`${mark}${k.padEnd(28)} buddy=${JSON.stringify(a)}  workbuddy=${JSON.stringify(b)}`)
}
console.log('\n================ BODY 对比 ================')
const bkeys = new Set([...Object.keys(buddy.body), ...Object.keys(workbuddy.body)])
for (const k of [...bkeys].sort()) {
  const a = JSON.stringify(buddy.body[k]), b = JSON.stringify(workbuddy.body[k])
  console.log(`${a === b ? '  ' : '≠ '}${k.padEnd(18)} buddy=${a?.slice(0, 130)}`)
  if (a !== b) console.log(`  ${''.padEnd(18)} workb =${b?.slice(0, 130)}`)
}
console.log('\n================ URL ================')
console.log('buddy    ', buddy.url)
console.log('workbuddy', workbuddy.url)
fs.rmSync(scratch, { recursive: true, force: true })
