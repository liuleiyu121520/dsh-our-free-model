# S19 本地验收清单（自更新 FR-17 / AC-45~50；方案 §V11.7）

> 由 S18 执行时落盘（方案 §V11 范围行约定）。真源演练由总监在本机执行，
> 全程零发布动作；registry `latest` 当前为 1.2.4。

## 前置

- 基线：`feat/standalone-lite`（S18 合入后），工作区干净。
- 全局安装可写（`npm prefix -g` 目录权限正常）。
- 回滚出口：`npm i -g our-free-model-standalone@1.2.4 --registry=https://registry.npmjs.org`。

## 主路径（真 registry，零 mock）

1. 临时降版打包安装：改 `packages/standalone/package.json` version → `1.2.3`（**不提交**），
   `node scripts/pack-standalone-npm.mjs` → `npm i -g <dist/*.tgz>`（全局装上含自更新代码的 1.2.3）。
2. `ofm` 启动 → 约 30 秒后管理台右上角气泡「发现新版本 1.2.4」；点关闭 → 本会话不再弹，
   重开管理台（刷新页面）状态仍可查（AC-46）。
3. 「立即更新」→ 确认（核对文案明示「进行中的调用会中断」）→ 气泡转 spinner →
   服务自重启 → 页面自动刷新 → 侧栏版本显示 **1.2.4**（真 registry 真包，AC-47/48）。
4. 数据完好性：更新前后比对 `~/.our-free-model/settings.json`（API Key 不变）、
   stats 与 claims-history 文件（AC-48）。
5. 负向：断网（或临时 hosts 屏蔽 registry.npmjs.org）重启服务 → 无气泡无弹窗、
   网关调用正常；1 小时内恢复网络 → 提示自动出现（AC-45）。
   `chmod -w <全局 node_modules>` → 更新失败错误气泡、服务不重启；
   `chmod +w` 后重试成功（AC-50）。
6. 非全局路径：源码直跑 `node packages/standalone/cli.mjs` → 气泡仅版本号 + 手动命令
   （无「立即更新」按钮，AC-49）。
7. 收尾回滚：`npm i -g our-free-model-standalone@1.2.4` 恢复全局 1.2.4；
   `git checkout -- packages/standalone/package.json` 还原临时版本改动。

## 可选补充

`npx verdaccio` + `NPM_CONFIG_REGISTRY` 本地源演练 `1.2.5-rc` 形态（prerelease→release 升级提示）。

## 结论记录

（验收执行后填写：逐项结果 / 偏差 / 是否批准 S20 发布。）
