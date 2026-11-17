# S8 勘误链登记（errata）

| 项 | 内容 |
|---|---|
| 性质 | 控制面勘误工件（不进 git commit；历史 commit 不改写；被勘误的原始工件原文不动） |
| 创建 | 2026-11-17，架构师 高见远（第 4 轮审查 R4O-002 处置；修复设计由交付总监裁定） |
| 关联 | commit `7cd21da`；`docs/software-company/s8-gate/e4-gray-zone-appendix.md`；方案 plan-buffer2026-smart-calendar.md v7 §6E-E6 |

## 勘误 #1：7cd21da commit message 与 e4 附录「保留 overrides」记载有误

**1. 有误记载（两处，原文照录）**

- commit `7cd21da` message 偏差段：「偏差（D18 存疑保留）：devDependencies 保留 dsh-llm-legacy + overrides——channel-pack-test.mjs:22 sourceMode 动态 import '@deepseek-ai/dsh-llm/invariant'，E-6 原计划的删除项实有保留侧引用，待方案修订确认」
- `e4-gray-zone-appendix.md` 第 3 条目（:43-46）：「channel-pack-test.mjs:22 sourceMode 动态 import `@deepseek-ai/dsh-llm/invariant` —— **E-6『删 dsh-llm-legacy』的原事实基础（gateway-source-test 唯一引用者）不完整**：按保留测试 D18『存疑一律保留』原则，devDependencies 保留 dsh-llm-legacy + overrides；方案 §6E-E6 需总监修订确认（本批未改方案）。」

> 转写注明：引号样式因嵌套排版由「」转写为『』，其余逐字。

**2. 正确终态（权威依据）**

- root package.json（7cd21da 树，实测）：**无 `overrides` 键、无 `peerDependencies` 键**；`devDependencies` 保留 `"dsh-llm-legacy": "npm:@deepseek-ai/dsh-llm@0.1.5-rc.2"`（package.json:43）。
- 方案表述以 plan-buffer2026-smart-calendar.md **v7 §6E-E6** 为准（v6 已先行修正，v7 沿用并扩展 SR-11）。

**3. 成因**

e4 附录条目 3 的写作时点早于「overrides 剥离」的最终决定（E-6 执行序列内先按「存疑保留」口径记录保守预案，后在同一 commit 内完成 overrides/peerDependencies 的实际剥离）；commit message 沿用了该时点的表述，未随剥离决定同步更新。

**4. 读者解释路径**

任何从 `git log`（7cd21da message）或 `s8-gate/e4-gray-zone-appendix.md` 出发的读者 → 本文件（`s8-gate/errata.md` 勘误 #1）→ 正确终态（package.json 实测 + 方案 v7 §6E-E6）。
