#!/usr/bin/env node
import path from 'node:path'
import { startStandalone } from './service.mjs'
import { openExternal } from './open-external.mjs'

const usage = `Our Free Model 独立本地服务
用法：npx our-free-model-standalone [选项]
      node packages/standalone/cli.mjs [选项]

  --port <端口>       监听端口，默认 18900（冲突时自动选择可用端口）
  --data-dir <目录>   数据目录，默认 OFM_HOME 或 ~/.our-free-model
  --lite              精简页面：只显示模型、渠道与网关（默认）
  --full              完整页面：额外显示概览、用量、订阅与工作台等服务页
  --no-open           不自动打开浏览器
  --no-refresh        跳过启动与周期刷新；仍可手动刷新和推理
  --probe             已停用（保留兼容）：自动探测不会发送任何请求
  --lan               启用并保存 LAN 推理中继（独立密钥，管理页仍仅限本机）
  --no-lan            关闭并保存 LAN 推理中继
  --lan-port <端口>   保存 LAN 期望端口，默认 0；不会单独开启中继
  --help              显示帮助
`

async function main() {
  const options = { lite: true, open: true }
  for (let index = 2; index < process.argv.length; index++) {
    const flag = process.argv[index]
    if (flag === '--help') { process.stdout.write(usage); return }
    if (flag === '--no-refresh') { options.refresh = false; continue }
    if (flag === '--probe') { options.probe = true; continue }
    if (flag === '--lite') { options.lite = true; continue }
    if (flag === '--full') { options.lite = false; continue }
    if (flag === '--no-open') { options.open = false; continue }
    if (flag === '--lan' || flag === '--no-lan') { options.lanEnabled = flag === '--lan'; continue }
    if (!['--port', '--data-dir', '--lan-port'].includes(flag) || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
      throw new Error(`未知选项或缺少参数：${flag}`)
    }
    const value = process.argv[++index]
    if (flag === '--port' || flag === '--lan-port') {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('端口必须为 0 到 65535 的整数')
      options[flag === '--port' ? 'port' : 'lanPort'] = Number(value)
    } else options.dataDir = path.resolve(value)
  }
  const service = await startStandalone(options)
  let stopping = false
  const shutdown = () => {
    if (stopping) return
    stopping = true
    void service.close().catch(error => {
      process.stderr.write(`停止失败：${error.message}\n`)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  process.stdout.write(`${service.product} ${service.version}\n管理页面（10 分钟内一次性登录）：${service.managementUrl}\nAPI：${service.url}/v1\nAPI Key 保存在：${service.keyFile}\n`)
  if (options.open) {
    // 一次性链接 10 分钟内只能兑换一次：先尝试自动打开浏览器。
    // 打开失败不算启动失败 —— 链接已经打印在上面，手动打开同样能用。
    const opened = await openExternal(service.managementUrl)
    if (!opened) process.stdout.write('未能自动打开浏览器，请手动打开上面的管理页面链接。\n')
  }
  if (service.lan.running) {
    process.stdout.write(`LAN API：${service.lan.baseUrls.join(', ') || `端口 ${service.lan.port}`}\nLAN Key：请在本机管理接口中查看（独立于本机 API Key）\n`)
  } else if (service.lan.error) process.stderr.write(`${service.lan.error}\n`)
}

main().catch(error => {
  process.stderr.write(`启动失败：${error.code === 'EEXIST' ? '数据目录已有服务运行，或 service.lock 的归属无法确认；请先退出已有服务。Windows 和 Linux 会自动回收已确认进程退出的陈旧锁。' : error.message}\n`)
  process.exitCode = 1
})
