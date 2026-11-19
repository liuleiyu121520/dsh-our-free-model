# 技术实现方案：Standalone 管理台 Buffer 2026 换肤 + 智能调度（auto）+ 用量日历 + 纯 Standalone 线清理 + 公开发布 + 6 页裁剪与深度换肤 + 视觉路由与 smart 迭代（v10）

> **版本说明**：本文件为追加式方案——第一部分（§1-§10 + 附录）为 v7 全文（S1-S11，1.1.0 已验收）；第二部分 §V8 为 v8/v9 增量（PRD v3.0：S12-S15，1.2.0 已发布）；**第三部分 §V10 为 v10 增量**（PRD v3.1：FR-15 auto 多模态路由 + FR-16 smart 页迭代，S16-S17，AC-41~44，D31-D34，R14-R15）。冲突时以更靠后的部分为准。

| 项 | 内容 |
|---|---|
| 方案版本 | v8（PRD v3.0 增量适配；快速路线精简方案，门禁不豁免） |
| 方案状态 | `PLAN_READY_FOR_REVIEW`（工程冻结在 `ff17b26`；v8 通过全新审查 + APPROVE 后才动代码） |
| 架构师 | 高见远 |
| 输入 PRD | `docs/software-company/prd-buffer2026-smart-calendar.md` v2.2（FR-1~12 / AC-1~35 / D1-D26 / R1-R10 / S1-S11） |
| 开发分支 | `feat/standalone-lite`；已实施提交链 `0090b52`→`8ecb617`→`06bb055`→`f1bbfde`→`7cd21da`；S8 出口五项 PASS |
| 改动范围 | v6 范围 + 本版：§6F.1/F.6 基线工件补件登记、**§6F.7 channel-source opt-in 改动设计（批准后执行）**、SR-11 静态化改述与预案 A 更正、§10.5 处置表 |
| 明确不修改（阶段化纪律） | v6 表述保留：S1-S7 插件半身零改动；S8 已按 §6E 执行；S11 起按 D25 授权；全程禁 main/PR/upstream；worker/、dist/、vendor/、business.mjs 不动 |

v6 → v7 变更摘要（第 4 轮 3 major + 1 minor）：① **R4O-001**：AC-21「全量测试通过记录」承载缺失（s8-baseline/ 实测仅两件）——F.1/F.6 增补件 `test-all-s7-record.txt`（工程师于 v7 批准后、F.7 改动前在 7cd21da 树重跑 17 命令 + npm test，tee 落盘含环境头）；「模拟预跑报告」承载明确指向 `zero-grep-evidence.md:121-129`；§0/§6 的 PASS 声称与工件一一对应。② **R4O-002**：E-6 审计链勘误——`s8-gate/errata.md` 已先行落盘（原始工件不动、历史 commit 不改写；登记 7cd21da message 与 e4 附录 :43-46 的「保留 overrides」记载有误、成因、读者路径）；§10.4 增行披露。③ **R4O-003**：SR-11 改述为静态可判定事实（lock :29/:155 直名条目系 peerDep 残留，任何 npm install 重同步 prune 后 channel-source 确定失败）；预案 A 更正为「恢复 peerDependencies 子集（npm≥7 自动装 peers）」并降为次选；**主处置 = §6F.7 channel-source opt-in 改动（v7 批准后执行）**；S9/S10 npm install 纪律（改动执行前禁、执行后解除）。④ **R4O-004**：MINOR-005 登记为「已由第 4 轮审查目击闭环」（依据见 §10.5）。v6 全部内容原样保留（含 MINOR-002 就地清理后的状态）。

---

## 0. 需求与验收映射总表

| PRD 条目 | 验收 | 落点 | 状态 |
|---|---|---|---|
| FR-1~FR-9 | AC-1~19 | §3/§4/§5 | S1-S6 已实施（至 8ecb617） |
| 阶段化零回归 | AC-20 / AC-21~26 | §6 S7 出口 + §6E/§6F | S7 基线= s8-baseline/ 两件 + **test-all-s7-record.txt（R4O-001 补件，批准后落盘）**；S8 出口五项 PASS（AC-25 证据=s8-gate/zero-grep-evidence.md 断言+判零、AC-21 证据=上列基线件） |
| FR-10 入口级清理 | AC-21~26 | §6E（E-0~E-10）+ §6F（F.1~F.7） | 已执行（f1bbfde + 7cd21da）；E-6 勘误见 s8-gate/errata.md |
| FR-11 impeccable | AC-27/28 | §6G | 待（本版通过后） |
| 终局回归 | AC-29 | §6H | 待 |
| FR-12 公开发布 | AC-30~35 | §6I | 待（S11；确认事项④⑤留其阶段门） |
| NFR-11 | AC-25 | §6F F.3④ 主判据 + F.6 工件 | S8 出口 PASS；SR-11 登记并 v7 静态化 |

---

## 1. 架构总览

### 1.1 模块与数据流（文字图）

```
客户端（IDE/SDK）─POST /v1/chat/completions model=auto|ourfreemodel|provider/xxx→
src/forward.js serveCompletion（共享内核，不改）→
service.mjs complete 包装（:288-316，首字节跟踪）→
  ① isSmartAlias? ─否→ ② channels.handles? ─否→ core.complete
  └是→ smart-schedule.mjs：预检（30s 快照）→ evaluatePool 全量单遍 → attemptOrder（预检可用×池序）
        → 改写 request.model → channels.complete（轮换/配额/recordUsage 计真实桶全沿用）
        → catch 配额类（channelCode='QUOTA_EXCEEDED' 或消息兜底）且未输出首字节→接力；非配额上抛；
          尝试序列全耗尽→429 信封（code=RATE_LIMIT + details）
管理台：/summary（15s）/smart/state/smart/pool/stats（复用）/claims/history/channels/rpc（领取包装）
后台：claims-history.mjs（5min 轮询 usage.autoCheckin + 手动 claim 包装）
构建链：build-standalone-ui → vite standaloneSharedUi（读 E-10 快照，已固化）→ web/ 资产
发布链（S11）：release-standalone-npm.mjs → build → pack（tgz）→ 冒烟 → publish（总监）→ view/push
```

### 1.2 auto 解析器位置（结论）

`service.mjs` 的 `runtime.complete` 包装层内、`channels.handles` 之前，逻辑在 `smart-schedule.mjs`（已实施，6403b8c 起）。依据：① service.mjs:288-316 standalone 独有组装点，auto 无 provider/ 前缀（channels/runtime.mjs:82）；② 首字节跟踪已存在（:291，D11）；③ requestLog 唯一挂点（:298-314，FR-4.9）；④ src/forward.js 共享内核、worker/business 禁改。命中后仅改写 `request.model`，管线与直连逐字节一致（D13/AC-6）。

### 1.3 与 src/combos.js 的关系（不复用）

combos 是目录级虚拟条目且 PRD 禁改语义；auto 需要 modelRateLimits 预检/配额分类/专用信封/网关别名。仅借鉴顺序游走模式。

---

## 2. 数据设计

### 2.1 调度池配置：settings.json 顶层字段（D17）

`SETTINGS_INITIAL`（src/store.js:158）追加 `smartSchedulePool: { models: [] }`（已实施，B6）。同构对象为出厂字段（combos/hiddenModelIds）；插件侧披露保留。保存走 `POST /api/management/smart/pool`；`managementSettings()` 补输出。

### 2.2 claims-history.json（新独立 JsonStore，已实施 0090b52）

schema `standalone/claims-history/v1`；`days[dayKey].events[{at,provider,text,kind,source,amount?,unit?}]`；pruneDays 120；每日每 provider 8 条上限；text ≤120 对齐渠道包。

### 2.3 auto 用量计入真实模型桶（零新增机制）

channels/runtime.mjs:104-111 以改写后 model 记账（D13/AC-6）。跳过状态零新建（D12，AC-12）。积分型配额不写 modelRateLimits → 当日重复尝试明示可接受（§3.5）。

---

## 3. auto 接力算法（伪代码级；已实施 6403b8c）

### 3.1 别名识别

```
isSmartAlias(model): name = String(model ?? '').trim().toLowerCase(); return name === 'auto' or name === 'ourfreemodel'
```

### 3.2 全量池评估（单次遍历；R1O-01 修复）

```
snapshot = { at, models: Map<provider,{id,disabled,dead}[]>, accounts: Map<provider,account[]> }
modelAvailability(modelId):
    (provider, model) = splitFirst(modelId, '/')
    m = snapshot.models[provider]?.find(row => row.id === model)
    if m is missing or m.disabled or m.dead: return { usable:false, reason:'invalid' }
    accounts = (snapshot.accounts[provider] ?? []).filter(a => a.enabled)
    if accounts empty: return { usable:false, reason:'invalid' }
    resets = accounts.map(a => a.modelRateLimits?.[model] ?? 0).filter(t => t > Date.now())
    if resets.length === accounts.length: return { usable:false, reason:'exhausted', resetAtMs:min(resets) }
    return { usable:true }
evaluatePool():                                  # 全量单遍，不提前 return
    pool = settings.smartSchedulePool.models; statuses=[]; usable=[]
    for modelId in pool:
        a = modelAvailability(modelId)
        statuses.push({modelId, ...a, accounts: accountStats(modelId)})
        if a.usable: usable.push(modelId)
    if pool empty or all invalid: return { kind:'empty', statuses }
    if usable.length: return { kind:'hit', hit:usable[0], statuses, attemptOrder:usable }
    return { kind:'exhausted', statuses }
```

attemptOrder：预检已判 exhausted 不进尝试序列（AC-7「未发出任何上游网络请求」+FR-4.4 硬验收；exhausted 进 429 明细=信息兜底）；积分型天然在 attemptOrder 由运行时接力覆盖。

### 3.3 调用与失败分类

```
smartComplete(request, onChunk):
    ev = evaluatePool()
    if ev.kind === 'empty': throw fail(400, '调度池为空或无可用模型：请在管理台「智能调度」页配置调度池')
    if ev.kind === 'exhausted': throw smartExhaustedFailure(ev.statuses)
    emitted = false; runtimeExhausted = []
    for candidate in ev.attemptOrder:
        try: return await channels.complete({...request, model:candidate}, c => { emitted=true; onChunk?.(c) })
        catch error:
            if emitted: throw error                       # AC-9
            if not isQuotaExhaustion(error): throw error  # D9/AC-11
            runtimeExhausted.push(candidate); void refreshSnapshot()
    throw smartExhaustedFailure(markExhausted(ev.statuses, runtimeExhausted))
```

分类表：A 类（modelRateLimits 型）预检跳过/运行时接力；B 类（积分/权益型）仅运行时接力+明示可接受重复尝试；已输出首字节不接力；非配额不接力；中止原样上抛。

### 3.4 429/400 信封与逐跳字段存留表（R1O-02 修复）

throw `{ statusCode:429, code:'RATE_LIMIT', providerRetryAfterMs?, details:{type:'smart_pool_exhausted', models:[{model, resetAtMs?, resetAtIso?, resetUnknown?}]} }` + 中文 message。逐跳：throw → serveCompletion catch（forward.js:676 spread）→ carryFailure（failure.js:2-12：message :7 / code 'RATE_LIMIT' 过 :8 正则 / status 429 :6,:9 / providerRetryAfterMs :10 / details 经 W2）→ forwardFailure（:24 classes['RATE_LIMIT']→[429,'rate_limit_error']；:32/:35；W2 error.details）→ failureReply（forward.js:160-165）。`x-should-retry` 不设。空池 400→byStatus[400]（failure.js:31）。

### 3.5 配额错误判据与抛点普查（R2O-002 重构）

**判据声明（正确性锚点）**：`isQuotaExhaustion = error?.channelCode === 'QUOTA_EXCEEDED' 或 /所有账号均受限|所有账号均不可用/.test(message)`——**channelCode 等值匹配，与抛出位置无关**，方案正确性不依赖枚举完备；普查表为回归参照（工程直出工件：`s8-gate/quota-census-mechanical.txt`，40 处 grep 直出）。

**普查表（40 处，4 组）**：抛出点 23（A 类=36292（30917 先写盘）、34022 部分、gemini 60093 混合（60078 轮换依据即 modelRateLimits）；其余 B：33955/34000/37489/37499/39429/39449/39475/39663/40129/41814/41828/41845/56254/56331/56359/60119/67295/68668/69050）；条件构造 4（41809/42103/43823/44312）；code 判定守卫 5（39689/43839/44328/68683/60144）；辅助/标记 8（29645/29655/32590/33510/41169/56590/59896/60109）。S3 用例=AC-6~13/20（AC-11 含三形态：trae 积分/gemini 账号耗尽/qoder 上游）。

### 3.6 快照刷新、空池、重启自愈

启动拉取→30s 定时 unref→请求时 >60s 异步刷新→运行时接力后即时刷新；失败静默（NFR-9）。空池 400（AC-10）；重启自愈（AC-12）；B 类重启后重试一次。

### 3.7 W1（channelCode）与直连字节级不变（R1O-03 修复）

透传属性 `channelCode`（非 code）：kernel 白名单（carryFailure）永不读取 → 直连六消费点（classified failure.js:37 / 流式 forward.js:162/941 / 非流式 :1196 / management :585 / requestLog）改前改后逐字段相同；smartComplete 是唯一读者；S2 字节级用例已实施。

### 3.8 /v1/models 注入面（R1O-06 修复）

仅 listener（service.mjs:346）与 relayTarget（:205）闭包注入；catalog/state（:283-284）、routable（management.mjs:224）、workbench（:214）、gateway.getEnabled（:431）、refreshCatalog 不注入。S4 三处清单无 auto 断言已实施。

---

## 4. 文件级改动清单（S1-S7 功能阶段）

### 4.1 前端（packages/standalone/frontend/）

| # | 文件 | 新增/修改 | 要点 | 行数 |
|---|---|---|---|---|
| F1 | `app.css` | 修改 | token 全量替换：昼块 + 6 处 dark 块；保留变量名；选择器审计（dark 全量行 + 青色归零）；动效保留 | ~600-900 |
| F2 | 10 个页面 css | 修改 | hex 逐文件基线对账 | ~150-300 |
| F3 | `components/shell.tsx` | 修改 | navigation 插 smart/calendar；pageNames；count-badge | +15~25 |
| F4 | `types.ts` | 修改 | Page +2；Stats.days 补 models[]；Summary.smart? | +40~60 |
| F5 | `app.tsx` | 修改 | LazyPage 扩展 + visited | +15~20 |
| F6/F7 | `smart.tsx`/`smart.css` | 新增 | 候选/勾选/拖拽+按钮/失效置灰/池状态全池/降级空态；全 token | ~450-600 |
| F8/F9 | `calendar.tsx`/`calendar.css` | 新增 | 月视图/悬停/抽屉/三态无数据/未来空态；全 token（已实施 8ecb617） | ~470-600 |
| F10 | `connection.tsx` | 修改 | auto 虚拟行/三 Tab 联动/Auto 卡/预设联动 | +50~70 |
| F11 | `usage.tsx`/`usage-data.mjs` | 微 | 类型兼容 | 0~5 |

tailwind 结论：保留变量名只换取值。

### 4.2 后端

| # | 文件 | 新增/修改 | 要点 | 行数 |
|---|---|---|---|---|
| B1 | `smart-schedule.mjs` | **新增（已实施 6403b8c）** | §3 全部 + autoRow + state() + dispose；含 pack sourceFiles 注册（pack-standalone.mjs:25，06bb055） | ~260-330 |
| B2 | `service.mjs` | 修改 | scheduler 接线；分发；requestLog auto→；/v1/models 仅 :346/:205 注入 | +50~70 |
| B3/B4 | `channels/worker.mjs`/`runtime.mjs` | 修改 | channelCode 透传（:152/:50） | +3~5 |
| B5 | `src/failure.js` | 修改 | details 条件透传（classes 不动） | +4~6 |
| B6 | `src/store.js` | 修改 | SETTINGS_INITIAL + smartSchedulePool | +5~8 |
| B7 | `claims-history.mjs` | **新增（已实施 0090b52）** | §2.2 + 5min 轮询 + since；含 pack sourceFiles 注册（:26，06bb055） | ~170-220 |
| B8 | `management.mjs` | 修改 | 四端点 + claim 包装 + summary.smart（已实施 c0daee7） | +90~130 |
| B9（S11） | `scripts/release-standalone-npm.mjs` | **新增（待 S11）** | §6I.1 六子命令 | ~180-240 |
| **B10（R4O-003）** | `scripts/test-all.mjs` | **修改（v7 批准后执行，§6F.7）** | channel-source（:67）移出默认套件为 opt-in（optInSuites 机制，--only 显式路径保留） | +3~6 |

### 4.3 工作默认色板（裁定 1）

昼 `#0E9F6E`/文本 `#0B7A54`、夜 `#34D399`（备选注释保留）；S1 走查终审已过。

---

## 5. 日历数据 API

- token 复用 GET /stats（days[].models[] 实载；stats.json 实测 5,821B、推界 ~700KB<1MB；裁剪备选默认关闭）。
- `GET /claims/history?from=&to=` → { schema, since, days[day].{providers, claimedCount, events} }；三态 join。
- `GET /smart/state` → { pool, hit, statuses（全池）, candidates }；`POST /smart/pool`。

---

## 6. 实施顺序与阶段门（S1-S11）

```
S1 换肤 → S2 channelCode → S3 smart核心 → S4 smart API+前端 → S5 claims（并行）→ S6 日历
→ S7 全量回归 + S8 基线快照 + E-0.3 模拟预跑 → S8 清理（已执行至 7cd21da，出口五项 PASS）
→ 【v7 批准后：F.7 channel-source opt-in 改动 + test-all-s7-record.txt 补件】
→ S9 impeccable → S10 终局回归 → S11 公开发布
```

| 阶段 | 出口条件 | 状态 |
|---|---|---|
| S1-S6 | S1 对账/走查；S2 字节对比；S3 用例=AC-6~13/20（AC-11 含三形态：trae 积分/gemini 账号耗尽/qoder 上游）；S4 断言；S5 claims；S6 走查 | 已实施（至 8ecb617） |
| S7 | 全量回归 + 基线快照 + 模拟预跑零违例 | 已过——证据件：s8-baseline/{pack-standalone-sha256.txt, src-vendor-zero-change.txt} + zero-grep-evidence.md:121-129（预跑）+ **test-all-s7-record.txt（R4O-001 补件，批准后工程师重跑落盘）** |
| S8 | AC-21~26 五项全 PASS；偏差登记 §6F.5 | 已执行（f1bbfde + 7cd21da） |
| S9 | AC-27/28（§6G） | 待（前置：F.7 执行） |
| S10 | AC-29（§6H） | 待（前置：F.7 执行后可在全新安装环境跑全量） |
| S11 | AC-30~35（§6I） | 待 |

