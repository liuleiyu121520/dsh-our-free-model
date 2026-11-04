/**
 * The disclaimer copy both surfaces show: the plugin's settings page and the
 * standalone/desktop console.
 *
 * The product carries no WorkBuddy and no Huawei Cloud channel. Those two are
 * excluded mechanically (`src/magpie-policy.js`, and the aggregate registry
 * through it), but an exclusion with no explanation leaves a user wondering
 * whether the channel is broken. This copy answers the two questions that
 * matter instead: those channels are not part of what this build offers, and
 * anything a user does with a channel is their own responsibility.
 *
 * THIS BRANCH RESTORES ALL THREE CHANNELS. The exclusion mechanism stays in
 * place (so the plugin and desktop surfaces still cannot disagree), but its
 * deny sets are empty, and this copy now says what is true of the build: the
 * channels are offered, using them is your own decision, and the risk they
 * carry — the community adapter signs requests as WorkBuddy's desktop client,
 * which is why upstream withdrew them — belongs to whoever enables them.
 *
 * The copy is data, not markup: each surface renders it in its own idiom, so
 * there is exactly one place to change what the product says. It is deliberately
 * short — a wall of legal text is read by nobody — and states the project's
 * purpose plainly, because that is the honest description of what it is.
 */

export const DISCLAIMER_VERSION = 3

/** Channels this build does not offer, named for the reader. Empty here: the
 *  three upstream-excluded channels are restored on this branch. */
export const EXCLUDED_CHANNELS = Object.freeze([])

/** The channels this branch re-offers, named for the reader. */
export const RESTORED_CHANNELS = Object.freeze([
  'WorkBuddy 国内版（workbuddy，亦称 CodeBuddy）',
  'WorkBuddy 国际版（workbuddy-ai）',
  '华为云 Huawei Cloud MaaS（huaweicloud，含 Token Plan）与 CodeArts（码道）',
])

export const DISCLAIMER = Object.freeze({
  version: DISCLAIMER_VERSION,
  title: '使用须知与免责声明',
  subtitle: '关于本分支恢复提供的渠道，以及你需要知道的责任边界',
  intro: '本插件是一个个人学习与技术研究项目，用于学习模型网关、协议适配与本地路由的实现方式，按「现状」提供，不构成任何商业服务或产品承诺。',
  sections: Object.freeze([
    {
      id: 'restored',
      heading: '本分支重新提供这三个渠道',
      body: '与上游不同，本分支重新提供 WorkBuddy 国内版（workbuddy，亦称 CodeBuddy）、WorkBuddy 国际版（workbuddy-ai）与华为云 Huawei Cloud MaaS（huaweicloud，含 Token Plan）及 CodeArts（码道）：渠道列表、预设、登录入口、插件市场与模型目录里都会出现，可以添加、登录和使用。上游之所以移除它们，是因为服务 WorkBuddy 的社区适配会以 WorkBuddy 自家桌面客户端的身份签名请求，上游不愿承担该风险；本分支把这一选择交回给你，也把这个风险一并交给你。',
    },
    {
      id: 'responsibility',
      heading: '使用这些渠道由你自己负责',
      body: '你通过本插件或任何其他方式使用上述渠道或其他第三方服务，包括自行配置地址、导入凭据、安装第三方插件或登录他人账号，均属于你的个人行为，与本项目作者及团队无关。我们不参与、不背书、不提供支持，也不对其可用性、合规性或任何后果承担任何责任。',
    },
    {
      id: 'accounts',
      heading: '账号与凭据由你自己负责',
      body: '本插件只在你本机保存你主动导入的凭据，不会上传到任何服务器。请确保你使用这些账号的方式符合对应服务商的条款与所在地法律；由此产生的封禁、扣费、数据风险或其他损失，由使用者自行承担。',
    },
    {
      id: 'no-warranty',
      heading: '不提供任何担保',
      body: '本项目不对正确性、稳定性、适销性或特定用途适用性作任何明示或默示担保。使用本插件造成的任何直接或间接损失，作者与团队均不承担责任。请自行评估风险，并优先遵守所在地区的法律法规与服务商协议。',
    },
    {
      id: 'lawful',
      heading: '请合法合规使用',
      body: '本项目仅用于个人学习与技术研究。请勿将其用于违反服务商条款、规避授权限制、批量滥用额度或其他违法用途。因使用方式不当引发的争议、索赔或法律责任，均由使用者自行承担。',
    },
  ]),
  accept: '我已阅读并了解',
  reopen: '查看免责声明',
})

