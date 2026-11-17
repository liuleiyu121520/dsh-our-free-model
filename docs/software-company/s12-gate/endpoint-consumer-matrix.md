# S12-A 端点×消费者矩阵（A5-M；R6O-002 方法）

基线：`feat/standalone-lite` @ ff17b26 → S12-A 工作树（本 commit）。
口径：枚举 management.mjs 全部路由分支（改前 34 个分支 + 资源/鉴权框架），逐端点 grep
保留前端源（6 页 tsx/mjs + components）与保留测试的调用点，给出删/留与证据。
符号锚点：`git grep -n <符号> ff17b26 -- <file>` 可复现。

## 一、删除端点（消费面已随页面删除）

| 端点组（ff17b26 锚点） | 前端消费者（改前） | 测试消费者（改前） | 处置 | 证据 |
|---|---|---|---|---|
| GET `/desktop-update`、POST `/desktop-update/check`、POST `/desktop-update/download`（management.mjs :340-345） | desktop-update.tsx（A1 删） | desktop-update-test.mjs（删）、workbench-native-desktop-test.mjs（删） | 删（含创建链 :140 createDesktopUpdater） | `git grep -n "desktop-update" ff17b26 -- packages/standalone/frontend` |
| GET `/workbench`、POST `/workbench/clients/{save,launch,stop}`（:407-415） | agents.tsx（A1 删） | workbench-test.mjs（删）、workbench-management-test.mjs（删）、workbench-native-desktop-test.mjs（删） | 删（创建链 management.mjs :236-241 createWorkbench） | `git grep -n "createWorkbench" ff17b26` |
| GET `/library`、POST `/library/{profiles/save,profiles/apply,profiles/remove,resources/save,resources/remove}`（:416-432） | library.tsx（A1 删） | workbench-library-test.mjs（删）、workbench-management-test.mjs（删） | 删（创建链 :245 createWorkbenchLibrary） | 同上 |
| GET `/routing`、POST `/routing/{save,remove,preview}`（:418-423） | routing.tsx（A1 删） | quota-routing-test.mjs（改写：剥离 routing 管理段，保留 src/combos 覆盖）、workbench-management-test.mjs（删） | 删（创建链 :244 createRoutingManagement） | `git grep -n "createRoutingManagement" ff17b26` |
| GET `/providers`、POST `/providers/{save,remove,test,discover}`（:433-443） | providers.tsx（A1 删） | workbench-test.mjs（删） | 删（创建链 :243 createProviderManagement） | 同上 |
| GET `/subscriptions`、GET `/subscriptions/discover`、POST `/subscriptions/{import,import-local,enabled,remove,quota}`（:444-468） | agents.tsx（A1 删） | workbench-management-test.mjs（删）、workbench-native-agents-test.mjs（删） | 删（service.mjs :266 createSubscriptions 创建删；src/subscriptions.js D16 孤儿保留） | `git grep -n "createSubscriptions" ff17b26 -- packages/standalone/service.mjs` |
| GET `/engine/status`、POST `/engine/start`、POST `/engine/refresh`、`/engine/ui/*`（:372-406） | workspace.tsx（A1 删） | workbench-native-test.mjs（删） | 删（service.mjs :268-269 createMagpieEngine/createMagpieModels 创建删；src/magpie-*.js D16 孤儿保留；enginePluginAsset 豁免路由随之删） | `git grep -n "createMagpieEngine" ff17b26 -- packages/standalone/service.mjs` |
| `/eac/status`、`/eac/login/start`、`/eac/login/poll`、`/eac/login/cancel`、`/eac/logout`、`/eac/pool`（:549-565） | EacPage（channels.mjs :148-172，A1 item7 随 `kind==='eac'` 分支删） | standalone-channels-test.mjs（改写：同 dataDir 直连 createStandaloneEac 实例驱动登录/池/登出）、standalone-react-ui-test.mjs（改写：/eac mock 与 eacAuth fixture 删） | 删（**eac.mjs 保留**：service.mjs :243 createStandaloneEac + :251 sealedCredential 推理链；summary.eacAuth 字段随之删——唯一消费者 EacPage） | `git grep -n "sealedCredential" ff17b26 -- packages/standalone/service.mjs` |
| POST `/models/refresh`（:599） | models.tsx（A1 删）+ app.tsx host.refreshModels（A2 删） | standalone-management-test.mjs（改写：service.runtime.refreshCatalog 直连）、standalone-package-test.mjs（改写：:261 改启动自刷新 + 轮询清单就绪）、standalone-model-row-test.mjs（改写） | 删 | `git grep -n "models/refresh" ff17b26` |
| POST `/models/test`（:604） | models.tsx（A1 删）+ app.tsx host.testModel（A2 删）；保留 6 页前端零消费（grep connection/settings/calendar/requests/channels.mjs 零命中） | standalone-management-test.mjs（改写：service.runtime.testModel 直连）、standalone-model-row-test.mjs（改写）、standalone-model-operation-test.mjs（改写迁移至 smart 启停） | 删 | `git grep -n "models/test" ff17b26` |