### 6E. S8 逐文件清单（清单口径沿用前版；已执行）

#### E-0 机械验证总则

**E-0.1**：① 逐 script 以实际 import 解析闭包为准；② **物理 import 断裂优先于被测对象归类**；③ 可改写条件=符号等价源（index.js:67/:69 re-export）或固化承接（E-10）；④ lib/ D23 双向条款。
**E-0.2 断言 A/B**：保留 scripts import 闭包 ⊆ 保留集；workflows 命令存在性。
**E-0.3 模拟预跑**：S7 基线期执行，违例归零后准 S8（承载：zero-grep-evidence.md:121-129 + 全文）。

#### E-1 根目录与整目录删除（已执行 7cd21da）

index.js、client.js（前置 E-10）、cordis.patch.yml、adapter/、locale/、packages/desktop/、catalog/、feed/、docs 插件史（issue-*.md 实测 7 个，F.5 偏差④）。

#### E-2 scripts/ 删除（41 个，已执行）

| 组 | 文件 |
|---|---|
| 插件宿主装配依赖 | offline(:50)/forward-boot(:53)/kilo(:142)/aggregate-wiring(:145)/open-external(:3)/recovery(:753)/bench-integration(:17)/magpie-plugin(:76)/magpie-sandbox(:9)/vault(:849)/subscription-wiring(:21)/workspace-appearance-ui(:9)/host-selftest(:9)/picker/live-feature-verify/tui/catalog/eac-login |
| 插件浏览器 UI 面 | sanitize(:14)/subscription-ui(:28)/heatmap/stat-bucket-ui/plugin-bench/picks-ui/upgrade-ui/ui-preview/_render-probe/client-lint/sponsor-ui/workbench-tauri |
| 发布链/签名/自检 | build-manifest/prepare-release/release-e2e/release-preparation-test/build-sponsor/sponsor-test/legacy-upgrade-test/gateway-source(:25)/refresh-revision |
| 桌面壳集成 | prepare-desktop/desktop-test（偏差点 #1，PM 已确认，§9） |

覆盖损失声明保留。

#### E-3 scripts/ 保留（已执行）

| 文件 | 依据 |
|---|---|
| build-legacy-payload（陷阱项）+ standalone 全链 + 全部 standalone-* 测试 + standalone-package-test + desktop-update-test + standalone-desktop-regression-test | 构建/测试链 |
| forward-test（:34→src/core.js）/ speed-stat-test（:22→src/core/stats.js） | index.js:67/:69 re-export 改写 |
| 读 client.js 共享 UI 系改读 E-10 快照（9 个） | 同源提取 |
| 孤儿 src 测试（updater/reload/picks/feed） | 被测对象 D16 保留 |
| client-terminal-test（:12，偏差点 #2 PM 已确认） | 被测对象在 pack 闭包 |
| lib/（D23；含 published-bytes 随删——7cd21da message E-4 段登记） | 反向依赖表（F.6 工件） |
| channel-pack-test.mjs（含 sourceMode :20-22） | E-6 devDep 保留依据（v7 SR-11 静态化） |
| 其余 src 共享内核测试 | 未标注者保留；E-0.3 预跑兜底 |

#### E-4 灰区机械归类（产物= e4-gray-zone-appendix.md；**其中 :43-46「保留 overrides」记载经 errata.md 勘误**）

规则按序：① 闭包断裂不可改写→删；② 可改写→E-7；③ 闭包干净且被测保留→保留；④ lib/ D23。

#### E-5 .github/workflows/

build-macos/prepare-release/release-sign 删；test.yml 保留零修改；验证 = workflow_dispatch + 本地等效命令留痕（R2O-005）。

#### E-6 root package.json（D18；v6 修正 + v7 勘误链）

