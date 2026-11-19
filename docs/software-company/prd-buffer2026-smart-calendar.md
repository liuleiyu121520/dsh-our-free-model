# PRD：Standalone 管理台 Buffer 2026 换肤 + 智能调度（Smart）+ 用量日历 + 纯 Standalone 线清理（v2）

| 项 | 内容 |
|---|---|
| 文档版本 | **v3.2**（2026-11-19） |
| 文档状态 | **PRD_READY**（需求已 Ready，可进入架构设计；架构师将在此基线上出方案 v3） |
| 产品线 | dsh-our-free-model / packages/standalone（独立 lite 形态，本分支起为纯 standalone 产品线） |
| 开发分支 | `feat/standalone-lite`（自尖端 838a64b 起开发，**不合并 main**） |
| 需求来源 | 用户与交付总监完成的澄清决议（决议 1-6 见 v1；决议 7-8 于 2026-11-17 增补，均为验收基线，见「决策记录」） |
| 撰写 | 产品经理 许清楚 |
| 代码基线事实 | 只读摸底 + v1/v2 撰写前二次核实（关键行号见附录 A） |

**v1 → v2 变更记录**

1. 新增决议 7「入口级清理」：FR-10、AC-20 阶段化拆分、AC-21～AC-26、阶段计划 S1-S10、D16/D18/D21/D22/D23。
2. 新增决议 8「impeccable UI 终审」：FR-11、AC-27～AC-28、D17/D24。
3. 原「明确不做：client.js、Tauri 壳」被决议 7 取代：S1-S7 期间不动，S8 起在本分支删除（main 不受影响）。Out of Scope 与 G4 相应重述。
4. 发布说明草稿补充「本版本起该分支为纯 standalone 线」。
5. v2.1（方案 v3 S8 清单确认事项复核）：`desktop-test.mjs` + `prepare-desktop.mjs` 改列删除对象（被测/服务对象为 packages/desktop 壳）；`client-terminal-test.mjs` 改列保留（被测对象在 pack 闭包内）；确认 D23 执行细则 = E-4 机械归类 + E-8 判定脚本输出附阶段门记录，并补「共享辅助按反向依赖定去留」双向条款。
6. v2.2（决议 9 公开发布）：新增 FR-12「S11 公开发布」（npm publish our-free-model-standalone@1.1.0 + push origin，授权范围见 D25）、AC-30～AC-35、阶段表 S11 行、D25/D26、R10；发布说明补「发布渠道」。FR-1～11 与 AC-1～29 未改动。
7. v3.0（决议 10，用户验收 1.1.0 后当面裁定）：**A 裁剪为 6 页**（FR-13，删除其余页面与 lite/full 双模架构，--full 旗标移除）；**B 深度换肤**（FR-14，夜主题换暖灰绿深底、昼夜同构、终端纹理清单化移除，推翻 D24 视觉保留面）；新增 AC-36～AC-40、阶段 S12-S15、D27～D30、R11～R13；版本 1.2.0（D29「未传播」口径论证）。被取代条目以〔v3.0：…〕内联标注，原文保留（审计链）。
8. v3.1（决议 11，v1.2.1 快速迭代，**本轮不发布 npm，交付物=本地可验收版本**）：新增 FR-15（auto 多模态路由：视觉能力来源/含图过滤/400-429 细分/缺失降级）、FR-16（候选停用隐藏+恢复开关、池状态区内联化 M/N、布局重分配）、AC-41～AC-44、阶段 S16-S17（S17 待用户批准）、D31～D34、R14～R15。FR-3.6 与 FR-13.4 中被推翻的 S12 偏差 7 设计以〔v3.1〕标注。
9. v3.2（用户 2026-11-19 自更新需求 + 验收迭代追认，交付物 = 1.2.5 自更新版本）：新增 FR-17（npm 全局实例自更新：每小时检查/右上角 messageTip 轻提示/一键更新/自重启/非全局禁用/失败反馈）、AC-45～AC-50、阶段 S18-S20（S20 发布 1.2.5，**待用户批准**）、D35～D38、R16～R17；S17 行补记验收迭代实际演进（registry latest=1.2.4，2026-11-19 实测）。追认标注（审计链补全，D38）：FR-15.6（/v1/models auto 行动态 vision 标识，1.2.3 已实装）；FR-16 两条〔v3.2：验收迭代细化〕（候选「显示无可用账号」开关、页面无纵向滚动条+保存轻提示，用户 2026-11-17 裁定）；FR-3.5〔v3.2 作废〕（用户 2026-11-19 裁定移除横幅，已随 1.2.4 落地）。

---

## 1. 背景与目标

### 1.1 问题定义

dsh-our-free-model 的 standalone 形态把多个免费渠道账号聚合为一个本机 OpenAI 兼容网关（默认端口 18900）。当前存在四个问题：

1. **配额碎片化**：每个模型背后是多账号轮换，但「模型级」的当日耗尽只能靠调用方换模型重试。用户希望指定一个优先顺序，让网关在模型之间自动顺序接力，对外只暴露一个 `auto` 模型名。
2. **观测碎片化**：token 用量（stats.json 按天按模型桶）与积分领取（auto-checkin.json 仅存最近一次运行摘要）没有统一的按日视图，用户无法回答「今天每个模型烧了多少 token、每个渠道领了多少积分」。
3. **视觉过时**：现有「纸面工作台」暖色系（app.css:3-59，注意当前 `--green: #2656c9` 实为蓝色）与目标品牌方向不符，用户要求全站换肤为 Buffer 2026 风格。
4. **分支身份残留**：`feat/standalone-lite` 源自 DSH 插件仓库，仓库根仍带着插件半身（index.js / client.js / cordis.patch.yml）、Tauri 桌面壳与插件发布链。功能全部完成后，本分支应清理为纯 standalone 产品线（main 分支的插件版本不受影响）。

### 1.2 目标用户

- **个人开发者（唯一 persona）**：在本机运行 standalone 服务、登录多个免费渠道账号、通过 OpenAI 兼容 API 接入 IDE / 对话客户端 / 智能体的用户。单用户本机场景，无多租户需求。

### 1.3 目标与成功指标

| # | 目标 | 可度量指标 |
|---|---|---|
| G1 | 对外提供 `auto` 顺序接力模型 | 以 `model=auto` 调用，按池顺序命中第一个未耗尽模型；耗尽模型当日不再重复尝试 |
| G2 | Buffer 2026 换肤 | 全站设计 token 全量替换，昼/夜双主题下 16 个页面（14 现有 + smart + calendar）无未定义样式变量、正文对比度 ≥ 4.5:1 |
| G3 | 用量日历 | 月视图每格可展示当日各模型 token 消耗与完成领取的渠道数；悬停/点击有明细 |
| G4 | 零回归（**阶段化基线**，见 AC-20/AC-21～AC-26） | S1-S7：插件半身文件零改动、`business.mjs` 与 lite 模式不变、src/ 共享内核扩展对既有行为字节级兼容；S8 起：standalone 行为与清理前等价 + main 分支不受影响 |
| G5 | 纯 standalone 线 | 清理后仓库无插件半身/桌面壳/发布链残留引用；root package.json 为可用的 standalone 命令入口 |

---

## 2. 范围与非范围

### 2.1 范围（In Scope）

`packages/standalone`（CLI 入口 `cli.mjs`、服务 `service.mjs`、管理 API `management.mjs`、前端 `frontend/`），为满足目标所必需的 `src/` 侧**只读复用与最小接入点**（如 `src/forward.js` 的模型清单注入、`src/store.js` 的 SETTINGS_INITIAL 扩展——均为既有惯例内的字段级扩展，不改变现有语义），以及两个收尾阶段：

1. FR-1～FR-2：全站 Buffer 2026 换肤 + 集中式侧栏改造。
2. FR-3～FR-6：智能调度（Smart）页、`auto`/`ourfreemodel` 网关别名、`/v1/models` 暴露、API 接入页说明。
3. FR-7～FR-9：用量日历页、领取历史记录、新页面注册链路。
4. FR-10：入口级清理（S8，功能全部完成并回归通过后执行；属 DEVELOPMENT_ASSET_WRITE，仅作为已批准方案的阶段执行）。
5. FR-11：impeccable UI 终审与精修（S9，清理完成后执行）。
6. FR-12：公开发布（S11，npm 包 + 分支推送；决议 9 明确授权，见 D25）。

### 2.2 非范围（Out of Scope，明确不做）

1. **不改 `packages/standalone/channels/business.mjs`**（channel-pack 构建产物，只能经 `/api/management/channels/rpc` 调 RPC）——全程有效。
2. **不改造 `src/combos.js`** 的 5 种轮换策略语义；本次调度语义固定为「顺序接力」（架构师可评估复用其基础设施，但对外行为以本 PRD 为准）。
3. **不改变 lite 精简模式**（`LITE_PAGES` 三页）的页面集合；新页面不进入 lite 导航。〔v3.0：被决议 10A 取代——lite/full 双模架构整体删除，lite 即产品，见 FR-13〕
4. **不回填历史领取数据**（channel-pack 未留存按天历史，物理上不可回填；见 FR-8 语义）。
5. 不做多用户、鉴权体系变更、LAN 权限模型变更。
6. 不做 EAC 协付、聚合渠道、路由组等现有页面的功能增删（仅随 token 换肤自动受益）。
7. **不合并回 main**；清理动作仅发生在 `feat/standalone-lite`，main 分支的插件版本及其发布链不受任何影响。
8. **不修剪依赖图**：`src/` 共享内核与 `vendor/channel-pack`（含 `vendor/magpie`）原样保留（决议 7 明确）。清理仅限「入口级」对象，不做更深层的依赖闭包修剪。
9. S1-S7 功能阶段**不触碰** DSH 插件半身与 Tauri 壳（它们的删除统一放到 S8，见 FR-10；此为对 v1 原 Out of Scope 第 1-2 条的阶段化重述）。

---

## 3. 用户故事

- **US-1**：作为个人开发者，我希望在管理台勾选若干渠道模型并排出优先顺序，之后所有客户端只需配置 `model=auto`，排第一的模型配额耗尽后网关自动落到下一个，当天不再反复撞已耗尽的模型——这样我在 IDE 里永远只需要填一个模型名。
- **US-2**：作为个人开发者，我希望一眼看出 `auto` 现在会命中哪个模型、哪些已被当日跳过、各自何时解禁——这样我能判断要不要手动换模型。
- **US-3**：作为个人开发者，我希望打开一个 Buffer 风格的月历，每天一格看到「各模型烧了多少 token、几个渠道完成了领取」，悬停有明细、点击有全天详情——这样我每周花 10 秒就能复盘免费额度的消耗节奏。
- **US-4**：作为个人开发者，我希望全站界面换成暖中性底色 + 活力绿主色的 Buffer 2026 风格，昼/夜主题都精致——这样长期盯着的工具不再视觉疲劳。
- **US-5**：作为个人开发者，我希望在「API 接入」页直接看到 `auto` 的说明和可复制的 curl 示例——这样给新客户端接线时不用翻文档。
- **US-6**：作为个人开发者，我希望这个分支最终是一个干净的纯 standalone 代码库：插件半身、桌面壳、发布链全部移除，剩下的每条命令都能跑、每个产物都等价——这样后续维护不再背着不属于这个产品的代码。

---

## 4. 功能需求（FR）

> 页面注册链路事实（FR-9 的依据）：侧栏定义于 `packages/standalone/frontend/components/shell.tsx:8-28`（4 组 14 页）；`frontend/types.ts:1` 的 `Page` 联合类型；`frontend/app.tsx` 的 `host.navigate` 白名单由 `liteNavigationPages()` 从 `navigation` 数组**推导**（shell.tsx:45-55），因此新页面加入 `navigation` 即自动进入白名单，无需另改白名单。分发点在 `packages/standalone/service.mjs` 的 `complete` 包装（`channels.handles(request.model) ? channels.complete : core.complete`，service.mjs:288-296 一带）。

### FR-1 全站 Buffer 2026 设计 token 全量替换
> 〔v3.0：本条色板与主题基线被 FR-14 深度换肤取代（昼冷灰白→暖纸面、夜近黑冷底→暖灰绿深底、纹理清零）；变量名结构保留、双主题完整性与 View Transition 要求继续有效。作为 1.1.0 已验收的历史阶段门保留原文〕

1. 替换 `frontend/app.css` 中的设计 token 体系（`--dsw-alias-*` 全套及派生 token）：**暖中性底色、活力绿主色（vibrant green，替换现值实为蓝的 `--green`/accent 系）、柔和圆角（组件级 radius 提升）、轻字重（标题/正文降一档字重）**。方向依据用户决议引用的 Buffer 官方设计声明（calmer / more flexible）。
2. **保留变量名结构**（组件引用不破坏），替换取值；允许新增 token，不允许删除仍被引用的变量名。
3. 昼/夜双主题都必须完整定义新 token；现有 View Transition 主题切换（shell.tsx:59-101）与 `prefers-reduced-motion` 降级行为保留。
4. 现有 14 个页面不做结构性改动，仅随 token 自动受益；页面专属 css（如 connection.css）中的硬编码色值需同步映射到新 token。
5. 焦点态、悬停态、选中态（如侧栏 `console-nav-indicator`）在新色板下可辨识。

### FR-2 集中式侧栏（Buffer 风格：分组 + 徽标计数）

1. 侧栏保持「品牌区 → 工作空间标识 → 分组导航 → 底部状态/主题切换/退出」的集中式结构，视觉按 Buffer 新版侧栏模式重做（更轻的分组标题、徽标计数、更克制的选中指示）。
2. 徽标计数（`count-badge` 模式扩展，至少覆盖）：
   - 「智能调度」条目：池内**当前可用**（未当日耗尽）的模型数；
   - 「模型与开关」条目：沿用现有目录计数（shell.tsx:133）。
3. 新增两个导航条目（页面 id 见 FR-9）：
   - `smart`「智能调度」加入「免费模型」分组（models/channels/connection/requests 所在组）；
   - `calendar`「用量日历」加入「工作空间」分组（overview/workspace/agents/usage/library 所在组），紧邻「用量统计」。
