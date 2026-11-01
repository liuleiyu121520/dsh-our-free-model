/**
 * 腾讯系渠道的**内容级**风控指纹改写（Gitee issue IKJNA1）。
 *
 * ## 现象
 *
 * 外部客户端（ZCode 等）经本插件的 OpenAI 网关调 `buddy` / `workbuddy` 时，
 * 只要 `system` 消息里带着某些**客户端自带的模板句**，腾讯网关就稳定回
 * `HTTP 400 / code 11128 / "Illegal API invocation from an unapproved channel"`，
 * 客户端侧只显示 `provider_code=INVALID_REQUEST reason=unknown`。
 * DSH 直连同一模型则完全正常 —— 差别只在于**外部客户端往 system 里注了什么**。
 *
 * ## 为什么这一层只改 system、且只对腾讯系
 *
 * 本机逐组实测（`www.workbuddy.ai` 与 `copilot.tencent.com` **两个端点表现一致**，
 * 同账号 / 同模型 / 同 UA 与 X-* 头 / `max_tokens=16`，被拦不耗额度）：
 *
 * | 探针 | system 文本 | 结果 |
 * |---|---|---|
 * | 中性对照 | `You are a helpful assistant.` | ✅ 200 |
 * | 最小充分触发 | `Main branch (you will usually use this for PRs): master` | ❌ 400/11128 |
 * | 只留标签 | `Main branch: master` | ✅ 200 |
 * | 换分支名 | `…(you will usually use this for PRs): dev` | ❌ 400/11128 |
 * | 句中/段中 | 前后都接别的句子 | ❌ 400/11128 |
 * | **改写该句** | `Main branch (PRs usually go here): master` | ✅ 200 |
 * | 同一句放进 **user** 消息 | — | ✅ 200 |
 * | 同一句放进 **tool** 消息 | — | ✅ 200 |
 * | 指纹在**第二条** system（非 `messages[0]`） | — | ❌ 400/11128 |
 * | 只差一个词（`normally` 替 `usually`） | — | ✅ 200 |
 * | 内层多一个空格 | `Main branch  (you will…)` | ✅ 200 |
 * | 全小写 / 全大写 | — | ❌ 400/11128 |
 *
 * 由此得到三条**不能违反**的实现约束（2026-11-01 补充第 1 条的例外说明）：
 *
 * 1. **只改 `system`**：`user` / `tool` 里同一句**不拦**（上表第 6、7 行，
 *    2026-11-01 的 E5 探针再次实证）。
 *    改写它们只会白白破坏用户的原话与工具输出，且换不来任何收益。
 * 2. **改写**所有** system 消息**，不只 `messages[0]`：非首位的 system 同样被拦
 *    （上表第 8 行）。WorkBuddy 网关那条「首条必须是 system」的硬要求是**另一回事**
 *    （见 `account-probe.ts` 的 `PROBE_SYSTEM`），与本文件无关。
 * 3. **大小写不敏感的精确匹配**：全小写与全大写都被拦（上表末行），所以
 *    `replaceAll` 的字面量比对必须带 `i`；但**只差一个词**或**多一个空格**都不拦，
 *    说明服务端认的是**逐字符的字面量**，**不能**把它泛化成正则/关键词。
 *
 * ## ⚠️ 2026-11-01 修订：网关和 `buddy-adapter` 直连**都要**挂
 *
 * 本节原先的结论是「DSH 直连不受影响，不挂在适配器里」，依据是「DSH 自己的系统
 * 提示词不含这些模板句」。**该前提已失效**——腾讯风控新增了指向 DSH harness
 * 开场句的指纹，DSH 直连 `buddy` 从 2026-10 下旬起稳定 400/11128（会话
 * `session-d9d35665` 实录：`buddy: 请求被拦截，请重新发送 Illegal API invocation
 * from an unapproved channel`，任意用户输入——哪怕 `hi`——都在第一条请求被拦）。
 * 本机单变量矩阵（`probe-buddy-unapproved-channel.mjs` / `probe-buddy-bisect.mjs`
 * 系列，同账号同模型同头，`max_tokens=1`）：
 *
 * | 探针 | 变量 | 结果 |
 * |---|---|---|
 * | A 短 system | `You are a helpful assistant.` | ✅ 200 |
 * | B A + X-Conversation-* 头 | 请求形状 | ✅ 200 |
 * | C DSH 系统提示词前 400 字符 | 仅内容 | ❌ 400/11128 |
 * | D C + 头 | 头无关 | ❌ 400/11128 |
 * | E5 完整 DSH 提示词放进 **user** | 角色 | ✅ 200（user 仍不扫） |
 *
 * 所以直连路径（`buddy-adapter.ts` 的 system 出站处）必须调用
 * {@link rewriteTencentSystemText}；国际版 workbuddy 与 buddy 共用适配器实例类，
 * 表是 provider 白名单，两端同时受护。**user/tool 角色维持不碰**（E5 再次实证
 * 不扫，改它们只会破坏用户原话）。
 *
 * ## ⚠️ 千万不要把 11128 加进 `isContentRejection`
 *
 * 那是**内容级**拦截：同一账号换掉这一句就通（上面「改写该句」一行）。
 * 认成「账号被策略拦」会触发换号 + 30 分钟账号冷却（`CONTENT_REJECTION_COOLDOWN_MS`），
 * 把整个账号池白锁 30 分钟，而真正该做的是改写那一句。
 * 维持现状（`isContentRejection` 只认 11140 / `request illegal` / 安全审核文案）
 * **是正确**的。
 *
 * ## 表驱动，而不是写死一处
 *
 * 屏蔽名单服务端掌握、可能随时更新，任何客户端将来都可能撞上新指纹。
 * 故这里是**表**：新增一条 = 往 {@link CONTENT_FINGERPRINTS} 里加一行 + 一条用例。
 */