剥离：main/exports/files/dsh/**peerDependencies**（@deepseek-ai×4）/**overrides**（实测均已剥）/keywords dsh 系；description 改写；scripts 删 manifest/manifest:check/selftest。
保留：17 条命令（AC-24 逐条 PASS）；devDependencies：

| 字段 | 处置（v7 终态） |
|---|---|
| `dsh-llm-legacy`（devDependencies） | **保留**（package.json:43）——保留侧 channel-pack-test.mjs:20-22 sourceMode 动态 import `@deepseek-ai/cordis`/`@deepseek-ai/dsh-llm`/`@deepseek-ai/dsh-llm/invariant`；devDeps 不入 npm 包（发布清单 `dependencies:{}` 由 pack 生成），AC-23 不受影响（S8 出口 PASS 佐证）；直名解析边界见 SR-11（静态化）与 §6F.7 处置 |
| `@deepseek-ai` overrides / peerDependencies | **已剥离**（实测无两键）。**审计勘误**：7cd21da commit message 与 e4-gray-zone-appendix.md:43-46 记载「保留 overrides」有误（写作时点早于剥离决定），终态以 package.json 与本节为准——勘误链登记于 `s8-gate/errata.md`（原始工件不动、历史 commit 不改写） |

其余 devDeps（esbuild/typescript/jose/undici）保留。

#### E-7 引用修剪（12 项 + F.5 偏差①③，已执行 f1bbfde）

test-all（suites+releaseSuites:34）/isolation-loader/standalone-shared-ui(:4→快照)/forward-test(:34)/speed-stat-test(:22)/读 client.js 系 9 个/rtk-test（样本）/updater-test（:865 样本）/tsconfig/README×2/PACKAGING。

#### E-8 机械复核与工件（已执行；产物清单 §6F.6）

#### E-9 硬约束保留（已执行）

src/ 全目录（src/adapter.js 在 pack sourceFiles 闭包内；闭包外孤儿=push/reload/updater/feed/picks/chan-relay/engine-parts）；vendor/、worker/、dist/（D22）、icon.svg、packages/standalone/（含 web/、NPM-README.md）、保留 docs、LICENSE、sponsor.tsx 与 web/。

#### E-10 共享渠道 UI 快照固化（已执行 f1bbfde）

`scripts/lib/standalone-shared-ui.source.js`，sha256 `b90c94d7444b1c8cb5928a6ba553139616b27b6083d2e522c6cdc7c1eb5049ee`；构建链与 9 个测试改读快照；AC-23 成立。

### 6F. S8 验证设计（AC-21~26；出口五项全 PASS）

**F.1** 入口基线（S7 出口）：`docs/software-company/s8-baseline/` 实测两件已落盘——`pack-standalone-sha256.txt`（11,264B，逐文件 sha256）+ `src-vendor-zero-change.txt`（331B，src/vendor 零改动证明）；**AC-21「全量测试通过记录」承载件 `test-all-s7-record.txt` 为 R4O-001 补件**：v7 批准后、§6F.7 改动执行前，由工程师在 7cd21da 树（未变）重跑 17 条命令逐条 + 主树 `npm test`，tee 输出落盘，文件头部注明 commit 7cd21da、执行时间戳、环境（TMPDIR 说明）与「与 S8 出口同时点重验」性质。**模拟预跑报告**承载 = `s8-gate/zero-grep-evidence.md:121-129`（边界修正说明·预跑第 2 轮段：词边界修正、W 类生成物白名单、updater fixture 全量登记 36 行）+ 上述补件。
**F.2** 独立 commit 组执行（f1bbfde + 7cd21da）。
**F.3** 出口五项（全 PASS）：① AC-23 产物逐文件 sha256 等价 + test:package×2；② AC-22 闭包完好（src-vendor-zero-change.txt）+ `git diff -- src/ vendor/` 为空；③ AC-24 17 命令 + npm test 全绿；④ AC-25 断言 A/B 主判据 + 辅助 grep 判零（zero-grep-evidence.md：pattern 原文+生成命令+68 行白名单分类）；⑤ AC-26 分支审计。

**F.5 S8 执行偏差登记表（v6 登记保留）**

| # | 偏差 | 实施内容与证据 | 定性 |
|---|---|---|---|
| 3-① | build-standalone-ui.mjs 的 build-sponsor no-op import 移除 | :2 起 import 区已无 build-sponsor（实测；原为纯 no-op 副作用 import） | E-7 补充项 |
| 3-② | update-magpie 套件清单剔除已删 magpie-plugin-test | test-all.mjs 与 update-magpie-engine.mjs grep 零命中 | E-7 机制延伸 |
| 3-③ | rtk-test 样本串指向 S8 后存在文件 | grep `adapter/kernel\|locale/en` 零命中 | E-7 既定项 |
| 3-④ | docs issue-* 实测 7 个 | 已删；v5 ×6 系笔误更正 | E-1 计数更正 |
| 3-⑤ | fixtures/updater-*.mjs 随唯一引用者删 | scripts/fixtures/ 现存 README.md + buddy-system-prompt.txt | E-4/D23 机制产物 |
| 4 | 环境限制类偏差 | 总监裁定接受（详见交付审查记录） | 环境限制 |
| 2 | E-6 字段处置偏离方案字面（dsh-llm-legacy devDep 保留） | §6E-E6 修正；**审计链勘误见 s8-gate/errata.md（R4O-002）** | 本版回写修正 |
| — | S7 pack sourceFiles 补登 | pack-standalone.mjs:25-26（06bb055）；prepare-desktop.mjs 同步补登且已随 S8 删（净效果为零） | 必要补正（§4 B1/B7 已登记） |

**F.6 E-8 工件清单（v7 更新：六件）**

| 工件 | 内容（实测） |
|---|---|
| `s8-gate/e4-gray-zone-appendix.md` | E-4 灰区逐文件归类（58 行；**:43-46「保留 overrides」记载经 errata 勘误**） |
| `s8-gate/quota-census-mechanical.txt` | §3.5 普查 40 处 grep 直出（47 行；MINOR-001 closure 证据） |
| `s8-gate/zero-grep-evidence.md` | AC-25 判零：pattern 原文 + 生成命令 + 68 行白名单分类 + **:121-129 预跑边界修正段（E-0.3 承载）**（129 行；自标「MINOR-003 闭环」） |
| `s8-gate/errata.md` | **v7 新增（R4O-002）**：E-6 审计链勘误（原文照录/正确终态/成因/读者路径；原始工件与历史 commit 不动） |
| `s8-baseline/` | pack-standalone-sha256.txt + src-vendor-zero-change.txt（实测两件）+ **test-all-s7-record.txt（R4O-001 补件，批准后工程师重跑落盘）** |
| E-10 快照 | sha256 `b90c94d7…049ee`（commit f1bbfde；MINOR-004 closure 佐证——五处锚点变换经 AC-23 产物等价 PASS） |

**F.7 R4O-003 工程改动：channel-source 套件 opt-in（v7 批准后、S9 前执行）**

- **改动**：`scripts/test-all.mjs` 将 channel-source（:67 `['channel-source', 'channel-pack-test.mjs', ['--source', '--channels-only']]`）移出默认套件集为显式 opt-in——实现为 optInSuites 机制（默认循环跳过该条目；显式路径 `npm test -- --only channel-source` 经既有 :130 `name.startsWith(only)` 过滤选中，:133 空选报错保留）。
- **D18 命令清单取舍：保持 17 条不变**。opt-in 经既有 `--only` 旗标路径显式运行，不新增 npm script——「18 条」方案（如 `test:source`）需二次触碰 S8 已定态的 root package.json，且与 `--only` 机制功能重复，弃。
- **覆盖损失声明（诚实）**：sourceMode 对照（vendor 源 vs 构建产物）仍可显式运行；默认套件其余成员不受影响。
- **验证判据**：① `npm test`（默认集）全绿；② `npm test -- --only channel-source` 在现有 node_modules 态显式可跑；③ E-0.2 断言 A 重跑零违例（test-all 属保留链文件）。
- **S9/S10 npm install 纪律**：本改动执行前，S9/S10 期间**禁止任何 npm install**（机理见 SR-11：lock 重同步将 prune 直名残留条目，引爆默认套件中的 channel-source）；执行后纪律解除——S10 全量测试即可在全新安装环境执行（channel-source 已 opt-in，lock prune 后 npm test 不受影响）。

### 6G. S9 impeccable 终审（AC-27/28；待本版通过 + F.7 执行后）

前置 S8 门 + F.7 + build + 起服务。Operate 模式：context/craft-floor → 32 单元（16 页×昼夜）critique → audit（a11y/性能/响应式/reduced-motion）→ 分级 → polish → 复检留痕；D24 边界；工件 `s9-impeccable-findings.md`；pack 等价窗口严格限 S8 入口/出口（D19）。

### 6H. S10 终局回归（AC-29；待）

全量测试（**F.7 执行后可在全新安装环境执行**）+ 网关冒烟（AC-6/7/8 抽测）+ 16 页双主题导航无白屏零 console error；证据 `s10-final-regression.md`。

### 6I. S11 公开发布（FR-12，AC-30~35；待）

#### I.1 形态决策：`scripts/release-standalone-npm.mjs` 六子命令（B9，待实施）

preflight/build/pack/smoke/publish/record，断言组映射 AC-30~35；whoami 只读探测、双点门禁；零凭据读取（AC-35）。

#### I.2 发布总序

S10 门 → bump 1.0.2→1.1.0（单点 packages/standalone/package.json；service.mjs:19 原位读取；root 2.8.1 不动）→ release-notes-1.1.0.md（PM 定稿）→ NPM-README 修订（I.6.2）→ commit A → preflight（whoami 暂停点）→ build（强序先于 pack，R10）→ pack（断言 private:false/bin 双命令/deps:{}/version）→ smoke（同一 tgz 字节）→ publish（总监执行）→ record → commit B → push。

#### I.3 git 集成（D25）

commit A/B 序列；push 仅单一 refspec `origin feat/standalone-lite`；git tag 不打（npm dist-tag latest 为版本权威；无读 tag 的自更新链；可选项留档）。

#### I.4 回滚预案（AC-34）

deprecate + dist-tag 回拨 1.0.2 为默认；72h unpublish 仅事故级；分支提交保留不 revert（禁 force push）；留痕模板四字段。

#### I.5 角色分工与凭据纪律（AC-35）

工程师零凭据；总监亲自执行 publish/OTP/push；凭据仅存用户浏览器会话与总监终端；record 模板无凭据字段；事后全仓 grep。

#### I.6 与 S8/S9 交叉确认

NPM-README ∈ E-9 保留域；badge/截图指向 main raw 资产恒有效；pack 版本防漂移替换；修订项：:51「DSH 插件入口」导流行删除、:52-55 上游 MIT 署名保留（S11 preflight 前过目）；dist/（D22）兼容。

---

## 7. 测试策略（AC 映射）

| 层 | 载体 | 覆盖 | 状态 |
|---|---|---|---|
| 渠道/网关集成 | standalone-channels-test 扩展 | AC-6~13/20（AC-11 含三形态：trae 积分/gemini 账号耗尽/qoder 上游） | 已实施 |
| 管理集成 | standalone-management-test 扩展 | AC-3/4/17/18 + 三处清单断言 | 已实施 |
| 清理级（S8） | §6F 命令组 + F.6 工件 | AC-21（基线件+补件）/22/23/24/25（断言 A/B + 68 行白名单）/26 | 出口五项 PASS |
| 终审走查（S9） | §6G | AC-27/28 | 待 |
| 终局（S10） | §6H | AC-29 | 待 |
| 发布级（S11） | §6I 六子命令 | AC-30/31/32/33/34/35 | 待 |
| E2E 手动 | 浏览器清单 | AC-1/2/5/14/15/16/19 | S1-S6 已走查；S9/S10 复测 |

---

## 8. 风险与回滚

### 8.1 PRD R1-R10 对策（保留）

R1 channelCode+消息兜底+自构 429 / R2 5min 轮询 / R3 金额可得才写 / R4 色板+双闸门 / R5 推导白名单 / R6 十文件基线 / R7 E-0 断言+预跑+反向依赖表（已验证）/ R8 test-all 修剪（已执行；F.7 追加 opt-in）/ R9 D24 边界 / R10 whoami 双点+README 核查+build 强序+回滚+凭据纪律。

### 8.2 方案自识别风险（SR 系）

| # | 风险 | 对策 | 状态 |
|---|---|---|---|
| SR-1~SR-5 | 快照陈旧/共享内核扩展/dark 覆盖量/LAN 一致性/信封丢字段 | 快照陈旧→§3.5 两层防御（预检跳过+运行时接力）；共享内核扩展→§4.2 B5/B6；dark 覆盖量→§4.3；LAN 一致性→§4.2 B2④；信封丢字段→§3.4 逐跳存留表/§3.7 | 已随 S1-S7 验证 |
| SR-6 | S8 清单偏差返工 | 偏差点全部闭环（§9） | 关闭 |
| SR-7 | E-10 快照分叉/锚文本稳定 | replaceOnce 双向断言 + sha256 留痕 | 已固化 |
| SR-8 | 删除 ~41 测试覆盖净损失 | 覆盖损失声明 + S10 冒烟/走查兜底 | 待 S10 |
| SR-9/SR-10 | 发布后 npm 侧问题晚暴露 / whoami 账号非预期 | smoke 同字节先于 publish + view 抽查 / preflight 账号断言 | 待 S11 |
| **SR-11（v7 静态化改述，R4O-003）** | **静态可判定事实**：channel-pack-test sourceMode（:20-22）动态 import 的 `@deepseek-ai/cordis`（:20）与 `@deepseek-ai/dsh-llm`（:21）**直名在终态依赖图中不可达**——peerDependencies 已剥离、devDependencies 仅含 alias `dsh-llm-legacy`（安装于 node_modules/dsh-llm-legacy，不提供直名解析）；当前 node_modules/@deepseek-ai/ 与 package-lock.json:29/:155 的直名条目系历史 peerDep 安装残留。**任何 `npm install` 触发 lock 重同步后残留条目被 prune → channel-source 套件（test-all.mjs:67，默认成员）确定失败 → npm test 红** | **主处置（已取代预案 A）**：§6F.7 opt-in 改动（v7 批准后执行）将该确定性失败移出默认套件，S9/S10 npm install 纪律随之解除；**预案 A（次选，仅在 opt-in 无法执行时）**：恢复 peerDependencies 的 `@deepseek-ai/dsh-llm` + `@deepseek-ai/cordis` 子集（npm≥7 自动安装 peers → 直名恢复可达）——**v6 所写「恢复 overrides 字段子集」技术无效（overrides 仅重定向版本不引发安装），v7 更正** | F.7 待批准执行 |

### 8.3 回滚

分支不合 main；数据零迁移；池清空即 auto 400；S1-S6 独立 commit；S8 两组 commit 可整体或分组 revert；S9 前端组独立可 revert；S10 无产物改动；S11 按 I.4。**F.7 属单文件小改动，独立 commit 可单独 revert**（revert 后 SR-11 纪律恢复适用）。

---

## 9. 阶段门确认事项闭环登记（v7 更新）

| # | 事项 | 状态 |
|---|---|---|
| ① | desktop-test.mjs 定删 | 已确认（PM v2.1；已执行） |
| ② | client-terminal-test.mjs 定留 | 已确认（PM v2.1；在库） |
| ③ | E-4 灰区归类结果 | 已承载（e4-gray-zone-appendix.md；其 :43-46 勘误见 errata.md） |
| ④ | NPM-README 修订 diff | 留 S11 阶段门 |
| ⑤ | release-notes-1.1.0.md 文案 | 留 S11 阶段门 |
| ⑥（v7 增） | F.7 channel-source opt-in 改动 + test-all-s7-record.txt 补件 | **待 v7 批准后执行**（本版设计定案，工程动作见 §6F.7/F.1） |

未决假设与证据缺口计数维持 **0/0**（前两轮审查闭环状态不变；SR-11 为风险登记且 v7 已静态化并附既定处置）。

---

## 10. 审查处置表

### 10.1 第 1 轮（v1→v2，12 项；记录保留）

R1O-01 接受 / R1O-02 接受方案 a / R1O-03 接受更强变体 / R1O-04 第 2 轮重开并 v4 升级关闭 / R1O-05~11 接受 / UA-3、EG-2 证据关闭。

### 10.2 第 2 轮（v3→v4，7 项 + R1O-04 重开；记录保留）

R2O-001 接受（E-0/E-2/E-3/E-7/E-8/E-10 系统重构）/ R2O-002 接受（判据脱钩+40 处 4 组）/ R2O-003 接受（断言 A/B 主判据+模拟判零）/ R2O-004/005/006/007 接受。

### 10.3 PRD v2.2 驱动的 v5 修订（记录保留）

FR-12/S11 九项变更（见 v5 §10.3）。

### 10.4 S5-S8 交付回写驱动的 v6 修订（记录保留；v7 增勘误披露行）

| 条目 | 落点 |
|---|---|
| 偏差 2（E-6）/ pack 补登 / 偏差 3①-⑤ / 偏差 4 / E-8 工件 / 确认事项 / MINOR-001/003/004 | v6 §10.4 各行保留（MINOR-001→quota-census、MINOR-003→zero-grep-evidence、MINOR-004→E-10 sha256+AC-23 佐证，均 addressed_during_approved_work） |
| **（v7 增）E-6 审计链勘误披露** | commit 7cd21da message 与 e4 附录 :43-46 的「保留 overrides」记载有误——勘误链登记于 `s8-gate/errata.md`（R4O-002 处置；原始工件不动、历史 commit 不改写），终态以 package.json 与 §6E-E6 为准 |

### 10.5 第 4 轮（v6→v7）

| ID | 级别 | 处置 | 修改位置 | 证据 | 关闭标准对应 |
|---|---|---|---|---|---|
| R4O-001 | major | 接受（总监裁定修复设计） | §6F.1/F.6/§0/§6 阶段表 | s8-baseline/ 实测两件（11,264B + 331B）；zero-grep-evidence.md:121-129 预跑段实测 | **补件 `test-all-s7-record.txt` 由工程师于 v7 批准后、F.7 改动前在 7cd21da 树重跑落盘**（17 命令 + npm test，tee，环境头含 commit/时间戳/TMPDIR/重验性质）；§0/§6 PASS 声称与工件一一对应 ✓（文本已改）；工件落盘后 R4O-001 完全闭环 |
| R4O-002 | major | 接受（reviewer better_alternative） | §6E-E6 勘误行 + §6F.6 + §10.4 增行 | e4 :43-46 原文照录（「保留 dsh-llm-legacy + overrides」）；7cd21da message 偏差段照录；package.json 实测无 overrides/peerDependencies | **`s8-gate/errata.md` 已先行落盘**（总监授权控制面工件）：①有误记载原文 ②正确终态（package.json + v7 §6E-E6）③成因（写作时点早于剥离决定）④读者路径；原始工件不动、历史 commit 不改写 ✓ |
| R4O-003 | major | 接受（reviewer better_alternative，含批准后工程项） | §6F.7（新）+ §8.2 SR-11 + §4 B10 + §6G/§6H 前置 | lock:29/:155 直名条目 + node_modules/@deepseek-ai/ 现存（peerDep 残留实证）；test-all.mjs:67 条目与 :130 `--only` startsWith 机制（opt-in 可行性） | SR-11 改述为静态可判定事实 ✓；预案 A 更正（恢复 peerDeps 子集，npm≥7 自动装 peers）并降次选 ✓（v6「恢复 overrides」技术无效已声明）；**主处置 F.7 opt-in 设计定案，v7 批准后执行**（验证三判据 + S9/S10 npm install 纪律声明） |
| R4O-004 | minor | 接受（二选一：登记「已由第 4 轮审查目击闭环」） | §10.5 本行 | 第 4 轮 reviewer reviewed_files 含 packages/standalone/NPM-README.md（:49-56 行级：:51 导流行/:52-55 署名块）与根 package.json（49 行全文，E-6/S11 行级断言）；cli.mjs 经 pack sourceFiles 闭包 + standalone-test 启动链功能性核验；src/core.js 经 forward-test/speed-stat-test 改写后实际执行（运行通过 = index.js:67/:69 re-export 符号存在性的行为级证明）——功能性间接核验强于静态目击 | 已登记闭环 ✓（依据如上；不宣称 reviewer 关闭，按 addressed_during_approved_work 口径随交付披露） |

v7 申报计数：blocker 0 / major 0 / minor 0（四项全部处置；其中 R4O-001 补件与 R4O-003 工程项为 **v7 批准后执行的既定动作**，设计定案与验证判据已写入 §6F.1/§6F.7，如实标注）/ 未决假设 0 / 证据缺口 0；阶段门确认事项：④⑤留 S11、⑥（F.7+补件）待本版批准后执行。

---

## 附：关键代码证据索引（锚点制 + 行号）

**S1-S7 功能面（保留）**：worker.mjs:152；runtime.mjs:50；contracts.mjs:21-27；service.mjs:19/288-316/283-285/346/205；management.mjs:62-78/80-95/200-209/214/224/299/417-439/431/585；failure.js:2-12(:8)/15-39(:23-24/:31)；forward.js:676/160-165/941/1196/380-382；store.js:59/150-156/158-265/558/353-425；stats.js:4-10；channels.mjs:11-24/143；shell.tsx:8-28/45/103-107/133；types.ts:1/56；app.tsx:50-53/64/77/89；app.css:12/936/2069/2395/2997/3798/4029；business.mjs:30032/30917/60873-60905/60889/61698/63220/62603/63836/61325-61370；channels-test.mjs:125-137/409-423；request-log.mjs:24-28/35。

**QUOTA 普查（40 处）**：直出工件 s8-gate/quota-census-mechanical.txt；关键锚点 `所有账号均受限`×2 / `所有账号均不可用`（60093）/ `积分不足`（41814）/ `QUOTA_EXCEEDED_MARKERS`（41169）。

**S8 清理面（保留）**：standalone-shared-ui.mjs:4 + anchor；index.js:67/:69；import index.js 20 文件与读 client.js 系清单（§6E-E2/E-3 全列）；desktop-test:9/24/198-206；client-terminal-test:12；test-all.mjs:34 `const releaseSuites`；pack-standalone.mjs:40；standalone-isolation-loader.mjs:1-4；icon.svg ← magpie-engine.js:19；business.mjs:6720/7721；test.yml:7-11。

**S11 发布面（保留）**：pack-standalone-npm.mjs:1-5/53-63/66-70/71/73-83/86-90；packages/standalone/package.json:3；NPM-README.md :10/:26/:51/:52-55；registry 与 npm CLI 事实（PM 核实采信）。

**S5-S8 工程实况（v6 保留）**：提交链 0090b52→8ecb617→06bb055→f1bbfde→7cd21da；pack-standalone.mjs:25-26 补登；channel-pack-test.mjs:20-22；package.json:43（devDep 保留；overrides/peerDependencies 无键）；E-10 快照 sha256 `b90c94d7…049ee`；s8-gate/ 与 s8-baseline/ 工件；偏差①-⑤实测。

**第 4 轮证据（v7 新增）**：
| 事实 | 锚点/位置 |
|---|---|
| e4 附录「保留 overrides」记载原文 | s8-gate/e4-gray-zone-appendix.md:43-46（第 3 条目尾句「devDependencies 保留 dsh-llm-legacy + overrides」） |
| commit message 同源记载 | 7cd21da message 偏差段「devDependencies 保留 dsh-llm-legacy + overrides——channel-pack-test.mjs:22 sourceMode 动态 import…」 |
| overrides 实删（终态） | package.json（7cd21da 树）无 overrides/peerDependencies 键（grep 零命中）；devDeps :43 |
| 勘误工件 | s8-gate/errata.md（v7 先行落盘；四段结构：原文照录/正确终态/成因/读者路径） |
| s8-baseline 实测两件 | pack-standalone-sha256.txt（11,264B）+ src-vendor-zero-change.txt（331B）；AC-21 测试记录件缺失属实 → 补件设计（§6F.1） |
| 预跑承载 | zero-grep-evidence.md:121-129（边界修正说明·预跑第 2 轮：词边界/W 类白名单/updater fixture 36 行全量登记） |
| SR-11 静态判定证据 | package-lock.json:29 `"node_modules/@deepseek-ai/cordis"`、:155 `"node_modules/@deepseek-ai/dsh-llm"`（peerDep 残留）；node_modules/@deepseek-ai/ 目录现存（19 条目）；package.json peerDeps 已剥 + devDeps 仅 alias（:43）→ 终态依赖图直名不可达 |
| opt-in 可行性 | test-all.mjs:67 channel-source 条目；:130 `&& (only === null || name.startsWith(only))`（--only 前缀过滤）；:133 `--only "…" selected no suite` 空选报错 |
| MINOR-005 目击依据 | 第 4 轮 reviewed_files：NPM-README.md（:49-56）/ package.json（49 行全文）；cli.mjs、src/core.js 经闭包+测试链功能性核验（§10.5 R4O-004 行） |
| 分支基线 | feat/standalone-lite @ 7cd21da（冻结点）；stats.json 5,821B（基线测量） |

---

---

# 第二部分 · v8 增量：6 页裁剪 + 深度换肤 + 1.2.0 发布（PRD v3.0 / S12-S15）

| 项 | 内容 |
|---|---|
| 方案版本 | **v9**（第 6 轮审查修订：R6O-001~005 major + R6O-006~008 minor；v8 增量章节就地修订，处置表见 §V8.9） |
| 状态 | `PLAN_READY_FOR_REVIEW`（快速路线精简方案：事实证据 + 验收映射 + 影响文件 + 步骤 + 测试 + 风险 + 回滚；门禁不豁免——blocker/major/未决假设/证据缺口清零 + APPROVE 才开工） |
| 输入 | PRD v3.0（FR-13/FR-14、AC-36~40、D27-D30、R11-R13；被取代条目内联标注原文保留） |
| 工程基线 | `feat/standalone-lite` @ **ff17b26**（冻结点；其前链：S9 收口系列 → 8e35f79 B9 发布脚本 → 0f159fe S11 commit A → 278c922/b511e18/ff17b26 三个 release 脚本修复）；**1.1.0 已发布**（npm view 实测 latest=1.1.0，time.modified 2026-11-16T23:40Z——与 D29 论证一致） |
| 与第一部分的关系 | S8 E-4 机械规则、E-0 断言方法、§6I 发布机制（六子命令/D25 授权/凭据纪律）全部复用；D24 视觉保留约束按 PRD v3.0 内联标注被决议 10B 推翻（世界级变更已获用户授权） |

## V8.0 验收映射

| PRD 条目 | 验收 | 落点 |
|---|---|---|
| FR-13 裁剪 6 页 | AC-36 / AC-37 | §V8.1（A1-A7）+ §V8.4 |
| FR-14 深度换肤 | AC-38 / AC-39 | §V8.2 + §V8.3 |
| S14 回归 | AC-36 复测 + 修剪后全量 | §V8.4 |
| FR-15/发布（FR-12 机制复用） | AC-40 | §V8.5 |
| R11-R13 | — | §V8.6 |

## V8.1 S12-A 裁剪：文件级清单（FR-13；全部基于 ff17b26 实测）

### A1 前端删除（页面文件与专属组件；R6O-006 计数修正）

| 路径（packages/standalone/frontend/） | 判定依据（实测，ff17b26） | 回滚 |
|---|---|---|
| **根级页面 tsx ×9**：`workspace.tsx`、`agents.tsx`、`models.tsx`、`usage.tsx`、`library.tsx`、`providers.tsx`、`routing.tsx`、`desktop-update.tsx`、`sponsor.tsx` | FR-13.1 页面集合外（frontend 根**无 overview.tsx**——概览页在 components/，单列下行） | 独立 commit 组 revert；main 不受影响 |
| `components/overview.tsx`（概览页本体+专用） | 概览删除（v8 误计根级 ×10，实为根级 ×9 + components ×1） | 同上 |
| `models.css`、`usage.css`、`routing.css`、`desktop-update.css`、`workbench.css`、`workspace.css`（css ×6） | 上述页面专属样式（目录实测存在） | 同上 |
| `components/workbench-dialog.tsx`（workspace 专用） | 反向依赖：仅被删页引用（grep） | 同上 |
| **保留** `components/model-picker.tsx` | **connection.tsx 唯一保留侧消费**（:26 `import { ModelPicker }`、:334 `<ModelPicker`；其余引用者 agents/providers/library/routing 均删——`grep -n "model-picker\|ModelPicker" packages/standalone/frontend/connection.tsx` 复现） | — |
| **保留** `components/channel-browser.tsx`、`dsh-import-dialog.tsx`、`disclaimer-dialog.tsx`、`ui.tsx`、`shell.tsx` | channels 页/全局对话框/共享 UI | — |
| `channels.mjs` 内部子页 **不裁剪** | 实测子页 **四个**：accounts/ledger/logs/**tools**（:124 导航项；tools=「供应商与备份」卡片 :93——均为账号渠道页保留功能）；**EacPage 与 `kind==='eac'` 挂载分支删除**（:148-172 EacPage、:175 三元）——其唯一挂载源是被删的 eac 页 ChannelMount kind（处置随 A5-M 矩阵） | — |

### A2 双模架构删除（FR-13.3 精确落点）

| 文件 | 落点（实测） |
|---|---|
| `cli.mjs` | :12-31 usage 文本的 `--lite`/`--full` 两行 + 解析分支（`if (flag === '--lite')…` / `'--full'`）+ `options.lite` 初值；未知旗标维持现状（不产生双模行为，AC-36 尾项） |
| `service.mjs` | :119 `lite = false` 选项、:356 `lite` 传递（info()）；startStandalone 签名与调用链同步 |
| `management.mjs` | info().lite 字段与传递 |
| `shell.tsx` | :33 `LITE_PAGES`、:54-55 `liteNavigationPages`、Sidebar `lite` prop 与过滤分支（:122-126）；回到单一 `navigationPages` 推导 |
| `app.tsx` | :65 host.navigate 的 lite 过滤、:71-74 lite 落地页 effect、ChannelMount（kind 收缩为仅 'channels'）与 Topbar 的 lite 相关分支；**LazyPage 收缩（R6O-001 修正，采纳单一来源推导）**：新增单一定义 `const LAZY_PAGES: ReadonlySet<Page> = new Set(['smart', 'calendar', 'settings'])`，LazyPage 的 name 类型与 :89 渲染数组**均从 LAZY_PAGES 推导**（渲染数组改 `navigationPages.filter(p => LAZY_PAGES.has(p))`，import/组件映射分支随之），不手写枚举——v8「仅剩 settings」表述错误（会白屏 smart/calendar），正确集合 = **settings/smart/calendar 三页**（现状签名 :50 五页 `'models'|'usage'|'settings'|'smart'|'calendar'`，删 models/usage）；**AC-36 断言显式覆盖 smart/calendar 懒加载路径**（visited 缓存 + 切换激活，挂 standalone-page-lifecycle-test 改写用例） |
| `types.ts` | Page 联合收缩为 6 页：`'channels' | 'smart' | 'connection' | 'calendar' | 'requests' | 'settings'`（现状 16 项实测 :1）；`Summary.lite?` 与 `Summary.eacAuth?` 字段删除（eacAuth 唯一消费者 EacPage 随删，A5-M） |

### A3 navigation 重组（D30 三分组）

`shell.tsx` navigation 数组重组为：`{ label: '渠道与模型', items: [channels, smart, connection] }`、`{ label: '数据', items: [calendar, requests] }`、`{ label: '管理', items: [settings] }`（账号渠道居首位）；`pageNames` 收缩 6 键；smart 徽标沿用（`summary.smart?.availableCount`）；「模型与开关」目录徽标随页删除（shell.tsx:133 的 models count-badge 分支移除）。白名单仍由 navigationPages 推导（机制不变，PRD FR-9 内联确认）。

### A4 smart 页补模型启停（FR-13.4 唯一入口）

现状实测：smart.tsx **:101** 已过滤 `disabled/dead`（`return (view?.candidates ?? [])` 过滤链，:102 为链内行、:180 是文案行——R6O-006 锚点修正），全前端**无 setDisabled 调用点**（PM 核实 + 本轮抽验一致）。S12 在候选清单行内补启停动作：调既有 RPC `model.setDisabled`（经 `/api/management/channels/rpc`，**business.mjs:63282** `case "model.setDisabled" {`，payload `{provider, modelId, disabled}`）；停用即从候选与池消失、启用即恢复（与 FR-3 语义一致）；行内按钮 + 键盘可达（沿用排序按钮模式，NFR-7）。AC-36 断言载体 = standalone-management-test 扩展（启停 RPC 往返 + smart 状态联动）+ nav/react-ui 走查。

### A5 后端端点与模块裁剪（E-4 机械规则；src/ 不动；R6O-003 创建链归位 + R6O-002 矩阵法）

**A5-1 创建链与模块（符号名锚点制——`git grep -n <符号> ff17b26` 可复现，行号为辅助）**：

| 对象（符号） | 创建位置（实测归位） | 处置 |
|---|---|---|
| `createWorkbench`（workbench.mjs） | **management.mjs**（import :10、创建 :236-241；v8 误写 service.mjs:210-220——该段实为 **LAN relay 配置，必须保留**，R6O-003） | 删（模块+创建+import） |
| `createProviderManagement`（providers.mjs） | management.mjs（import :11、创建 :242） | 删 |
| `createRoutingManagement`（routing.mjs） | management.mjs（import :12、创建 :243） | 删 |
| `createWorkbenchLibrary`（library.mjs） | management.mjs（import :13、创建 :244） | 删 |
| `createDesktopUpdater`（desktop-update.mjs） | management.mjs（import :14、创建 **:140**；`git grep -n createDesktopUpdater ff17b26 -- packages/standalone/management.mjs`） | 删 |
| `createSubscriptions` | **service.mjs :264**（经参数传入 management） | 删（agents 页删；src/subscriptions.js 为 D16 孤儿保留） |
| `createMagpieEngine` / `createMagpieModels` | **service.mjs :268-269** | 删创建与接线（workspace 页删；src/magpie-*.js 为 D16 孤儿保留） |
| `createStandaloneEac`（eac.mjs） | **service.mjs :261**（`eac = createStandaloneEac({…})`）+ **:279 `sealedCredential: eac.credential`**（传入 core runtime——**推理链依赖，eac.mjs 保留的真实依据**；management.mjs:259 `eacAuth: eac?.cached()` 为 summary 字段） | **eac.mjs 保留**（推理链）；`/eac/*` 六管理端点与 `summary.eacAuth` 随消费面删除（A5-M）；v8「渠道页内嵌 EAC 登录入口仍在」判定**失实撤回**（EacAuth/useEacLogin 仅在被删的 EacPage :148-172，挂载分支 :175 `kind === 'eac'`——R6O-002） |

**A5-M 端点×消费者矩阵（R6O-002 更好替代；S12 执行时先产出矩阵工件再动手）**：枚举 management.mjs 全部路由分支 → 逐端点 grep 保留前端源（6 页 tsx/mjs）与保留测试的调用点 → 删/留 + 证据。本轮预填关键行（其余由矩阵补全）：

| 端点组（位置辅助） | 消费者判定（实测） | 处置 |
|---|---|---|
| `/workbench*`、`/library*`、`/providers*`、`/routing*`、`/subscriptions*`、`/engine*` | 唯一前端消费者=被删页；测试消费者=workbench 系四测试（A6 删） | 删（含 privilegedManagementRoute 前缀 :316-323 对应项） |
| `/desktop-update*`（:316、:340-345） | 前端桥随页删；desktopUpdate 创建链删 | 删 |
| **`/eac/*` 六端点**（:549-560：status/login/poll/login/start/login/cancel/logout/pool） | 唯一消费者=EacPage（channels.mjs:148-172，随 kind 分支删） | **删**（eac.mjs 本体因推理链 sealedCredential 保留——A5-1） |
| **`/models/test`、`/models/refresh`**（:599/:604） | 消费者=被删 models.tsx + `standalone-package-test.mjs:261` | 删端点；**standalone-package-test:261 同步改写**（该断言改用保留端点或移除——A6 登记） |
| `/login/terminal` | 登录页（保留） | 留 |
| `/summary` `/stats` `/smart/*` `/claims/*` `/channels/rpc` `/requests*` `/settings` `/key*` `/disclaimer` `/session` `/logout` `/dsh/import` | 保留页消费面 | 留 |

**A5-2 文件与注册**：packages/standalone/ 下 `workbench.mjs`、`providers.mjs`、`library.mjs`、`routing.mjs`、`desktop-update.mjs` 删；pack sourceFiles 移除对应行（desktop-update.mjs=pack-standalone.mjs:27 等）与 `src/magpie-*.js` 行（不再被引用；文件按 D16 保留）；`client-terminal.mjs` **保留**（login-terminal 端点消费）；`scripts/desktop-update-test.mjs` 删；`scripts/standalone-desktop-regression-test.mjs` **保留**（PM 核实测 eac/open-external——A5-M 矩阵 S12 复核其端点依赖均属保留面）；root package.json `build:magpie`/`update:magpie` 命令保留（D18 17 条不变，vendor 资产有效，存疑保留）。

### A6 测试处置（E-4 机械规则逐文件；R6O-005 补 workbench 系四测试；检索口径 = 「被删后端模块 import + 端点调用」，产出与 A5-M 矩阵共用）

| 测试 | 处置 | 判据（实测锚点） |
|---|---|---|
| `standalone-nav-test.mjs` | **改写**：断言改为 6 页三分组、无 lite 分支、未知 page 不可达、**smart/calendar 懒加载可达**（R6O-001） | 导航机制保留、页面集合变更——AC-36 断言载体 |
| `standalone-page-lifecycle-test.mjs` | 改写：LazyPage 集合=LAZY_PAGES 推导（settings/smart/calendar 三页）、visited 机制不变 | 机制保留 |
| `standalone-frontend-test.mjs` / `standalone-react-ui-test.mjs` | 改写：渲染面收缩 6 页；被删页断言移除 | 前端整体测试保留 |
| `standalone-model-operation-test.mjs` / `standalone-model-row-test.mjs` | **改写并迁移**：启停断言改挂 smart 页语义（A4 的 RPC 往返 + 候选联动）；目录行断言收缩 | 被测功能（启停）迁移而非消失 |
| `standalone-channel-filter-test.mjs` | 改写：过滤断言收缩至保留页 | 同上 |
| `standalone-client-regression-test.mjs` | 改写：快照对比提取集收缩（仅保留仍在 standalone 前端的可比组件：ChannelCard/DICT 等；Shell/FreePage/Roster/ChainEditor* 等已删组件移出对比集） | 快照（E-10）冻结含全量历史组件，对比集按保留面收缩 |
| **`workbench-test.mjs`**（R6O-005） | **删** | :6-7 `import { createWorkbench… } from '../packages/standalone/workbench.mjs'` + providers.mjs——被删后端模块直依 |
| **`workbench-library-test.mjs`** | **删** | :6-7 import workbench.mjs/library.mjs |
| **`workbench-management-test.mjs`** | **删** | :7 import workbench.mjs；:61 遍历 `['/workbench','/providers','/subscriptions','/library','/routing']` 被删端点 |
| **`workbench-native-desktop-test.mjs`** | **删** | :23 相关删除面（workbench 系端点/模块） |
| `desktop-update-test.mjs` | 删（A5-2） | 被测对象删 |
| **`standalone-package-test.mjs`** | **改写 :261** | 该行断言消费 `/models/test|refresh` 端点（随端点删）——改用保留端点断言或移除该断言（R6O-002 矩阵产出） |
| **test-all.mjs suites 逐套件标注** | 删：`workbench`（:73）、`workbench-library`（:74）、`workbench-management`（:75）、`desktop-update`（:90）及 A6 删除项对应套件；其余（standalone 系/共享内核系/A6 改写项）保留 | `grep -n "workbench\|desktop-update" scripts/test-all.mjs` 复现 |

### A7 AC-37 判零（R6O-004 四条 pattern + 判零脚本化；R6O-008 时序前置）

**四条 pattern（拆分以消除误报/漏报）**：

| 面 | pattern | 口径 |
|---|---|---|
| (a) 前端源面 | `'(overview\|workspace\|agents\|usage\|sponsor)'`（限 `packages/standalone/frontend/*.tsx *.mjs`） | 撞词 id（models/library/providers/routing/eac/updates）**不入此面**——保留测试合法字面量（如 standalone-management-test:363/:375 `'eac'`、magpie-native-ui 13 处、forward-test index/client 字面量）会误报；撞词 id 仅在被删文件内命中，文件删除后此面自然归零 |
| (b) 端点面 | `/workbench\|/library\|/providers\|/routing\|/subscriptions\|/engine\|/desktop-update\|/eac/\|/models/(test\|refresh)`（含模板串形态 `${PREFIX}/…`） | v8 单 pattern 对模板串零覆盖的漏报面修复 |
| (c) 测试面 | 限 A6 处置集合文件复检（删除项不存在即零；改写项按新断言面） | 不全仓扫测试字面量 |
| (d) 符号面 | `LITE_PAGES\|liteNavigationPages\|--full\|hasDesktopBridge\|--lite` | 双模架构符号清零 |

**判零脚本化（R6O-004 更好替代）**：新增一次性只读脚本 `scripts/s12-zero-residual-audit.mjs`——输出「pattern × 命中 × 豁免理由」工件 `docs/software-company/s12-zero-residual-audit.txt`；S14/S15 复跑**同脚本**比对。豁免逐项留痕：E-10 快照（冻结历史组件）、release-notes/控制面文档、web/ 重建前状态（见时序）。

**时序（R6O-008）**：web/ 构建产物现存 desktop-update 残留（app.js -o 计 8 处 / app.css 11 处——minified 单行文件 `-c` 行计数为 1，判零以 `-o` 口径）——**判零必须前置于 `build:standalone-ui` 重建 + 产物提交完成之后**；脚本内置前置检查：`web/assets.json` 指纹与重建输出一致性（不通过即中止并报「产物未重建」），白名单不再为重建前状态留豁免。

判零出口四判据不变：四 pattern 归零 + `npm test`（修剪后）+ `typecheck:standalone` 全绿 + pack 产物清单断言不含被删模块（AC-37）。

## V8.2-0 Buffer 2026 设计语言锚点（BA-1~10；S12-B 与 S13 的逐条验收锚点）

> 来源：用户提供的 6 篇 Buffer 参考文章，2026-11-17 重新抓取固化（交付总监转交）。本表为 §V8.2（S12-B 换肤）的执行锚点与 §V8.3（S13 终审）的逐条判定基准；与 AC-38（纹理判零）/AC-39（双主题终审）互引——S13 三路评估对 BA-1~10 逐条判定 PASS/FAIL，任何 FAIL 即发现项进入分级修复流程。

| # | 锚点 | S12-B 落点对应（§V8.2 表） |
|---|---|---|
| BA-1 | 暖中性底：昼暖纸面/夜暖灰绿深底（夜底从近黑冷 #181c1f 系换暖调），内容主角界面退后 | 落点 #6（含抽验修正：主底已暖，冷残留清理于装饰层） |
| BA-2 | 翡翠绿仅主操作/选中/状态，不做装饰；琥珀等粉彩仅语义用途 | 落点 #6/#7（色彩语义审计随精修） |
| BA-3 | 轻字重（标题 600/正文 400-500）+ 柔圆角（控件 8-10px、卡片 12-16px，全站统一 token） | 落点 #6（token 化 radius/weight，S1 已建 --radius-*/--weight-* 基础上收口统一） |
| BA-4 | 零终端纹理（判零 grep）：斜切角 clip-path/chamfer、扫描线、[NO SIGNAL] 层（app.css:4244-4259 整层）、LOCAL 标注（shell.tsx:155）、装饰性等宽数字（渠道卡统计/徽标/页头 mono→正文字体；tabular-nums 仅限数据表格） | 落点 #1-#5（= AC-38 判零清单，逐项对应；tabular-nums 现状口径 = 四文件 grep 91 行，§V8.2 #5） |
| BA-5 | 侧栏=集中式三分组+每项徽标计数+底部状态区，轻量化（暖化后与内容区同语言） | §V8.1 A3（三分组重组）+ 落点 #6（侧栏暖化同语言） |
| BA-6 | 日历=月格+悬停明细+点击详情+状态语义色，卡片走 Buffer 圆角语言 | 落点 #7（calendar 同步过一遍；结构 S6 已建） |
| BA-7 | 无数据/0/数值三态清晰呈现（已有，保持） | 回归断言（S14 AC-15/16 抽测覆盖，不破坏） |
| BA-8 | 账号渠道页=Channels 面板心智：账号列表+状态徽标+行内操作，圆角卡、渠道品牌微着色保留但去斜切角 | 落点 #7（主战场最高优先级；品牌微着色保留、斜切角随 #1 清零） |
| BA-9 | 智能调度页=队列心智：候选/池两栏+拖拽排序+行内模型启停（S12-A 已列） | §V8.1 A4（启停补齐）+ 落点 #7（smart 同步过一遍） |
| BA-10 | 视觉噪音判零：无 glow/无装饰动画/无多余装饰层（reduced-motion 之外的纯装饰动效清零） | 落点 #2/#3（呼吸动画/扫描动画随层移除）+ S13 B 路检测器复扫（glow/装饰动效 grep 与走查） |