4. lite 模式下不显示新条目（不加入 `LITE_PAGES`）。〔v3.0：2.3 分组与 2.4 lite 屏障语义均被 FR-13 导航重组（三分组 6 页）与双模删除取代；smart 徽标保留〕

### FR-3 智能调度（Smart）页

1. 模型清单来源：经 `/api/management/channels/rpc` 调 `model.list`，**过滤 `disabled` 条目**；每行展示模型 id、provider、绑定账号数、当前可用账号数（依据账号 `modelRateLimits` 推导的「可用 / 当日耗尽」状态）。
2. 支持勾选加入调度池；池内条目支持**拖拽排序与上移/下移按钮**两种方式（按钮为键盘/无拖拽环境的等效路径，缺一不可）。
3. 池配置持久化到 `settings.json`（经 `SETTINGS_INITIAL` 新增顶层字段，JsonStore 浅合并自动补齐，符合 src/store.js 惯例）。服务重启后勾选与顺序不丢。
4. 失效条目（模型已从渠道下架、被 disabled、账号全部删除）在池列表中标灰并提示「已失效」，调度时自动跳过；不自动删除条目（用户可手动移除）。
5. 页面头部常驻说明：`auto`（别名 `ourfreemodel`）的接力语义一句话摘要。〔v3.2 作废：用户 2026-11-19 裁定移除横幅——smart 页头部常驻接力语义说明横幅已移除（随 1.2.4 落地）；`auto` 接力语义说明仍由「API 接入」页说明卡（FR-6.2）承载〕
6. 页内提供「池状态」区：每个池内模型当前状态（可用 / 当日已跳过 + 解禁时刻）、以及当前 `auto` 请求实际会命中的第一个模型。〔v3.1：被决议 11C 取代——独立池状态区移除，状态内联至池行（M/N + 解禁时刻），见 FR-16.3〕

### FR-4 `auto` 别名网关语义（顺序接力）

对外网关（`/v1/chat/completions`、`/v1/responses`、`/v1/messages`，即 src/forward.js 全部推理端点）接受 `model = auto`（规范名）与 `model = ourfreemodel`（别名，二者等价；建议做小写归一后精确匹配，不匹配任何带 `provider/` 前缀的渠道模型）：

1. **顺序接力**：按调度池顺序取第一个「可用」模型分发。「可用」= 该模型存在于 model.list 且未 disabled，且至少一个 enabled 账号的 `modelRateLimits[modelId]` 不在未来（预检跳过，不发网络请求）。
2. **账号轮换沿用**：命中某具体模型后，其内部多账号轮换、配额标记、`modelRateLimits` 只接受更长解禁时刻等现有规则**与直接调用该模型完全一致**，不重复实现。
3. **接力触发条件（唯一）**：该模型所有账号当日配额耗尽（channel-pack 抛出 `QUOTA_EXCEEDED` 类错误，见 business.mjs:36292「所有账号均受限」）或预检判定已耗尽 → 落到池中下一个可用模型。**其他错误（网络、5xx、能力不匹配等）不触发接力**，错误行为与直接调用该模型完全一致。
4. **当日防冗余**：已被判定耗尽的模型，当日（其账号 `modelRateLimits` 解禁时刻之前）后续 `auto` 请求直接跳过、不重复尝试。跳过状态**由持久化的 `modelRateLimits` 派生**（不新建独立跳过缓存），因此服务重启后跳过状态自动正确。
5. **流式保护**：接力只允许发生在「尚未向客户端下发任何输出字节」之前；一旦已开始下发（首 chunk 已出），即使后续失败也不再切换模型，按现有错误/恢复语义处理。依据：service.mjs 包装层已有首字节跟踪。
6. **全池耗尽（用户建议已验证，采纳）**：返回 **HTTP 429**，错误信封遵循 OpenAI 兼容结构（`error.type = "rate_limit_error"`，`error.code = "insufficient_quota"` 或等价 429 分类），`error.message` 中文说明「调度池内全部模型当日配额耗尽」；并在响应体内附**机器可读的各模型解禁明细**（每个池内模型一条：模型 id + 最早解禁时刻，epoch ms 与 ISO 8601 至少其一；字段命名由架构师定，验收见 AC-8）。扩展字段必须放在 SDK 可忽略的位置，不破坏 OpenAI SDK 解析。
   - 合理性验证结论：与 OpenAI 官方 429/`insufficient_quota` 语义一致，与 src/failure.js:23-24 现有 429 映射一致；SDK 对未知扩展字段容忍。
   - 实现注意（非需求）：channel-pack 的错误码字面量是 `QUOTA_EXCEEDED`，而 src/failure.js 映射表中的字面量是 `QUOTA_EXHAUSTED`；standalone 层须确保耗尽错误最终以 429 呈现（当前直接透传可能落到 502 兜底）。此为工程验证项，验收只看对外契约。
   - **模型最早解禁时刻定义**：该模型全部 enabled 账号 `modelRateLimits[modelId].resetAtMs` 的**最小值**（最早有账号恢复的时刻）。
7. **空池 / 池内全部失效**：返回 **HTTP 400** `invalid_request_error`，消息明确指引「调度池为空/无可用模型，请在管理台-智能调度页配置」。这是配置错误而非限流，不用 429。
8. **`auto` 条目与真实模型冲突**：渠道模型均带 `provider/` 前缀（channels.handles 的识别规则），`auto`/`ourfreemodel` 为保留名；若未来出现同名渠道模型，保留名优先，且 PRD 视为冲突需回到需求评审。
9. **请求日志**：`auto` 请求在请求日志（requestLog）中需可辨识最终命中的真实模型（如记录 `auto→真实模型` 或等价信息），便于排障；token 用量计入**真实命中模型**的 stats 桶（`days[日].models[真实模型]`），不新增 `auto` 统计桶。

### FR-5 `/v1/models` 暴露 `auto` 条目（用户建议已验证，采纳）

1. `GET /v1/models`（src/forward.js:380-382）在清单**头部**追加**恰好一条** `id: "auto"` 的条目（展示名如「OurFreeModel 智能调度」，owned_by 等字段形态与现有条目一致）。
2. **始终暴露**（即使池空），保证客户端预配置的模型名不会消失；池空时的调用行为见 FR-4.7。
3. 别名 `ourfreemodel` **不在** `/v1/models` 中重复列出（避免客户端下拉出现两个等效条目），但请求侧照常接受。

### FR-6 「API 接入」页（connection.tsx）增强

1. 模型选择区（ModelPicker）置顶固定一项 `auto`（含说明徽标「智能调度」），选中后下方代码示例（curl / Python / Node 三个 Tab，connection.tsx:88-131）中的模型名联动为 `auto`。
2. 页内新增一段 Auto/OurFreeModel 说明卡：一句话语义（按调度池顺序接力、配额耗尽自动落下一个）、两个模型名等价说明、以及一条独立的 `model=auto` curl 最小示例（可复制）。
3. 「客户端配置」预设 Tab 中的 Model ID 值随选择联动（含选中 `auto` 时显示 `auto`）。

### FR-7 用量日历页（Buffer 风格月视图）

1. **月视图**：默认当月，可切换上/下月；周一或周日起始由设计稿定（默认周一，与中国日历习惯一致），周末列有视觉区分。
2. **每格内容**：
   - 当日各模型 token 消耗总量（input+output+reasoning 合计，来源于 stats `days[YYYY-MM-DD]`）；多模型时显示「总量 + 模型数」或迷你分布（设计稿定，验收只要求总量与模型数可见）；
   - 当日**完成领取的渠道数**（来源于 FR-8 领取历史，当日存在「领取成功」记录的去重渠道数）。
3. **悬停明细卡片**：列出当日每个模型消耗的 token 数（input/output/reasoning 分列或合计，至少合计），以及当日每个渠道的领取结果摘要（渠道名 + 领取量文本；领取量为渠道包提供结构化数据时的数值，否则为记录的摘要文本）。
4. **点击当日格**：右侧滑出**当日详情抽屉**（Buffer 草稿侧栏式交互）：逐模型 token 明细（含 calls 次数）、逐渠道领取明细、当日合计。
5. **无数据语义（验收关键）**：
   - **功能上线前的历史日期**（领取历史文件不存在该日记录）：日历该格领取区显示「无数据」态（不显示 0，明确区分「0 个渠道领取」与「该日未记录」）；token 消耗仍正常显示（stats 有 120 天历史）。
   - 当日格中「今天」有高亮；未来日期格显示为不可交互的空态。
6. 数据读取性能：切换月份一次拉取当月数据，不逐格请求。

### FR-8 渠道领取历史记录（可行性关键点，已按用户决议固化为验收语义）

**事实依据**：channel-pack 的 `auto-checkin.json`（schema `channel-pack/auto-checkin/v1`，business.mjs:60869-60961）仅保存**最近一次运行**的状态（`{enabled, lastDate, lastResult, lastAt, channels[{provider, text}≤24 条], dismissedRunAt}`），**没有按天按账号历史**；且该循环运行在 business.mjs 内部（禁止修改）。

1. **领取历史由 standalone 层新增记录**，持久化为独立 JsonStore（新文件，如 `claims-history.json`），顶部带 schema 版本字符串（符合「统计类新建独立 JsonStore + schema 版本」惯例）。
2. **记录来源（两条，架构师可调整实现但覆盖面不得缩水）**：
   - a. 经 management 层转发的手动 `credits.claimAll` 等 credits 类 RPC：包装记录每次调用的逐渠道结果；
   - b. 渠道包内部自动签到：standalone 层通过可用的 RPC（如 `usage.autoCheckin` 返回的 `autoCheckin.state()`）**轮询/读取状态快照**，在 `lastAt` 变化时落一条当日记录（至少含 provider、结果文本、时间戳；若状态含结构化金额则一并记录）。轮询间隔不得导致漏记一次运行（自动签到默认 60 分钟一次，轮询间隔建议 ≤ 10 分钟，最终由架构师按功耗/IO 权衡）。
   - 备选方案（架构师可评估）：由 standalone 层接管自动领取循环（关闭 channel-pack 内部开关、服务侧定时调 `credits.claimAll` RPC），可获完整结构化历史；约束：默认开启与 60 分钟节奏不得回退，`business.mjs` 不改。若采用此方案需回本 PRD 备案变更。
3. **记录粒度下限**：事件级 `{at(ms), provider, 摘要文本, (可得时)金额/单位, 来源(手动/自动)}`；按本地日聚合入 `days[YYYY-MM-DD]`（与 stats `dayKey` 同为本地时区口径，store.js:150-152），裁剪策略与 stats 一致（120 天）。
4. **历史空白语义**：功能上线日起记录；之前的日期在日历中显示「无数据」（见 FR-7.5），**不得伪造 0 值**。
5. management API 新增只读查询端点（命名由架构师定，如 `GET /api/management/claims/history?from=&to=`），按日期范围返回按日聚合结果；受管理会话鉴权保护。

### FR-9 新页面注册链路（一致性需求）

1. 新页面 id：`smart`、`calendar`；需同步三处以保证一致：shell.tsx `navigation` 数组（自动推导白名单）→ types.ts `Page` 联合类型 → app.tsx 页面渲染（LazyPage/懒加载模式与现有一致）。
2. `pageNames` 映射、Topbar 面包屑（shell.tsx:103-107）同步补齐。
3. 直达 URL/刷新后状态保持行为与现有页面一致（沿用现有 page 状态机制）。〔v3.0：注册机制（navigation→Page 联合→渲染→白名单推导）保留并继续适用；页面集合变更见 FR-13〕

### FR-10 入口级清理：本分支转为纯 standalone 线（决议 7）

> 执行边界：清理属 DEVELOPMENT_ASSET_WRITE，**只能作为已批准方案的 S8 阶段执行**（前置条件：S1-S7 功能全部完成且回归通过）。本 PRD 定义目标状态与验收判据；删除清单的逐文件定案由架构师在 S8 阶段门产出并经确认后执行。

**S1-S7 期间约束（清理前语义，见 AC-20）**：插件半身与 Tauri 壳文件零改动；`src/` 共享内核的扩展保持既有导出与行为不变（对插件侧维持字节级兼容），保证清理前的基线测量有效。

**S8 删除对象（用户决议枚举，验收基线）**：

| 类别 | 对象 |
|---|---|
| DSH 插件半身 | 根 `index.js`、`client.js`、`cordis.patch.yml` |
| Tauri 桌面壳 | `packages/desktop/` 整目录 |
| 插件发布链 | `catalog/`、`feed/` 整目录 |
| 插件相关 scripts | 仅服务插件半身/发布链/桌面壳的脚本（如 `build-manifest.mjs`、`prepare-release.mjs`、`release-e2e.mjs`、`release-preparation-test.mjs`、`build-sponsor.mjs`、sponsor 系、`client-lint.mjs`（静态检查 client.js 与 locale 字典）、`desktop-test.mjs` + `prepare-desktop.mjs`（被测/服务对象为 packages/desktop 壳，**v2.1 改列删除**）、catalog/feed/legacy-upgrade 对应测试等——**以 E-4 机械归类为准，不凭名字猜**，见下方 D23 执行细则） |
| .github workflows | `prepare-release.yml`、`release-sign.yml`（插件发布/签名）、`build-macos.yml`（桌面壳 dmg）；`test.yml` 保留但同步修剪指向已删资产的 job/step（若有） |
| 插件专属 docs 与测试脚本 | 仅述插件发布/签名/插件 issue 史/sponsor 的 docs（如 `RELEASING.md`、`ci-required-checks.md`、`contributor-ci-signing.md`、`issue-*.md`、`sponsor-advertisement.md`、`releases/` 等——逐文件判定）；standalone 与共享内核 docs（如 `free-lane-wire.md`、`standalone-web-management-verification.md`、`docs/software-company/`、`testing/`、`verification/` 等）保留 |