配套机械删除（R6O-003 归位后的创建链，全部实测于 management.mjs import :9-13 / 创建 :140/:236-244）：
workbench.mjs、providers.mjs、library.mjs、routing.mjs、desktop-update.mjs 五模块文件删除；
pack sourceFiles 移除五行 + `src/magpie-engine.js`/`src/magpie-models.js` 两行（文件按 D16 保留）；
`privilegedManagementRoute`（:315-323，所列前缀全部随删）、`sessionAuthenticated`/`privilegedSessions`
机制（特权路由集为空）、`enginePluginAsset` 一并删除；`capabilities.modelWorkspace` 移除。

## 二、保留端点（消费面仍在）

| 端点 | 前端消费者（保留面） | 测试消费者 | 证据 |
|---|---|---|---|
| POST `/login/terminal` | app.tsx LoginScreen（openTerminal） | standalone-management-test（verifyLoginTerminal）、standalone-login-terminal-test | `git grep -n "login/terminal" -- packages/standalone/frontend` |
| POST `/session` / POST `/logout` | app.tsx（登录/enterLogin） | management-test、react-ui、package-test | 同上 |
| GET `/summary` / GET `/stats` | app.tsx loadData（15s 轮询） | management-test、channels-test、lan-test、package-test、react-ui | 同上 |
| GET `/claims/history` | app.tsx host.claimsHistory → calendar.tsx | management-test claims 块（AC-17/18） | `git grep -n "claimsHistory" -- packages/standalone/frontend` |
| GET `/smart/state`、POST `/smart/pool` | app.tsx host.smartState/saveSmartPool → smart.tsx | management-test（池校验/持久化）、channels-test（auto 接力系） | `git grep -n "smart/state" -- packages/standalone/frontend` |
| POST `/channels/rpc` | channels.mjs ctx.rpc（四子页）+ app.tsx host.setModelDisabled（**A4 新增：model.setDisabled {provider, modelId, disabled}**）；gateway.getEnabled/setEnabled 由共享渠道客户端（ofm-sharedclient 打包面）消费 | channels-test（模型开关/批量开关/claimAll）、management-test（A4 扩展：载荷通道 + 候选形状） | business.mjs:63282 `case "model.setDisabled"` |
| GET `/requests`、POST `/requests/clear` | requests.tsx | — | `git grep -n "requests/clear" -- packages/standalone/frontend` |
| GET `/dsh/import`、POST `/dsh/import` | components/dsh-import-dialog.tsx | channels-test | `git grep -n "dsh/import" -- packages/standalone/frontend` |
| GET `/disclaimer`、POST `/disclaimer/ack` | components/disclaimer-dialog.tsx | — | 同上 |
| POST `/settings` | app.tsx host.saveSettings → settings.tsx | management-test（校验/落盘/周期重排） | 同上 |
| GET `/key`、POST `/key/rotate` | app.tsx host.getApiKey/rotateKey → connection.tsx | management-test、react-ui、lan-test | 同上 |
| GET `/lan/key`、POST `/lan/key/rotate` | 前端零消费（LAN 密钥仅设置文件/日志提示） | standalone-lan-test（:128/:136/:163/:172） | 方案留清单未列亦未列删；按「保留测试消费面」口径留 |

## 三、测试处置台账（A6；检索口径=被删后端模块 import + 端点调用）