## V8.2 S12-B 深度换肤（FR-14；含本轮抽验修正）

**抽验修正（PM 事实核对的偏差登记）**：夜主题**主底 token 已是暖调**——app.css:925 起 `[data-theme="dark"]` 的 `--paper: #12110e`，注释明示「层次：L0 #12110e < L1 #1b1a16 < L2 #232019」（S1-S9 换肤成果）；PRD 引用的「#181c1f 系」在前端 css **零命中**。**冷色残留实测集中于装饰层**：斜切角区渐变 `rgba(20,22,34,*)`/`rgba(13,14,22,*)`/`rgba(11,12,18,*)`（app.css:775/827 一带，偏蓝黑）与 channels.css 的 cp5/ofm 遗产层。FR-14 执行因此 = 纹理层移除 + 装饰层冷色清理 + 昼内容区暖纸面化 + channels 内容区主战场精修（而非全量底色重做）。

| # | 落点 | 内容（实测锚点） | 验收 |
|---|---|---|---|
| 1 | 斜切角清零 | `clip-path: polygon(px…)` 组件装饰：app.css:774（14px 切角）、:826（18px）、:4251（16px 空态）及全量 grep 其余命中；`:548-552` 的 `clip-path: inset`（入场动效）**保留**（PRD 明示不在禁列） | AC-38 grep 判零（inset 除外） |
| 2 | NO SIGNAL 层移除 | app.css:4244-4259 整层（`.chart-empty/.empty-state` 的 `[ NO SIGNAL ]` ::before + 方括号变体 + 呼吸动画）——**页面删除后仍影响保留页空态，必须移除**；保留页空态以新空态样式承接 | AC-38 `NO SIGNAL` 变体归零 |
| 3 | 扫描线/scanline/cp5 遗产 | app.css 19 处 scanline/cp5 命中逐处清理；channels.css 的 cp5/ofm 渐变与动画层同口径 | AC-38 归零 |
| 4 | LOCAL 标注 | shell.tsx:155 顶栏 `<span>LOCAL</span>`（含 topbar-divider 调整） | AC-38 移除 |
| 5 | 等宽数字场景化 | 现状 `tabular-nums` 四文件 **grep 计 91 行**（`grep -rn "tabular-nums" packages/standalone/frontend/*.css \| wc -l`，ff17b26 实测——v8 写 62 处系 `tabular-nums\|mono-font` 合计口径、审查者 40 处系按出现次数计，v9 统一为 91 行 grep 口径）——逐行分类：数据表格/统计数值**保留并列表留痕**（channels.css:200/398/484/520 渠道卡统计、calendar.css:10/30 日历数字等）；页头/徽标/非数据场景 mono → 正文字体 | AC-38 逐处留痕表 |
| 6 | 夜主题底色**全量 hue 审计**（R6O-007）+ 昼暖纸面 | 不再枚举三系色值——**夜主题全部底色/渐变/阴影色值按 hue 判冷全量审计**（实测冷色系含 `rgba(20,22,34,*)`、`rgba(13,14,22,*)`、`rgba(11,12,18,*)` 与**第四系 `rgba(16,17,25,*)`（app.css:715，v8 漏列）**）；产出一次性只读色值审计脚本（色值×位置×hue 表 → `docs/software-company/s12-color-audit.txt`，AC-38 可复跑判据）；昼内容区冷灰白 → 暖纸面；**昼夜同构校验**：同一 token 集两组取值一一同构 | AC-38「无近黑冷底残留」= 色值审计脚本 hue 判定归零 + AC-39 同构断言 |
| 7 | 渠道内容区主战场（R12） | channels.css 渠道卡/徽章/统计行/签到开关/页头/tabs 逐组件精修（最高优先级）；settings/connection/requests/calendar/smart 同步过一遍 | AC-39 双主题终审 |

View Transition 与 `prefers-reduced-motion` 降级保留（FR-14.4 沿用 FR-1.3/NFR-6）。

## V8.3 S13 impeccable 重终审（AC-39；D28 新基线）

- 前置：S12 出口（AC-36/37/38 全绿）+ build:standalone-ui + 起服务。
- 走查矩阵：**6 页 × 昼/夜 = 12 单元**；refinement 基线 = FR-14 完成后的新世界（D28——世界级变更授权已在 S12 用尽，S13 起恢复「精修不推翻」约束，此后世界级变更回到上报流程）。
- 三路评估精简版：**A 代码审查**（token 同构性/残留 grep 复跑/空态承接/键盘可达）+ **V 视觉走查**（12 单元逐页：渠道内容区主战场优先）+ **B 检测器**（对比度 ≥4.5:1/3:1 双主题、控制台零错误、reduced-motion 降级、glow/纯装饰动效复扫）。**逐条判定：对 §V8.2-0 锚点 BA-1~10 逐条 PASS/FAIL，FAIL 即发现项分级处置**（与 AC-38/39 互引：BA-4 = AC-38 判零清单；BA-1/2/3/5-10 = AC-39 终审基线）。
- 发现分级 blocker/major/minor → 修复复检留痕；工件 `docs/software-company/s13-impeccable-findings.md`。
- 出口：无未解决 blocker/major；昼暖纸面/夜暖灰绿深底且 token 一一同构；AC-36 复测通过。

## V8.4 S14 回归

0. **前置（R6O-008 时序）**：`npm run build:standalone-ui` 重建 + web/ 产物提交 → 跑 A7 判零脚本（assets.json 指纹前置检查必须通过）+ §V8.2 色值审计脚本——两工件归档后才进入以下步骤；
1. 全量测试：`npm test`（A6 修剪后）+ `test:standalone` + `test:management` + `test:standalone-channels` + `test:package` + `typecheck:standalone` + `typecheck`；
2. 6 页功能冒烟：channels（RPC 面：model.list/account.list/claimAll 包装）、smart（池保存/启停/状态）、calendar（数据/三态）、requests（列表/清空）、settings（保存往返）、connection（auto 示例联动）；
3. **保留页行为不变断言**：AC-4（池持久化）/AC-7（预检接力）/AC-8（429 信封）/AC-13（/v1/models auto）/AC-15（日历）抽测复验（PRD S14 行指定基线）；
4. `build:standalone-ui --check` + `pack:standalone` 产物清单断言（不含被删模块）。
证据 `docs/software-company/s14-regression-record.md`。

## V8.5 S15 发布 1.2.0（AC-40；复用 §6I 机制）