**E-4 灰区机械归类（D23 执行细则，v2.1 确认）**：E-2/E-3 未逐一点名的其余 scripts（fixtures/、probes/、scripts/lib/、具名测试）按机械规则归类，不逐文件预枚举、不凭名字猜：
- (a) 被测对象（import 的被测模块）为 `src/` 或 standalone 保留文件 → **保留**；
- (b) import/index.js/client.js/adapter/packages/desktop/catalog/feed/仅插件 UI → **删**；
- fake-kernel 命中者再做二次核查：含 `src/` 或 standalone 被测 import → 保留；
- **双向依赖条款（PM 补充）**：共享辅助（如 `scripts/lib/*`）被任一保留脚本依赖则保留，仅被删除脚本依赖则随之删——已核实 scripts/lib/ 同时被保留侧（build-channel-pack、channel 系、forward 系等）与删除侧（build-manifest、catalog-test 等）依赖，必须逐个按反向依赖定去留；
- 归类结果由 E-8 判定脚本在 S8 执行时输出并附于阶段门记录，作为 AC-22「清理完整性」的清单依据。

**S8 保留对象（硬约束）**：

1. `src/` 共享内核与 `vendor/`（channel-pack、magpie）**原样不动**，不做依赖图修剪（决议 7 明确）。
2. standalone 全链命令所需的一切脚本。**已核实的保留证据（不得误删）**：
   - `scripts/build-legacy-payload.mjs`：其产物 `src/o2a.js` 在 `pack:standalone` 的 sourceFiles 闭包内（pack-standalone.mjs 注释明确），属 standalone 构建链；
   - `scripts/build-channel-pack.mjs`、`build-standalone-channels.mjs`、`build-standalone-ui.mjs`、`build-magpie-engine.mjs`、`update-magpie-engine.mjs`、`pack-standalone*.mjs`、`standalone-*` 系测试、`measure-standalone-ui.mjs`、`standalone-third-party.txt`：standalone 构建/测试链；
   - `scripts/client-terminal-test.mjs`：被测对象 `packages/standalone/client-terminal.mjs`（在 pack sourceFiles 闭包内），**v2.1 自删除枚举移出、确认保留**（删除将失去该模块测试覆盖）；
   - 测试 `src/` 共享内核的套件（aggregate/forward/stream/subscription 等系）：被测对象保留，测试保留；
   - 测 standalone 自身能力的桌面相关测试：`desktop-update-test.mjs`（被测对象 `packages/standalone/desktop-update.mjs`——updates 页仍按 `hasDesktopBridge()` 条件显示，功能不受 S8 影响）与 `standalone-desktop-regression-test.mjs`（被测对象 `packages/standalone/eac.mjs`、`open-external.mjs`）。**v2.1 修订**：`desktop-test.mjs` 与 `prepare-desktop.mjs` 的被测/服务对象是 `packages/desktop/` 壳（service-host.mjs、tauri.conf.json、titlebar.js/css、install-hooks.nsh），改列删除对象；`test-all.mjs` 的 `desktop` 套件（test-all.mjs:90）随之修剪；对二者的其余引用仅 build-macos.yml（本就删除），无保留侧依赖。
3. `worker/`（Cloudflare Worker 部署件）与 `dist/`（构建产物）**不在删除清单**：worker/ 是独立部署的基础设施而非仓库入口级代码，dist/ 为生成物（PM 保守决策 D22；如架构闭包分析证实 worker/ 仅服务已删链路，可在 S8 清单中提出并单独确认）。
4. `adapter/`（dsh-llm.d.ts + kernel.js）、`locale/`（插件 i18n）属插件半身伴生资产：按「仅被插件半身引用、且不在 standalone 依赖闭包（pack:standalone sourceFiles）内」规则并入删除清单，由架构师 grep 证实后定案（D23）。

**S8 root package.json 目标状态（用户委托 PM 定义，D18）**：

保留为仓库根 npm 清单与命令入口，剥离插件 manifest 身份：

1. **保留**：`name`、`version`、`private`、`type`、`description`（改写为纯 standalone 描述）、`repository`/`homepage`/`bugs`、`engines`、`license`，以及全部 standalone 命令：`pack:standalone`、`test:package`、`start:standalone`、`test:standalone`、`test:management`、`build:standalone-channels`、`build:standalone-ui`、`build:magpie`、`update:magpie`、`typecheck:standalone`、`test:standalone-channels`、`test`、`test:contributor`、`test:release`、`channel-pack`、`typecheck`、`build:legacy-payload`——**逐条可执行成功**。
2. **剥离**：`dsh` 字段（插件 manifest）、`main`、`exports`（插件入口）、`files`（插件打包清单）、`peerDependencies`（@deepseek-ai/cordis 系）、`overrides`（dsh-llm-legacy 系——若闭包证实 build-legacy-payload 依赖则保留并在清单中注明）、`keywords` 中的 `dsh`/`dsh-plugin`。
3. **scripts 修剪**：删除指向已删文件的命令（如 `manifest`、`manifest:check`，及经判定为插件专属的 `selftest` 等）；`scripts/test-all.mjs` 的 suites 列表同步修剪（移除 manifest/catalog/legacy-upgrade 等引用已删文件的 release 套件），修剪后 `npm test` 全绿。
4. **devDependencies**：仅可移除「经依赖闭包核实无引用，且删除后全部保留命令可运行」的项（如 @deepseek-ai 系）；存疑一律保留。

**S8 验证判据（用户给定方向 + PM 细化，见 AC-21～AC-26）**：

1. `pack:standalone` 产物在清理前后**等价**：文件清单与逐文件 sha256 完全一致（pack-standalone.mjs 内建逐文件哈希；zip 容器时间戳等元数据除外）。基线快照在 S8 入口（S7 回归通过后）采集。
2. standalone 全量测试通过：`npm test`（修剪后）+ `test:standalone` + `test:management` + `test:standalone-channels` + `test:package` + `typecheck:standalone` + `typecheck` 全绿。
3. 无残留引用：全仓 grep（排除 `node_modules/`、`dist/`、`.git/`）无任何 import/require/路径引用已删对象；保留的 workflows 不引用已删路径。
4. main 分支不受影响：清理提交仅落在 `feat/standalone-lite`，不产生对 main 的合并或 PR。

### FR-11 impeccable UI 终审与精修（决议 8）

> 时机：S8 清理完成后（S9）；对象为最终形态的全站 UI。依据 impeccable 技能 v4.8.0 的标准与命令面。

1. **范围**：全部 16 页（14 现有页 + smart + calendar），昼/夜双主题各完整走查一遍。
2. **模式与基调**：本产品为任务型界面，按技能 **Operate 模式**执行——精确与克制优先、可扫读性/一致性/原生预期优先于表达（技能 Modes 定义）；遵循 craft-floor 质量底线（技能 reference/craft-floor.md）。
3. **流程**：按技能命令面执行 `critique`（UX 评审）→ `audit`（技术检查：a11y、性能、响应式）→ `polish`（发布前精修）；UI 改动前必须过 craft-floor；动效检查含 `prefers-reduced-motion` 降级。
4. **精修边界（refinement，不得 redesign）**：S9 是对 S1-S7 已建立的 Buffer 2026 视觉世界的**精修保留**（refinement preserves），不得替换配色世界/设计语言/信息架构；如 critique 认为需要视觉世界级变更，该发现按「上报而非执行」处理，回到需求评审。
5. **验收判据**：
   - critique + audit 对 16 页 × 双主题：**无未解决的 blocker / major 级发现**（或该级发现已修复并复检关闭，留痕）；
   - a11y（含 NFR-7 对比度、键盘可达）、响应式（管理台目标宽度区间内的布局不破）、动效（降级路径可用）检查完成；
   - 精修后 AC-1/AC-2/AC-14/AC-15 复测仍通过（换肤与核心交互不被精修破坏）。

### FR-12 公开发布：npm 包 + 分支推送（决议 9，S11）

> **授权范围（决议 9，用户已明确授权）**：git commit/push 限 `feat/standalone-lite` 分支推送到 origin（github.com/liuleiyu121520/dsh-our-free-model）；`npm publish` 包 `our-free-model-standalone` 到 registry.npmjs.org；必要时经浏览器授权流程完成 `npm login`（Chrome 已登录 npm 网页，CLI 当前 E401 未登录）。软件公司协议的 git 边界在上述范围内解除；**仍禁止**：碰 main、开 PR、动 upstream remote。

1. **阶段定位**：S11 独立发布阶段。前置 = S10 终局回归全绿（发布产物必须来自纯 standalone 分支的最终形态，即 S8 清理 + S9 精修之后）。
2. **版本策略（PM 验证采纳，D26）**：`packages/standalone/package.json` version `1.0.2 → 1.1.0`（semver minor）。
   - 论证：npm 包的公共接口 = CLI（bin `ofm` / `our-free-model-standalone`）+ OpenAI 兼容 HTTP API + 配置/数据文件兼容。本次变更全部为新增能力（`auto` 条目对 `/v1/models` 为 additive，不改变既有模型条目），既有行为经 AC-20/AC-23/AC-29 保证等价；UI 换肤不属于程序化接口的 semver 破坏面。major 会误导用户预期迁移步骤，与实际「配置零改动」相悖。
   - registry 已实测：`1.1.0` 未占用（存量 0.0.0-stage / 1.0.0 / 1.0.1 / 1.0.2，latest=1.0.2，最后更新 2026-11-09）。
   - **bump 落盘单点** = `packages/standalone/package.json`：`service.mjs:19` 运行时读取该文件版本（CLI/管理台侧栏版本展示自动生效）；npm 发布清单的 version 由 pack 脚本构建时取自同一文件，无第二落盘点。root package.json 的 version（2.8.1，插件线版本谱系，main 管辖）不在本次 bump 范围。
3. **发布前置**：
   - S10 全绿；
   - 版本 bump 落盘并 git 提交；
   - `npm login`（浏览器授权）完成，`npm whoami` 返回预期账号；
   - CHANGELOG / 发布说明更新（含 1.1.0 段）；
   - `packages/standalone/NPM-README.md` 更新与核查——**npm 页面 README 的唯一来源是该文件**（pack-standalone-npm.mjs 缺失即报错，非根 README.md）：无插件半身/已删对象引用、版本相关表述与 1.1.0 一致；
   - 打包前必须先执行 `build:standalone-ui`：pack 脚本按仓库现状原样收文件，`packages/standalone/web/` 必须是 S9 精修后的**最终前端构建**。
4. **发布产物与本地冒烟**：
   - 产物经 `scripts/pack-standalone-npm.mjs` 产出（该脚本现状**只打包不发布**，头注释明示「不 bump 版本、不签名、不发布」；发布命令为 S11 新增步骤）；产物清单特征：`private: false`、bin 双命令、`files` = standalone 闭包、`dependencies: {}`（零运行时依赖）；
   - 发布前本地冒烟：全新环境 `npm i -g <tgz>`（或 npx）启动一次，验证服务可启动、管理台可访问、`/v1/models` 含 `auto` 条目。
5. **发布成功判据**：`npm view our-free-model-standalone@1.1.0` 可查（含 dist 信息）；dist-tags `latest = 1.1.0`；npm 包页面 README 正常展示。
6. **git 推送**：`feat/standalone-lite` → origin 推送成功，远端与本地一致（同一 commit）；不 push main、不开 PR、不动 upstream remote。
7. **回滚预案**：npm 政策内新版本发布后 **72 小时内可 unpublish**；超窗或已有显著下载量时以 `npm deprecate` 替代。触发回滚时按预案执行并在发布记录留痕（注明处置方式与时间）。
8. **凭据纪律**：npm token / OTP 不落盘、不进 prompt、不进文档/PRD/git 提交/发布记录；授权流程走浏览器（用户已授权 computer-use）或用户自输。

### FR-13 产品裁剪：6 页形态，lite 即产品（决议 10A）

1. **页面集合（唯一，共 6 页）**：账号渠道 `channels`、智能调度 `smart`、网关与 API 接入 `connection`、用量日历 `calendar`、请求日志 `requests`、服务设置 `settings`。其余页面从导航与前端整体移除：概览、模型工作台（workspace）、客户端与订阅（agents）、模型与开关（models）、用量统计（usage）、资源库（library）、聚合渠道（providers）、路由组（routing）、EAC 协付渠道（eac）、应用更新（updates），及赞助 UI（sponsor.tsx）。
2. **导航重组（采纳交付总监建议，D30）**：三分组——「渠道与模型」：账号渠道、智能调度、网关与 API 接入；「数据」：用量日历、请求日志；「管理」：服务设置。账号渠道列首位（用户日常主页面）。徽标沿用：「智能调度」= 池内当前可用模型数；「模型与开关」目录徽标随页删除。
3. **双模架构删除（精确落点）**：`cli.mjs:12-31` 的 `--lite`/`--full` 旗标删除（lite 默认语义消失，启动即 6 页产品）；`service.mjs:119,356` 的 lite 选项与 `summary.lite` 链路删除；前端 `LITE_PAGES`/`liteNavigationPages`（shell.tsx:33,54-55）与 app.tsx 的 lite 白名单分支删除，回到单一 `navigationPages` 推导。
4. **被删页面功能去留清单**：
   - **模型启停**：候选过滤已有（smart.tsx:102/180 过滤 disabled/dead），但**行内启停动作当前不存在**（前端无 setDisabled 调用点，该能力原在模型与开关页）——S12 须在智能调度页候选清单补齐行内启停（走既有 `model.setDisabled` RPC 通道），作为模型级启停的**唯一入口**；禁用后从候选与池中消失、重新启用即恢复，语义与 FR-3 一致。〔v3.1：S12 实现的「已停用条目常显于候选 + 启用按钮」设计被决议 11B 推翻——停用模型默认隐藏，启用路径改由「显示已停用」开关承载，见 FR-16.2；本条的「唯一入口」定位不变〕
   - **token 用量数据**：用量统计页删除后，token 数据由**用量日历唯一承载**（按日按模型 + 合计视图）；stats.json 结构与采集链路不动（AC-15/AC-16 继续有效）。
   - **密钥轮换**：本就在接入页（保留），无迁移。
   - **网关端口 / 密钥 / 主题 / 服务开关等配置**：settings 页为唯一配置入口（保留理由：上述配置无其他承载页）。
   - **隐藏模型/隐藏免费模型等目录偏好 UI**：随模型页删除；对应 settings 字段保留不动（纯 UI 移除，无数据迁移）。
   - **请求日志**：整页保留，逻辑不变。
   - **应用更新页**：删除。前端 `desktop-update.tsx/css` 与 `hasDesktopBridge` 判定随页移除（npm 形态本就不显示该页）；后端 `packages/standalone/desktop-update.mjs` 及 `desktop-update-test.mjs` 按 S8 E-4 机械规则处置（前端无消费 → 删，pack sourceFiles 同步更新）；`standalone-desktop-regression-test.mjs` 测的是 eac/open-external（保留）。
   - **workbench/library/providers/routing/agents 页专属前端模块**与仅服务这些页面的 management 端点：按 E-4 机械规则与 pack 闭包同步移除；`src/` 共享内核不动（沿用 S8 原则：入口级裁剪，不修剪依赖图）。