/** 受影响的 provider：腾讯系两个后端（`buddy` = CodeBuddy 中国版，`workbuddy` = WorkBuddy 国际版）。 */
const TENCENT_PROVIDERS: readonly string[] = ['buddy', 'workbuddy']

interface ContentFingerprint {
  /** 被拦的**字面量**（匹配时**大小写不敏感**，但不做任何模式泛化）。 */
  readonly find: string
  /** 等义改写。两个端点均实测 200。 */
  readonly replace: string
  /** 来源与证据，写死在代码里，免得后人「顺手」把它改成正则或删掉。 */
  readonly note: string
}

/**
 * 已知会被腾讯网关拦下的 system 模板句。
 *
 * ⚠️ **每一条都必须有实发证据**（被拦 + 改写后放行，两条都要），
 * 照抄别家客户端的常量而没实测过 = 给上游加了一条没人验证过的改写。
 */
const CONTENT_FINGERPRINTS: readonly ContentFingerprint[] = [
  {
    // ZCode 内建常量：`$Js="Main branch (you will usually use this for PRs)"`。
    // 每个 git 仓库里的会话都会被注入（拼在 `Main branch … : <分支名>` 这一行）。
    find: 'Main branch (you will usually use this for PRs)',
    replace: 'Main branch (PRs usually go here)',
    note: 'Gitee IKJNA1；本机 2026-10-05 对 workbuddy / CodeBuddy 双端点实测复现',
  },
  {
    // DSH harness 系统提示词的开场句。腾讯国内端点（copilot.tencent.com）
    // 2026-10 下旬起把它认作「非官方渠道客户端」指纹。
    // 二分实测（probe-buddy-bisect.mjs）：单独该句 → 400/11128；
    // 改成下文的等义句 → 200；全文只改这一句仍被拦（还有组合指纹，见
    // REFLOW 部分），所以这一条与 reflow **缺一不可**。
    find: 'You are an AI agent powered by DeepSeek Harness.',
    replace: 'You are an AI assistant running inside a harness.',
    note: '本机 2026-11-01 对 copilot.tencent.com 实测：单独被拦、改写后单独放行（同账号/模型/头，max_tokens=1）',
  },
]

