---
target: standalone 管理台 frontend
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/Users/leiyu/AI/dsh-hub/dsh-our-free-model/packages/standalone/frontend"
timestamp: 2026-11-16T20-01-41Z
slug: packages-standalone-frontend
closed: true
---
# Impeccable Critique — standalone 管理台（Buffer 2026 换肤后终审）
Method: multi-agent (A: 代码级设计审查 · V: 视觉 QA image-analyst 30 截图 · B: 检测器+浏览器证据)
Nielsen 30/40 (Good)。强项：状态可见 4 / 错误恢复 4；弱项：一致性 2 / 灵活高效 2。
Design specificity：领域语言量身（接力语义/解禁/三态领取），骨架通用件，macOS 三色点出戏。
确定性：CLI tsx 扫描 0 发现；浏览器 5 页 95 条 anti-pattern（low-contrast ×35、undersized/tiny-text ×50、bounce-easing ×6、smart 首屏 1387% 溢出、nested-cards、暗轮 dark-glow/stripes）。
Priority Issues：
[P1] smart 首屏纵向失衡+候选无界（smart-grid 1387%、无搜索/max-height）→ layout+polish
[P1] 昼主题对比度违例（#0e9f6e/#fff 3.4:1、--ink-faint 3.7:1 小字、placeholder 3.1:1）→ 换 --green-ink/--ink-quiet
[P1] 夜主题=第二套组件语言（主按钮三套、复选框蓝/绿、暗色大写变换、KPI 字体漂移、绿边框、页脚漂移）→ 收敛组件语言单一系统
[P1] 日历抽屉假 modal（无 Esc/焦点圈禁/归还）→ harden
[P2] connection token 纪律破产（62 !important、硬编码胶囊、未定义 token）→ extract+polish
Persona 红旗：Alex 无快捷键/42 tab stop/无批量；Sam 3:1 选中态、假 modal、listbox 结构、三种 switch。
Minor：字号 0.5px 步进、字重取整、空态四构图、tab 三语言、绿 accent 越界六处、reduced-motion 豁免不全、topbar 不 sticky、斜纹残留、英文报错直出、curl 截断。
优势：双主题身份+切换动效+原生表面三件套；状态色三件套；异步状态机纪律。
Questions：分组三渠道入口；教学文案毕业机制；connection 六任务拆分。