5. **残留清理**：全仓（前端组件与 Page 联合、management 端点与白名单、测试、pack sourceFiles、NPM-README）无被删页面的任何残留引用（AC-37）。

### FR-14 深度换肤：暖调同构双主题，终端纹理清零（决议 10B，推翻 D24 视觉保留面）

1. **新基线**：昼主题内容区由冷灰白改为**暖纸面**；夜主题由近黑冷底改为**暖灰绿深底**；**昼夜同构**——同一 token 集、仅深浅不同的两组取值（一一同对应，不允许某 token 仅存在于单一主题）。
2. **终端身份纹理清单化移除**（执行清单与验收见 AC-38）：
   - 斜切角：组件表面的 `clip-path: polygon(px 偏移…)` 装饰（app.css:774/826 等）；入场动画用的 `clip-path: inset`（app.css:548-552）属动效，不在禁列；
   - `[ NO SIGNAL ]` 字样及方括号变体：含**通用空态层**（app.css:4244-4259，页面删除后仍影响保留页，必须移除）与呼吸动画；
   - 扫描线 / scanline 渐变与动画（含 channels.css 等页面级 css 的 cp5/ofm 遗产层）；
   - 顶栏 `LOCAL` 大写标注（shell.tsx:155）；
   - 等宽数字风格标识：`font-variant-numeric: tabular-nums` 仅保留于数据表格/统计数值场景（逐处确认留痕），不得作为界面风格标识大面积使用；
   - 近黑冷底：夜主题背景系 token 全组换暖调，冷色残留视为缺陷。
3. **重点区域**：账号渠道页内容区（渠道卡、徽章、统计行、签到开关、页头）为用户主战场，逐组件精修，换肤优先级最高。
4. **范围**：全部 6 个保留页面 × 昼/夜双主题；View Transition 主题切换与 `prefers-reduced-motion` 降级保留（沿用 FR-1.3/NFR-6）。
5. **与 D24 的关系**：本 FR 即用户裁定的世界级变更授权；S13 impeccable 重走时，refinement 基线 = FR-14 完成后的新世界（此后再回到「精修不推翻」约束）。

### FR-15 auto 多模态路由：含图请求自动选择视觉模型（决议 11A）

1. **视觉能力判定来源（PM 核实定稿）**：权威布尔 = 渠道包能力层计算的 per-model `vision`（business.mjs:53619 由上游 `capabilities.vision === true` 判定，且含实测覆写——上游 tags 不含 vision 但实际能看图的模型有专门覆写表，business.mjs:44010-44028），经 `channels.publicModelRows()` 进入 summary.catalog——**即接入页/原模型页视觉徽章的同一数据源**（前端 `Model.vision`，types.ts:8；connection.tsx:342 徽章）。**关键事实：`model.list` RPC 不含 vision 字段**（仅 id/name/disabled/dead/isFree?，business.mjs:63220-63274），而调度快照（smart-schedule.mjs:56-82）现状仅含 model.list + accounts——S16 须为调度快照补视觉能力来源（复用 publicModelRows/能力目录通道，具体由架构师定）；验收要求：smart 候选的视觉标记与接入页徽章**同源一致**。核心目录侧 registry.json 的 vision 为三态（true/false/null=未知），同样以「显式 true」为唯一肯定样本。
2. **判定语义与缺失降级（PM 定稿：保守跳过）**：`vision === true` 才算支持视觉；**能力数据缺失（false/null/undefined）一律按「不具备视觉」处理**。依据：全仓「显式 true」约定（management 汇总 `entry.vision === true`、registry null=未知、channel-pack capabilities 判定）；且接力不覆盖能力型错误（FR-4.3），把图发给文本模型必然失败且不会换下一个——宁可早失败并给出指引。
3. **过滤语义（仅含图时）**：请求含图片输入（OpenAI `image_url`、Anthropic image block、Responses `input_image` 等全部对外入口）时，候选链在 FR-4.1 可用判定之上追加 `vision === true` 过滤，再按池顺序接力；被过滤掉的非视觉模型即使排序第 1 也不参与。**纯文本请求不做任何能力过滤**，行为与 1.2.0 完全一致。
4. **含图且无可用视觉模型的行为（PM 验证采纳 400，并做语义细分）**：
   - 池内**不存在**任何 `vision === true` 的模型（或池空）→ **HTTP 400** `invalid_request_error`，消息指引「调度池内没有支持视觉的模型，请在智能调度页将视觉模型加入调度池」（配置错误，与 FR-4.7/D10 同口径）；
   - 池内**存在**视觉模型但当日全部耗尽（或因停用/下架/无可用账号全部不可用）→ 沿用 **HTTP 429** 语义（FR-4.6），解禁明细**仅列视觉候选**（配额问题而非配置问题）；
   - 依据：OpenAI 对「内容与模型能力不匹配」返回 400；与既有 400/429 二分一致。
5. **沿用条款**：FR-4.3（接力仅由配额耗尽触发——视觉过滤发生在候选链构建时，不新增接力触发条件）、FR-4.5（流式保护）、FR-4.9（请求日志与 stats 计入真实命中模型）对含图请求同样适用。
6. **`/v1/models` `auto` 行动态 vision 标识〔v3.2 追认〕**：`auto` 条目携带动态计算的 `vision` 布尔——**调度池含至少一个 `vision === true` 的模型即为 `true`，否则 `false`**（按当前池实时计算，池变化随清单响应动态反映；能力数组 `input` 联动反映 image 模态）。该行为已于 1.2.3 实装（smart-schedule.mjs `autoRow()`），本条追认登记入 PRD（判定来源与 FR-15.1 同源一致，D38）。

### FR-16 smart 页迭代：候选过滤、池内联状态与布局（决议 11B/C/D）

1. **候选列表过滤（推翻 S12 偏差 7 的常显设计）**：已停用（disabled）模型**默认不出现**在候选列表。
2. **停用模型的启用路径（PM 定稿：开关式恢复，防不可逆陷阱）**：候选区顶部提供「显示已停用模型」开关（默认关）；开启后停用条目以灰显 + 「启用」动作列出，启用后即回到默认候选。理由：模型启停唯一入口在 smart 页（FR-13.4），若停用后不可见且无恢复路径，停用将成为不可逆操作；channel-pack 的 disabled 透传设计（business.mjs 注释：照实透传供客户端灰显+恢复按钮）同样预期客户端提供恢复路径。〔v3.2：验收迭代细化——用户 2026-11-17 裁定，候选区并列新增「显示无可用账号」开关：`available === 0`（含未绑定 0/0）的候选模型默认隐藏，经该开关呈现（带隐藏计数与空态指引）；随 1.2.x 验收迭代实装（前端 `showUnavailable` 开关），本条追认登记（见 D38）〕
3. **池状态区内联化（取代 FR-3.6）**：独立「池状态」区删除；池内每行显示「已消耗 M/N（账号）」——N = 该模型启用账号数、M = N − 可用数（当日已耗尽账号数，自 modelRateLimits 派生；数据源沿用 smart 状态 accounts.available/total，smart.tsx:19-28 已在用）。M = N 且 N > 0（全部耗尽）时行内追加「最早解禁 HH:mm」（本地时区，取该模型启用账号最早 resetAt；解禁时刻需经 /smart/state 透出，具体字段架构师定）；每账号解禁明细的悬停展示为**可选增强**（非验收项）。
4. **布局重分配**：移除池状态区后重新分配候选区与池区高度，候选列表 max-height 增大；验收口径见 AC-44（1080p 视口两区完整可见、无页内死区）。〔v3.2：验收迭代细化——用户 2026-11-17 裁定：① smart 页**整页无纵向滚动条**（滚动由候选区/池区内部列表承载，验收口径在 AC-44 基础上收紧）；② 池配置保存后以**自动消失的 messageTip 轻提示**确认（不阻塞、不常驻占位）；随 1.2.x 验收迭代实装（smart 页 toast ~2.8s 自动消失 + 容器内滚动），本条追认登记（见 D38）〕
5. **数据与兼容**：/smart/state 结构可扩展但不得破坏既有字段（accounts.available/total 等沿用）；调度池配置（settings）与 1.2.0 兼容，无迁移。

### FR-17 自更新：npm 全局实例的一键升级与自重启（用户 2026-11-19 需求）

> 适用前提：完整自更新链路仅对 **npm 全局安装实例**（`npm i -g our-free-model-standalone` 后经全局 bin 启动）启用；源码直跑 / npx 实例只提示、禁用自更（判定见 17.5-②）。首个具备本能力的版本为 **1.2.5**——≤1.2.4 升级到 1.2.5 仍走手动 `npm i -g`（D37）。

1. **更新检查（服务进程内，每小时）**：调度模式对齐既有 auto-checkin 调度惯例（business.mjs：启动延时 30s 首跑 + 60 分钟周期，`setTimeout` + `unref`）——`unref` 定时器 + 启动后约 30s 首检，此后每 1 小时一次。检查方式 = 执行 `npm view our-free-model-standalone dist-tags.latest`，将 latest 与**当前运行版本**（service.mjs:19 运行时读取的 package.json version）比对。检查在服务进程内独立进行，不依赖管理台是否打开；检查结果为服务内存态（**无新增持久化文件与 settings 字段**，重启后由下一周期重建），供管理台查询。
2. **新版轻提示（messageTip）**：`latest > 当前版本` 时，管理台**右上角 messageTip 轻提示**新版可更新（含目标版本号与「立即更新」入口）。提示**可关闭**：会话内关闭后本轮不再重复弹出；更新可用状态留存、可在管理台查询（状态查询形态由架构师定，如复用 summary 或新增只读端点；受管理会话鉴权，对齐 NFR-8）。
3. **一键更新**：「立即更新」→ 前端确认（明示「将重启服务，进行中调用会中断」，见 17.5-①）→ `POST /api/management/update/run`（受管理会话鉴权）→ 服务端执行 `npm i -g our-free-model-standalone@<latest>`（目标版本 = 最近一次检查所得 latest）。
4. **成功后自重启**：安装成功 → 停止监听（释放端口）→ 以 `detached` 方式派生新版全局 cli（**沿用原端口 / 数据目录 / 关键启动参数**）→ 旧进程退出。前端自更新发起后进入轮询，探测到服务恢复后自动刷新并显示**新版本号**。
5. **边界（总监默认设计，D36）**：
   - ① 更新执行前明示「将重启服务，进行中调用会中断」，经确认后才执行；
   - ② 非 npm 全局运行实例（源码直跑 / npx）**只提示、不启用自更**（「立即更新」不可用）；判定 = `process.argv[1]` 是否位于 npm 全局 `node_modules` 内，**判定不可得时保守禁用**（按非全局处理）；
   - ③ 安装失败 / 超时 → messageTip 错误态反馈、可重试；失败不改变现存全局安装、旧进程不重启（无半升级状态，当前实例继续运行）；
   - ④ 更新**检查**失败（网络 / registry 不可达等）**静默**：不弹提示、不影响服务与网关，下一周期自动重试；
   - ⑤ 不涉及浏览器 CSP（更新动作全部在服务端完成，无浏览器侧内容安全策略面）。
6. **阶段与验收口径**：S18 实现+自测 → S19 本地用户验收 → S20 发布 1.2.5（待用户批准，FR-12 机制复用）；端到端验收允许 **mock npm 源或真实 registry**（AC-45～AC-50）。

---

## 5. 非功能需求（NFR）

| # | 类别 | 要求 |
|---|---|---|
| NFR-1 | 性能 | `auto` 预检跳过为内存计算（O(池大小)），命中可用模型时不增加可感知首字节延迟（目标：新增开销 < 50ms）；全池耗尽的 429 判定不发任何上游网络请求 |
| NFR-2 | 性能 | 日历页单月数据一次加载；悬停卡片纯前端渲染，无额外请求 |
| NFR-3 | 兼容 | OpenAI SDK（Python/Node）对 `auto` 条目、429 耗尽响应可正常解析（扩展字段被忽略、不抛格式错误）；现有 14 页功能零回归 |
| NFR-4 | 兼容 | `business.mjs`、lite 模式页面集合与行为不变；`--full` 启动行为不变。插件半身/Tauri 壳：S1-S7 不变，S8 删除（阶段化，见 G4） |
| NFR-5 | 数据迁移 | 新增 settings 字段经 SETTINGS_INITIAL 浅合并自动补齐，旧 settings.json 无损升级；stats.json 结构不动；claims-history 为新文件无迁移；旧 auto-checkin.json 不动、继续由 channel-pack 使用 |
| NFR-6 | 双主题 | 所有新 UI（smart、calendar、connection 增强、新侧栏）在昼/夜主题下均完整适配；token 缺失导致的回退视为缺陷 |
| NFR-7 | 可访问性 | 排序提供按钮等价路径（键盘可达）；悬停卡片信息在点击抽屉中均可达（不依赖 hover）；对比度：正文 ≥ 4.5:1，大字/图形 ≥ 3:1（双主题）；S9 以 impeccable audit 复核 |
| NFR-8 | 安全 | smart 池配置与 claims 历史端点均经管理会话鉴权；429 明细与日历数据不包含任何凭据/密钥；领取历史仅存本机（遵循现有数据目录隔离） |
| NFR-9 | 健壮性 | 渠道 RPC 不可用时 smart/calendar 页显示降级空态与重试入口，不白屏；轮询快照失败不阻塞主流程 |
| NFR-10 | 时区口径 | 日历「日」边界统一为本地时区（与 stats dayKey 一致）；渠道记账固有的 UTC+8 语义（modelRateLimits 解禁时刻、auto-checkin 记账日）不改，仅在展示解禁时刻时按本地时区格式化 |
| NFR-11 | 仓库自洽（清理后） | 清理后仓库无对已删路径的任何引用（代码/脚本/workflows/docs 一致）；root package.json 无失效命令；任何保留命令的 `node_modules` 全新安装后可运行（依赖闭包完整） |

