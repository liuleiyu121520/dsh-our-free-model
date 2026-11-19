<div align="center">

# Our Free Model

**命令行模型网关 —— 一条命令，在你自己机器上跑起一个带网页控制台的 OpenAI 兼容网关。**

[![npm](https://img.shields.io/npm/v/our-free-model-standalone?style=flat-square&color=2f6f4f)](https://www.npmjs.com/package/our-free-model-standalone)
[![node](https://img.shields.io/node/v/our-free-model-standalone?style=flat-square&color=4b6fff)](https://nodejs.org)
[![deps](https://img.shields.io/badge/dependencies-0-7da1de?style=flat-square)](https://www.npmjs.com/package/our-free-model-standalone)
[![license](https://img.shields.io/npm/l/our-free-model-standalone?style=flat-square&color=263146)](https://github.com/liuleiyu121520/dsh-our-free-model/blob/main/LICENSE)

</div>

## 安装并启动

```bash
npm i -g our-free-model-standalone
ofm
```

不安装也可以：`npx our-free-model-standalone`

启动后终端打印一次性管理链接（10 分钟内有效），浏览器打开即可。API 地址是
`http://127.0.0.1:18900/v1`，API Key 在控制台「网关与 API 接入」页查看。

<div align="center">
  <img src="https://raw.githubusercontent.com/liuleiyu121520/dsh-our-free-model/feat/standalone-lite/docs/images/standalone-console/channels-light.png" width="864" alt="网页控制台：账号渠道页（昼主题）">
</div>

<table>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/liuleiyu121520/dsh-our-free-model/feat/standalone-lite/docs/images/standalone-console/smart-light.png" width="400" alt="智能调度页：候选模型与调度池接力"></td>
    <td align="center"><img src="https://raw.githubusercontent.com/liuleiyu121520/dsh-our-free-model/feat/standalone-lite/docs/images/standalone-console/calendar-light.png" width="400" alt="用量日历页：按日 token 消耗与渠道领取"></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="https://raw.githubusercontent.com/liuleiyu121520/dsh-our-free-model/feat/standalone-lite/docs/images/standalone-console/night-theme.png" width="400" alt="夜间主题（暖深色）"></td>
  </tr>
</table>

## 它做什么

把各家免费模型额度与你登录的账号渠道，汇集成一个 `/v1` 接口，供 IDE、命令行和脚本调用。

- **13 个账号渠道**统一管理：登录、账号池、每日签到、用量与备份
- **OpenAI 兼容**：`/v1/chat/completions`、`/v1/responses`，任何兼容客户端直接接
- **自带网页控制台**：账号渠道 / 智能调度 / 网关与 API 接入 / 用量日历 / 请求日志 / 服务设置，昼/夜双主题
- **零运行时依赖**，只用 Node 内置模块
- **默认只监听 `127.0.0.1`**，凭据只落在本机数据目录

## 常用参数

```bash
ofm --port 18900            # 指定端口（占用时自动换）
ofm --data-dir ~/ofm-data   # 数据目录，默认 ~/.our-free-model
ofm --no-refresh            # 不自动刷新模型清单
ofm --help                  # 全部选项
```

## 自动更新

控制台启动约 30 秒后检查新版本（此后每小时一次；结果只保存在内存里，不写任何配置）。
发现新版本时右上角会提示：点「立即更新」并确认，服务会自动执行 `npm i -g` 并重启，
页面随后自动刷新；更新失败不影响现有安装，可就地重试。诊断日志见数据目录下的
`update.log` 与 `update-restart.log`。

自动更新仅支持 macOS / Linux 上的 npm 全局安装。`npx` 运行、项目内依赖或
Windows 环境不会出现一键更新按钮，界面会显示手动升级命令
（`npm i -g our-free-model-standalone@<版本>`），按提示执行即可。

## 仓库

- **源码**：[liuleiyu121520/dsh-our-free-model](https://github.com/liuleiyu121520/dsh-our-free-model)（命令行工具在 [`packages/standalone`](https://github.com/liuleiyu121520/dsh-our-free-model/tree/main/packages/standalone)）
- **问题反馈**：[Issues](https://github.com/liuleiyu121520/dsh-our-free-model/issues)

> 与上游的关系：源自 [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model)（MIT，版权声明保留、未重新授权），
> 差异仅在渠道取舍——恢复了上游移除的 WorkBuddy 国内版/国际版与华为云渠道，风险由使用者承担。
> 完整说明见[仓库 README](https://github.com/liuleiyu121520/dsh-our-free-model#readme)。

## 免责

个人学习与技术研究项目，按「现状」提供，**不是模型提供方**：所有回答由你配置的第三方服务产生，
额度与可用性由对应服务方决定。使用时请遵守各地法律与服务商条款，风险自负。
