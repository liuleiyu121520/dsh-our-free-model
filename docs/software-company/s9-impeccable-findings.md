# S9 impeccable 终审工件（s9-impeccable-findings）

| 项 | 内容 |
|---|---|
| 阶段 | S9（PRD FR-11 / AC-27、AC-28） |
| 执行 | 交付总监（impeccable skill v4.8.0，Operate 模式）+ 工程师 + image-analyst + e2e-tester |
| 起点 | feat/standalone-lite @ 4aa6dfe（S8 后冻结点） |
| 终点 | feat/standalone-lite @ 8f6bd0c（S9 修复链 7 个 commit：7468d81、8178237、46a8baf、b1c5c14、44ba80b、9580524、eb01848、8f6bd0c） |

## 一、Critique（三路隔离评估 → 综合裁决）

- **方法**：multi-agent——A 代码级设计审查（Nielsen 10 项）、V 视觉 QA（30 张昼/夜截图逐页）、B 确定性检测器（CLI tsx 扫描 + 浏览器 CSP 旁路注入 5 页实扫）
- **Design Health Score：30/40（Good）**；快照：`.impeccable/critique/2026-11-16T20-01-41Z__packages-standalone-frontend.md`
- **确定性证据**：CLI 23 tsx exit 0；浏览器 95 条 anti-pattern（low-contrast ×35、undersized/tiny-text ×50、bounce-easing ×6、smart 首屏 1387% 溢出、nested-cards、暗轮 dark-glow/stripes）
- **总评**：领域语言量身、异步状态机与错误分类学获奖级；弱在一致性（夜主题=第二套组件语言）与键盘效率

## 二、修复矩阵（全部计算样式级验证）

| 发现（严重度） | 修复 | 验证 |
|---|---|---|
| smart 首屏失衡/候选无界（P1） | 筛选框+max-height 380 滚动 | 178→31 收窄、scrollHeight 实证 |
| 昼对比度违例（P1） | --green-ink/--ink-quiet 全替换、placeholder --muted | 5.3:1、grep --ink-faint=0 |
| 夜=第二套组件语言（P1） | 主按钮三套→一套（600/12px 像素级同色）、蓝复选框→绿 accent、暗大写×13 删、KPI 单色化、夜输入中性边框 --border-input、页脚居中+贴底、斜纹/白药丸/琥珀双色清零 | 三处主按钮逐字段相等、15 页大写扫描=0、rgb 采样 |
| 日历假 modal（P1） | Esc/焦点圈禁/归还/roving tabindex（42→1 tab stop）+未来格拦停 | CDP activeElement 全链路 |
| connection token 纪律（P2） | 硬编码胶囊→槽位、未定义 token 落地、z-index token 化、nested-card 拆层 | grep #38bdf8/#fbbf24=0 |
| 绿 accent 越界 ×6（P2） | 全部中性化/语义化（图例绿+琥珀两色） | 像素采样两色区分 |
| reduced-motion 缺口（P2） | 光束/status-pulse/cp-pulse 关停 | 规则 grep |
| bounce-easing ×7（P2） | easeOutExpo 曲线 | grep=0 |
| 10/10.5px 小字 ×51（P2） | ≥11px | grep=0 |
| curl 硬截断（P3） | 横向滚动容器 | CSS 属性 |
| workspace 夜横幅对比（P3） | --danger-ink | 7.3:1 实测 |
| settings 开关不同构（P3） | 昼夜实底绿+白胶囊滑块（轨道绑 --green-ink token） | rgb 精确匹配 |

**修复过程教训**（已沉淀）：CSS 级联中新增规则打不过旧 `!important` 残留——两轮返工后改为直接修改胜出规则本身（9580524）与修复花括号嵌套吸收缺陷（eb01848）。

## 三、D24 已接受项（夜身份纹理层，保留不修）

见 `s9-accepted-texture-items.md`：overview 夜「NO SIGNAL」空态框、channels 夜签到容器切角、providers/eyebrow 昼夜一致的设计性大写、connection macOS 三色窗点（上报项，世界级装饰，待用户裁定是否移除）。

## 四、P3 遗留（follow-up，不阻断交付）

1. channels `.ui-switch` 昼轨道 #257151 → `--green-ink` token 迁移（与 settings 数值完全同构）
2. 侧栏导航重分组（三个「渠道」入口分属两组，组数 4→3）
3. 全局快捷键/命令面板；smart 候选批量操作
4. smart 三段教学文案「毕业机制」（确认后折叠）
5. connection 页六任务拆分为两条旅程
6. 原生 `window.confirm` → 站内确认对话框；topbar sticky；字号阶梯 1.125-1.2 规律化；字重 550/650 取整
7. favicon 401（服务端路由固有）；workspace Magpie 引擎缺失提示的环境说明

## 五、复验汇总

- impeccable detect CLI（8 改动 tsx）：exit 0
- e2e 五轮验证（含两轮 FAIL 定位-返工-复测闭环）：最终全 PASS，15 页 0 console error
- image-analyst 终版像素复核：三大系统性问题确认消除（主 CTA 像素级统一/大写清零/KPI 零值单色中性），绿渗漏四处收口
- 快照关闭：本 pass 清空全部 Priority Issues（P1×4 + P2 connection），P3 如上披露