---

## 6. 数据需求汇总

| 数据 | 位置/形态 | 读 | 写 | 裁剪 |
|---|---|---|---|---|
| 调度池配置（勾选+顺序） | settings.json 新顶层字段（SETTINGS_INITIAL 补齐） | 网关分发、smart 页 | smart 页保存 | 不裁剪 |
| 跳过状态（当日耗尽） | **不新建**；由账号 `modelRateLimits` 派生 | 分发预检、smart 页状态区 | 沿用 channel-pack 现有写入 | 沿用渠道包 |
| 领取历史 | 新独立 JsonStore（schema 版本字符串），`days[YYYY-MM-DD]` 事件级 | calendar、management 查询端点 | credits RPC 包装 + auto-checkin 快照 | 120 天 |
| 日历 token 数据 | 现有 stats.json `days[日].models[model]{input,output,reasoning,calls,...}` + `GET /stats` | calendar | 现有 recordUsage 链路（计入真实命中模型） | 现有 120 天 |
| `auto` 清单条目 | 运行时注入 `/v1/models` | 对外网关 | 无持久化 | — |
| S8 基线快照 | pack:standalone 产物逐文件 sha256 清单 + 全量测试通过证据（S8 入口采集，作为等价性对照） | AC-22/AC-23 | 一次性 | 随发布归档 |

---

## 7. 实施阶段与阶段门（顺序已验证固化，D19）

| 阶段 | 内容 | 出口条件（阶段门） |
|---|---|---|
| S1-S7 | 功能开发：换肤 token → 侧栏 → smart 页 + auto 网关 → /v1/models + 接入页 → 领取历史 → 日历 → 注册链路收尾（具体切分由架构师定） | AC-1～AC-19 全绿；AC-20（插件半身零改动、src 字节级兼容）；**采集 S8 基线快照**（pack 产物 sha256 清单 + 测试全绿证据） |
| S8 | 入口级清理（FR-10；DEVELOPMENT_ASSET_WRITE，按已批准方案的清单执行） | AC-21～AC-26 全绿（含 pack 前后等价、无残留引用、main 不受影响）；E-4 归类清单（E-8 判定脚本输出）附于阶段门记录（D23 细则） |
| S9 | impeccable 全站精修（FR-11） | AC-27/AC-28 全绿 |
| S10 | 终局回归 | AC-29：全量 standalone 测试 + 网关冒烟（AC-6/7/8 抽测）+ 16 页双主题可导航无白屏 |
| S11 | 公开发布（FR-12；npm publish + push origin，决议 9 授权范围，见 D25） | AC-30～AC-35 全绿 |
| S12 | 裁剪与深度换肤开发（FR-13/FR-14；含按 E-4 机械规则的同步清理与 pack sourceFiles 更新） | AC-36/AC-37/AC-38 全绿 |
| S13 | impeccable 重终审（6 页 × 双主题；以 FR-14 新世界为 refinement 基线，D28） | AC-39 全绿 |
| S14 | 回归（6 页基线：AC-4/AC-7/AC-8/AC-13/AC-15 抽测复验 + 修剪后全量测试） | 全量测试绿 + 抽测通过 |
| S15 | 发布 1.2.0（FR-12 机制复用；版本口径见 D29） | AC-40 全绿 |
| S16 | v1.2.1 快速迭代（FR-15/FR-16；含调度快照的视觉能力来源扩展） | AC-41～AC-44 全绿；**本地启动交付用户验收，npm 发布暂停**（D34） |
| S17 | 1.2.1 发布（**待用户本地验收通过后另行批准**；FR-12 机制复用） | 用户批准后按 AC-40 同口径执行（版本 1.2.1）〔v3.2 补记：验收迭代实际经 1.2.1→1.2.4 多轮发布演进（含 FR-15.6 与 FR-16 验收迭代细化落地），registry dist-tags latest=1.2.4（2026-11-19 实测）〕 |
| S18 | v1.2.5 自更新实现+自测（FR-17：每小时检查/轻提示/一键更新/自重启/非全局禁用/失败反馈） | AC-45～AC-50 全绿（自测口径，mock 或真实 npm 源）；本地启动交付用户验收 |
| S19 | 自更新本地用户验收（检查→提示→更新→自重启→新版本号全链路真实演练） | 用户验收通过并明示批准发布 |
| S20 | 发布 1.2.5（FR-12 机制复用；**待用户批准**） | 用户批准后按 AC-40 同口径执行（版本 1.2.5） |

**顺序验证结论（D19）**：维持「功能 → 清理 → 精修 → 终局回归」。依据：a) 决议 7 明确清理前置条件为「功能全部完成并回归通过」，S8 必须在 S7 后；b) impeccable 是终审，须面对最终代码形态（清理后），避免精修后再动仓库结构造成走查失效；c) S9 精修会改前端文件，故 pack 等价判据的对照窗口严格限定在 S8 入口/出口之间，S9/S10 的门槛是测试与走查而非产物等价；d) S10 兜底覆盖 S9 引入的任何回归。

---

## 8. 验收标准（Given / When / Then）

> 以下 AC 为发布验收最低集；QA 可在此基础上扩展。UI 类（标注 ★）在昼、夜两主题下各执行一遍。

**换肤与侧栏**
- **AC-1** ★ Given 管理台任意现有页（概览/工作台/模型/渠道/接入/日志/用量/设置等任选 3 页）When 加载完成 Then 无未定义 CSS 变量告警、无原「蓝色主色」残留（抽查 accent/green 系 token 取值为绿色系）、昼/夜切换正常且 View Transition 生效。〔v3.0：1.1.0 已验收的历史门；视觉基线自 S12 起以 FR-14 为准，终验见 AC-39〕
- **AC-2** ★ Given 侧栏 When 渲染 Then 出现分组「免费模型 → 智能调度」与「工作空间 → 用量日历」入口；lite 模式下二者不可见；「智能调度」徽标数字 = 池内当前可用模型数。〔v3.0：被 AC-36 取代——导航为三分组 6 页，LITE_PAGES 消失〕

**智能调度页**
- **AC-3** Given 渠道含模型 M1（2 个账号）、M2（1 个账号，已 disabled 对应模型条目）、M3 When 打开 smart 页 Then 候选清单含 M1、M3，不含 M2。
- **AC-4** Given 用户勾选 M3、M1 并将 M1 排序第 1，保存 When 刷新页面/重启服务 Then 勾选与顺序保持不变（settings.json 持久化生效）。
- **AC-5** ★ Given 池内某模型被渠道下架 When 打开 smart 页 Then 该条目标灰显示「已失效」且可手动移除。

**auto 网关语义**
- **AC-6** Given 池顺序 [M1, M2]，M1 可用 When 以 `model=auto` 调 `/v1/chat/completions` Then 请求由 M1 的账号承接（与直接调用 M1 等价），stats 计入 M1 桶。
- **AC-7** Given 池顺序 [M1, M2]，M1 全部账号当日配额耗尽（`modelRateLimits` 标记未来时刻）When 以 `model=ourfreemodel` 调用 Then 请求落到 M2，且对 M1 **未发出任何上游网络请求**（预检跳过）；请求日志可辨识 auto→M2。
- **AC-8** Given M1、M2 均当日耗尽 When 以 `model=auto` 调用 Then 返回 HTTP 429，`error.type=rate_limit_error`；响应体可解析出 M1、M2 各自的解禁时刻（epoch ms 或 ISO 8601）；OpenAI SDK 收到该响应不产生解析异常（可正常读出 error.message）。
- **AC-9** Given 池顺序 [M1, M2]，M1 在请求中途（已有输出字节下发后）失败 When 以 `model=auto` 流式调用 Then 不切换到 M2（无重复输出），错误行为与直接调用 M1 一致。
- **AC-10** Given 池为空 When 以 `model=auto` 调用 Then 返回 HTTP 400 `invalid_request_error`，消息含「智能调度」配置指引。
- **AC-11** Given 任一池内模型返回非配额类错误（如上游 5xx）When 以 `model=auto` 调用 Then 不接力，错误按直接调用该模型的语义返回。
- **AC-12** Given 服务重启 When 重启后立即以 `model=auto` 调用 Then 之前已耗尽模型的跳过仍然生效（源自持久化 modelRateLimits，无需重新试错）。
- **AC-13** Given `GET /v1/models` When 调用 Then 清单头部恰好一条 `id=auto` 条目（池空时也在），且无 `ourfreemodel` 重复条目；以 `model=ourfreemodel` 调用与 `auto` 行为一致（AC-6/7 任一场景复测）。

**API 接入页**
- **AC-14** ★ Given 接入页 When 选中 `auto` Then curl/Python/Node 示例中模型名均为 `auto` 且可复制；页内存在 Auto/OurFreeModel 说明卡与独立 curl 示例。

**日历与领取历史**
- **AC-15** ★ Given 昨天有 M1 消耗 1,000 token、2 个渠道领取成功（功能上线后）When 打开日历当月 Then 昨天格显示 token 总量 1,000（或含模型数）与「2 个渠道领取」；悬停卡片可见 M1 明细与两渠道领取摘要；点击打开抽屉显示完整明细。
- **AC-16** ★ Given 功能上线前的某历史日期（stats 有数据、领取历史无记录）When 查看该格 Then token 消耗正常显示，领取区显示「无数据」态（区别于 0）。
- **AC-17** Given 手动触发一次 `credits.claimAll`（经管理台渠道页）When 完成后打开日历 Then 当日领取渠道数与明细包含本次结果。
- **AC-18** Given 自动签到完成一次运行 When 轮询周期后查看 claims-history Then 新增一条对应 `lastAt` 的当日记录（provider + 摘要文本至少可得）。
- **AC-19** ★ Given 切换月份 When 操作 Then 仅一次数据请求完成整月渲染；未来日期格为空态不可交互。

**阶段化回归与清理（FR-10）**
- **AC-20（清理前语义，S1-S7 全程有效）** Given S1-S7 任一功能提交 When 检查变更集 Then 插件半身与 Tauri 壳文件（index.js、client.js、cordis.patch.yml、packages/desktop/、catalog/、feed/ 及 FR-10 枚举对象）零改动；`src/` 与 `vendor/` 既有文件的修改不改变现有导出签名与行为（新增文件/字段/参数缺省值兼容）。清理后语义（S8+）由 AC-21～AC-26 承载。
- **AC-21（S8 基线快照）** Given S1-S7 回归全绿 When 进入 S8 Then 已采集并归档基线：pack:standalone 产物的文件清单与逐文件 sha256、全量测试通过记录。
- **AC-22（清理完整性）** Given S8 清单执行完毕 When 检查仓库 Then FR-10「S8 删除对象」全部不存在；pack:standalone 的 sourceFiles 闭包内文件全部完好；`src/` 与 `vendor/` 相对基线零改动。
- **AC-23（产物等价）** Given 清理前后两次 `pack:standalone` 产物 When 逐文件比对 Then 文件清单一致、逐文件 sha256 一致（zip 容器元数据除外）；`test:package`（standalone-package-test）两次均通过。
- **AC-24（root package.json 目标态）** Given 清理后的根 package.json When 静态检查与逐条执行 Then 无 `dsh` 字段、无指向已删文件的 scripts；FR-10.「S8 root package.json 目标状态」保留命令清单逐条执行成功；`npm test`（suites 修剪后）全绿。
- **AC-25（无残留引用）** Given 清理后的仓库 When 全仓 grep（排除 node_modules/、dist/、.git/）已删对象路径/模块名 Then 无 import/require/字符串路径引用；保留 workflows（test.yml 等）不引用已删路径；`typecheck` 与 `typecheck:standalone` 通过。
- **AC-26（main 不受影响）** Given S8 清理提交 When 检查 git Then 全部提交仅落在 feat/standalone-lite，无对 main 的合并/PR/推送，main 文件树与清理前一致。

**impeccable 终审（FR-11）**
- **AC-27（终审门）** Given S8 完成后的全站 16 页 When 以 impeccable critique + audit 执行昼/夜双主题走查 Then 无未解决的 blocker/major 级发现（或该级发现已修复、复检关闭并留痕）；a11y/响应式/动效（含 reduced-motion 降级）检查完成。
- **AC-28（精修不越界）** Given S9 精修产出 When 复测 Then Buffer 2026 视觉世界未被替换（无世界级 redesign），AC-1/AC-2/AC-14/AC-15 复测通过。

**终局回归**
- **AC-29** Given S9 完成 When 执行 S10 Then 全量 standalone 测试全绿；网关冒烟（AC-6/AC-7/AC-8 场景抽测）通过；16 页双主题均可导航、无白屏、无控制台错误。〔v3.0：S10 历史门对 1.1.0 有效；自 S14 起页面基线为 6 页，由 AC-36/AC-39 承载〕