1. **机制复用**：`scripts/release-standalone-npm.mjs` 六子命令链（S11 已实战验证，ff17b26 已修 `./` 前缀——publish/smoke 的 tgz 参数 npm 11 本地语义）；D25 授权范围、I.5 角色分工（总监执行 publish/push）、I.4 回滚框架、AC-35 凭据纪律全部沿用。
2. **版本**：bump `packages/standalone/package.json` 1.1.0→**1.2.0**（D29：minor + 用户裁定覆盖 latest；「未传播」论证采信 PM npm 实测——1.1.0 发布 <24h、周下载 247 全为 1.0.x 且窗口早于 1.1.0 → 1.1.0 实测下载≈0）。
3. **发布说明（破坏性声明开篇）**：`release-notes-1.2.0.md` 首节 = 破坏性变更说明（页面删减 16→6、`--full`/`--lite` 旗标移除、模型启停新入口=智能调度页、token 数据新入口=用量日历、受影响功能迁移指引）；文案 PM 定稿（S11 确认事项④⑤同口径）。
4. **NPM-README 核对**：6 页形态表述、无被删页/`--full` 引用（A7 判零覆盖）、:51 插件导流行维持删除态。
5. **发布后动作（建议项，AC-40）**：`npm deprecate our-free-model-standalone@1.1.0 "1.2.0 提供精简 6 页形态与迁移指引，建议升级"`。
6. **git**：commit A（bump+notes+README）→ 六子命令 → commit B（record）→ push 单一 refspec（AC-33 纪律沿用）。

## V8.6 风险与回滚（R11-R13 对策 + 回滚）

| # | 风险 | 对策 |
|---|---|---|
| R11 | 被删页面与其他模块耦合（Page 联合/共享组件/management.ts/单测 fixtures/pack sourceFiles） | §V8.1 A1-A7 文件级清单（反向依赖实测：model-picker/eac/channels 子页保留判定）+ A7 判零 grep + 修剪后全量测试；E-4/E-0 机制复用 |
| R12 | channels.css 深层遗产（cp5/ofm/夜纹理）工作量低估 | §V8.2 #7 主战场最高优先级 + AC-38 判零/AC-39 终审双闸；S13 视觉走查渠道页单元排首 |
| R13 | desktop-update 处置不当（误删被引用模块/残留死代码） | A5 精确清单（desktop-update.mjs+测试删、standalone-desktop-regression-test 留、pack:27 行移除、前端桥随页删）；A7 判零含 desktop-update/hasDesktopBridge |
| SR-12（自识别） | 换肤波及保留页行为（css 改动误伤交互态） | S14 保留页行为不变断言（AC-4/7/8/13/15 抽测）+ 12 单元走查 |
| SR-13（自识别） | 1.2.0 覆盖 latest 后需回滚 | `npm dist-tag add our-free-model-standalone@1.0.2 latest` + deprecate 1.2.0（I.4 框架；1.0.2 为最后稳定全页版） |

**回滚**：S12 裁剪/换肤分独立 commit 组（A 组/B 组）可分别 revert；S15 按 I.4（dist-tag 回拨 1.0.2 + deprecate 1.2.0；分支提交保留）；全程不碰 main/PR/upstream（D25 纪律沿用）。数据层：裁剪零数据迁移（settings 字段纯 UI 移除保留不动，PRD FR-13.4）。

## V8.7 未决假设与证据缺口申报

**未决假设 0 / 证据缺口 0**。本轮 PM 已核实事实全部抽验一致，仅一处**修正登记**（非缺口）：FR-14 背景描述「夜近黑冷底 #181c1f 系」与实测不符——前端 css 零命中 #181c1f，夜主底 token 已暖（#12110e/#1b1a16/#232019，S1-S9 成果）；冷残留实证定位于斜切角装饰层 rgba(20,22,34) 系与 channels.css 遗产层（§V8.2 抽验修正段）。该修正**收窄 FR-14 工作面但不改变 AC-38 判零标准**（纹理/冷色 grep 判零照常执行）。阶段门确认事项：S15 的 release-notes-1.2.0 破坏性声明文案（PM 定稿）。

## V8.8 处置表（PRD v3.0 驱动的 v8 增量）

| 条目 | 落点 | 证据 |
|---|---|---|
| FR-13.1-2 页面集合与导航重组 | §V8.1 A1/A3 | frontend 目录实测（tsx ×10/css ×6 删除清单）；navigation 现状（4 组 16 页，smart 在「免费模型」组） |
| FR-13.3 双模删除 | §V8.1 A2 | cli.mjs:12-31/service.mjs:119,356/shell.tsx:33,54-55/app.tsx:65 全实测 |
| FR-13.4 功能去留（启停/token/密钥/配置/请求日志/updates） | §V8.1 A4 + A5 | smart.tsx:102/180 过滤现状 + 前端零 setDisabled 调用点（grep）；model.setDisabled RPC business.mjs:63278 既有 |
| FR-13.5 残留清理 | §V8.1 A7 | 判零 grep + 四判据（npm test/typecheck/产物清单） |
| FR-14.1-5 深度换肤 | §V8.2（含抽验修正） | app.css:925 夜底已暖/774/826/4244-4259 斜切角与 NO SIGNAL/scanline 19 处/shell.tsx:155 LOCAL/tabular-nums 62 处 |
| S13/S14/S15 | §V8.3/V8.4/V8.5 | PRD 阶段表 + §6I 机制复用 + npm view 实测（latest=1.1.0） |
| D29 版本口径 | §V8.5.2 | PM npm time/downloads 实测采信 + 抽验 latest=1.1.0 ✓ |
| R11-R13 | §V8.6 | 逐项对策 |

v8 申报计数：blocker 0 / major 0 / minor 0 / 未决假设 0 / 证据缺口 0（一处 PM 事实修正登记，非缺口）；阶段门确认事项 1 项（S15 发布说明文案）。

## V8.9 第 6 轮处置表（v8 → v9；R6O-001~008，审查者实证全部经本轮抽验复核一致后采纳）

| ID | 级别 | 处置 | 修订位置 | 关键证据（ff17b26 实测复核） |
|---|---|---|---|---|
| R6O-001 | major | **接受（更好替代：单一来源推导）** | §V8.1 A2 app.tsx 行 + A6 nav/page-lifecycle 行 | LazyPage 现状签名 :50 五页集合 `'models'\|'usage'\|'settings'\|'smart'\|'calendar'`、:89 渲染数组同集合——删 models/usage 后正确集合 = **settings/smart/calendar 三页**；LAZY_PAGES 单一定义 + navigationPages.filter 推导（不手写枚举）；AC-36 增 smart/calendar 懒加载可达断言（visited + 切换激活） |
| R6O-002 | major | **接受（更好替代：端点×消费者矩阵）** | §V8.1 A5-1/A5-M + A6（standalone-package-test:261 改写） | EacAuth/useEacLogin 仅在 channels.mjs EacPage（:148-172），唯一挂载=被删的 `kind==='eac'` 分支（:175）——v8「渠道页内嵌 EAC 入口仍在」**失实撤回**；eac.mjs 保留真实依据 = service.mjs:261 createStandaloneEac + :279 sealedCredential（推理链）+ management.mjs:259 eacAuth（随 EacPage 删）；/eac/* 六端点（management.mjs:549-560）与 /models/test\|refresh（:599/:604）入矩阵并定案 |
| R6O-003 | major | **接受（创建链归位 + 符号名锚点制）** | §V8.1 A5-1 表 | service.mjs:210-220 实为 LAN relay 配置（**必须保留**，v8 错标为创建链）；workbench/library/providerManagement/routingManagement 创建实在 management.mjs（import :9-13→实测 :10-14、:236-244）+ desktopUpdate :140；service.mjs 真实存在 :261 eac/:264 subscriptions/:268-269 magpie；处置表对象列改符号名 + `git grep -n <符号> ff17b26` 可复现锚点 |
| R6O-004 | major | **接受（四 pattern + 判零脚本化）** | §V8.1 A7 | 误报面实证：standalone-management-test:363/:375 `'eac'` 字面量、magpie-native-ui 13 处、forward-test 4 处——撞词 id 移出 (a) 面；漏报面实证：端点模板串 `${PREFIX}/eac/` 零覆盖——(b) 面覆盖；(c) 限 A6 处置集合、(d) 符号面；判零脚本 `scripts/s12-zero-residual-audit.mjs`（一次性只读，输出 pattern×命中×豁免工件，S14/S15 复跑同脚本） |
| R6O-005 | major | **接受** | §V8.1 A6 增四行 + test-all 套件逐套件标注 | workbench-test :6-7（import workbench.mjs/providers.mjs）、workbench-library-test :6-7、workbench-management-test :7/:61（遍历 /workbench /providers /subscriptions /library /routing）、workbench-native-desktop-test :23——四测试删；test-all :73-75 三套件 + :90 desktop-update 套件删；检索口径 = 被删后端模块 import + 端点调用（与 A5-M 共用产出） |
| R6O-006 | minor | **接受（七处锚点修正）** | §V8.1 A1/A4 + 附 V8 | frontend 根无 overview.tsx（在 components/，根级 tsx ×9 + components ×1）；model-picker 保留侧引用者仅 connection.tsx:26/:334；channels.mjs 子页四个（accounts/ledger/logs/**tools**，tools 保留）；smart.tsx 过滤 :101；model.setDisabled 实测 business.mjs:63282；shell.tsx LITE_PAGES :35 / liteNavigationPages :56-57；tabular-nums 四文件 grep 91 行（v8 的 62 系 tabular+mono 合计口径，已注明） |
| R6O-007 | minor | **接受（更好替代：色值审计脚本）** | §V8.2 落点 #6 | app.css:715 `rgba(16,17,25,0.85)` 第四冷色系（v8 三系枚举漏列）；#6 改「夜主题全部底色全量审计按 hue 判冷」+ 一次性只读色值审计脚本（色值×位置×hue 表 → s12-color-audit.txt，AC-38 可复跑判据） |
| R6O-008 | minor | **接受（时序前置 + 指纹检查）** | §V8.1 A7 时序段 + §V8.4 步骤 0 | web/ 构建产物 desktop-update 残留（app.js -o 8 处 / app.css 11 处；minified 单行 -c 计 1，以 -o 口径）——判零前置于 build:standalone-ui 重建 + 产物提交后；脚本内置 assets.json 指纹一致性前置检查，白名单不留重建前豁免 |

v9 申报计数：blocker 0 / major 0 / minor 0 / 未决假设 0 / 证据缺口 0（R6O-001~008 全部处置，待第 7 轮全新审查复核）；阶段门确认事项 1 项（S15 发布说明文案）不变。

## 附 V8：证据索引（ff17b26 实测，2026-11-17）

| 事实 | 锚点 |
|---|---|
| 提交链（v7 后） | S9 收口系列（46a8baf…8f6bd0c）→ 8e35f79（B9 发布脚本）→ 0f159fe（S11 commit A：bump 1.1.0 + NPM-README 删导流行）→ 278c922（preflight porcelain 修正）→ b511e18（smoke realpath）→ **ff17b26**（release 脚本 npm 相对路径 `./` 前缀——publish 裸 tgz 被 npm 11 解析为 GitHub 简写，修为本地 tarball 语义） |
| npm registry | `npm view`：dist-tags latest=1.1.0；time.modified 2026-11-16T23:40Z（D29 采信 + 抽验一致） |
| 页面文件现状 | frontend/ 目录：28 tsx/css（16 页 + app/shell/sponsor/desktop-update 等）；components/ 8 文件 |
| channels.mjs 子页 | :124 导航项 + :142-144 渲染：**四个** = accounts/ledger/logs/**tools**（tools=「供应商与备份」卡片 :93，保留）；EacPage :148-172 与 kind==='eac' 挂载分支 :175 随删 |
| 双模链路 | cli.mjs:12-31（--lite/--full + options.lite）；service.mjs:119（`lite = false`）/ :356（lite 传递）；shell.tsx **:35** LITE_PAGES / **:56-57** liteNavigationPages；app.tsx:65 navigate 过滤 |
| navigation 现状 | shell.tsx:8-27：4 组 16 页（models/smart/channels/connection/requests + overview/workspace/agents/usage/calendar/library + providers/routing/eac + settings/updates） |
| smart 启停缺口 | smart.tsx **:101** 过滤 disabled/dead（:180 为文案行）；全前端 grep 无 setDisabled（PM 核实一致）；RPC 通道 business.mjs **:63282** `case "model.setDisabled" {` |
| 夜底现状（抽验修正） | app.css:925 起 `--paper: #12110e`（注释：L0 #12110e < L1 #1b1a16 < L2 #232019，暖调）；`#181c1f` 前端 css 零命中；冷残留 = :775/:827 `rgba(20,22,34,*)`/`rgba(13,14,22,*)`/`rgba(11,12,18,*)` + **:715 `rgba(16,17,25,0.85)`（第四系，R6O-007）** 渐变装饰层——全量 hue 审计口径见 §V8.2 #6 |
| 纹理清单锚点 | 斜切角 app.css:774（polygon 14px）/826（18px）/4251（16px）；NO SIGNAL :4244-4259（.chart-empty/.empty-state ::before + 呼吸动画）；scanline/cp5 app.css 19 处；LOCAL shell.tsx:155；**tabular-nums 四文件 grep 91 行**（`grep -rn "tabular-nums" packages/standalone/frontend/*.css \| wc -l`；channels.css:200/398/484/520、calendar.css:10/30 等数据场景） |
| management 被删页端点 | management.mjs:316-323（privileged 前缀）+:340-345（desktop-update 三端点）+:355+/:364-391/:392-416（workbench/library/routing/providers/subscriptions）+engine 系 + **/eac/* 六端点 :549-560** + **/models/test|refresh :599/:604**（消费者=被删 models.tsx + standalone-package-test:261） |
| 五模块创建链（R6O-003 归位） | management.mjs import **:10-14**（workbench/providers/library/routing/desktop-update 五模块）+ 创建 :140（desktopUpdate）/ :236-244（workbench/providerManagement/routingManagement/library）；service.mjs :261 eac / :264 subscriptions / :268-269 magpie（eac 保留依据 = :279 sealedCredential 推理链） |
| pack 注册 | pack-standalone.mjs:27 `'packages/standalone/desktop-update.mjs'`（S12 移除行） |
| 测试命中面 | grep 被删页 id 命中 9 测试：nav/page-lifecycle/frontend/react-ui/model-operation/model-row/channel-filter/client-regression + desktop-update-test（A6 处置表）+ **workbench 系四测试**（workbench/workbench-library/workbench-management/workbench-native-desktop，R6O-005，删）+ test-all :73-75/:90 套件 |
| web 产物残留（R6O-008） | web/app.js `-o` 计 8 处 / app.css 11 处 desktop-update（minified 单行，`-c` 行计数为 1）——重建前状态，判零时序见 A7 |
| release 脚本 | scripts/release-standalone-npm.mjs（8e35f79 引入；ff17b26 修 `./` 前缀：publish 裸 `dist/xxx.tgz` 被 npm 11 当 GitHub 简写报 git ls-remote 128） |

---

---

# 第三部分 · v10 增量：auto 视觉路由 + smart 页迭代（PRD v3.1 / S16-S17）

| 项 | 内容 |
|---|---|
| 方案版本 | **v10**（PRD v3.1 增量；快速路线精简方案，门禁不豁免） |
| 状态 | `PLAN_READY_FOR_REVIEW`（工程基线冻结在 `14280e4`；v10 通过第 8 轮全新审查 + APPROVE 后才动代码） |
| 输入 | PRD v3.1（FR-15/FR-16、AC-41~44、D31-D34、R14-R15；S12 偏差 7 设计被决议 11B 推翻并内联标注） |
| 工程基线 | `feat/standalone-lite` @ **14280e4**（其前链：1f555cd S12-A 六页裁剪 → 1f666ab S12-B 暖调换肤 → 45266f7 1.2.0 发布 → 14280e4 发布脚本版本动态取值）；registry 实测 `latest=1.2.0`（D34：本轮 npm 发布暂停） |
| 范围 | S16 一阶段（FR-15/16，本地可验收交付）；S17（1.2.1 发布）**待用户本地验收后另行批准** |

## V10.0 验收映射

| PRD 条目 | 验收 | 落点 |
|---|---|---|
| FR-15 auto 多模态路由 | AC-41（五场景） | §V10.1 |
| FR-16.1-2 候选过滤与启用开关 | AC-42 | §V10.2-1/2 |
| FR-16.3-5 池内联状态/布局/兼容 | AC-43 / AC-44（布局半） | §V10.2-3/4 |
| 本地交付门 | AC-44（自测+registry 断言） | §V10.4 |
| R14/R15 | — | §V10.5 |
| S17（暂缓） | AC-40 同口径 | §V10.6 |

## V10.1 FR-15 auto 视觉路由（smart-schedule.mjs 扩展）

**1. vision 单一事实源（本轮统一核实结论，写死）**：`channels.publicModelRows()` 行的 `vision` 布尔——源头为 business 能力层（`capabilities.vision === true`，business.mjs:53619 一带）**含 RACCOON 实测覆写表**（business.mjs:44010-44028：`RACCOON_IMAGE_CAPABILITY_OVERRIDES`（sn-deepseek-v4-1-flash / sn-glm-5-3-flash）+ `raccoonSupportsImage()`——上游 tags 不含 vision 但实测能看图的模型覆写为支持），经 worker.mjs:78 折叠为单布尔 `vision: row.input?.includes('image') === true`；该行经 service 包装 `publicModelRows`（service.mjs:285 一带）进入 management `summary().catalog`（`vision: entry.vision === true`）→ 前端 `Model.vision`（types.ts:9）→ 接入页徽章（connection.tsx:359 `selected.vision ? …视觉支持`）。**PM 两个说法（worker :78 / business :53619）为同一条链的两层，无冲突；权威布尔 = publicModelRows().vision（徽章同源死规定由此满足——零第二实现）**。`model.list` RPC 无 vision 字段（实证：63220-63274 仅 id/name/disabled/dead/isFree?）——不采用。

**2. 快照扩展（refreshSnapshot 第三路，同源通道）**：现有快照 `{ at, models: Map<provider,rows>, accounts: Map<provider,rows> }`（smart-schedule.mjs:56-82 实证）增 `vision: Map<string, boolean>`——refreshSnapshot 时并行执行 `const rows = channels.publicModelRows() ?? []`（**内存函数，非 RPC**：runtime 缓存行，worker 'changed' 后 refresh 已更新；与接入页徽章读的是同一份 rows），构建 `Map(row.id → row.vision === true)`；刷新失败静默保留旧值（NFR-9 惯例）。**R14 消解**：同源即取自同一函数返回值，结构上不可能与徽章漂移；「能力 RPC 不可得回 PRD 重议」条款保留（publicModelRows 路径失效时触发）。

