/**
 * Gemini 工具参数 schema 清洗的离线契约测试。
 *
 * 起因（2026-11-04 实机）：DSH 里选 Gemini 3.8 Flash 调用，整轮 400：
 *
 * ```
 * GenerateContentRequest.tools[0].function_declarations[20].parameters
 *   .properties[source_paths].items.items: field predicate failed: $type == Type.ARRAY
 * GenerateContentRequest...properties[allowed_origins].items.items: ...
 * GenerateContentRequest...properties[functions].items.items: ...
 * ```
 *
 * 这条错误由 DSH 自己的 MCP / REA 工具参数触发（普通对话不会），所以它既不
 * 是账号问题也不是模型问题——是**发出去的 schema 不合法**。判据（上游硬约束）：
 *
 * 1. `items` 只能出现在 `type === 'array'` 的 schema 上；
 * 2. `items` 必须是**对象**（数组形态的 `items` 上游不接受）；
 * 3. `items` 自己的 `type` 不能缺省 —— 空 `{}` 或纯描述性 schema 会被拒。
 *
 * 另外固定一条**语义**要求，而不只是「不 400」：union type 里同时出现
 * `boolean` 和 `array` 时（`["null","boolean","object","array","number","string"]`），
 * 收敛结果必须是 `array`。早先按书写顺序取第一个非 null 项会得到 `boolean`，
 * 于是模型把 `source_paths` 当布尔数组传 —— 请求通了，工具仍然坏。
 *
 * Run: node scripts/gemini-schema-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const sourceRoot = pathToFileURL(path.join(root, '..', 'vendor', 'channel-pack', 'src') + '/').href
const ts = (await import('typescript')).default
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && specifier.endsWith('.js')) {
      const url = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL).href
      if (fs.existsSync(fileURLToPath(url))) return { url, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) {
      return {
        format: 'module', shortCircuit: true,
        source: ts.transpileModule(fs.readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
          fileName: fileURLToPath(url),
        }).outputText,
      }
    }
    return nextLoad(url, context)
  },
})

const { sanitizeGeminiSchema } = await import(new URL('gemini.ts', sourceRoot).href)

let failures = 0
const check = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`) } catch (error) {
    failures++
    console.log(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 收集所有违反上游 items 约束的路径（空数组 = 合法）。 */
function itemViolations(node, path = 'parameters', out = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return out
  if (node.items !== undefined) {
    if (Array.isArray(node.items)) out.push(`${path}.items 是数组形态（上游要求对象）`)
    else if (node.type !== 'array') out.push(`${path}.items 出现在 type=${JSON.stringify(node.type)} 上（只允许 array）`)
    else if (typeof node.items !== 'object' || node.items === null) out.push(`${path}.items 不是对象`)
    else {
      if (node.items.type === undefined) out.push(`${path}.items.type 缺省`)
      itemViolations(node.items, `${path}.items`, out)
    }
  }
  for (const [name, child] of Object.entries(node.properties ?? {})) itemViolations(child, `${path}.properties.${name}`, out)
  for (const [index, child] of (node.anyOf ?? []).entries()) itemViolations(child, `${path}.anyOf[${index}]`, out)
  return out
}
const assertLegal = schema => {
  const violations = itemViolations(schema)
  if (violations.length > 0) throw new Error(violations.join('; '))
}
const at = (schema, ...keys) => keys.reduce((node, key) => node?.properties?.[key], schema)

console.log('=== 1. 实机报错的三个参数 ===')
const REPORTED = { type: 'object', properties: {
  source_paths: { type: ['null', 'array'], items: { items: {}, type: ['null', 'boolean', 'object', 'array', 'number', 'string'] } },
  allowed_origins: { type: ['null', 'array'], items: { type: ['null', 'string'] } },
  functions: { type: ['null', 'array'], items: { type: ['null', 'object', 'string'] } },
} }
const reported = sanitizeGeminiSchema(REPORTED)
check('三个参数清洗后全部合法（原报错路径 .items.items 不再违规）', () => { assertLegal(reported) })
check('source_paths 收敛为 array（不是 boolean）', () => {
  const node = at(reported, 'source_paths')
  if (node.type !== 'array') throw new Error(`type=${JSON.stringify(node.type)}`)
})
check('allowed_origins 收敛为 array 且元素是 string', () => {
  const node = at(reported, 'allowed_origins')
  if (node.type !== 'array' || node.items?.type !== 'string') throw new Error(JSON.stringify(node))
})
check('functions 收敛为 array 且元素是 object', () => {
  const node = at(reported, 'functions')
  if (node.type !== 'array' || node.items?.type !== 'object') throw new Error(JSON.stringify(node))
})
check('nullable 仍然表达出来（union 里含 null）', () => {
  for (const name of ['source_paths', 'allowed_origins', 'functions']) {
    if (at(reported, name).nullable !== true) throw new Error(`${name} 丢了 nullable`)
  }
})

