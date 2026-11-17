# S16 本地交付门自测留痕（AC-44，§V10.4）

- 执行日期：2026-11-17
- 基线：feat/standalone-lite @ 14280e4 + S16 实现提交（见 git log）
- 环境：临时 OFM_HOME（mkdtemp 数据目录）+ 本机替身上游（OFM_TEST_UPSTREAM，零外部网络）
- 驱动：真实 HTTP 网关（/v1/chat/completions、/api/management/*）+ 真实浏览器（Chromium headless，playwright 1.58）
- 脚本：一次性自测脚本位于 /private/tmp/s16-selftest/s16-selftest.mjs（不入库）

## 六项结果

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| ① | 六页正常渲染 0 console error | PASS | 渲染=账号渠道/智能调度/API 接入/用量日历/请求日志/服务设置；pageerror+console.error=0 |
| ② | auto 纯文本调用成功（fixture 上游） | PASS | HTTP 200，choices[0].message.content="account-ok"，命中池内第一可用 loomy/fixture-text |
| ③ | auto 含图命中 vision 模型 | PASS | 上游派发恰一条 fixture-free（vision=true）且带图；非视觉 fixture-text 与当日耗尽 fixture-locked 零派发 |
| ④ | 停用模型默认不在候选、开关开启后可见 | PASS | 默认 DOM count=0；「显示已停用模型」开启后可见，带「已停用」标记 ×1 + 「启用」按钮 ×1 |
| ⑤ | 池行显示 M/N（账号） | PASS | 耗尽行「已消耗 1/1（账号） · 最早解禁 13:19」（本地时区 HH:mm）；未耗尽行「已消耗 0/1（账号）」 |
| ⑥ | 池状态区不存在 | PASS | .smart-status-card/.smart-status-list/.smart-status-row DOM=0；「池状态」标题=0 |

服务面附加证据：summary.catalog vision 标记（fixture-text=false / fixture-free=true，与徽章同源 publicModelRows）；
/smart/state statuses accounts.earliestResetAtMs 仅在存在未来解禁时透出（locked 行 > now，text 行缺省）。

走查留屏：/private/tmp/s16-selftest/s16-smart-1080p.png（1920×1080 视口，两区完整可见）。

## registry 断言（D34 零 publish）

`npm view our-free-model-standalone dist-tags` → `{ latest: '1.2.0' }`（本地 package.json 亦为 1.2.0，未 bump——S17 暂缓）。

## 布局口径（FR-16.4）

1920×1080 视口实测：候选卡与池卡完整可见（候选卡底 557px / 池卡底 547px，1080 内）；候选列表 max-height 380px→560px，
72px 行距下完整可视行 5→7 行；独立池状态区块移除后页面无可滚动死区。
