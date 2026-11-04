/**
 * 生成可直接 `npx` 运行的独立服务包（本地验证用，不发布）。
 *
 * 独立服务的后端按仓库相对路径引用 `../../src/...` 与 `../../vendor/...`，
 * 所以发布包必须保留同样的相对布局：包根内同时有 `packages/standalone/`
 * 和 `src/`，`bin` 指向 `packages/standalone/cli.mjs`。这样零代码改动就能
 * 从 `node_modules/<name>` 里跑起来。
 *
 * 只做打包与完整性记录；不 bump 版本、不签名、不发布。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { standaloneSourceFiles, repositoryRoot } from './pack-standalone.mjs'

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const json = value => `${JSON.stringify(value, null, 2)}\n`

export function buildNpmStandalonePackage({ name = 'our-free-model-standalone', outputName } = {}) {
  const sources = standaloneSourceFiles().map(file => ({
    file, bytes: fs.readFileSync(path.join(repositoryRoot, file)),
  }))
  const standalonePackage = JSON.parse(sources.find(item => item.file === 'packages/standalone/package.json').bytes)
  const sourceDigest = hash(Buffer.concat(sources.flatMap(({ file, bytes }) => [Buffer.from(`${file}\0${bytes.length}\0`), bytes])))
  const dist = path.join(repositoryRoot, 'dist')
  fs.mkdirSync(dist, { recursive: true })
  const label = outputName ?? `${name}-${standalonePackage.version}-dev-${sourceDigest.slice(0, 10)}`
  if (!/^[a-z0-9][a-z0-9.-]{0,180}$/.test(label)) throw new Error('输出名必须是单个小写文件名')
  const stage = path.join(dist, '.npm-stage-')
  fs.rmSync(stage, { recursive: true, force: true })
  const root = path.join(stage, 'package')
  fs.mkdirSync(root, { recursive: true })
  try {
    for (const { file, bytes } of sources) {
      // 保留 `packages/standalone/package.json` 的原位副本：`service.mjs` 用它读产品版本
      // （`readFileSync(new URL('./package.json', import.meta.url))`）。包根的那份是
      // npm 清单，不能代替它。
      const target = path.join(root, file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes)
    }
    // 发布包的 package.json：保留仓库相对布局，只补 bin / files / 运行要求。
    const shipped = sources.map(({ file }) => file)
    fs.writeFileSync(path.join(root, 'package.json'), json({
      name,
      version: standalonePackage.version,
      private: false,
      type: 'module',
      description: 'Our Free Model 独立本地服务：一条命令启动，网页里设置免费模型与网关，无需安装 DSH',
      bin: { [name]: './packages/standalone/cli.mjs' },
      files: shipped,
      engines: standalonePackage.engines,
      license: 'MIT',
      // 后端只用 node: 内置模块；这里留空是为了让 `npx` 明确不拉任何运行时依赖。
      dependencies: {},
    }))
    fs.writeFileSync(path.join(root, 'README.md'), `# Our Free Model 独立本地服务（npx 包）

一条命令启动，浏览器里设置免费模型与网关，不需要安装 DSH。

\`\`\`
npx ${name}
\`\`\`

启动后终端会打印一次性管理链接并尝试自动打开浏览器；链接 10 分钟内有效、只能兑换一次。
数据默认保存在 \`~/.our-free-model\`，用 \`--data-dir\` 或 \`OFM_HOME\` 覆盖。
精简页面只显示模型、账号渠道与网关；\`--full\` 可回到完整控制台。

需要 Node.js ${standalonePackage.engines?.node ?? '^22.19.0 || >=24.0.0'}。
`)
    const manifest = {
      format: 'ofm-npm-package/v1',
      purpose: 'local-validation-only',
      product: { name, version: standalonePackage.version },
      source: {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
        snapshotSha256: sourceDigest,
      },
      files: shipped.sort().map(file => ({ path: file, size: fs.statSync(path.join(root, file)).size })),
    }
    fs.writeFileSync(path.join(root, 'package-manifest.json'), json(manifest))
    const packed = execFileSync('npm', ['pack', '--json', '--pack-destination', stage], {
      cwd: root, encoding: 'utf8', timeout: 180000,
    })
    const [info] = JSON.parse(packed)
    const tarball = path.join(dist, `${label}.tgz`)
    fs.copyFileSync(path.join(stage, info.filename), tarball)
    return { tarball, files: shipped.length, size: info.size, unpacked: info.unpackedSize, sourceSha256: sourceDigest, version: standalonePackage.version }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = {}
    for (let index = 2; index < process.argv.length; index++) {
      const flag = process.argv[index]
      if (flag === '--help') {
        console.log('node scripts/pack-standalone-npm.mjs [--name <包名>] [--output <文件名>]')
        process.exit(0)
      }
      if (!['--name', '--output'].includes(flag) || !process.argv[index + 1]) throw new Error(`未知选项或缺少参数：${flag}`)
      options[flag === '--name' ? 'name' : 'outputName'] = process.argv[index + 1]
      index++
    }
    const result = buildNpmStandalonePackage(options)
    console.log(`独立服务 npx 包：${result.tarball}`)
    console.log(`${result.files} 个文件，压缩 ${(result.size / 1024).toFixed(0)} KiB，解压 ${(result.unpacked / 1048576).toFixed(1)} MiB，版本 ${result.version}`)
  } catch (error) {
    process.stderr.write(`打包失败：${error.message}\n`)
    process.exitCode = 1
  }
}