| 测试 | 处置 | 判据 |
|---|---|---|
| workbench-test / workbench-library-test / workbench-management-test / workbench-native-desktop-test / desktop-update-test | 删（方案 A6 明列） | 直依被删模块 / 被删端点 |
| **workbench-native-test / workbench-native-agents-test** | **删（E-4① 扩展，方案未列）** | :10 `import { prepareClientLaunch } from '../packages/standalone/workbench.mjs'`——被删模块直依，原生集成闭包断裂不可改写；不入 test-all、无其他引用者 |
| standalone-nav-test | 改写 | 6 页三分组、双模符号清零、LAZY_PAGE_NAMES 单源、未知页不可达 |
| standalone-page-lifecycle-test | 改写 | LazyPage=smart/calendar/settings（visited 缓存+切换激活）、lite 段删除 |
| standalone-frontend-test | 改写 | 懒加载分包=smart/calendar/settings、usage-data 断言随文件删、被删页分包判零 |
| standalone-react-ui-test | 改写 | 六页导航流、/eac mock 与 eacAuth fixture 删 |
| standalone-model-operation-test | 改写并迁移 | 启停断言改挂 smart 语义（RPC payload/busy 护栏/失败提示/重读联动） |
| standalone-model-row-test | 改写并迁移 | smart 页行内启停浏览器语义（真实服务 + loomy 替身：落盘/候选联动/键盘可达）；playwright 缺席时跳过 |
| standalone-channel-filter-test | 保留不动 | 渠道页保留面（展平/无筛选）断言不受裁剪影响 |
| standalone-client-regression-test | 改写 | 快照对比集收缩至 ChannelCard/DICT；models.tsx 编译段删 |
| standalone-package-test | 改写 | :261 → 启动自刷新 + 清单轮询；落地页 overview-ready → 渠道页 tab；--no-refresh 移除 |
| standalone-management-test | 改写 | /models/test|refresh 十二处 → service.runtime 直连；新增 A4 扩展检查（启停 RPC 通道 + smart 状态形状） |
| standalone-channels-test | 改写 | /eac/* 五处 → 直连 createStandaloneEac；:344 → 摘要无 eac 行；:381 → summary；新增 smart 候选联动断言（停用/启用往返） |
| **quota-routing-test** | **改写（A5-M 补全，方案 A6 未列）** | :3 import createRoutingManagement（被删模块）→ 剥离三段 routing 管理检查，保留 src/combos 与共享内核配额路由覆盖 |
| standalone-lan-test | 改写 | CLI 旗标矩阵删 --lite/--full 期望 |
| **workbench-ui-test** | **删（E-4① 扩展，方案未列）** | 手工 playwright 脚本（需 .verify/ui-phase1-url.txt），调用 GET/POST `/api/management/providers`、`/api/management/subscriptions*`（已删端点）；无引用者、不入 test-all |
| **managed-upgrade-ui-test** | 微改 | 手工脚本；stale mock 清理：summary.eacAuth fixture 与 `/eac/status` mock 行删除（app 不再请求）；`/update/*` 为插件面 mock，不受影响 |
| test-all.mjs | 修剪 | 删 workbench(:73)/workbench-library(:74)/workbench-management(:75)/desktop-update(:90) 四套件 |
| standalone-desktop-regression-test | 保留不动 | 端点依赖复核：仅 open-external 与 eac.mjs 直连（均保留面），零命中被删端点 |

## 四、偏差登记（方案与实况）

1. **standalone-management-test / standalone-channels-test 消费被删端点**：方案 A5-M 预填的消费者分析（"消费者=被删 models.tsx + standalone-package-test:261"、"唯一消费者=EacPage"）遗漏这两个保留套件的调用点（management-test 12 处 /models/*、channels-test 5 处 /eac/*）。按 A5-M 方法（"其余由矩阵补全"）就地改写为等价保留面断言，未改方案。
2. **A4 断言载体分布**：方案指定 "standalone-management-test 扩展（启停 RPC 往返 + smart 状态联动）"；management-test 无渠道替身（候选恒空），故 management-test 承载载荷通道+状态形状扩展，真实往返+联动断言落在有渠道替身的 channels-test（启停块内新增 smart/state 断言）。
3. **E-4① 扩展删除**：workbench-native-test、workbench-native-agents-test 两文件方案未列，实测直依被删模块，按 S8 E-4①（闭包断裂不可改写→删）处置。
4. **quota-routing-test**：方案 A6 未列，实测 import 被删 routing.mjs，剥离管理段保留 combos 覆盖（同「改写」类处置）。