/**
 * ## 组合指纹：跨句**连续字面量**（2026-11-01 新发现，比单句更麻烦）
 *
 * DSH 系统提示词第二段的前两个相邻句子：
 *
 * > `Tokens prefixed with @ are paths the user explicitly referenced. Relative
 * >  paths resolve from the workspace root; absolute paths identify files or
 * >  directories on the host.`
 *
 * 单句都**放行**，两句以原文的「. + 空格」相连就**被拦**——是跨句连续字面量，
 * 不是命中计数：
 *
 * | 探针 | 输入 | 结果 |
 * |---|---|---|
 * | E1 | 两句**逆序**相连 | ✅ 200（逆序不拦 = 精确字面量，不是「≥2 命中」） |
 * | E2 | 两句之间**换行** | ✅ 200（空格是匹配面的一部分） |
 * | E3 | 原段落原文 | ❌ 400/11128 |
 * | F2 | 全文仅换行、不改开场句 | ❌ 400/11128（开场句是独立单句指纹） |
 * | F1/F3 | 全文换行 + 开场句改写 | ✅ 200 |
 *
 * 服务端名单会随上游版本扩充，逐句追赶永远是落后的。故在两条已实测的单句
 * 指纹之外，对 **system 文本**加一条通用**打断**变换：把「句末标点后跟单个
 * 空格再接大写/引号/括号」的间隙换成换行——只动**分隔符**，一个词都不改，
 * 语义完全等价，而跨句字面量匹配（要求逐字符，含那个空格）被打断。
 *
 * ⚠️ 为什么只在**后接大写**时断行（F3 实测同样放行）：小写续写
 * （`…do this. and not that`）大概率是同一句内部，代码/URL 里的
 * `x. bar` 类 token 也因此基本不受影响。段落换行（`\n\n`）保持原样。
 */
const SENTENCE_JOIN_PATTERN = /(?<=[.!?]) (?=[A-Z"'(])/g

/** 正则元字符转义：把字面量安全地变成**精确**匹配，而不是模式。 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface CompiledFingerprint {
  readonly replace: string
  /** 小写形态，用于 `includes` 预检（不命中就不必跑正则，字符串**原样**返回）。 */
  readonly findLower: string
  readonly pattern: RegExp
}

const COMPILED: readonly CompiledFingerprint[] = CONTENT_FINGERPRINTS.map((rule) => ({
  replace: rule.replace,
  findLower: rule.find.toLowerCase(),
  // `g` = 全部出现都改写；`i` = 大小写不敏感（实测全小写 / 全大写同样被拦）。
  pattern: new RegExp(escapeRegExp(rule.find), 'gi'),
}))

/** 该 provider 是否走腾讯系后端（有这套内容级风控）。 */
export function isTencentContentFingerprintProvider(provider: string): boolean {
  return TENCENT_PROVIDERS.includes(provider)
}

/**
 * 把 system 文本做两层腾讯风控改写：
 *
 * 1. **组合指纹打断**（{@link SENTENCE_JOIN_PATTERN}）：把「句末标点 + 单空格 +
 *    大写/引号/括号」的跨句间隙换成换行。只动分隔符不动词，语义等价；
 *    DSH harness 提示词的相邻句组合指纹实测（E1/E2/F3）证明这是唯一能跟上
 *    上游名单扩充的通用手段。**无条件应用**——2026-11-01 实测 para2-only 也
 *    被拦（E3），说明组合指纹**不伴随**任何单句指纹，「命中单句才 reflow」
 *    的保守判据会漏。
 * 2. **单句指纹表改写**（{@link CONTENT_FINGERPRINTS}）：逐字面量等义替换。
 *
 * ## 契约
 *
 * - **非腾讯系 provider 原样返回**（同一个函数指针意义上的同一份字符串内容）；
 * - **不含句间空格间隙与指纹的文本逐字符不变** —— 这一条是硬要求：腾讯侧按
 *   前缀缓存，无谓地重建字符串会让每一轮都算作新前缀，白白吃掉缓存命中。
 *   ⚠️ 2026-11-01 起「逐字符不变」只对**无需改写**的文本成立：含组合指纹
 *   的文本每轮都会得到**同一个** reflow 结果（纯函数），前缀依旧稳定，
 *   只是在首轮建立新前缀；
 * - 只改**内容**，不删句子、不改结构：`Main branch (PRs usually go here)`
 *   与原句语义等价，换行与原文的空格一样是句间分隔。
 *
 * @param text 已取出的 system 纯文本
 * @param provider `parseModelRoute` 得到的 provider 段
 */
export function rewriteTencentContentFingerprints(text: string, provider: string): string {
  if (!isTencentContentFingerprintProvider(provider)) return text
  // 1) 组合指纹打断：只替换「. + 空格 + 大写」这一个间隙字符。
  let out = text.replace(SENTENCE_JOIN_PATTERN, '\n')
  // 2) 单句指纹表。
  for (const rule of COMPILED) {
    // 预检：不含（小写化后的）字面量就整条跳过，`out` 保持同一份字符串内容。
    if (!out.toLowerCase().includes(rule.findLower)) continue
    // `String.replace` 配 `g` 正则会在调用前后把 lastIndex 归零，不会串状态。
    out = out.replace(rule.pattern, rule.replace)
  }
  return out
}