console.log('\n=== 2. union type 的收敛优先级 ===')
check('array 优先于 boolean（本次故障的根因）', () => {
  const out = sanitizeGeminiSchema({ type: ['null', 'boolean', 'object', 'array', 'number', 'string'] })
  if (out.type !== 'array') throw new Error(`type=${JSON.stringify(out.type)}`)
})
check('object 优先于 string/number/boolean', () => {
  const out = sanitizeGeminiSchema({ type: ['boolean', 'number', 'string', 'object'] })
  if (out.type !== 'object') throw new Error(`type=${JSON.stringify(out.type)}`)
})
check('string 优先于 number/boolean', () => {
  const out = sanitizeGeminiSchema({ type: ['boolean', 'number', 'string'] })
  if (out.type !== 'string') throw new Error(`type=${JSON.stringify(out.type)}`)
})
check('只有 null + 单一类型时按该类型，且标 nullable', () => {
  const out = sanitizeGeminiSchema({ type: ['null', 'string'] })
  if (out.type !== 'string' || out.nullable !== true) throw new Error(JSON.stringify(out))
})
check('未知/自定义类型保持原顺序（不凭空发明）', () => {
  const out = sanitizeGeminiSchema({ type: ['null', 'weird-custom-type'] })
  if (out.type !== 'weird-custom-type') throw new Error(JSON.stringify(out))
})

console.log('\n=== 3. items 形态的各种边界 ===')
check('items 是数组形态 → 收敛成对象形态且合法', () => {
  const out = sanitizeGeminiSchema({ type: 'array', items: [{ type: 'string' }, { type: 'number' }] })
  assertLegal({ properties: { x: out } })
})
check('array 的 items 为空对象 → 补出确定类型', () => {
  const out = sanitizeGeminiSchema({ type: 'array', items: {} })
  if (out.items?.type === undefined) throw new Error(JSON.stringify(out))
  assertLegal({ properties: { x: out } })
})
check('array 完全没有 items → 不凭空添加（上游允许省略）', () => {
  const out = sanitizeGeminiSchema({ type: 'array' })
  if (out.items !== undefined) throw new Error(JSON.stringify(out))
})
check('非 array 上带 items → 删除 items', () => {
  const out = sanitizeGeminiSchema({ type: 'string', items: { type: 'string' } })
  if (out.items !== undefined) throw new Error(JSON.stringify(out))
})
check('深层嵌套（array→object→array→union array）全部合法', () => {
  const out = sanitizeGeminiSchema({ type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: {
    b: { type: 'array', items: { type: ['null', 'array'], items: { type: ['number', 'string'] } } },
  } } } } })
  assertLegal(out)
  const inner = at(out, 'a').items.properties.b
  if (inner.type !== 'array' || inner.items?.type !== 'array') throw new Error(JSON.stringify(inner))
})

console.log('\n=== 4. 普通工具 schema 不受影响 ===')
check('标准 object/string schema 逐键保留', () => {
  const schema = { type: 'object', properties: { path: { type: 'string', description: 'p' } }, required: ['path'], additionalProperties: false }
  const out = sanitizeGeminiSchema(schema)
  if (out.type !== 'object') throw new Error('type 变了')
  if (out.properties?.path?.type !== 'string' || out.properties?.path?.description !== 'p') throw new Error('属性被改')
  if (out.required?.[0] !== 'path') throw new Error('required 丢失')
  if ('additionalProperties' in out) throw new Error('白名单外的键应被删除')
})
check('枚举保持字符串数组', () => {
  const out = sanitizeGeminiSchema({ type: 'string', enum: ['a', 'b'] })
  if (JSON.stringify(out.enum) !== '["a","b"]') throw new Error(JSON.stringify(out))
})
check('清洗是纯函数，不改入参', () => {
  const schema = { type: ['null', 'array'], items: { items: {}, type: ['null', 'boolean', 'array'] } }
  const snapshot = JSON.stringify(schema)
  sanitizeGeminiSchema(schema)
  if (JSON.stringify(schema) !== snapshot) throw new Error('入参被原地修改')
})
check('幂等：清洗两次结果一致', () => {
  const once = sanitizeGeminiSchema(REPORTED)
  const twice = sanitizeGeminiSchema(once)
  if (JSON.stringify(once) !== JSON.stringify(twice)) throw new Error('不幂等')
})

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exitCode = failures === 0 ? 0 : 1
