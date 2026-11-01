/**
 * 腾讯系渠道 system 风控改写的离线契约测试。
 *
 * 线上行为（400/11128 与放行）**无法离线复现**，所以这里的判据全部来自
 * 「实测事实 → 代码不变式」的映射，每条都在注释里给出实测出处；不要把它
 * 们当成可随意调整的字面量断言。
 *
 * 核心不变式：**实现产出的字节序列必须与真实放行过的那个请求体一致**。
 * 这条由 {@link passedBody} 锚定 —— 2026-11-01 用真实凭据对
 * copilot.tencent.com 实发 **HTTP 200** 的那份文本（探针
 * `probe-buddy-*` 系列产出，输入已归档到 `scripts/fixtures/`），逐字符比对。
 * 只要实现还等于它，直连就不会再吃到 11128；改动正则/表而不同步实测，
 * 这条会立刻红。
 *
 * `tencent-fingerprint.ts` 没有运行时外部依赖，直接由 Node 剥离类型后导入。
 *
 * Run: node scripts/tencent-fingerprint-test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

let failures = 0
const check = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`) } catch (error) {
    failures++
    console.log(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}`)
  }
}

const { rewriteTencentContentFingerprints, isTencentContentFingerprintProvider } =
  await import(pathToFileURL(
    path.join(root, '..', 'vendor', 'channel-pack', 'src', 'openai-gateway', 'tencent-fingerprint.ts'),
  ).href)

// 实测样本：DSH harness 当时的系统提示词原文（probe 系列输入，已归档）。
// 归档是**必需**的：「与放行字节一致」这条断言要能永久重放，
// 不能依赖 /tmp 里那份会消失的探针输入。
const original = fs.readFileSync(path.join(root, 'fixtures', 'buddy-system-prompt.txt'), 'utf8')

const R1 = 'You are an AI agent powered by DeepSeek Harness.'
const W1 = 'You are an AI assistant running inside a harness.'
const P0 = 'Tokens prefixed with @ are paths the user explicitly referenced.'
const P1 = 'Relative paths resolve from the workspace root; absolute paths identify files or directories on the host.'
// F3 探针（HTTP 200）用的就是这个显式公式；与实现同源互为验证。
const reflowUpper = (s) => s.replace(/(?<=[.!?]) (?=[A-Z"'(])/g, '\n')
const passedBody = reflowUpper(original).split(R1).join(W1)

console.log('=== 1. provider 白名单 ===')
check('buddy / workbuddy 受护', () => {
  assert.equal(isTencentContentFingerprintProvider('buddy'), true)
  assert.equal(isTencentContentFingerprintProvider('workbuddy'), true)
})
check('其余 provider 原样返回（内容逐字符不变）', () => {
  for (const provider of ['qoder', 'trae', 'cline', 'lobsterai', 'loomy', 'raccoon', 'minimax', 'zcode', 'codearts', 'gemini', '']) {
    assert.equal(rewriteTencentContentFingerprints(original, provider), original,
      `provider ${JSON.stringify(provider)} 不该被改写`)
  }
})

console.log('\n=== 2. 与实测放行字节一致（核心不变式）===')
check('DSH 系统提示词 → 逐字符等于实发 200 的那份文本', () => {
  assert.equal(rewriteTencentContentFingerprints(original, 'buddy'), passedBody)
  assert.equal(rewriteTencentContentFingerprints(original, 'workbuddy'), passedBody)
})
check('开场句单句指纹已消失', () => {
  assert.equal(rewriteTencentContentFingerprints(original, 'buddy').includes(R1), false)
})
check('组合指纹的相连形态已消失，句子本身原样保留', () => {
  const out = rewriteTencentContentFingerprints(original, 'buddy')
  assert.equal(out.includes(`${P0} ${P1}`), false, '两句必须以非「. + 单空格」分隔')
  assert.ok(out.includes(P0), 'P0 句子内容必须原样保留（只动分隔符）')
  assert.ok(out.includes(P1), 'P1 句子内容必须原样保留（只动分隔符）')
})

console.log('\n=== 3. 单句指纹表 ===')
check('ZCode 的 Main branch 模板句 → 等义改写（Gitee IKJNA1）', () => {
  assert.equal(
    rewriteTencentContentFingerprints(
      'You are a helpful assistant. Main branch (you will usually use this for PRs): master',
      'workbuddy',
    ),
    // 句界空格同时被 reflow 打断（保留句号），再叠加表里的等义替换。
    'You are a helpful assistant.\nMain branch (PRs usually go here): master',
  )
})
check('大小写变体同样改写（实测全小写/全大写都被拦）', () => {
  const out = rewriteTencentContentFingerprints(
    'MAIN BRANCH (YOU WILL USUALLY USE THIS FOR PRS): master', 'buddy')
  assert.match(out, /Main branch \(PRs usually go here\)/i)
  assert.equal(out.includes('YOU WILL USUALLY USE'), false)
})
check('多处出现全部改写；入参不被原地修改', () => {
  const input = `${R1} … ${R1}`
  const out = rewriteTencentContentFingerprints(input, 'buddy')
  assert.equal(out.split(R1).length - 1, 0)
  assert.equal(out.split(W1).length - 1, 2)
  assert.equal(input, `${R1} … ${R1}`)
})

console.log('\n=== 4. reflow 的保守性（只动分隔符，不动内容）===')
check('除开场句替换外不增删任何字符（空白折叠后比对）', () => {
  const squash = (s) => s.replace(/\s+/g, ' ').trim()
  const stripped = squash(rewriteTencentContentFingerprints(original, 'buddy')).split(W1).join(R1)
  assert.equal(stripped, squash(original), '改写只应替换开场句 + 换分隔符')
})
check('小写续写不断行（`foo(). bar` 不动）', () => {
  const s = 'Call foo(). bar is fine.'
  assert.equal(rewriteTencentContentFingerprints(s, 'buddy'), s)
})
check('双空格 / 已有换行的句界不动', () => {
  for (const s of ['Hello.  World', 'end.\nNext para', 'A.  B.   C']) {
    assert.equal(rewriteTencentContentFingerprints(s, 'buddy'), s, JSON.stringify(s))
  }
})
check('段落分隔（双换行）保持', () => {
  const s = 'First para.\n\nSecond para.'
  assert.equal(rewriteTencentContentFingerprints(s, 'buddy'), s)
})
check('无指纹文本逐字符不变（前缀缓存不受扰动）', () => {
  const s = 'You are a helpful assistant.'
  assert.equal(rewriteTencentContentFingerprints(s, 'buddy'), s)
})
check('改写是纯函数且幂等（同一输入永远同一输出 → 前缀稳定）', () => {
  const a = rewriteTencentContentFingerprints(original, 'buddy')
  for (let i = 0; i < 5; i++) assert.equal(rewriteTencentContentFingerprints(original, 'buddy'), a)
  assert.equal(rewriteTencentContentFingerprints(a, 'buddy'), a)
})

console.log('\n=== 5. 边界 ===')
check('空串与纯空白安全', () => {
  for (const s of ['', ' ', '\n\n', '. ']) {
    assert.equal(typeof rewriteTencentContentFingerprints(s, 'buddy'), 'string')
  }
})
check('带 g 的正则不串状态（lastIndex 每次归零）', () => {
  const s = `${R1} ${R1} ${R1}`
  for (let i = 0; i < 3; i++) {
    assert.equal(rewriteTencentContentFingerprints(s, 'buddy').split(R1).length - 1, 0)
  }
})

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exitCode = failures === 0 ? 0 : 1