**3. 含图检测函数 `hasImageInput(request)`（三入口，smart-schedule.mjs 导出，纯函数可单测）**：service 包装层 request 对象的形态（worker.mjs:117 `request.responsesBody ?? request.openAi ?? harnessBody(request)` 实证三形态并存）：
- ① OpenAI chat：`request.openAi?.messages[].content` 为数组时，元素含 `image_url` 键 → true；
- ② Responses：`request.responsesBody?.input[]` 元素含 `type === 'input_image'`（含嵌套 `content[]` 递归一层）→ true；
- ③ Anthropic：`request.messages[].content[]` 元素含 `type === 'image'`（image block）→ true；
其余一律 false。**漏检语义安全**：检测遗漏 → 不过滤 → 行为与 1.2.0 纯文本路径一致（无回归面，SR-14）。

**4. 候选链过滤（evaluatePool/smartComplete 两处语义）**：
```
smartComplete(request, onChunk):
    visionOnly = hasImageInput(request)
    ev = evaluatePool({ visionOnly })            # 伪码扩展：usable 判定在 §3.2 基础上，visionOnly 时追加
                                                #   snapshot.vision.get(modelId) === true（显式 true 才肯定；
                                                #   false/null/undefined 一律按无视觉保守跳过，D31）
    if ev.kind === 'empty' and visionOnly:
        throw fail(400, '调度池内没有支持视觉的模型，请在智能调度页将视觉模型加入调度池')   # 池内不存在任何
                                                # vision=true（或池空）→ 400 配置指引（FR-15.4a/D31）
    …（empty 非含图 / exhausted / attemptOrder 循环沿用 §3.3；visionOnly 时 attemptOrder 已仅含视觉可用模型）
```
- **空语义细分**：`evaluatePool({visionOnly})` 的 statuses 全量仍覆盖池，但 `usable/attemptOrder` 仅视觉模型；「池内不存在 vision=true」= `statuses.every(s => !s.vision)` → 400；「存在视觉但全耗尽/不可用」→ 429 沿用 smartExhaustedFailure，**details 增 `filteredBy: 'vision'` 字段且 models 仅列视觉候选**（FR-15.4b；扩展字段 SDK 忽略，纯文本 429 形状不变）。
- **非显式 true 保守跳过**（D31）：vision Map 仅在 `=== true` 时肯定；快照中缺该模型键 = 不具备。
- **沿用条款**：接力触发条件不新增（视觉过滤发生在候选链构建期，FR-4.3 不变）；流式保护/请求日志/stats 计真实模型（FR-4.5/4.9）对含图请求同样适用。
- **纯文本零变化**：`visionOnly === false` 时全链路与 1.2.0 逐字节一致（AC-41 场景二）。

## V10.2 FR-16 smart 页三改（smart.tsx/smart.css）

**1. 候选默认过滤 disabled（推翻 S12 偏差 7 常显，R15）**：smart.tsx:101-107 过滤链追加 `!row.disabled`；修剪偏差 7 实现件——:30 `已停用` 常显 tag、:36-39 启停按钮常显、:107 注释（「候选清单保留已停用条目」）、:205 区头文案（「停用条目可在此重新启用」）。
**2. 「显示已停用模型」开关（D32 恢复路径）**：候选区顶部开关（默认关）；开启后停用条目灰显 + 仅「启用」动作（复用既有启停 RPC 行内按钮 :36-39，该视图收敛为启用单向）；启用成功即回默认候选（重读 /smart/state 语义不变，:134）。
**3. 池状态区内联化（D33）**：smart.tsx:259 `<h2>池状态</h2>` 独立区块整体移除（DOM 与视觉均无，AC-43）；池行内联「已消耗 M/N（账号）」——N=accounts.total、M=N−accounts.available（/smart/state 既有字段，smart.tsx:19-28 已在用）；**M=N 且 N>0 行内追加「最早解禁 HH:mm」**（本地时区）——**/smart/state 扩展字段**：`statuses[].accounts.earliestResetAtMs`（该模型全部启用账号 `modelRateLimits[modelId]` 中 > now 的最小值，与 §3.4 resetAtMs 同源派生；**可选字段新增、既有字段零改动**，FR-16.5 兼容约束）。每账号悬停明细为可选增强（不做）。
**4. 布局重分配（D33/D34）**：移除池状态区后候选区与池区高度重分配、候选列表 max-height 增大（smart.css）；AC-44 口径 = 1920×1080 默认缩放两容器完整可见 + 无死区 + 候选可视行数多于 1.2.0（走查留屏证）。

## V10.3 测试（AC-41~43 载体）

| 套件 | 用例 |
|---|---|
| standalone-channels-test 扩展 | ① 池 [M-text, M-vision] 含图（fixture：vision 布尔经 publicModelRows 注入）→ M-vision 承接、M-text 零上游调用；② 同池纯文本 → M-text 承接（与 1.2.0 断言复用）；③ 池无 vision → 含图 400 invalid_request_error + 指引；④ 池有 vision 但全耗尽（modelRateLimits 预置）→ 429 + details 仅视觉候选 + `filteredBy:'vision'`；⑤ vision 缺失模型（键不存在）→ 含图不被调用、纯文本不受影响（AC-41 场景五） |
| standalone-management-test 扩展 | /smart/state：`accounts.earliestResetAtMs` 透出与派生断言；候选 disabled 默认不出现（state 面断言配合前端开关）；既有字段回归（FR-16.5 兼容） |
| nav/frontend 回归（R15） | S12 偏差 7 断言修剪：standalone-model-operation-test 的「停用常显+启用按钮常显」断言改为开关语义（默认不含、开启可见、启用回候选）；react-ui 走查池状态区不存在（DOM 断言） |
| 判零复跑 | §V8.1 A7 判零脚本 + §V8.2 色值审计复跑（S16 改动不引入新残留/新冷色） |

## V10.4 本地交付门（AC-44；D34 本轮不发布）

1. 六项功能自测清单（留痕 `docs/software-company/s16-local-acceptance.md`）：① smart 页正常渲染（开关/内联状态/布局）；② `model=auto` 纯文本调用成功（行为=1.2.0）；③ `model=auto` 含图调用命中视觉模型；④ 停用模型默认不在候选（开关路径可恢复）；⑤ 池行显示 M/N（全耗尽行显示 HH:mm）；⑥ 独立池状态区不存在（DOM+视觉）。
2. registry 断言：`npm view our-free-model-standalone dist-tags` → **latest 仍为 1.2.0**（全程零 publish 操作，含 release 脚本不运行 publish 子命令）。
3. 本地启动交付：`npm run start:standalone`（或 `node packages/standalone/cli.mjs`）启动 + 一次性管理链接交用户验收（「先看再发」）。

## V10.5 风险与回滚

| # | 风险 | 对策 |
|---|---|---|
| R14 | 视觉数据源与徽章不同源（漏选/误选） | §V10.1-1/2：单一事实源写死 = `channels.publicModelRows().vision`（徽章同一函数返回值，结构上零漂移）；能力 RPC 不可得 → 回 PRD 重议判定来源（条款保留） |
| R15 | 偏差 7 推翻的实现/测试回归 | §V10.2-1 修剪清单（:30/:36-39/:107/:205）+ §V10.3 nav/model-operation 断言改写 + AC-42 按新语义验收；AC-44 走查兜底布局 |
| SR-14（自识别） | 含图入口检测遗漏（未来新增请求形态） | 漏检 → 不过滤 → 行为同 1.2.0（无回归面）；三入口清单以 worker.mjs:117 三形态为锚，新增入口时同步检测函数（判零脚本 (d) 面可加 `image_url\|input_image` 前端无关、后端形态审计） |
| SR-15（自识别） | earliestResetAtMs 派生与 429 resetAtMs 双实现漂移 | 同一派生函数复用（modelAvailability 内已算 min(resets)——直接透出，零第二实现） |

**回滚**：S16 独立 commit 组（FR-15 后端 / FR-16 前端可分可合）可整体 revert——纯文本路径零变化使后端 revert 零影响面；/smart/state 为可选字段新增，旧前端读新响应兼容、新前端读旧响应降级（earliestResetAtMs 缺省不显示）。数据层零迁移（池配置/快照无 schema 变更）。

## V10.6 S17（暂缓，待用户本地验收后另行批准）

版本 1.2.1（patch——AC-41/42/43 全为 additive，`/smart/state` 可选字段兼容）；FR-12/§6I 机制全复用（14280e4 起发布脚本版本从 package.json 动态取值——bump 单点不变）；发布说明补 v1.2.1 段（视觉路由 + smart 迭代）。**本版不排期、不预执行任何 publish 动作。**

## V10.7 未决假设与证据缺口申报

**未决假设 0 / 证据缺口 0**。PM 预核事实全部抽验一致并统一：worker.mjs:78 与 business.mjs:53619 系同链两层（§V10.1-1）；RACCOON 覆写表实证（44010-44028）；model.list 无 vision 实证；S12 偏差 7 实现件行号实证（smart.tsx:30/:36-39/:107/:205/:259）；快照现状实证（smart-schedule.mjs:56-82）。阶段门确认事项：S16 本地验收后用户对 S17 的批准（D34 既定流程）。

## V10.8 处置表（PRD v3.1 驱动的 v10 增量）

| 条目 | 落点 | 证据 |
|---|---|---|
| FR-15.1 判定来源定稿 | §V10.1-1/2 | worker.mjs:78 + business.mjs:53619/RACCOON 覆写 :44010-44028 + connection.tsx:359 徽章 + types.ts:9——同链实证；model.list 无 vision（:63220-63274） |
| FR-15.2 保守跳过 / 15.3 仅含图过滤 | §V10.1-4 | D31「显式 true」约定；纯文本零变化（AC-41 场景二载体） |
| FR-15.4 400/429 细分 | §V10.1-4 | details 增 filteredBy:'vision'，明细仅视觉候选 |
| FR-16.1-2 候选过滤+开关 | §V10.2-1/2 | S12 偏差 7 实现件修剪清单（smart.tsx 四处行号） |
| FR-16.3 池内联状态 | §V10.2-3 | /smart/state 增 accounts.earliestResetAtMs（可选字段，兼容约束 FR-16.5） |
| FR-16.4 布局 | §V10.2-4 | AC-44 走查口径 |
| AC-44 本地交付门 | §V10.4 | registry latest=1.2.0 实测（本轮基线）+ 六项自测清单 |
| R14/R15 | §V10.5 | 同源写死 / 偏差 7 修剪清单 |
| S17 暂缓 | §V10.6 | D34 |

v10 申报计数：blocker 0 / major 0 / minor 0 / 未决假设 0 / 证据缺口 0；阶段门确认事项 1 项（S17 待用户本地验收批准，D34 既定流程）。

## 附 V10：证据索引（14280e4 实测，2026-11-17）

| 事实 | 锚点 |
|---|---|
| 提交链（v9 后） | 1f555cd（S12-A 六页裁剪）→ 1f666ab（S12-B 暖调换肤）→ 45266f7（1.2.0 发布）→ **14280e4**（发布脚本版本改为从 package.json 动态取值） |
| registry | `npm view`：latest=1.2.0（D34 断言基线） |
| vision 链（单一事实源） | worker.mjs:78 `vision: row.input?.includes('image') === true`；business.mjs:53619（capabilities.vision 判定）+ :44010-44028（RACCOON_IMAGE_CAPABILITY_OVERRIDES：sn-deepseek-v4-1-flash/sn-glm-5-3-flash + raccoonSupportsImage）；service.mjs publicModelRows 包装（:285 一带）；management summary() catalog（`vision: entry.vision === true`）；types.ts:9 `vision?: boolean`；connection.tsx:359 徽章 |
| model.list 无 vision | business.mjs:63220-63274（models 仅 id/name/disabled/dead/isFree?） |
| 调度快照现状 | smart-schedule.mjs:56-82（snapshot = { at, models, accounts }；refreshSnapshot 并行 model.list+account.list RPC；失败静默）；:109-118（accountStats total/available 派生——M/N 与 earliestResetAtMs 的数据源） |
| 请求三形态 | worker.mjs:117 `request.responsesBody ?? request.openAi ?? harnessBody(request)`——含图检测三入口的形态锚点 |
| S12 偏差 7 实现件 | smart.tsx:30（已停用 tag 常显）、:36-39（启停按钮常显）、:107（保留注释）、:205（区头文案）、:259（`<h2>池状态</h2>` 独立区块）、:267（invalid 行）、:19-28（accounts 消费）、:134（启停后重读状态） |
| AC-41 五场景 | PRD v3.1 :441-447（含图命中/纯文本零变化/无 vision 400/有但耗尽 429/缺失保守） |

---

# 第四部分 · v11 增量：npm 全局实例自更新（PRD v3.2 / S18-S20）

| 项 | 内容 |
|---|---|
| 方案版本 | **v12**（v11 经第 9 轮 REVISE 修订：R9O-001 兜底强制解锁 / R9O-002 勘误撤回；PRD v3.2 增量，标准路线不豁免） |
| 状态 | `PLAN_READY_FOR_REVIEW`（工程基线冻结在 `d7a6409`；v12 待第 10 轮全新审查——delta 仅 R9O-001/R9O-002 两项闭环，处置表 §V11.12） |
| 输入 | PRD v3.2（FR-17、AC-45~50、D35-D38、R16-R17、S18-S20）；总监 S18 设计委派（检查器/端点/自重启/前端/测试五件） |
| 工程基线 | `feat/standalone-lite` @ **d7a6409**；registry 实测 `latest=1.2.4`（本轮 `npm view our-free-model-standalone dist-tags.latest --json` → `"1.2.4"`，2026-11-19）；本地包版本 `packages/standalone/package.json` = 1.2.4 |
| 范围 | S18 实现+自测（本方案主体）；S19 本地验收清单内容（§V11.7，验收文档由 S18 执行时落盘）；S20 发布 1.2.5 流程复述（§V11.8，**待用户批准、本轮零 publish 动作**） |
| 明确不做 | 不改 `packages/standalone/channels/*`（channel-pack 签名清单零触碰）；不改 `src/*`；不手改 `web/` 构建产物（由 build-standalone-ui 重建）；不新增持久化 settings 字段（FR-17.1：检查结果纯内存态）；零新增运行时依赖（包内 `dependencies: {}` 保持，npm view/i 用系统 npm） |

## V11.0 验收映射

| PRD 条目 | 验收 | 落点 |
|---|---|---|
| FR-17.1 每小时检查/内存态/unref | AC-45 | §V11.2 |
| FR-17.2 右上角 messageTip+关闭语义+状态可查 | AC-46 | §V11.3/§V11.5 |
| FR-17.3 一键更新（确认→update/run→npm i -g） | AC-47 | §V11.3/§V11.5 |
| FR-17.4 自重启（停监听→detached 派生→旧进程退出→前端轮询刷新） | AC-48 | §V11.4/§V11.5 |
| FR-17.5-② 非全局禁用自更（保守判定） | AC-49 | §V11.2/§V11.3/§V11.5 |
| FR-17.5-③ 失败不破坏现存安装/错误态可重试 | AC-50 | §V11.2/§V11.6 |
| FR-17.5-①④⑤（明示中断/检查静默/无 CSP 面） | AC-45/47 | §V11.3/§V11.5/§V11.9 |
| D35/D36/D37/D38 | — | §V11.2~§V11.8 逐条内联 |
| R16/R17 | — | §V11.9 |
| S18/S19/S20 | AC-45~50 / 用户验收 / 发布 | §V11.6/§V11.7/§V11.8 |

## V11.1 项目现状证据与口径校正（v12 勘误：撤回①，保留②③）

**关键工程事实（d7a6409 实测，行号见附 V11）**：
1. 版本读取：`service.mjs:17`（`VERSION = JSON.parse(readFileSync(new URL('./package.json', …))).version`）。PRD 写 :19，实测 :17——以实测为准。
2. close 链全貌：`service.mjs:378-396`——`stopped=true → clearTimeout(timer) → management.dispose() → eac/scheduler/claims/runtime.dispose() → await relayChanges → Promise.all([managementClosing, closeRelay(), listener.close(), channels.close()]) → finally { stores.dispose(); await releaseLock() }`。**service.lock 在 close 链最尾部释放**（`acquireServiceLock` :48-107）。
3. 锁竞态决定自重启顺序（本方案核心修订，见 §V11.4）：macOS（darwin）`acquireProcessGuard` 直接返回 null（:27），EEXIST 时**无回收路径**（:67 `if (error.code !== 'EEXIST' || !releaseGuard) throw error`——win32/linux 专属）；即旧进程持锁期间新进程启动必然 EEXIST 失败。
4. 调度形态锚点：`business.mjs:61142-61176`（`start()`：首跑延时 → tick → 周期重排；`defaultSchedule` :61172-61176 = `setTimeout + timer.unref() + cancel 句柄`）。**〔v12 勘误，撤回 v11「口径校正①」〕** auto-checkin 生产默认首跑即 30s：`AUTO_CHECKIN_DELAY_MS = 3e4`（business.mjs:60915）、周期 `AUTO_CHECKIN_INTERVAL_MS = 36e5`（:60916）、`autoCheckinDelayMs()` fallback 返回 DELAY（:60917-60921；env `DSH_CHANNEL_PACK_AUTO_CHECKIN_DELAY_MS` 仅测试覆写）。v11 的 sed 窗口起于 :60916 漏看 DELAY 常量、且误读 fallback 返回值为 INTERVAL_MS（60min），据以立的「校正①」属错误代码阅读，本轮撤回并降格为勘误。本方案 30s 首检 + 60min 周期**同时契合 AC-45 用户口径与 auto-checkin 生产先例**，二者一致、无冲突。
5. 端口延续事实：`service.mjs:344-346` 启动即 `settings.update({ standalonePort: listener.port })` 持久化实际端口；cli 侧 `port ?? savedPort`（service.mjs:229、cli.mjs:30/34-37）——显式 `--port` 优先于保存值。派生透传必须传**实际端口**而非原始 `--port 0`（§V11.4-3）。
6. 启动参数全集（cli.mjs:10-18/23-38）：`--port`、`--data-dir`、`--no-open`、`--no-refresh`、`--probe`（停用兼容）、`--lan/--no-lan/--lan-port`（三者均为 settings 持久化写入口，service.mjs:237-238 已保存、重启自动恢复，无需透传）。
7. 发布包布局：`pack-standalone-npm.mjs` 注入 `bin: { 'our-free-model-standalone': './packages/standalone/cli.mjs', ofm: 同 }`，**保留仓库相对布局**（包根下 `packages/standalone/` + `src/`）——全局安装后 `self-update.mjs` 与 `cli.mjs` 同目录，`path.join(moduleDir, 'cli.mjs')` 即派生目标。npm 全局布局 macOS/Linux 恒为 `<prefix>/lib/node_modules/our-free-model-standalone/…`（nvm `~/.nvm/versions/node/vX/lib/node_modules`、homebrew `/usr/local/lib/node_modules` 同构）；npx 缓存为 `~/.npm/_npx/<hash>/node_modules/…`。
8. **口径校正 ②（关键遗漏防线）**：`pack-standalone.mjs:13-62` 的 `sourceFiles` 是**显式文件清单**，新文件 `packages/standalone/self-update.mjs` 若不登记，发布 tgz 将缺失该模块 → 全局实例 `import './self-update.mjs'` 启动即崩。登记该行列为 T2 完成判据。
9. 管理端注入惯例：`OFM_TEST_UPSTREAM`（service.mjs:245/:324）为既有测试 env 先例；management 鉴权门在 `route()` 统一 401（management.mjs:290），路由为方法+路径白名单 else-if 链（:291-431）。
10. **口径校正 ③（委派顺序修订）**：委派稿自重启顺序为「停监听 → 派生 → 旧进程 exit(0)」（子进程重试防竞态）。依事实 2/3，macOS 上旧进程持锁至 close 尾部，「先派生后退出」会让新进程在 `acquireServiceLock` 即 EEXIST 退出（重试若无锁感知也仅是延迟失败）。本方案修订为「**先完整 close（含锁释放）→ 再派生 → 旧进程 exit(0)**」，子进程启动重试降级为二道防线（§V11.4）。反驳依据：`service.mjs:27/:67/:125/:392` 可复核——这是比委派顺序更强的工程证据；行为语义（AC-48 断言集）不变。