/** Whether a stored acknowledgement matches the current copy version. */
export function disclaimerAcknowledged(settings) {
  return Number(settings?.disclaimerAck) === DISCLAIMER_VERSION
}

/**
 * ## 独立服务的免责声明（与插件版**不是**同一份）
 *
 * 上面那份 `DISCLAIMER` 是给 **DSH 插件**用的，讲的是「本分支与上游的差异」
 * （恢复了哪些渠道、上游为什么移除）。独立服务（`packages/standalone`，即
 * `npx` / 桌面端那个网页控制台）的用户根本没装 DSH、也没见过上游，把
 * 「本分支重新提供这三个渠道」摆在他面前只会莫名其妙。
 *
 * 独立服务真正要回答的是另外三件事：
 *
 * 1. **不需要 DSH**：一个 Node 进程 + 一个网页控制台，一条命令直接起；
 * 2. **数据只在本机**：凭据只写入本地数据目录，不读也不写 DSH 的任何东西；
 * 3. **它只是网关，不是模型提供方**：额度与可用性由各渠道服务方决定。
 *
 * ⚠️ 版本号与插件版**独立**：`STANDALONE_DISCLAIMER_VERSION` 变动只让独立服务
 * 的用户重新确认一次，不会波及 DSH 里已确认过的用户（两者各存各的 settings）。
 */
export const STANDALONE_DISCLAIMER_VERSION = 1

export const STANDALONE_DISCLAIMER = Object.freeze({
  version: STANDALONE_DISCLAIMER_VERSION,
  title: '使用须知与免责声明',
  subtitle: '这是一个在本机运行、自带网页控制台的模型网关，不是模型提供方',
  intro: '本程序是一个个人学习与技术研究项目，用于在本机统一接入多家模型服务并提供 OpenAI 兼容的本地网关，按「现状」提供，不构成任何商业服务或产品承诺。',
  sections: Object.freeze([
    {
      id: 'what',
      heading: '它是什么：一个本地网关，与 DSH 无关',
      body: '独立服务不需要安装 DSH，也不依赖任何宿主环境：一条命令启动一个本地进程，用浏览器打开它打印的管理链接即可操作。它与 DSH 插件是两套彼此独立的程序，互不读取对方的配置或凭据——你在插件里的账号不会自动出现在这里，反之亦然。',
    },
    {
      id: 'upstream',
      heading: '它不提供模型，只为你的凭据做转发与路由',
      body: '本程序不含任何模型能力。所有回答都由你自行配置的第三方服务产生，能否使用、额度多少、是否收费、是否符合条款，全部由对应服务方决定；本程序只在你本机做协议适配与请求路由，不参与定价，也不对其可用性作出承诺。',
    },
    {
      id: 'accounts',
      heading: '账号与凭据只存在这台机器上',
      body: '你主动导入或登录得到的凭据，只写入本机的数据目录，不会上传到本项目作者或任何第三方服务器。请确保你使用这些账号的方式符合对应服务商的条款与所在地法律；由此产生的封禁、扣费、数据风险或其他损失，由使用者自行承担。',
    },
    {
      id: 'network',
      heading: '默认只在本机监听',
      body: '管理页面与 API 默认仅监听回环地址（127.0.0.1），只有本机能访问。如果你自行开启局域网转发或修改监听地址，等于把入口暴露给对应网络，请自行评估并承担由此带来的风险。',
    },
    {
      id: 'no-warranty',
      heading: '不提供任何担保',
      body: '本项目不对正确性、稳定性、适销性或特定用途适用性作任何明示或默示担保。使用本程序造成的任何直接或间接损失，作者与团队均不承担责任。请自行评估风险，并优先遵守所在地区的法律法规与服务商协议。',
    },
    {
      id: 'lawful',
      heading: '请合法合规使用',
      body: '本项目仅用于个人学习与技术研究。请勿将其用于违反服务商条款、规避授权限制、批量滥用额度或其他违法用途。因使用方式不当引发的争议、索赔或法律责任，均由使用者自行承担。',
    },
  ]),
  accept: '我已阅读并了解',
  reopen: '查看免责声明',
})

/** 独立服务的确认判据：同一套 settings 契约，各用各的版本号（见上）。 */
export function standaloneDisclaimerAcknowledged(settings) {
  return Number(settings?.disclaimerAck) === STANDALONE_DISCLAIMER_VERSION
}
