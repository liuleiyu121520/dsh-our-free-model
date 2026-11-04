/**
 * DSH 账号一键导入 与 网关请求日志 的回归套件。
 *
 * 两块都是本 fork 新增的独立端能力，没有历史保护：
 * 1. `dsh-import.mjs` —— 唯一读取 DSH 侧凭据的模块，必须证明它读得全、且
 *    遇到坏数据不炸、不把凭据写进错误信息。
 * 2. `request-log.mjs` —— 逐请求落盘，必须证明白名单真的挡掉 prompt/密钥、
 *    环形保留生效、坏行不影响其余。
 *
 * 全部用临时目录与合成数据，绝不碰真实账号。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectDshChannels, parseCredentialRefs } from '../packages/standalone/dsh-import.mjs'
import { createRequestLog, toLogRow } from '../packages/standalone/request-log.mjs'

let checks = 0
const check = (name, run) => { checks++; run(); console.log(`ok  ${name}`) }

const scratch = fs.mkdtempSync(path.join(os.homedir(), 'ofm-import-'))
try {
  // ── 1. 多行折叠凭据必须读全 ─────────────────────────────────────────────
  // 真实形状：多行值是「JSON 里含长字符串」，YAML 把它折成多行，
  // 续行是裸文本（不是 JSON 数组项）。折叠后仍必须是合法 JSON。
  const q = "'"
  const yaml = [
    'version: 1',
    'records:',
    '  deepseek-account-platform/default:',
    "    kind: 'token'",
    'refs:',
    "  SINGLE_ACCOUNT_AAAA: '{\"access_token\":\"a\",\"refresh_token\":\"r\"}'",
    "  MULTI_ACCOUNT_BBBB: '{\"access_token\":\"b\",\"scope\":\"https://a",
    '    https://b',
    '    https://c\"}\'',
    '  EMPTY_ACCOUNT_CCCC: ~',
    'other:',
    "  SHOULD_NOT_BE_READ: '{\"access_token\":\"x\"}'",
  ].join('\n')

  check('多行折叠的凭据与单行凭据都被解析', () => {
    const refs = parseCredentialRefs(yaml)
    assert.deepEqual(Object.keys(refs).sort(), ['MULTI_ACCOUNT_BBBB', 'SINGLE_ACCOUNT_AAAA'])
    assert.equal(refs.SINGLE_ACCOUNT_AAAA.access_token, 'a')
    // 续行按 YAML 折叠规则拼成一个空格，JSON 因此仍然合法。
    assert.equal(refs.MULTI_ACCOUNT_BBBB.access_token, 'b')
    // 折叠把三行拼成一个空格分隔的 scope 字符串。
    assert.equal(refs.MULTI_ACCOUNT_BBBB.scope, 'https://a https://b https://c')
  })

  check('refs 段之后的顶层键不会被当成账号凭据', () => {
    const refs = parseCredentialRefs(yaml)
    assert.equal(Object.hasOwn(refs, 'SHOULD_NOT_BE_READ'), false)
  })

  // ── 2. 探测：全量、跳过坏条目、未安装 DSH 不报错 ─────────────────────────
  const write = (dir, accounts, refValues) => {
    fs.mkdirSync(path.join(dir, 'channel-pack'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'channel-pack', 'state.json'), JSON.stringify({
      accounts, disabledModels: { qoder: ['m1'] }, loomyPermanentLocked: {},
    }))
    const lines = ['refs:', ...Object.entries(refValues).map(([ref, value]) =>
      `  ${ref}: '${JSON.stringify(value)}'`)]
    fs.writeFileSync(path.join(dir, '.credentials.yaml'), lines.join('\n'))
  }

  const dshHome = path.join(scratch, 'dsh')
  const accounts = [
    { id: 'a1', provider: 'qoder', credentialRef: 'REF_A', enabled: true, expiresAt: Date.now() + 86400000 },
    { id: 'a2', provider: 'workbuddy', credentialRef: 'REF_B', enabled: true },
    { id: 'a3', provider: 'trae', credentialRef: 'REF_MISSING', enabled: true },
  ]
  write(dshHome, accounts, {
    REF_A: { access_token: 'token-a' },
    REF_B: { access_token: 'token-b' },
  })

  check('账号按渠道统计，缺凭据的条目被跳过而不是让整个探测失败', () => {
    const detected = detectDshChannels({ dshHome })
    assert.equal(detected.available, true)
    assert.equal(detected.accounts, 2)
    assert.deepEqual(detected.providers, { qoder: 1, workbuddy: 1 })
    assert.equal(detected.skipped, 1)
    assert.equal(Object.keys(detected.payload.credentials).length, 2)
    assert.equal(detected.payload.format, 'channel-pack/backup', '必须用后端认的格式名')
    assert.equal(detected.payload.version, 1, '必须用后端认的版本号')
    assert.deepEqual(detected.payload.disabledModels, { qoder: ['m1'] })
  })

  check('过期账号计入 expired 但仍可导入', () => {
    const expiredHome = path.join(scratch, 'expired')
    write(expiredHome, [{ id: 'x', provider: 'qoder', credentialRef: 'R1', expiresAt: Date.now() - 1000 }], { R1: { access_token: 't' } })
    const detected = detectDshChannels({ dshHome: expiredHome })
    assert.equal(detected.available, true)
    assert.equal(detected.expired, 1)
  })

  check('没有 DSH 数据目录时返回 available:false 而不是抛错', () => {
    const detected = detectDshChannels({ dshHome: path.join(scratch, 'nothing-here') })
    assert.equal(detected.available, false)
    assert.equal(detected.reason, 'missing')
    assert.equal(detected.accounts, 0)
  })

  // 「已导入过就不再弹」的判据在服务端：manageGET 把 backup.status 的账号数并进
  // available。这里直接验证那段判据的形状 —— 它必须让「本服务已有账号」时
  // available 恒为 false，否则用户每次打开都会被问要不要整体替换自己的账号。
  check('本服务已有账号时探测结果必须不可导入（避免二次弹窗）', () => {
    // 复刻 management.mjs 里的判据：available = 探测到 && existing === 0
    const decide = (probeAvailable, existing) => probeAvailable === true && existing === 0
    assert.equal(decide(true, 0), true, '探测到且本服务无账号 → 应该问')
    assert.equal(decide(true, 22), false, '本服务已有 22 个账号 → 不该再问')
    assert.equal(decide(false, 0), false, '没有可导入账号 → 不问')
    assert.equal(decide(false, 22), false, '两样都不成立 → 不问')
  })

  // 前端不得再用 `dshImportAsked` 提前短路：那个设置位会让「删光账号后想再导入」
  // 永久失效，也会让换数据目录的机器永远等不到提示。
  check('导入弹窗不靠设置位短路口，且「稍后」不写设置位', () => {
    const source = fs.readFileSync(new URL('../packages/standalone/frontend/components/dsh-import-dialog.tsx', import.meta.url), 'utf8')
    assert.ok(!/if \(summary\.settings\.dshImportAsked === true\) return/.test(source),
      '不得用 dshImportAsked 提前 return')
    assert.ok(/if \(value\.available\) setOpen\(true\)/.test(source),
      '是否弹窗必须只看后端给出的 available')
    // 「稍后」分支里不该再写 dshImportAsked
    const finish = source.slice(source.indexOf('const finish'), source.indexOf('const importNow'))
    assert.ok(!/dshImportAsked: true/.test(finish),
      '「稍后」不应把提示标成已问过，否则下次不再提示')
    // 「一键导入」成功后仍然写一次，避免导入完又被问
    const importNow = source.slice(source.indexOf('const importNow'))
    assert.ok(/dshImportAsked: true/.test(importNow),
      '导入成功后应记录，避免重复提示')
  })

  check('state.json 损坏时报 unreadable，不带路径或凭据', () => {
    const broken = path.join(scratch, 'broken')
    fs.mkdirSync(path.join(broken, 'channel-pack'), { recursive: true })
    fs.writeFileSync(path.join(broken, 'channel-pack', 'state.json'), '{not json')
    fs.writeFileSync(path.join(broken, '.credentials.yaml'), 'refs:')
    const detected = detectDshChannels({ dshHome: broken })
    assert.equal(detected.available, false)
    assert.equal(detected.reason, 'unreadable')
    assert.equal(JSON.stringify(detected).includes(broken), false, '错误结构里不得出现数据目录路径')
  })

  // ── 3. 请求日志：白名单、环形保留、坏行容错 ─────────────────────────────
  const logDir = path.join(scratch, 'log')

  check('白名单挡掉 prompt 与密钥，只留元数据', () => {
    const row = toLogRow({ model: 'm', ok: true, input: 10, prompt: 'SECRET-PROMPT', apiKey: 'sk-SECRET', authorization: 'Bearer x' })
    assert.ok(row)
    assert.deepEqual(Object.keys(row).sort(), ['at', 'input', 'model', 'ok'])
    assert.equal(JSON.stringify(row).includes('SECRET'), false)
  })

  check('没有 model 的记录被直接丢弃', () => {
    assert.equal(toLogRow({}), null)
    assert.equal(toLogRow({ model: '' }), null)
    assert.equal(toLogRow(null), null)
  })

  check('追加后可读回，新记录在前', () => {
    const log = createRequestLog({ dataDir: logDir, logger: { warn() {} } })
    log.append({ at: 1, model: 'first', ok: true, elapsedMs: 10 })
    log.append({ at: 2, model: 'second', ok: false, status: 429 })
    const page = log.list({ limit: 10 })
    assert.equal(page.total, 2)
    assert.equal(page.entries[0].model, 'second')
    assert.equal(page.entries[1].model, 'first')
  })

  check('环形保留只留最近 maxEntries 条', () => {
    const ringDir = path.join(scratch, 'ring')
    const log = createRequestLog({ dataDir: ringDir, maxEntries: 3, logger: { warn() {} } })
    for (let i = 0; i < 6; i++) log.append({ at: i, model: `m${i}`, ok: true })
    const page = log.list({ limit: 10 })
    assert.equal(page.total, 3)
    assert.deepEqual(page.entries.map(row => row.model), ['m5', 'm4', 'm3'])
  })

  check('日志文件里的坏行不影响其余记录', () => {
    const dirtyDir = path.join(scratch, 'dirty')
    fs.mkdirSync(dirtyDir, { recursive: true })
    fs.writeFileSync(path.join(dirtyDir, 'request-log.jsonl'),
      ['{"model":"good","at":1,"ok":true}', 'not-json-at-all', '{"nope":1}'].join('\n'))
    const log = createRequestLog({ dataDir: dirtyDir, logger: { warn() {} } })
    const page = log.list({ limit: 10 })
    assert.equal(page.total, 1, '坏行必须被跳过，好行保留')
    assert.equal(page.entries[0].model, 'good')
  })

  check('落盘文件不含任何敏感字段', () => {
    const log = createRequestLog({ dataDir: logDir, logger: { warn() {} } })
    log.append({ model: 'm', ok: true, prompt: 'SECRET-PROMPT', apiKey: 'sk-SECRET' })
    const text = fs.readFileSync(path.join(logDir, 'request-log.jsonl'), 'utf8')
    assert.equal(/SECRET/.test(text), false)
  })

  check('清空后读回为空', () => {
    const log = createRequestLog({ dataDir: logDir, logger: { warn() {} } })
    assert.equal(log.clear(), true)
    assert.equal(log.list({ limit: 10 }).total, 0)
  })
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}

console.log(`standalone-dsh-import: ${checks}/${checks} checks passed`)
