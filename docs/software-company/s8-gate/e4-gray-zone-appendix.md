# E-8 工件：E-4 灰区机械归类附录 + lib 反向依赖表（D23 双向条款执行记录）

生成方式：静态 import/readFileSync 引用闭包扫描（E-0.1①②），断言 A/B 脚本实测（违例=0）。
执行时点：S8 第二组提交（7cd21da）后实测；与 E-0.3 worktree 预跑结果一致。

## lib/ 反向依赖表（引用者 × 保留/删除）

| lib 文件 | 保留侧引用者（实测） | 删除侧引用者 | 处置（D23） |
| --- | --- | --- | --- |
| channel-pack-gate.mjs | channel-pack-gate-test、build-channel-pack | — | 保留 |
| channel-pack-kernel.mjs | opencode-parity/channel-image-pricing/channel-network/probe-buddy-request-shape/channel-pack/image-pricing-host 各 test | — | 保留 |
| engine-binary.mjs | workbench-management/magpie-policy/engine-transport 各 test | magpie-plugin-test（删） | 保留 |
| fake-kernel.mjs | model-test-probe-race/effort/freetier-gate/sniff/combo-advance/forward/egress-availability/model-test-finish-integration/channel-pack/retry-safety 各 test | 15 个已删装配/UI 测试 | 保留 |
| published-bytes.mjs | —（保留侧零引用） | build-manifest/legacy-upgrade/release-preparation/release-e2e/prepare-release/catalog-test（全删） | **删除**（双向条款） |
| standalone-channel-fixture.mjs | standalone-channels-test、standalone-ui-preview | — | 保留 |
| standalone-isolation-loader.mjs | standalone-test | — | 保留（forbidden 清单去 index.js/adapter 两条） |
| standalone-refresh-fixture.mjs | standalone-management-test | — | 保留 |
| standalone-shared-ui.mjs | standalone-model-row-test、build-standalone-ui | — | 保留（E-10 改读快照） |
| undici-stub.mjs | opencode-parity-test | — | 保留 |

## fixtures/ 归类

| 文件 | 引用者（实测） | 处置 |
| --- | --- | --- |
| README.md | 文档 | 保留（剔除已删 updater 快照条目） |
| buddy-system-prompt.txt | tencent-fingerprint-test | 保留 |
| updater-1.3.1.mjs / updater-2.5.9.mjs | legacy-upgrade-test（已删，动态 import） | **删除**（D23 双向条款） |

## probes/ 归类（E-0.1②：物理 import 断裂优先于被测对象归类）

- **删除（8）**：availability-matrix / budget-and-vision / budget-dialects / effort-repeat-sampling /
  free-lane-survey / mint-ids / reasoning-effort-probe / tool-calling —— import `./open-sse/*`
  （仓库内不存在该目录，物理断裂不可改写）。
- **保留（9）**：batch-delivery / dangling-tool-call / decode-window / long-answer / long-think-truncation /
  pairing-repair / shell-slot-promotion / stream-terminal-frames / tool-name-charset —— 被测对象为
  src/ 共享内核（adapter/catalog/effort/http/messages/upstream，D16 保留域），import 闭包完好。

## 灰区补充说明（预跑发现的清单级修正，证据见 zero-grep-evidence.md）

1. build-standalone-ui.mjs:2 对 build-sponsor.mjs 的副作用 import（E-7 清单遗漏）——该副作用在
   插件端移除赞助组件后为纯 no-op（打印「跳过广告内联」），按 E-0.1③ 移除该行。
2. update-magpie-engine.mjs 套件清单引用已删 magpie-plugin-test —— 剔除该条。
3. channel-pack-test.mjs:22 sourceMode 动态 import `@deepseek-ai/dsh-llm/invariant` ——
   **E-6「删 dsh-llm-legacy」的原事实基础（gateway-source-test 唯一引用者）不完整**：
   按保留测试 D18「存疑一律保留」原则，devDependencies 保留 dsh-llm-legacy + overrides；
   方案 §6E-E6 需总监修订确认（本批未改方案）。
4. rtk-test 样本（REPO/FIND/SEARCH/TREE/GIT_STATUS）与 updater-test :865 哨兵按 E-7「样本改写」
   处理；find/searchList 过滤器校验磁盘存在性，样本路径全部指向 S8 后仍存在的文件（rtk 套件实测通过）。
5. test-all 注释提及已删 host-selftest/recovery-test —— 注释改写（非引用）。

## 断言 A / 断言 B 结果

- 断言 A（保留 scripts import 闭包 ⊆ 保留文件集 ∪ node_modules ∪ node 内置 ∪ 白名单）：**违例 0**。
- 断言 B（test.yml 四 job run 命令引用对象存在）：**违例 0**——offline→test-all.mjs、
  release-readiness→npm run test:release（releaseSuites 修剪后=legacy-payload+engine-payload）、
  typecheck→tsconfig(virtual.d.ts)、standalone-frontend→typecheck:standalone + build-standalone-ui
  --check + build-legacy-payload --check，全部存在且实测可执行。
- 机械断言执行时点：S8 第一组（f1bbfde）与第二组（7cd21da）后各一次，均零违例。