## V11.2 检查器：packages/standalone/self-update.mjs（新文件；FR-17.1/17.5-②④）

**导出三件**（纯函数可单测 + 工厂）：

1. `compareVersions(a, b)`（写死，零依赖）：取 `x.y.z` 三段数字逐段比（`Number` 比较，1.2.10 > 1.2.9）；同三段时**有 prerelease 后缀（`1.2.5-rc.1`）< 无后缀（`1.2.5`）**（semver 核心子集，覆盖 S19 rc→正式场景）；任一输入非 `\d+\.\d+\.\d+(-[\w.-]+)?` 形态 → 返回 `null`（保守视为不可比，不提示更新）。不支持 build metadata 等完整 semver——1.2.x 发布序列三段数字，不触雷（限制声明，§V11.9-SR16）。
2. `detectInstallKind({ platform, moduleDir })` → `'global' | 'npx' | 'local' | 'source' | 'unsupported'`：
   - `platform === 'win32'` → `unsupported`（**范围声明：自更新链路仅 macOS/Linux**；Windows 用户在管理台看到的是「发现新版本 + 手动升级命令」形态，AC-49 语义，非功能缺失）；
   - `moduleDir` 含 `/.npm/_npx/`（posix 分隔符）→ `npx`（npx 缓存安装，误升级会改全局副本而运行实例不变——禁）；
   - `moduleDir` 匹配 `(^|/)lib/node_modules/our-free-model-standalone/` → `global`（npm 全局布局唯一特征，事实 7；**依此判定 canSelfUpdate=true**）；
   - 仅匹配 `(^|/)node_modules/our-free-model-standalone/`（项目本地安装）→ `local`（禁）；
   - 其余（源码直跑）→ `source`（禁）；
   - 判据用 `__dirname`（self-update.mjs 安装位置 = 运行代码的真实来源）而非委派稿的 `process.argv[1]`：argv[1] 在 wrapper/自定义脚本启动时指向 wrapper，`__dirname` 恒指向实际加载的包内路径，信息更准；语义仍满足 D36②（判定不可得 → 保守禁用）。
3. `createSelfUpdate(deps)` 工厂，deps（生产默认 + 测试注入双轨）：

| dep | 生产默认 | 测试注入（env，跨进程需要） |
|---|---|---|
| `currentVersion` | service.mjs 传入 `VERSION` | — |
| `moduleDir` | `__dirname`（fileURLToPath） | `OFM_SELF_UPDATE_MODULE_DIR` |
| `npmCommand` | `'npm'`（PATH 解析，spawn 继承 env——`NPM_CONFIG_REGISTRY`/代理配置天然生效，R17 兼容） | `OFM_SELF_UPDATE_NPM`（假 npm 脚本绝对路径） |
| `firstDelayMs` | `30_000`（AC-45） | `OFM_SELF_UPDATE_FIRST_DELAY_MS` |
| `intervalMs` | `3_600_000` | `OFM_SELF_UPDATE_INTERVAL_MS` |
| `viewTimeoutMs` | `15_000` | `OFM_SELF_UPDATE_VIEW_TIMEOUT_MS` |
| `installTimeoutMs` | `600_000`（10 分钟） | `OFM_SELF_UPDATE_INSTALL_TIMEOUT_MS` |
| `closeTimeoutMs` | `5_000`（close 挂起兜底竞速，§V11.4-2） | `OFM_SELF_UPDATE_CLOSE_TIMEOUT_MS`；另有 `OFM_SELF_UPDATE_TEST_STUCK_CLOSE=1`（集成测试钩子：将 performRestart 的 close 调用替换为永不 resolve 的 promise，专测兜底路径，§V11.6） |
| `dataDir` / `logger` / `performRestart` | service.mjs 注入（§V11.4） | — |

   env 注入命名与 `OFM_TEST_UPSTREAM` 先例一致，**测试专用钩子、生产文档不宣传、未设置即全默认**。
- `start()`：对齐 business.mjs:61151-61164 调度形态——`setTimeout(first, firstDelayMs)`，tick 内执行检查后重排 `setTimeout(tick, intervalMs)`，`timer.unref()`，`stop()` 清除句柄（不阻止进程退出，AC-45）。
- 检查动作：`spawn(npmCommand, ['view', 'our-free-model-standalone', 'dist-tags.latest', '--json'])`，`timeout: viewTimeoutMs`，失败（非零退出/超时/垃圾输出/JSON 解析失败）**静默**：记 `lastError`（内存）、保留上次 `latest`，下一周期自动重试（AC-45/FR-17.5-④——无弹窗、服务与网关调用不受影响）。
- 内存态 `state()`（**零持久化**，重启后下一周期重建，FR-17.1）：
  `{ current, latest: string|null, hasUpdate: boolean, canSelfUpdate: boolean, checkedAt: number|null, lastError: string|null, state: 'idle'|'available'|'updating'|'restarting'|'failed', target?: string }`
  （`canSelfUpdate = detectInstallKind(...) === 'global'`；`hasUpdate = compareVersions(latest, current) === 1`。）
- `requestRun()`（management 端点调用）：同步前置校验并置 `state='updating'` 后返回，安装异步执行——`canSelfUpdate=false` → throw 409；`!hasUpdate` → throw 409；`state==='updating'||'restarting'` → throw 409；`state==='failed'` **放行重试**（AC-50）。异步体：`spawn(npmCommand, ['i', '-g', 'our-free-model-standalone@' + latest], { timeout: installTimeoutMs })`，收集 stdout/stderr 尾部 ~4KB 摘要 → 失败：`state='failed'` + `lastError`，**服务不重启、现存全局安装未变**（npm 安装原子性，无半升级；AC-50）；成功：`state='restarting'` → `await deps.performRestart()`。两条路径均追加 `dataDir/update.log`（时间戳/目标版本/结果/输出摘要——R16 可诊断性载体）。

## V11.3 端点：management.mjs（FR-17.2/17.3）

1. `createManagement` 增可选参数 `selfUpdate`（service.mjs 传入实例）；未传时 summary 不含 `update` 字段、`update/run` 404（兼容形态，测试可独立构造）。
2. `summary()`（:224-252）增 `...(selfUpdate ? { update: selfUpdate.state() } : {})`——**轮询即达前端**（app.tsx:98 既有 15s 轮询 `/summary`，零新增查询通道，D35「状态查询形态由架构师定」落点）。
3. `route()` 鉴权门内（:290 之后）新增分支：
   `POST /api/management/update/run` → `await readBody(req)`（空 JSON 对象，与 logout :291-294 形态一致）→ `json(res, 200, selfUpdate.requestRun())`（requestRun 内 throw 的 409/401 经既有 catch :457-461 转 JSON 错误响应）。**立即响应、不挂 HTTP 等待安装**（npm 最长 10 分钟，request() 前端默认 10s 超时，app.tsx:85——同步等待必炸；响应体 `{ ok: true, target }`，安装进度由前端轮询 `summary.update.state` 获得）。
4. 鉴权/负向路径：未登录 → 401（既有 :290 门）；`canSelfUpdate=false` → 409 + 文案含手动升级命令（AC-49 服务侧面）；GET 该路径 → 404（else-if 链既有行为）。

## V11.4 自重启序列（FR-17.4/17.5-③；service.mjs + cli.mjs）

**顺序（依 V11.1 事实 2/3 修订，委派稿「先派生后退出」的反驳见 V11.1-10）**：

```
requestRun() 安装成功（state='restarting'）后：
1. await sleep(300ms)                      # 让 update/run 的 HTTP 响应先 flush（json() 已 res.end，
                                           # 300ms 余量防连接层排队）
2. await Promise.race([service.close(), sleep(closeTimeoutMs)])
                                           # §V11.1-2 完整 close 链原样复用：HTTP 停监听、
                                           # management/eac/scheduler/claims/runtime dispose、
                                           # stores flush、service.lock 释放（:392）
   ├─ close 正常完成 → 继续 3；close reject → update.log 留痕 + process.exit(1)（安装已成功，
   │                    全局命令可用，R16-b 兜底；finally 块保证锁仍释放，:391-393）
   └─ 兜底（close 挂起竞速超时，默认 5s）〔v12 R9O-001 修订〕三步强制序列：
       a) update.log 追加留痕：「close 超时（组件挂起，详情见 update-restart.log），执行强制解锁后退出；
          如服务仍无法启动，请删除 <dataDir>/service.lock 后重试」；
       b) 强制版 releaseLock（self-update.mjs 内 forceReleaseLock(dataDir)：读 service.lock，
          校验 JSON.pid === process.pid 且 product === 'our-free-model-standalone'——锁确属本进程；
          与正式 releaseLock（service.mjs:96-106 token/pid/product 归属校验）语义等价，
          进程即将退出，pid+product 自证足够）→ fs.unlinkSync(lockFile)；
          读取/unlink 失败或归属不符 → update.log 追加「请手动删除 <dataDir>/service.lock 后重启」；
       c) process.exit(0)（exit 终结一切连接，detached 子进程不受影响）。
       不变式：兜底路径「**锁必释放（b 成功）或留痕含删锁指引（b 失败）**」——与 close 链 finally 的
       锁释放不变式对齐，不留 darwin 残锁死锁（残锁 + :27/:67 EEXIST 无回收 = 手动 ofm 亦无法启动）。
3. fs.accessSync(path.join(moduleDir, 'cli.mjs'))   # 新版 cli 就位校验（npm i -g 后同路径已是新版，V11.1-7）
   失败 → update.log 留痕 + process.exit(1)
4. spawn(process.execPath, [cliPath, ...passthroughArgs, '--no-open', '--update-restart'],
        { detached: true, stdio: ['ignore', logFd, logFd], env: process.env })
   # logFd = fs.openSync(path.join(dataDir, 'update-restart.log'), 'a')——新进程崩溃可诊断（R16-c）
   # execPath = 当前 node 二进制（nvm 场景正确同源）
   # spawn 同步异常 → update.log 留痕 + stderr + process.exit(1)
5. child.unref(); fs.closeSync(logFd); process.exit(0)
```

**要点**：安装成功后无论派生成败，旧进程都不再提供服务（HTTP 已停）——此时 npm 安装完好，`ofm` 全局命令可手动重启，`update.log`/`update-restart.log` 双日志保证可诊断（R16 对策核心：**失败前移到安装阶段可重试（AC-50），派生阶段只剩低概率同步错误且留痕**）。R16「新进程启动即崩」无自动回滚为 PRD 声明既定风险，兜底 = update-restart.log + S19 真机演练门。

**2. passthroughArgs（argv 过滤透传，从 process.argv 提取）**：

| 参数 | 处理 | 依据 |
|---|---|---|
| `--port` | 原 argv 有 → 透传**实际端口**（service.port）而非原值（`--port 0` 透 0 会换随机端口，违背 AC-48「端口一致」）；argv 无 → 不透传（settings.standalonePort 已持久化实际端口，service.mjs:345，新进程自动同端口） | V11.1-5 |
| `--data-dir` | 原样透传（显式目录必须延续；argv 无则默认链 OFM_HOME/~/.our-free-model 与旧进程一致） | cli.mjs:11/:37 |
| `--no-refresh` | 原样透传（用户显式的会话级启动偏好，AC-48「关键启动参数一致」） | cli.mjs:13 |
| `--lan/--no-lan/--lan-port` | **不透传**（settings 持久化，service.mjs:237-238 新进程自动恢复，透传反而无害冗余） | V11.1-6 |
| `--probe` | 不透传（停用兼容旗标） | cli.mjs:14 |
| `--no-open` | **强制附加**（更新重启不弹浏览器抢焦点——前端正在轮询等待，AC-48 流程不被打断） | cli.mjs:12 |
| `--update-restart` | **强制附加**（内部旗标，见 3） | 本节 |

**3. cli.mjs 改动（二道防线）**：usage 增一行 `--update-restart  （内部）自更新重启接力：遇锁/端口占用自动重试`；解析 `if (flag === '--update-restart') { options.updateRestart = true; continue }`（:23-38 白名单链内）；`main()` 中 `updateRestart` 时对 `startStandalone` 包重试循环：catch `code ∈ {EEXIST, EADDRINUSE}` → 最多 5 次×500ms 后重试，全败走原错误路径。防「close 完成后第三方抢占端口/锁」边缘竞态（正常序列下 close 先于 spawn，此层近乎空转，属防御深度）。

**4. service.mjs 接线**：import `createSelfUpdate`；listener 就绪后创建实例（`currentVersion: VERSION, dataDir, moduleDir, logger, performRestart`），`start()`；`close()` 链首段与 `clearTimeout(timer)` 并列 `selfUpdate.stop()`（仅取消检查定时器；updating 中用户 Ctrl-C → npm 事务性保证无半升级，下次启动内存态重建，§V11.9-R16-d）。`performRestart` 闭包绑定最终 service 对象（实现形态：`let serviceRef` + return 后回绑，或将 close 序列提取为局部函数——按最小 diff 由工程师定，验收只认上述行为序列）。

## V11.5 前端（FR-17.2/17.3；AC-46/47/48/49/50）

**新组件 `frontend/components/update-notice.tsx`**，挂载于 `app.tsx:113` 的 `<header className="topbar">` 内 `<Topbar>` 之后（右上角；shell.tsx 零改动）：

1. **显示条件**（summary.update 驱动 + 本地会话记忆）：
   - `state ∈ {updating, restarting}` 或用户已发起更新 → spinner 气泡「正在更新到 x.y.z 并重启服务…」（不可关闭）；
   - `state === 'failed'` → 错误气泡（lastError 摘要 + **重试** + 关闭）；
   - `hasUpdate && canSelfUpdate && sessionStorage['ofm-update-dismissed'] !== latest` → 气泡「发现新版本 x.y.z（当前 a.b.c）」+「立即更新」+ 关闭；
   - `hasUpdate && !canSelfUpdate`（源码/npx/local/win32）→ 气泡仅展示新版本号 + 手动升级命令 `npm i -g our-free-model-standalone@x.y.z` + 复制 + 关闭；**「立即更新」不渲染**（AC-49）；
   - 关闭 → `sessionStorage.setItem('ofm-update-dismissed', latest)`——同版本本会话不再弹，状态仍可查（summary.update，AC-46）。
2. **确认交互（AC-47/D36①）**：点击「立即更新」→ 气泡内容切换为二次确认态「将重启服务，进行中调用会中断」+「确认更新/取消」——**内联两步，不新增模态组件**（与 disclaimer-dialog 的模态语言、hash 路由零耦合，规避 R17-UI）。
3. **发起与恢复探测（AC-48）**：确认 → `request('/update/run', {}, 30000)` → 成功即进入「等待重启」模式（App 层 `updatePhase` 状态）：**独立 2s 轮询** `GET /api/management/summary`——fetch 失败/超时 = 服务重启中（预期，不报错）；成功且 `version === target` → `location.reload()`（hash 保留，app.tsx:19-29 页面回位）；成功但版本异常 → 同样 reload 回稳态；总超时 5 分钟 → 错误态提示手动刷新。等待期间既有 15s loadData 轮询的报错被抑制（app.tsx:98 回调加 `updatePhase` 判断，不 setError——避免全屏 error-notice 与更新气泡打架）。
   - LAN 开启场景（standaloneLanEnabled=true）服务重启后旧会话 401：探测轮询遇 401 一律继续轮询至超时，reload 后走登录页（会话重启失效为既有语义，登录屏文案已声明 app.tsx:45；验收口径注明）。
4. `types.ts`：`Summary` 增 `update?: UpdateInfo`（字段同 §V11.2 state() 形状）。`app.css` 增 `.update-notice` 系（对齐 `notice`/`notice-enter` 动效与 `ui-spinner` 复用，app.tsx:43 同款；暖调语言，深浅主题双覆盖——S12-B 色板惯例）。
5. **更新失败（AC-50）**：`update/run` 直接 4xx 或轮询见 `state==='failed'` → 错误气泡 + 重试按钮（重试=重新走确认流）。

## V11.6 测试（AC-45~50 载体；S18 自测口径，mock 为主）