**公开发布（FR-12）**
- **AC-30（发布前置）** Given S10 全绿 When 进入 S11 Then `packages/standalone/package.json` version=1.1.0 已落盘并 git 提交；`npm whoami` 返回预期账号；CHANGELOG/发布说明已含 1.1.0 段；`NPM-README.md` 无插件半身/已删对象引用且版本表述一致；`build:standalone-ui` 已产出 S9 精修后的最终前端。
- **AC-31（产物冒烟）** Given `pack-standalone-npm` 产出的发布产物 When 在全新环境 `npm i -g`（或 npx）启动 Then 服务启动成功、管理台可访问、`/v1/models` 含 `auto` 条目；产物清单为 `private: false` 且含双 bin（`ofm` / `our-free-model-standalone`）、零运行时依赖。
- **AC-32（发布成功）** When `npm publish` 完成 Then `npm view our-free-model-standalone@1.1.0` 可查（含 dist 信息）；dist-tags `latest=1.1.0`；npm 包页面 README 展示正常。
- **AC-33（git 推送）** When 推送完成 Then `origin/feat/standalone-lite` 与本地为同一 commit；全程无对 main 的推送、无 PR、无 upstream remote 变更。
- **AC-34（回滚预案）** Given 发布后需要撤回 When 执行回滚 Then 在 npm 72 小时 unpublish 窗口内完成 unpublish，或以 `npm deprecate` 替代，并在发布记录留痕（处置方式与时间）。
- **AC-35（凭据纪律）** Given 发布全程 When 事后检查 Then npm token/OTP 未出现在任何落盘文件、文档（含本 PRD）、git 提交与发布记录中。

**v3.0：6 页裁剪与深度换肤（FR-13/FR-14）**
- **AC-36（6 页可达且功能完整）** Given FR-13 完成 When 启动服务 Then 侧栏恰为 6 页三分组（账号渠道/智能调度/网关与 API 接入 + 用量日历/请求日志 + 服务设置），无被删页面入口，各页可达无白屏；模型启停可在智能调度页候选清单行内完成（停用即从候选与池中消失、启用即恢复）；`cli.mjs` 无 `--lite`/`--full` 旗标（传入未知旗标不产生双模行为）。
- **AC-37（无残留引用）** When 全仓 grep（前端、management 端点与白名单、测试、pack sourceFiles、NPM-README）被删页面 id（overview/workspace/agents/models/usage/library/providers/routing/eac/updates/sponsor）及对应组件/端点/测试 Then 零残留引用；修剪后 `npm test` 与 `typecheck:standalone` 全绿；pack 产物不含被删页面模块（含 desktop-update.mjs）。
- **AC-38（终端纹理判零）** When 按 FR-14.2 清单 grep 全部保留页面与公共 css Then：组件装饰 `clip-path: polygon(px…)` 归零（inset 动效除外）；`NO SIGNAL` 任意变体归零；顶栏 `LOCAL` 标注移除；scanline/扫描线渐变与动画归零；夜主题底色系 token 全组为暖调（无近黑冷底残留）；`tabular-nums` 仅存于统计数值场景且逐处列表留痕。
- **AC-39（impeccable 重终审）** Given S12 完成 When 以 impeccable critique + audit 对 6 页 × 昼/夜双主题走查 Then 无未解决的 blocker/major 发现；昼为暖纸面、夜为暖灰绿深底且昼夜 token 一一同构（仅深浅不同）；AC-36 复测通过。
- **AC-40（1.2.0 发布）** Given S14 全绿 When 发布 Then `packages/standalone/package.json` version=1.2.0；`npm view our-free-model-standalone@1.2.0` 可查、dist-tags `latest=1.2.0`；发布说明含 1.1.0→1.2.0 **破坏性变更说明**（页面删减、`--full` 旗标移除、迁移指引：受影响功能的新入口）；push `feat/standalone-lite` → origin 与本地一致（不碰 main/PR/upstream）；凭据纪律同 AC-35；（建议项）对 1.1.0 执行 `npm deprecate` 指向 1.2.0。

**v3.1：auto 多模态路由与 smart 页迭代（FR-15/FR-16）**
- **AC-41（auto 多模态路由）** 五个场景：
  Given 池顺序 [M-text（无视觉）, M-vision（vision=true 且可用）] When 以 `model=auto` 发送**含图**消息 Then 请求由 M-vision 承接，M-text 未被调用；
  Given 同上池序 When 发送**纯文本**消息 Then 请求由第 1 位 M-text 承接，行为与 1.2.0 一致（纯文本不过滤）；
  Given 池内不存在任何 `vision=true` 模型（或池空）When 发送含图消息 Then 返回 HTTP 400 `invalid_request_error`，消息含「智能调度」配置指引；
  Given 池内存在视觉模型但当日全部耗尽 When 发送含图消息 Then 返回 HTTP 429，解禁明细仅列视觉候选；
  Given 某模型 vision 缺失/未知 When 含图请求候选构建 Then 该模型按无视觉处理（不被调用），其纯文本调用不受影响。
- **AC-42（候选过滤与启用路径）** Given 模型 D 已停用 When 打开 smart 页 Then 候选列表默认不含 D；开启「显示已停用模型」开关后 D 可见（灰显）且提供「启用」动作；启用后 D 回到默认候选、可加入池。
- **AC-43（池内联状态）** Given 池内模型 X 有 3 个启用账号、其中 2 个当日已耗尽 When 查看 smart 页 Then 独立「池状态」区不存在（DOM 与视觉均无）；X 行显示「已消耗 2/3（账号）」；全部耗尽模型（M=N>0）行内显示最早解禁时刻（本地时区）。
- **AC-44（布局与本地交付门）** Given 1920×1080 默认缩放视口 When 打开 smart 页 Then 候选区与池区两容器均完整可见（不存在只能看到其一的情况），候选列表可视行数多于 1.2.0 版本，页面无大面积空白死区。**功能自测通过**：页面正常渲染、auto 纯文本调用成功、auto 含图调用命中视觉模型、停用模型不出现在候选、池行显示 M/N、池状态区不存在。**本轮 npm 发布暂停**：全程无 npm publish 操作、registry dist-tags `latest` 仍为 1.2.0；交付物 = 本地启动供用户验收（用户明示「先看再发」）。

**v3.2：自更新（FR-17）**
- **AC-45（检查周期与静默失败）** Given npm 全局实例运行 When 启动后约 30s 首检、此后每 1 小时执行 `npm view our-free-model-standalone dist-tags.latest` 与当前运行版本比对 Then 形成更新可用/不可用状态且管理台可查；定时器 `unref`（不阻止进程正常退出）；检查失败（网络/registry 错误）静默——无错误弹窗、服务与网关调用不受影响，下一周期自动重试。
- **AC-46（轻提示与关闭语义）** Given latest 新于当前版本 When 打开管理台 Then 右上角出现 messageTip 轻提示（含目标版本号与「立即更新」入口）；关闭后本轮（本会话）不再重复弹出；更新可用状态仍留存可查。
- **AC-47（一键更新端到端）** Given 更新可用状态（mock npm 源或真实 registry 的 latest 新于当前版本，两种形态均为合法测试路径）When 点击「立即更新」Then 先出现「将重启服务，进行中调用会中断」明示确认；确认后发出 `POST /api/management/update/run`，服务端完成 `npm i -g our-free-model-standalone@<latest>` 安装。
- **AC-48（自重启与版本变更）** Given 安装成功 When 自重启执行 Then 服务停止监听、以 detached 派生新版全局 cli（端口/数据目录/关键启动参数与原实例一致）、旧进程退出；前端轮询探测到服务恢复后自动刷新，管理台显示**新版本号**（= 更新目标版本）；重启后数据（settings/stats/claims-history 等）完好无损。
- **AC-49（非全局运行禁用自更）** Given 源码直跑或 npx 启动的实例 When 检查发现新版 Then 仅提示新版可更新，「立即更新」不可用（自更新禁用）；判定依据 = `process.argv[1]` 是否位于 npm 全局 node_modules，判定不可得时同样保守禁用。
- **AC-50（失败反馈与重试）** Given `npm i -g` 安装失败或超时 When 更新执行 Then messageTip 呈错误态，「立即更新」可重试；当前实例不受影响（服务不重启、网关继续可用、现存全局安装未被破坏）。

---

## 9. 决策记录与来源

