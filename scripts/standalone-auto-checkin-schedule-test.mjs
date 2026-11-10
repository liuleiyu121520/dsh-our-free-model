/**
 * 自动签到的**调度**契约。
 *
 * 报障原状：开关显示「已开启」，却整天不签到，只有手动关掉再打开才有动作。
 * 根因是 `start()` 只挂了一个一次性 `setTimeout(fire, 30s)` —— 跑完就永久沉默。
 *
 * 这里钉住修复后的三条语义：
 * 1. 启动延时到点跑第一轮；
 * 2. 之后**周期性**再检查（默认 60 分钟），不是跑完就结束；
 * 3. 每轮都受「今天已跑过就跳过」约束 —— 周期检查不会重复打上游。
 *
 * 用注入的 `schedule` + 可拨动的时钟，零等待、不碰真实网络与账号。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

// `auto-checkin.ts` 用了 TS 参数属性等语法，Node 的 strip-only 模式不认。
// 复用仓库里 gateway-source 测试同一套转译方式（仓库自带 typescript 5）。
const ts = (await import('typescript')).default
const transpile = (source, url) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: url,
}).outputText
const sourceRoot = new URL('../vendor/channel-pack/src/', import.meta.url).href
const hooks = registerHooks({
  // TS 源码里写 `./foo.js` 指向 `./foo.ts`（NodeNext 惯例），解析时补一次映射。
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && specifier.endsWith('.js')) {
      const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
      if (fs.existsSync(target)) return { url: target.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) {
      return { format: 'module', shortCircuit: true, source: transpile(fs.readFileSync(fileURLToPath(url), 'utf8'), url) }
    }
    return nextLoad(url, context)
  },
})
const { AUTO_CHECKIN_INTERVAL_MS, createAutoCheckin } = await import('../vendor/channel-pack/src/auto-checkin.ts')

let checks = 0
const check = (name, run) => { checks++; return run().then(() => console.log(`ok  ${name}`)) }

/** 手动推进的调度器：记录每次排定，由测试决定何时触发。 */
function createManualScheduler() {
  const queue = []
  let seq = 0
  return {
    schedule(fn, ms) {
      const entry = { id: ++seq, fn, ms, cancelled: false }
      queue.push(entry)
      return { cancel() { entry.cancelled = true } }
    },
    /** 触发当前挂起的那一个（模拟定时器到点）。 */
    async fireNext() {
      const entry = queue.find(item => !item.cancelled && !item.fired)
      if (entry === undefined) throw new Error('没有待触发的定时器')
      entry.fired = true
      entry.fn()
      // 让 runIfDue 的微任务跑完
      await new Promise(resolve => setImmediate(resolve))
      return entry
    },
    pending() { return queue.filter(item => !item.cancelled && !item.fired) },
    all: () => queue,
  }
}

function createDeps({ clock, scheduler, claimCalls, state }) {
  const doc = { enabled: true, lastDate: '', lastResult: '', lastAt: 0, channels: [], dismissedRunAt: 0 }
  return {
    doc,
    store: {
      kind: 'memory',
      load: () => ({ ...doc }),
      async save(next) { Object.assign(doc, next) },
    },
    listProviderIds: async () => ['demo'],
    claim: async provider => {
      claimCalls.push(provider)
      return {
        ok: true,
        value: { summary: { claimed: 1, totalCredit: 10, alreadyClaimed: 0, inactive: 0, failed: 0, coversToday: 1 } },
      }
    },
    now: () => clock.now,
    delayMs: 30_000,
    schedule: scheduler.schedule,
  }
}

await check('启动后按延时跑第一轮，并把今日记为已签到', async () => {
  const clock = { now: Date.UTC(2026, 10, 9, 2, 0, 0) }
  const scheduler = createManualScheduler()
  const claimCalls = []
  const checkin = createAutoCheckin(createDeps({ clock, scheduler, claimCalls }))
  checkin.start()
  assert.equal(scheduler.all().length, 1, '启动必须排定第一轮')
  assert.equal(scheduler.all()[0].ms, 30_000, '首轮用启动延时（默认 30 秒）')
  await scheduler.fireNext()
  assert.deepEqual(claimCalls, ['demo'], '第一轮应当真的调一次签到')
  assert.notEqual(checkin.state().lastDate, '', '跑完要记下今天')
})

await check('第一轮之后必须继续周期检查（60 分钟），而不是就此停摆', async () => {
  const clock = { now: Date.UTC(2026, 10, 9, 2, 0, 0) }
  const scheduler = createManualScheduler()
  const claimCalls = []
  const checkin = createAutoCheckin(createDeps({ clock, scheduler, claimCalls }))
  checkin.start()
  await scheduler.fireNext()   // 第一轮

  const pendingAfterFirst = scheduler.pending()
  assert.equal(pendingAfterFirst.length, 1, '第一轮跑完必须重新排定下一轮')
  assert.equal(pendingAfterFirst[0].ms, AUTO_CHECKIN_INTERVAL_MS, '周期必须是 60 分钟')
  assert.equal(AUTO_CHECKIN_INTERVAL_MS, 3_600_000, '常量语义：60 分钟')
})

await check('同一天内的周期轮次全部跳过，不重复打上游', async () => {
  const clock = { now: Date.UTC(2026, 10, 9, 2, 0, 0) }
  const scheduler = createManualScheduler()
  const claimCalls = []
  const checkin = createAutoCheckin(createDeps({ clock, scheduler, claimCalls }))
  checkin.start()
  await scheduler.fireNext()          // 第一轮：真跑
  const afterFirst = claimCalls.length
  assert.equal(afterFirst, 1)

  // 同一天再走三轮（时钟只前进几小时，日期不变）
  for (const advanceMinutes of [60, 60, 60]) {
    clock.now += advanceMinutes * 60_000
    await scheduler.fireNext()
  }
  assert.equal(claimCalls.length, afterFirst, '当天已签到后，周期轮次必须直接跳过')
  assert.equal(scheduler.pending().length, 1, '跳过之后仍要继续排下一轮（跨天要靠它）')
})

await check('跨天后的第一轮自动补跑', async () => {
  const clock = { now: Date.UTC(2026, 10, 9, 2, 0, 0) }
  const scheduler = createManualScheduler()
  const claimCalls = []
  const checkin = createAutoCheckin(createDeps({ clock, scheduler, claimCalls }))
  checkin.start()
  await scheduler.fireNext()
  assert.equal(claimCalls.length, 1)

  // 推进到第二天
  clock.now += 24 * 60 * 60_000
  await scheduler.fireNext()
  assert.equal(claimCalls.length, 2, '跨天后必须自动补跑一轮')
})

await check('关掉开关后周期轮次不再打上游', async () => {
  const clock = { now: Date.UTC(2026, 10, 9, 2, 0, 0) }
  const scheduler = createManualScheduler()
  const claimCalls = []
  const deps = createDeps({ clock, scheduler, claimCalls })
  const checkin = createAutoCheckin(deps)
  checkin.start()
  await scheduler.fireNext()
  const before = claimCalls.length

  await checkin.setEnabled(false)
  clock.now += 24 * 60 * 60_000      // 第二天
  await scheduler.fireNext()
  assert.equal(claimCalls.length, before, '关闭状态下即使是新的一天也不该签到')
})

hooks.deregister()
console.log(`standalone-auto-checkin: ${checks}/${checks} checks passed`)
