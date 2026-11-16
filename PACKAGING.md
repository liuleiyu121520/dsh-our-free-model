# Our Free Model · 独立服务打包指南

本仓库是纯 standalone 产品线：唯一可发布产物是 npm 包
`our-free-model-standalone`（`dist/*.tgz`），以及本地验证用的 Darwin zip。

| 产物 | 命令 | 说明 |
| --- | --- | --- |
| npm 包 tgz | `node scripts/pack-standalone-npm.mjs` | 零运行时依赖，bin 双命令 `our-free-model-standalone` / `ofm`；npm 页面 README 来自 `packages/standalone/NPM-README.md` |
| 本地 zip | `npm run pack:standalone -- --node-license <Node-LICENSE>` | 内嵌 Node 运行时与完整 LICENSE；产物含逐文件 sha256 的 `package-manifest.json` |

前置：打包前先 `npm run build:standalone-ui`，`packages/standalone/web/` 必须是最新前端构建
（pack 按仓库现状原样收文件）。完整性记录见包内 `package-manifest.json`；该记录不是签名或发布授权。
发布流程与冒烟步骤见方案 S11（`docs/software-company/`）。