| # | 决策 | 来源 |
|---|---|---|
| D1 | 仅 standalone 形态；business.mjs 禁改。**（v2 修订：插件半身/Tauri 壳「不动」仅 S1-S7 有效，S8 起按 D16 在本分支删除；main 不受影响）** | 用户决议 1 + 决议 7 |
| D2 | Buffer 2026 全站换肤（暖中性底/活力绿/圆角/轻字重/集中式侧栏分组+徽标；新页深度定制），token 全量替换 | 用户决议 2（引用 Buffer 官方设计声明 calmer/more flexible 及新版侧栏/日历/草稿侧栏交互模式）。〔v3.0：视觉基线被决议 10B 细化修正——暖调同构双主题+纹理清零，见 D28/FR-14〕 |
| D3 | Smart 页 + `auto`(别名 `ourfreemodel`) 顺序接力、配额跳过、防冗余 | 用户决议 3 |
| D4 | 全池耗尽 → 429 + 各模型解禁明细 | 用户建议 + **PM 验证采纳**（与 OpenAI 429/insufficient_quota 语义及 src/failure.js:23-24 现有映射一致；AC-8） |
| D5 | `/v1/models` 暴露 auto 条目 | 用户建议 + **PM 验证采纳**：始终暴露单条 `auto`、不重复列别名（客户端下拉无重复；预配置稳定；AC-13） |
| D6 | 接入页增加 Auto 说明与示例 | 用户决议 4 |
| D7 | 日历页数据源 = stats 天桶 + 新增领取历史；领取历史缺失则新增记录、空白日显示无数据 | 用户决议 5 + **代码核实**：auto-checkin.json 仅存最近一次运行（business.mjs:60869-60978），按天历史物理缺失 |
| D8 | 分支 feat/standalone-lite，不合并 main | 用户决议 6（决议 7 重申 main 不受影响） |
| D9 | 接力触发条件唯一 = 配额耗尽；其他错误不接力 | 用户决议 3 的语义精确化（PM 定），AC-11 |
| D10 | 空池/全失效 → 400 而非 429 | PM 决策（配置错误 vs 限流的语义区分），AC-10 |
| D11 | 流式已输出即不接力 | PM 决策（防重复输出的网关通行语义，且 service.mjs 已有首字节跟踪可依托），AC-9 |
| D12 | 跳过状态由 modelRateLimits 派生、不另建缓存 | PM 决策（自愈、重启安全，符合「只接受更长解禁时刻」的现有写规则），AC-12 |
| D13 | auto 用量计入真实命中模型桶 | PM 决策（保持 stats 语义稳定，不引入新桶），AC-6 |
| D14 | 新页面不进 lite 模式 | PM 决策（保守，不改变 lite 三件事定位），AC-2。〔v3.0：随决议 10A 失效——LITE_PAGES 概念删除，lite 即产品（D27）〕 |
| D15 | 日历日边界 = 本地时区（与 stats dayKey 一致） | PM 决策（store.js:150-152 为本地时区），NFR-10 |
| D16 | S8 入口级清理：删除用户枚举对象，保留 src/ 与 vendor/ 不修剪，main 不受影响 | 用户决议 7（验收基线） |
| D17 | S9 impeccable 终审：16 页 × 双主题，Operate 模式，craft-floor，critique/audit/polish，无未解决 blocker/major | 用户决议 8（验收基线）+ impeccable 技能 v4.8.0 标准 |
| D18 | root package.json 目标态 = 保留 workspace 根与全部 standalone 命令、剥离 dsh manifest 字段/插件入口/files/peerDeps/失效 scripts，test-all 修剪后全绿 | 用户决议 7 委托 PM 定义 + **代码核实**（package.json 现状：dsh 字段/main/exports/files/@deepseek-ai peerDeps 与 standalone 命令并存）；AC-24 |
| D19 | 阶段顺序 S1-S7 → S8 → S9 → S10 固化；pack 等价对照窗口限定 S8 入口/出口 | PM 验证（清理前置条件为决议 7 明确；impeccable 须面对最终形态；S9 改文件故产物等价只在 S8 窗口内判定；S10 兜底），第 7 节 |
| D20 | AC-20 拆为清理前（S1-S7：插件零改动 + src 字节级兼容）/ 清理后（S8+：standalone 等价 + main 不受影响，由 AC-21～AC-26 承载）两阶段语义 | 交付总监指令（决议 7 派生） |
| D21 | 清理判据 = pack:standalone 前后逐文件 sha256 等价 + standalone 全量测试通过 + 全仓 grep 无残留引用 | 用户决议 7 给定方向 + PM 细化（pack-standalone.mjs 内建逐文件哈希，等价可机械判定）；AC-21/22/23/25 |
| D22 | worker/、dist/ 不在删除清单（worker 为独立部署基础设施非入口级；dist 为构建产物） | PM 保守决策（决议 7 枚举未含；如闭包分析有新证据可经确认后调整） |
| D23 | adapter/、locale/ 等插件伴生资产按「仅被插件半身引用且不在 standalone 闭包内」规则并入清理；**v2.1 确认执行细则（方案 v3 E-4/E-8）**：灰区 scripts（fixtures/、probes/、scripts/lib/、具名测试）机械归类——被测对象为 src/ 或 standalone 保留文件→留，import 插件半身/桌面壳/发布链→删，fake-kernel 命中二次核查；共享辅助按**反向依赖**定去留（被任一保留脚本依赖则留）；E-8 判定脚本 S8 执行时输出清单附阶段门记录，不凭名字预枚举 | PM 依决议 7「插件半身」原则推导 + 方案 v3（SHA 86d54c09…b053）实测证据 + PM 只读复核（附录 A v2.1 块；双向条款为 PM 补充，依据 scripts/lib/ 混合依赖实测） |
| D24 | S9 精修 = refinement，不得推翻 Buffer 2026 视觉世界；世界级变更发现按「上报而非执行」处理 | impeccable 技能 refinement-preserves 原则 + 决议 2 已定视觉方向；AC-28。〔v3.0：被决议 10B 推翻——用户裁定夜主题保留的终端身份纹理即「没改」，授权世界级变更；S13 以 FR-14 完成后的新世界为 refinement 基线（D28）〕 |
| D25 | S11 公开发布：S10 全绿后 npm publish `our-free-model-standalone` 到 registry.npmjs.org + push `feat/standalone-lite` → origin。授权范围：commit/push（限该分支→origin）、npm publish、浏览器授权 npm login；仍禁 main/PR/upstream | 用户决议 9（已明确授权，验收基线）；registry 存量自有包事实见附录 A v2.2 |
| D26 | 版本 `1.0.2 → 1.1.0`（minor）。依据：公共接口（CLI/OpenAI 兼容 API/配置与数据兼容）零破坏、`auto` 为 additive、既有行为等价（AC-20/23/29）；UI 换肤非 semver 破坏面；registry 实测 1.1.0 未占用。bump 单点 = packages/standalone/package.json（service.mjs:19 运行时读取自动生效；npm 清单版本构建时取自同文件） | 用户决议 9 建议方向 + **PM 验证采纳**（npm view 实测 + 代码核实）；AC-30 |
| D27 | 决议 10A：产品裁剪为 6 页（channels/smart/connection/calendar/requests/settings），删除其余页面与 lite/full 双模架构（--full 旗标移除，lite 即产品）；模型启停唯一入口收敛至智能调度页；token 数据由用量日历唯一承载 | 用户验收 1.1.0 后当面裁定（原话裁定，无歧义）；FR-13/AC-36/AC-37 |
| D28 | 决议 10B：夜主题换暖灰绿深底、昼夜同构仅深浅不同、终端纹理清单化清零、昼内容区换暖纸面；推翻 D24 视觉保留面（用户裁定夜主题终端纹理即「没改」） | 用户当面裁定；FR-14/AC-38/AC-39；S13 以 FR-14 后世界为 refinement 基线 |
| D29 | 版本 `1.2.0`（minor，用户裁定直接覆盖 latest）。口径论证「包龄 <24h 视为未传播」：1.1.0 发布于 2026-11-16T23:40Z（<24h）；npm 周下载窗口 11-09~11-15 共 247 次、全部为 1.0.x（窗口早于 1.1.0 发布）→ 1.1.0 实测下载≈0，破坏面（页面删减/--full 移除）无实际受损用户；程序化接口中除 `--full` 旗标外零破坏。缓解：发布说明显著标注破坏性变更 + 建议对 1.1.0 `npm deprecate`（AC-40） | 用户裁定 + PM 数据论证（npm time/downloads 实测，附录 A v3.0） |
| D30 | 导航三分组采纳：「渠道与模型」（账号渠道/智能调度/网关与 API 接入）+「数据」（用量日历/请求日志）+「管理」（服务设置），账号渠道居首 | 交付总监建议 + PM 验证（与用户旅程一致：日常主页面居首，6 页 3 组粒度均衡）；FR-13.2/AC-36 |
| D31 | 决议 11A 定稿包：视觉能力来源 = 渠道包能力层布尔（与接入页徽章同源；model.list 不含 vision，调度快照需扩展）；缺失（非显式 true）按无视觉保守跳过；仅含图时候选链过滤；无视觉模型 400 / 有视觉但全耗尽 429（明细仅视觉候选）；接力触发条件不新增（沿用 FR-4.3） | 用户决议 11A + **PM 核实**（model.list 无 vision 字段、能力层含实测覆写、registry 三态——附录 A v3.1）+ 全仓「显式 true」约定 + D10 400/429 二分；AC-41 |
| D32 | 决议 11B：停用模型默认不显示（推翻 S12 偏差 7 常显+启用按钮设计）；候选区顶部「显示已停用模型」开关承载启用路径（防不可逆停用陷阱；channel-pack disabled 透传设计预期客户端有恢复路径） | 用户决议 11B + PM 补启用路径（FR-13.4 唯一入口不丢失）；AC-42 |
| D33 | 决议 11C/D：独立池状态区移除；池行内联「已消耗 M/N（账号）」（accounts.available/total 派生，M=N 时行内最早解禁时刻，悬停明细可选）；布局验收口径 = 1080p 视口两区完整可见 + 无死区 | 用户决议 11C/11D + PM 定稿展示细节；AC-43/AC-44 |
| D34 | 本轮交付方式：本地可验收版本，**npm 发布暂停**（用户明示「先看再发」）；S17 发布须待用户本地验收通过后另行批准 | 用户决议 11 附带流程要求；AC-44 |
| D35 | FR-17 自更新定稿包（用户 2026-11-19 需求，要素齐全无歧义）：服务进程内每小时检查（对齐 auto-checkin 调度模式：unref 定时器 + 启动约 30s 首检；`npm view our-free-model-standalone dist-tags.latest` vs 当前运行版本）；新版 → 管理台右上角 messageTip 轻提示（可关闭；会话内关闭后本轮不再重复弹，状态留存可查）；「立即更新」→ `POST /api/management/update/run` → 服务端 `npm i -g our-free-model-standalone@<latest>`；成功自重启（停监听 → detached 派生全局 cli 沿用端口/数据目录/关键参数 → 旧进程退出；前端轮询恢复后自动刷新并显示新版本号） | 用户 2026-11-19 需求；FR-17.1～17.4/AC-45～AC-48 |
| D36 | FR-17 边界（总监默认设计，用户要素未指定处的保守补全）：①执行时明示「将重启服务，进行中调用会中断」；②非 npm 全局实例（源码直跑/npx）只提示、不启用自更（以 `process.argv[1]` 是否位于 npm 全局 node_modules 判定，判不了保守禁用）；③安装失败/超时 → messageTip 错误态可重试（不破坏现存安装、旧进程不重启）；④检查失败静默；⑤不涉浏览器 CSP | 交付总监默认设计（2026-11-19）；FR-17.5/AC-47/AC-49/AC-50 |
| D37 | 阶段与版本口径：S18（实现+自测）→ S19（本地用户验收，mock 或真实 npm 源）→ S20（发布 **1.2.5**，**待用户批准**，FR-12 机制复用）；首个具备自更新能力的版本为 1.2.5——≤1.2.4 升级到 1.2.5 仍走手动 `npm i -g` | 用户 2026-11-19 需求 + PM 推论（发布顺序事实：registry latest=1.2.4，2026-11-19 实测） |
| D38 | v3.2 追认包（审计链补全，已发布版本实装事实回填 PRD）：①FR-15.6——/v1/models auto 行动态 vision 标识（池含视觉模型即 true，1.2.3 已实装，smart-schedule.mjs `autoRow()`）；②FR-16 验收迭代细化两条——候选「显示无可用账号」开关（smart.tsx `showUnavailable`）、smart 页无纵向滚动条 + 保存 messageTip 轻提示（用户 2026-11-17 裁定，随 1.2.x 验收迭代实装）；③FR-3.5 常驻接力语义说明作废（用户 2026-11-19 裁定移除横幅，随 1.2.4 落地） | 用户裁定（2026-11-17/11-19）+ 已发布版本事实 + PM 只读核实（2026-11-19，代码锚点见各内联标注） |

无残留关键待确认项。

---

## 10. 风险与依赖

| # | 风险/依赖 | 影响 | 缓解 |
|---|---|---|---|
| R1 | `QUOTA_EXCEEDED`（渠道包字面量）与 `QUOTA_EXHAUSTED`（failure.js 映射表字面量）不一致，直接透传可能落 502 而非 429 | AC-8 不达 | 工程验证项已写入 FR-4.6；验收只认对外契约（429） |
| R2 | 自动签到在 business.mjs 内部循环，standalone 只能轮询状态快照，理论存在漏记窗口（轮询间隔内多次运行） | 日历领取数偏少 | 轮询间隔约束（≤10min，FR-8.2）；或架构师评估接管循环方案（FR-8.2 备选，需回 PRD 备案） |
| R3 | auto-checkin 状态仅含渠道级摘要文本（无逐账号金额） | 日历明细粒度受限 | FR-8.3 已按「至少 provider+摘要」定验收下限，不承诺金额数值 |
| R4 | Buffer 2026 视觉基准为外部品牌方向，团队无现成设计稿 | 换肤主观争议 | FR-1 以 token 体系与可度量验收（对比度/无未定义变量/绿色系取值）锚定；S9 impeccable critique/audit 提供第二道客观闸门；视觉走查由用户验收 |
| R5 | 侧栏/页面注册三处（navigation/Page 联合/渲染）漂移风险 | 新页点不动（历史 #678 类问题） | FR-9 明确三处一致性为验收项；白名单从 navigation 推导的现状降低了风险 |
| R6 | 换肤波及页面专属 css 硬编码色值（如 connection.css） | 风格不一致 | FR-1.4 已列入范围 |
| R7 | 清理误删共享内核或闭包内脚本（scripts/ 目录 160+ 文件，插件/共享/standalone 三类混杂；已发现 build-legacy-payload.mjs 这类「名字像插件、实属 standalone 闭包」的陷阱） | standalone 构建/测试链断裂 | S8 阶段门：架构师逐文件清单经确认后执行；AC-22/AC-23（闭包完好 + 产物 sha256 等价）机械兜底；v2.1 已实证按名归类风险（desktop-test 误列保留、client-terminal-test 误列删除，均经方案 v3 实测纠正）——E-4 机械规则即为此闭环 |
| R8 | test-all.mjs suites 修剪遗漏（releaseSuites 引用 manifest/catalog/legacy-upgrade 等已删对象） | `npm test` 红 | AC-24 明确修剪后全绿为验收项；NFR-11 无失效命令 |
| R9 | S9 精修越界（把 refinement 做成 redesign，推翻已验收视觉世界） | AC-1/AC-2 复测失败、决议 2 被架空 | D24/FR-11.4 边界约束 + AC-28 复测；世界级变更走上报流程 |
| R10 | 发布环节风险：CLI 未登录（E401）需浏览器授权；NPM-README 与版本漂移；发布后撤回受 npm 政策约束（72h 窗口）；tgz 内前端非最新构建（pack 按仓库现状收文件） | S11 阻塞或发布残次版本 | FR-12.3 前置（whoami 验证、README 核查、先 build:standalone-ui）；AC-30/31/32 逐项把关；回滚预案 AC-34；凭据纪律 AC-35 |
| R11 | 被删页面代码与其他模块耦合（types.ts Page 联合、共享组件、management.ts、单测 fixtures、pack sourceFiles） | 裁剪后残留死引用或误伤保留功能 | 复用 S8 E-4 机械规则 + AC-37 全仓 grep + 修剪后全量测试兜底；共享组件按反向依赖保留 |
| R12 | channels.css 等页面级深层遗产 CSS（cp5/ofm 遗产层、夜主题纹理体系）换肤工作量与回归面被低估 | 用户主战场（账号渠道页）视觉不达标 | FR-14.3 将渠道内容区列为最高优先级主战场；AC-38（纹理判零）+ AC-39（双主题终审）双闸 |
| R13 | updates 页删除后 desktop-update 能力处置不当（误删仍被引用模块，或残留死代码） | 构建链断裂或残留引用 | FR-13.4 明确：前端桥与页删；desktop-update.mjs + desktop-update-test.mjs 按 E-4 删（无前端消费、npm 形态不显示）；standalone-desktop-regression-test.mjs 测 eac/open-external 保留；AC-37 覆盖 |
| R14 | 视觉能力数据源未进入调度快照（smart-schedule.mjs 现仅快照 model.list + accounts，而 model.list 无 vision）——S16 扩展若与接入页徽章不同源，会出现「徽章显示支持视觉、auto 含图却不选它」的不一致 | 含图路由误判（漏选或误选） | FR-15.1 定死同源要求（与 summary.catalog/publicModelRows 同一布尔）；AC-41 场景一验收兜底；若渠道侧拿不到可靠布尔（能力 RPC 不可得）回 PRD 重议判定来源 |
| R15 | S12 偏差 7 推翻带来的实现与测试回归（「已停用常显 + 启用按钮」相关断言、样式与交互需同步修剪） | smart 页行为不一致、测试红 | AC-42 按新语义验收；涉及 smart 的单测同步更新；布局改动用 AC-44 走查兜底 |
| R16 | 自重启链路风险：停监听后 detached 派生失败（全局 bin 路径解析错、端口未及时释放、环境/权限变化）或新进程启动即崩 → 旧进程已退出、服务中断且无自动回滚 | 更新后服务不可用 | S18 自测覆盖自重启端到端（AC-47/AC-48）；派生失败时的兜底与留痕（错误日志/退出码/可诊断性）由架构师方案定并作为 S18 阶段门内容；S19 用户本地真实演练通过后才进入 S20（发布待批准） |
| R17 | 更新链路依赖外部环境：registry 不可达/网络波动、npm 全局目录权限、`npm view`/`npm i -g` 超时或行为差异 | 检查失效或更新失败 | 检查失败静默 + 每小时自动重试（FR-17.1/17.5-④）；安装失败不破坏现存安装、错误态可重试（AC-50）；非全局实例禁用自更（AC-49）规避源码直跑/npx 误升级 |

---

## 11. 发布说明草稿

> 以下为面向最终用户的发布说明草稿，发布时可裁剪。

**OurFreeModel Standalone「Buffer 2026」版本**

全新外观
- 全站换上 Buffer 2026 风格：暖中性底色、活力绿主色、更柔和的圆角与更轻的字重；昼/夜双主题同步焕新，主题切换动效保留。
- 全部 16 个页面经过系统性 UI 终审（无障碍、响应式与动效降级逐项检查），任务型界面以精确与克制为先。

智能调度（新）
- 新增「智能调度」页：勾选渠道模型加入调度池，拖拽或按钮调整优先顺序。
- 对外只需一个模型名：`model=auto`（别名 `ourfreemodel`）。网关按你的顺序优先调用第一位模型，其多账号轮换规则不变；某模型当日配额全部耗尽后自动落到下一个，且当天不再重复尝试已耗尽的模型。
- 调度池全部耗尽时返回 429，并在响应中附上每个模型的解禁时间明细，方便你的客户端实现退避重试。
- `GET /v1/models` 现已包含 `auto` 条目；「API 接入」页新增 Auto 说明与一键复制的调用示例。