| 套件 | 用例 |
|---|---|
| **scripts/self-update-test.mjs（新）单元段** | ① `compareVersions` 矩阵：1.2.4<1.2.5、1.2.10>1.2.9、相等、`1.2.5-rc.1`>1.2.4、`1.2.5`>`1.2.5-rc.1`、非法输入（'abc'/''/null）→ null；② `detectInstallKind` 矩阵：`~/.nvm/…/lib/node_modules/our-free-model-standalone/…`→global、`/usr/local/lib/node_modules/…`→global、`~/.npm/_npx/x/node_modules/…`→npx、`<proj>/node_modules/…`（无 lib 段）→local、源码路径→source、win32→unsupported；③ 检查器（env 提速 + 假 npm view 输出 `"1.9.9"`）：idle→checked、hasUpdate 流转；view 非零退出/超时（假 npm sleep）/垃圾输出 → lastError 记录、latest 保留旧值、无异常抛出（AC-45 静默）；④ `requestRun` 拒绝路径：source 形态 409、无更新 409、updating 重复 409；⑤ 假 npm `i` 非零退出 → state=failed + lastError + `update.log` 留痕、**不触发 performRestart**（AC-50） |
| **self-update-test.mjs 集成段（自重启端到端，关键自动化）** | 构造伪全局目录 `<tmp>/lib/node_modules/our-free-model-standalone/packages/standalone/`：cli.mjs 替身（起 http 监听 argv `--port`、argv 原样落盘 `respawn-argv.json`、`GET /` 回 `{version:'99.0.0'}`）+ 假 npm（view→`"1.9.9"`；i→no-op 退出 0）；spawn 真实 `node packages/standalone/cli.mjs --port 0 --data-dir <tmp> --no-open`（env 注入 OFM_SELF_UPDATE_*）→ 解析 stdout 管理链接拿端口/登录（key 读 dataDir/settings.json）→ 断言 summary.update 形状（canSelfUpdate=true、hasUpdate=true）→ POST update/run 200 → 断言：**旧进程 exit code 0**、`update.log` 含目标版本、`respawn-argv.json` 含 `--port <实际端口>`/`--data-dir <tmp>`/`--update-restart`/`--no-open`、**原端口被替身接管**（请求回 99.0.0）；失败注入变体：假 npm i 退出 1 → 旧进程**不退出**、summary.update.state=failed、网关 `/v1` 仍应答（AC-50 端到端）；**close 挂起兜底注入用例（v12 R9O-001）**：env `OFM_SELF_UPDATE_TEST_STUCK_CLOSE=1` + `OFM_SELF_UPDATE_CLOSE_TIMEOUT_MS=500` 起旧进程 → update/run → 断言 ①旧进程仍 exit(0)（竞速兜底生效）②`dataDir/service.lock` 已被强制解锁删除（或 update.log 含手动删锁指引——两分支必居其一）③update.log 含兜底路径留痕 ④**同 dataDir 再 spawn 真实 cli.mjs 启动成功无 EEXIST**（服务可再次启动 = 残锁死锁已消除的可恢复性证明）→ 清理 |
| **standalone-management-test.mjs 扩** | summary.update 字段存在与形状（源码直跑形态 canSelfUpdate=false 如实）；update/run：未登录 401、canSelfUpdate=false → 409 含手动命令、GET → 404、非 JSON body → 415（readBody 既有惯例）；**本文件零真 npm 调用**（成功路径归集成段） |
| **前端测试（standalone-frontend-test/react-ui-test 扩）** | fixture summary 带 update：available → 气泡出现含版本号；关闭 → sessionStorage 记忆、同版本不再渲染；canSelfUpdate=false → 无「立即更新」、含手动命令文本（AC-46/49 DOM 断言） |
| **回归** | 既有 standalone-* 全套件复跑（service.mjs 改动影响面）；pack-standalone-gate-test / standalone-package-test（sourceFiles 登记 self-update.mjs 后 tgz 完整性 + 包内启动冒烟）；判零脚本复跑（前端新增样式不引入冷色残留） |

## V11.7 S19 本地验收清单（AC-45~50 真源演练；文档 S18 执行时落 docs/software-company/s19-local-acceptance.md）

**主路径（真 registry，零 mock、零发布动作）**——利用 `latest(1.2.4) > 本地降版实例` 场景：
1. 临时改 `packages/standalone/package.json` version → `1.2.3`（**不提交**），`node scripts/pack-standalone-npm.mjs` → `npm i -g <dist/*.tgz>`（全局装上含自更新代码的 1.2.3 实例，全局布局真实）。
2. `ofm` 启动 → ~30s 后管理台右上角气泡「发现 1.2.4」；关闭 → 本会话不再弹、重开管理台仍可查（AC-46）。
3. 「立即更新」→ 确认（明示中断文案核对）→ 气泡 spinner → 服务重启 → 自动刷新 → 侧栏版本显示 **1.2.4**（真 registry 真包 `npm i -g our-free-model-standalone@1.2.4`，AC-47/48）。
4. 数据完好：更新前后比对 settings.json（API Key 不变）/stats/claims-history 文件（AC-48）。
5. 负向：断网（或临时 hosts 屏蔽 registry.npmjs.org）重启服务 → 无气泡无弹窗、网关调用正常、1h 后恢复网络自动出现提示（AC-45）；`chmod -w` 全局 node_modules → 更新失败错误气泡、服务不重启、`chmod +w` 后重试成功（AC-50）。
6. 非全局路径：源码直跑 `node packages/standalone/cli.mjs` → 气泡仅版本号+手动命令（AC-49）。
7. 回滚：`npm i -g our-free-model-standalone@1.2.4 --registry=https://registry.npmjs.org` 恢复全局 1.2.4；git checkout 还原临时版本改动。
（可选补充：`npx verdaccio` + `NPM_CONFIG_REGISTRY` 本地源演练 1.2.5-rc 形态——非必需，主路径已覆盖全链路。）

## V11.8 S20 发布 1.2.5 复述（D37；**待用户批准，本轮零 publish 动作**）

1. 前置：S19 用户验收通过并明示批准（PRD :390）。
2. bump `packages/standalone/package.json` → `1.2.5`；NPM-README 增「自更新」说明段（S18 内完成文案，含 Windows 不支持声明）。
3. `node scripts/release-standalone-npm.mjs` preflight → build → pack → smoke（工程师）→ **publish**（总监本人终端，凭据零落盘，release-standalone-npm.mjs:194-205）→ `npm view` 断言 `dist-tags.latest === 1.2.5` → record 落 `docs/software-company/release-record-1.2.5.md`。
4. 发布后 dogfood（首个生产自更新样本）：任一全局 1.2.4 实例 ≤1h 收到提示 → 一键升级 1.2.5 → 结果记入 release-record。
5. 回滚预案：§6I.4 机制复用（deprecate 1.2.5 / dist-tag 回拨 1.2.4）；**自更新特例**：已升 1.2.5 的实例在 latest 回拨后 hasUpdate=false，不会自动降级——需用户手动 `npm i -g our-free-model-standalone@1.2.4`（发布说明中注明）。

## V11.9 风险与回滚

| # | 风险 | 对策 |
|---|---|---|
| R16-a 停监听后派生竞态（锁/端口） | 自重启顺序修订为「完整 close（锁释放）→ 派生 → exit」（V11.1-10，service.mjs:27/:67/:392 证据）；cli `--update-restart` 5×500ms 二道防线（§V11.4-3）；集成测试覆盖真进程退出/端口接管（§V11.6） |
| R16-b 派生同步失败 / close 挂起（execPath/cli 路径异常、close 链组件挂起） | 同步失败：close 前 `fs.accessSync(cliPath)` 校验，失败留痕 `update.log` + exit(1)，安装此时已完好、`ofm` 命令可手动重启（无半升级）。**close 挂起（v12 R9O-001）**：5s 竞速 → 强制解锁（`forceReleaseLock`：pid+product 归属校验后 unlink service.lock）→ update.log 留痕（含删锁指引兜底分支）→ exit(0)；不变式「锁必释放或留痕含指引」，杜绝 darwin 残锁死锁（service.mjs:96-106 releaseLock 仅挂 close finally——挂起即不执行）；集成兜底注入用例覆盖（§V11.6） |
| R16-c 新进程启动即崩 | detached 派生 stdio 重定向 `dataDir/update-restart.log`（可诊断）；无自动回滚为 PRD R16 既定声明；S19 真机演练为发布门 |
| R16-d updating 中用户 Ctrl-C | close 链 `selfUpdate.stop()` 仅停检查定时器；npm 安装事务性（无半升级）；内存态下次启动重建；边缘：安装完成但未及重启 → 全局已是新版，下次手动/正常启动即新版（无害终态） |
| R17 registry/网络/权限 | 检查失败静默+1h 重试（AC-45）；安装失败错误态可重试不破坏现存安装（AC-50）；npm 命令继承 env（NPM_CONFIG_REGISTRY/代理天然兼容企业环境）；nvm 前缀权限用户侧既有；**Windows 声明范围外**（detectInstallKind unsupported，仅提示手动命令，AC-49 形态） |
| SR-16（自识别）简化 semver 限制 | 仅三段数字 + prerelease<release 子集；build metadata 等不支持；1.2.x 发布序列三段数字不触雷；非法输入保守 null 不提示（漏报安全、误报为零） |
| SR-17（自识别）重启窗口前端 401/断连 | 独立 2s 探测轮询容忍失败/401 至 5 分钟总超时；LAN 场景 reload 后登录页为既有会话语义（app.tsx:45 文案）；等待期抑制全局 error-notice 打架（§V11.5-3） |
| SR-18（自识别）pack 清单遗漏致发布包启动崩 | sourceFiles 登记 self-update.mjs 列为 T2 完成判据 + package-test 冒烟（V11.1-8） |

**回滚（S18 代码）**：改动为独立 commit 组（后端 self-update.mjs/service/management/cli + 前端 + pack 清单 + 测试），可整体 revert；零数据迁移（update 状态纯内存；`update.log`/`update-restart.log` 为追加型诊断日志，残留无害）；未发布前 registry 无任何变化。

## V11.10 未决假设与证据缺口申报

**未决假设 0 / 证据缺口 0**。两项口径校正（V11.1-8/10：pack sourceFiles 显式清单、自重启顺序依锁证据修订）均已用可复核行号证据关闭，非缺口；v11 的「校正①」（30s 非 auto-checkin 生产默认）系错误代码阅读，v12 已撤回并降格为勘误（V11.1-4；business.mjs:60915 实测 `AUTO_CHECKIN_DELAY_MS = 3e4`）。R9O-001 兜底强制解锁已并入 §V11.4-2/§V11.2（closeTimeoutMs）/§V11.6（兜底注入用例）/§V11.9（R16-b）。阶段门确认事项 2 项（既定流程，非未决）：S19 用户验收批准、S20 发布批准（D37）。

## V11.11 影响文件与实现顺序（T1→T5 依赖序，S18 执行清单）

| # | 文件 | 动作 | 前置 | 完成判据 |
|---|---|---|---|---|
| T1 | `packages/standalone/self-update.mjs` | 新建（compareVersions/detectInstallKind/createSelfUpdate） | — | self-update-test 单元段全绿 |
| T1 | `scripts/self-update-test.mjs` | 新建（单元段） | 同上 | 同上 |
| T2 | `packages/standalone/service.mjs` | 修改（创建/start/performRestart 注入/close 链 stop） | T1 | standalone-test 冒烟不回归 |
| T2 | `packages/standalone/cli.mjs` | 修改（--update-restart 解析+重试+usage） | T1 | 重试路径单测/手测 |
| T2 | `scripts/pack-standalone.mjs` | 修改（sourceFiles 登记 self-update.mjs） | T1 | package-test/gate 全绿 |
| T3 | `packages/standalone/management.mjs` | 修改（selfUpdate 参数/summary.update/update/run） | T2 | management-test 扩展全绿 |
| T3 | `scripts/standalone-management-test.mjs` | 修改（§V11.6 断言） | T3 | 同上 |
| T4 | `frontend/types.ts` / `app.tsx` / `app.css` / `components/update-notice.tsx`（新） | 前端四件 | T3（契约先定） | typecheck + 前端测试 + web 重建 |
| T5 | `scripts/self-update-test.mjs` | 扩集成段（替身+假 npm+真进程自重启） | T2-T4 | 集成断言全绿（旧进程退出/端口接管/失败变体） |
| 收尾 | `packages/standalone/NPM-README.md` | 增自更新说明（含 Windows 声明） | T5 | pack 冒烟含文案 |

明确不修改：`channels/*`（business.mjs 等签名清单零触碰）、`src/*`、`login-terminal.mjs`、`shell.tsx`、web 构建产物（由 build 生成）。

v12 申报计数：blocker 0 / major 0 / minor 0 / 未决假设 0 / 证据缺口 0（第 9 轮 1 major / 1 minor 已逐项处置并登记 §V11.12）；阶段门确认事项 2 项（S19 验收批准、S20 发布批准，D37 既定流程）。

## V11.12 第 9 轮处置表（v11 → v12；R9O-001/R9O-002）

| ID | 级别 | 裁决摘要 | 处置 | 修改位置 | 证据 | 关闭标准 |
|---|---|---|---|---|---|---|
| R9O-001 | major | §V11.4 步骤 2 兜底「close 5s 超时 → 强制 process.exit(0)」在 darwin 留 service.lock 残锁（releaseLock 仅挂 close() closing promise 的 finally——close 挂起则永不执行；exit 不删磁盘锁文件；:27/:67 EEXIST 无回收路径直接 throw）→ 更新后既不自启、手动 ofm 亦 EEXIST；且该路径无 update.log 留痕 | **接受**（采纳 reviewer better_alternative）：兜底改为「close 与 5s 计时竞速 → 超时执行**强制版 releaseLock**（forceReleaseLock(dataDir)：pid+product 归属校验后 unlink，与 close 链 finally 的锁释放不变式对齐）→ update.log 留痕（含兜底说明 + 失败分支「请删除 <dataDir>/service.lock」指引）→ exit(0)」；R16-b 声称同步修正；测试设计补兜底注入用例 | §V11.4-2（兜底三步强制序列与不变式）、§V11.2 deps 表（closeTimeoutMs=5s / OFM_SELF_UPDATE_CLOSE_TIMEOUT_MS / OFM_SELF_UPDATE_TEST_STUCK_CLOSE 钩子）、§V11.6 集成段（close 挂起兜底注入用例）、§V11.9 R16-b 行、附 V11（锁释放与兜底依据行） | 本轮复测：service.mjs:96-106（releaseLock 闭包归属校验；仅由 close() 调用）、:387-394（releaseLock 挂 closing 的 finally——挂起即不执行）、:27/:67（darwin 无 Unix-socket guard、EEXIST 无回收） | 兜底路径满足「锁必释放或留痕含删锁指引」不变式（§V11.4-2b 已写入）+ 兜底注入用例在列（§V11.6：STUCK_CLOSE 注入 → exit(0) → 锁删除/指引留痕 → 同 dataDir 可再启动无 EEXIST） |
| R9O-002 | minor | v11「口径校正①」事实错误：business.mjs:60915 `AUTO_CHECKIN_DELAY_MS=3e4`（30s 首跑即 auto-checkin 生产默认）、:60916 INTERVAL=36e5；「30s 并非 auto-checkin 生产值」系 DELAY/INTERVAL 混读，PRD「启动约 30s 首检」本与代码一致 | **接受**（本轮复测与裁决一致，无反驳）：撤回「校正①」，降格为勘误说明并入调度形态锚点；措辞改为「auto-checkin 生产默认首跑即 30s（DELAY=3e4，间隔 36e5），本方案 30s 首检同时契合 AC-45 与 auto-checkin 先例」；§V11.10 申报文字与附 V11 索引同步 | §V11.1 标题（撤回①保留②③）、§V11.1-4（勘误段，含 v11 误读成因：sed 窗口起于 :60916 漏看 DELAY 常量、误读 fallback 返回值）、§V11.10、附 V11（调度形态行改写） | 本轮复测 business.mjs:60915-60921（`var AUTO_CHECKIN_DELAY_MS = 3e4` / `var AUTO_CHECKIN_INTERVAL_MS = 36e5` / `autoCheckinDelayMs` 两处 fallback 均返回 `AUTO_CHECKIN_DELAY_MS`） | 文档与 business.mjs:60915-60919 实测一致（§V11.1-4 与附 V11 均已按 DELAY=3e4 实测改写，「非生产默认」表述已清除） |

## 附 V11：证据索引（d7a6409 实测，2026-11-19）

| 事实 | 锚点 |
|---|---|
| registry | `npm view our-free-model-standalone dist-tags.latest --json` → `"1.2.4"`；本地包 version=1.2.4（packages/standalone/package.json） |
| 版本读取 | service.mjs:17（VERSION 读 ./package.json；PRD 写 :19，实测 :17） |
| close 链与锁释放时序 | service.mjs:378-396（close 全序列；:392 finally releaseLock）；acquireServiceLock :48-107（:86 写锁；:96-106 释放）；:27 darwin 无 Unix-socket guard；:64-83 EEXIST 回收仅 win32/linux（:67 throw 条件） |
| 锁释放与兜底依据（v12 R9O-001） | service.mjs:96-106（releaseLock 闭包：token/pid/product 归属校验后 removeOwnedLock + closeSync）；releaseLock 仅在 close() 的 closing promise finally（:387-394）被 await——close 链挂起（Promise.all 某项永不 resolve）则锁永不释放且 exit 不删磁盘文件 → darwin 残锁无回收（:27/:67）→ 兜底 forceReleaseLock（pid+product 校验 + unlink）与删锁指引留痕（§V11.4-2） |
| 端口持久化与优先级 | service.mjs:344-346（setPort + settings.update({standalonePort})）；:229（port ?? savedPort）；cli.mjs:30/:34-37（--port 解析） |
| 调度形态 | business.mjs:61142-61176（start/tick/defaultSchedule=setTimeout+unref+cancel）；:60915-60921（**AUTO_CHECKIN_DELAY_MS=3e4 首跑 30s 生产默认**、AUTO_CHECKIN_INTERVAL_MS=36e5 周期 60min、autoCheckinDelayMs fallback 返回 DELAY——v12 勘误：v11 误读为 INTERVAL_MS，30s 首检与 auto-checkin 先例一致） |
| 启动参数全集 | cli.mjs:6-19（usage）、:21-38（解析白名单）；--lan 系持久化 service.mjs:237-238 |
| 发布包布局与 bin | pack-standalone-npm.mjs:44-58（bin 双命令名 → packages/standalone/cli.mjs；files=shipped；仓库相对布局）；pack-standalone.mjs:13-62（sourceFiles **显式清单**——新文件必须登记） |
| 管理端鉴权/路由/summary | management.mjs:290（401 门）、:291-431（else-if 路由链）、:224-252（summary）、:40-55（readBody 415/413 惯例）、:457-461（错误转 JSON） |
| 前端轮询/顶栏/提示形态 | app.tsx:85（request 默认 10s 超时）、:86（loadData /summary+/stats）、:98（15s 轮询）、:113（header.topbar+Topbar 挂点）；shell.tsx:121-124（Topbar 右上 console-topbar-status）；app.tsx:45（会话重启失效文案）；smart.tsx:105-114（toast 2.8s 先例——更新气泡不自动消失，语义不同） |
| 测试 env 注入先例 | service.mjs:245/:324（OFM_TEST_UPSTREAM）；management-test.mjs:60-101（check/request/login 形态、startStandalone({port:0, refresh:false}) + keyFile 读 key） |
| 发布流程 | release-standalone-npm.mjs:118-119（preflight/build/pack/smoke/publish/record 子命令）、:194-205（publish+view 断言）、:25（版本取自 packages/standalone/package.json） |