用量日历（新）
- 新增 Buffer 风格月视图日历：每格显示当日各模型 token 消耗与完成领取的渠道数；悬停看明细卡片，点击打开全天详情抽屉。
- 领取历史从本版本开始记录；此前的日期会如实标注「无数据」（历史领取明细无法回补）。

纯 Standalone 产品线
- **自本版本起，该分支成为纯 standalone 产品线**：DSH 插件半身、Tauri 桌面壳与插件发布链已从本分支移除；standalone 的启动、构建、打包与测试命令全部保留且经过等价性验证（打包产物与清理前逐文件一致）。
- main 分支上的插件版本不受本次清理影响。

发布渠道
- 本版本以 npm 包 `our-free-model-standalone@1.1.0` 公开发布（registry.npmjs.org）：`npm i -g our-free-model-standalone` 一条命令安装，`npx our-free-model-standalone` 或短命令 `ofm` 直接启动。零运行时依赖，只需 Node.js。

**1.2.0 发布说明要点（v3.0 新增，定稿另出文档）**
- 开篇即破坏性变更声明：管理台精简为 6 页（账号渠道/智能调度/网关与 API 接入/用量日历/请求日志/服务设置），`--full` 旗标移除；受影响功能的新入口对照（模型启停→智能调度页；用量统计→用量日历；配置→服务设置）。
- 正常升级指引：`npm i -g our-free-model-standalone`；API 网关与客户端配置不受影响（零改动）。
- 深度换肤：暖纸面（昼）/暖灰绿深底（夜）同构双主题；对 1.1.0 用户的视觉变化如实说明。

兼容性
- 现有客户端配置（Base URL / API Key / 具体模型名）无需任何改动；直连具体模型的行为与之前完全一致。

---

## 附录 A：PRD 撰写过程中的代码核实清单（供架构师/QA 引用）

**v1 核实**

| 事实 | 位置 |
|---|---|
| 侧栏 4 组 14 页、navigation 数组、白名单从 navigation 推导、LITE_PAGES | packages/standalone/frontend/components/shell.tsx:8-55 |
| Page 联合类型、Stats/Summary 前端类型 | packages/standalone/frontend/types.ts:1,34-74 |
| 分发点 complete 包装与首字节跟踪、requestLog | packages/standalone/service.mjs（channels.handles 分发段） |
| /v1/models 返回 `{object:'list', data: modelRows()}` | src/forward.js:380-382 |
| 429 映射表 QUOTA_EXHAUSTED/RATE_LIMIT | src/failure.js:23-24 |
| recordUsage 天桶结构 days[日].models[model]、pruneDays 120、dayKey 本地时区 | src/store.js:150-152, 305-390（经 src/core.js 接入） |
| auto-checkin.json 仅存最近一次运行（无按天历史） | packages/standalone/channels/business.mjs:60866-60978 |
| 渠道账号 modelRateLimits 语义与「所有账号均受限」QUOTA_EXCEEDED | packages/standalone/channels/business.mjs:30032-30937, 36292 |
| channels/rpc 转发端点（包装记录挂点） | packages/standalone/management.mjs:417-439 |
| combos.js 5 策略（fallback/round-robin/smart/usage/pace，本次不复用其语义） | src/combos.js:37 |
| 设计 token 体系与昼主题纸面色板 | packages/standalone/frontend/app.css:3-70 |

**v2 新增核实（决议 7/8）**

| 事实 | 位置/结论 |
|---|---|
| root package.json 同时为 DSH 插件 manifest（`dsh` 字段、`main: index.js`、exports、files 插件清单、@deepseek-ai/* peerDeps/overrides、keywords dsh/dsh-plugin）与 standalone 命令入口（pack/test/build/start 共 17 条） | 根 package.json |
| pack-standalone.mjs 以显式 sourceFiles 列表打包（= standalone 依赖闭包），内建逐文件 sha256 哈希 → 产物等价判据可机械执行 | scripts/pack-standalone.mjs 头部与 sourceFiles |
| `build-legacy-payload.mjs` 的产物 `src/o2a.js` 在 pack sourceFiles 内（注释明示）→ 该脚本属 standalone 构建链，**不得当插件脚本删除** | scripts/pack-standalone.mjs sourceFiles + 注释 |
| test-all.mjs 的 releaseSuites 含 manifest/legacy-payload/release/catalog/legacy-upgrade/engine-payload → 清理后需修剪 suites | scripts/test-all.mjs 头部 |
| .github/workflows 四个：build-macos（桌面 dmg）、prepare-release 与 release-sign（插件发布/签名，main 为_live 更新源）、test（CI，含 ruleset 要求的 job 名） | .github/workflows/*.yml |
| worker/ 为 Cloudflare Worker 部署件（wrangler.toml/verify-deployment），非本仓库入口级代码 | worker/ 目录 |
| adapter/（dsh-llm.d.ts + kernel.js）、locale/（en/zh.json）为插件半身伴生资产；src/ 与 standalone 对 adapter/worker/locale 的直接引用仅 src/vault.js 一处字符串命中（需 S8 闭包细查） | 根目录 + grep |
| catalog/（dsh-plugin.json/integrity/provenance）、feed/（announcements/manifest）为插件发布链数据 | catalog/、feed/ 目录 |
| dist/ 为构建产物目录（npm-standalone、tgz） | dist/ 目录 |
| impeccable 技能 v4.8.0：Modes 含 Operate（任务型界面：精确、克制、可扫读、一致性）；命令面含 critique（UX 评审）/audit（a11y/性能/响应式）/polish（发布前精修）；craft-floor 为任何 UI 编辑前的质量底线；refinement preserves / redesign replaces 二分 | ~/.zcode/skills/impeccable/SKILL.md |

**v2.1 新增核实（方案 v3 S8 清单确认事项复核，2026-11-17，PM 只读复核通过）**

| 事实 | 位置/结论 |
|---|---|
| desktop-test.mjs 被测对象为 packages/desktop 壳：import `stageDesktopService`（prepare-desktop.mjs）、spawn `packages/desktop/service-host.mjs`、断言 tauri.conf.json / titlebar.js / titlebar.css / install-hooks.nsh → 与 prepare-desktop.mjs 一并改列删除（事项 1 确认） | scripts/desktop-test.mjs:9,24,198-206 |
| prepare-desktop.mjs 为桌面壳打包辅助（stage `packages/desktop/src-tauri/resources`）；其余引用仅 test-all.mjs:90 `desktop` 套件（随删修剪）与 build-macos.yml:24（本就删除）→ 无保留侧依赖 | scripts/prepare-desktop.mjs:6-8；grep 复核 |
| desktop-update-test.mjs 测 `packages/standalone/desktop-update.mjs`（createDesktopUpdater / selectDesktopRelease / newerVersion / installerChecksum）→ 保留，desktop-update 功能不受 S8 影响 | scripts/desktop-update-test.mjs:7 |
| standalone-desktop-regression-test.mjs 测 `packages/standalone/eac.mjs`、`open-external.mjs` → 保留 | scripts/standalone-desktop-regression-test.mjs:5-6 |
| client-terminal-test.mjs 测 `packages/standalone/client-terminal.mjs`（launchClientTerminal），后者在 pack sourceFiles 闭包内 → 保留，自 v2 删除枚举移出（事项 2 确认） | scripts/client-terminal-test.mjs:12；pack-standalone.mjs sourceFiles |
| client-lint.mjs 静态检查 client.js（ModuleLoader 注册、t() 双字典、ofm_* 样式类）→ 被测对象为插件浏览器半身，删除归类维持不变 | scripts/client-lint.mjs:1-12,16 |
| scripts/lib/ 为混合依赖共享辅助：保留侧（build-channel-pack、channel 系、aggregate-wiring、forward-boot 等）与删除侧（build-manifest、catalog-test 等）均依赖 → E-4 须按反向依赖逐个定去留（双向条款依据） | scripts/lib/ 目录 + grep |
| workbench-native-desktop-test.mjs 对「desktop-test」的 grep 命中仅为自身文件名运行注释，无 import 依赖，归类由 E-4 按其被测对象判定 | grep 复核 |

**v2.2 新增核实（决议 9 发布事实复核，2026-11-17，PM 只读复核通过）**

| 事实 | 位置/结论 |
|---|---|
| registry 存量：`our-free-model-standalone` 已有版本 0.0.0-stage / 1.0.0 / 1.0.1 / 1.0.2，dist-tags latest=1.0.2，最后更新 2026-11-09T14:51:40Z；`1.1.0` 未占用 | `npm view our-free-model-standalone --json` 实测（2026-11-17） |
| packages/standalone/package.json：name=our-free-model-standalone、version=1.0.2、private=true（发布清单由 pack 脚本生成时改写为 private:false） | packages/standalone/package.json:2-4 |
| pack-standalone-npm.mjs 头注释明示「只做打包与完整性记录；不 bump 版本、不签名、不发布」→ 发布命令为 S11 新增步骤；清单生成：bin 双命令（包名 + `ofm`）、files=standalone 闭包（复用 pack-standalone.mjs 的 standaloneSourceFiles）、engines、license MIT、dependencies:{} | scripts/pack-standalone-npm.mjs:1-52 |
| npm 页面 README 唯一来源 = `packages/standalone/NPM-README.md`（脚本对该文件缺失直接抛错；非根 README.md）；「版本与命令名以构建时为准」防漂移 | scripts/pack-standalone-npm.mjs:64-72 |
| 版本读取链路：service.mjs:19 运行时 `readFileSync(new URL('./package.json', import.meta.url)).version`；pack 保留 packages/standalone/package.json 原位副本专供此读取；CLI/管理台侧栏版本展示随 bump 自动生效 | packages/standalone/service.mjs:19；pack-standalone-npm.mjs:37-40 注释 |
| pack 按仓库现状原样收文件（`packages/standalone/web/` 为构建产物）→ tgz 含 S9 后最终前端的前提是打包前先 `build:standalone-ui` | scripts/pack-standalone-npm.mjs:21-27 |

**v3.0 新增核实（决议 10 裁剪/换肤落点复核，2026-11-17，PM 只读复核通过）**

| 事实 | 位置/结论 |
|---|---|
| 双模判定链：cli.mjs `--lite` 默认 / `--full` 置 lite:false → service.mjs lite 选项（:119）→ summary.lite（:356）→ 前端 LITE_PAGES/liteNavigationPages 过滤（app.tsx:65 host.navigate）——FR-13.3 的精确删除落点 | packages/standalone/cli.mjs:12-31；service.mjs:119,356；shell.tsx:33,54-55；app.tsx:65 |
| smart 页现有候选过滤（disabled/dead 过滤）但**无行内启停动作**（前端全目录无 setDisabled 调用点）→ 模型启停需 S12 补齐至 smart 页唯一入口（RPC `model.setDisabled` 通道已存在） | frontend/smart.tsx:102,180,242；grep 复核 |
| 终端纹理落点：斜切角 `clip-path: polygon(14px/18px…)`（app.css:774,826）；通用空态 `[ NO SIGNAL ]` 带 !important（app.css:4244-4259，删页后仍影响保留页）；models.css/usage.css 的 NO SIGNAL 层随页删除；`clip-path: inset`（app.css:548-552）为入场动画不属纹理；顶栏 `LOCAL`（shell.tsx:155）；`tabular-nums` 多处（app.css:125,164,176,217,599,607 等）需逐处判场景 | frontend/app.css、models.css、usage.css、shell.tsx 逐点核实 |
| 被删页面前端组件实测存在：agents/library/models/providers/routing/usage/workspace/desktop-update/sponsor 等 .tsx 及配套 css | frontend/ 目录清单 |
| npm 数据（D29 论证依据）：1.1.0 publish=2026-11-16T23:40:00.075Z；周下载（2026-11-09~11-15）=247 且窗口全部早于 1.1.0 发布 → 1.1.0 实测下载≈0 | npm view time --json；api.npmjs.org downloads 实测（2026-11-17） |
| 1.1.0 已实现 smart/claims 管理端点（/smart/state、/smart/pool、/claims/history）——FR-13 裁剪不触及这三个端点 | app.tsx:65 host 接口实测 |

**v3.1 新增核实（决议 11 视觉能力与 smart 状态数据源复核，2026-11-17，PM 只读复核通过）**

| 事实 | 位置/结论 |
|---|---|
| `model.list` RPC 返回字段仅 id/name/disabled(/isFree?)/dead，**不含 vision**——调度侧不能直接从该 RPC 获得视觉能力 | packages/standalone/channels/business.mjs:63220-63274 |
| 视觉权威布尔在渠道包能力层：上游 `capabilities.vision === true` 判定（business.mjs:53619）；上游 tags 缺失但实测能看图的模型有覆写表（RACCOON 等，business.mjs:44010-44028）；「capabilities 空对象 ⇒ 无 vision」（business.mjs:51232-51245） | business.mjs 能力层 |
| registry.json 的 vision 为三态（true/false/null=未知）；management 汇总目录 `vision: entry.vision === true`（显式 true 才标）——「显式 true」是全仓约定 | src/providers/registry.json；management.mjs summary() |
| 前端视觉徽章数据源 = summary.catalog 的 `Model.vision`（types.ts:8），渠道行经 `channels.publicModelRows()` 并入（service.mjs catalog 合并）；接入页徽章 connection.tsx:342 | frontend/types.ts:8；connection.tsx:342 |
| 调度快照现状：createSmartScheduler 仅快照 model.list + accounts（smart-schedule.mjs:56-82），无 vision → FR-15.1 的扩展点；分发顺序 isSmartAlias → scheduler → channels.handles → core（service.mjs:255-286） | packages/standalone/smart-schedule.mjs；service.mjs |
| smart 页已使用 accounts.available/total（smart.tsx:19-28）→ M/N 内联显示零新增后端字段即可实现；解禁时刻（最早 resetAt）需经 /smart/state 透出（字段名架构师定） | frontend/smart.tsx:19-28 |
