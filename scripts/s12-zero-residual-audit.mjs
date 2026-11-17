#!/usr/bin/env node
/**
 * S12 残留判零审计（一次性只读；方案 §V8.1 A7 / R6O-004 + R6O-008）。
 *
 * 四条 pattern（显式交替，正例自检）扫 git ls-files 追踪文件，输出
 * 「pattern × 命中 × 豁免理由」工件 docs/software-company/s12-gate/s12-zero-residual-audit.txt；
 * S14/S15 复跑同脚本比对。前置检查：web/assets.json 指纹与重建输出一致
 * （内部调 build-standalone-ui --check，产物未重建即中止，白名单不留重建前豁免）。
 *
 * 判零口径：独立端产品面（packages/standalone/** 与 scripts 独立端脚本）的
 * 代码命中必须为零；豁免仅限已登记类别（控制面文档 / E-10 快照 / 共享内核
 * 自有路径 / 文件路径 token / 删除留痕注释 / 判零守恒断言字符串 / 二进制资产）。
 *
 * Run: node scripts/s12-zero-residual-audit.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const reportPath = path.join(root, 'docs/software-company/s12-gate/s12-zero-residual-audit.txt')

// ── 前置：web/ 产物必须与源码重建一致（R6O-008 时序） ───────────────────────
try {
  execFileSync(process.execPath, ['scripts/build-standalone-ui.mjs', '--check'], { cwd: root, stdio: 'pipe' })
} catch (error) {
  process.stderr.write(`产物未重建（web/ 与源码不一致）：请先 npm run build:standalone-ui 并提交产物。\n${error.stdout ?? ''}\n`)
  process.exit(1)
}

// ── 四条 pattern（§V8.1 A7 表） ─────────────────────────────────────────────
const fresh = source => new RegExp(source, 'g')
const PATTERNS = [
  {
    id: 'a', face: '前端源面',
    scope: file => /^packages\/standalone\/frontend\/.+\.(tsx|ts|mjs|css|html)$/.test(file),
    source: "'(overview|workspace|agents|usage|sponsor)'",
    positives: ["'workspace'", "'overview'", "'sponsor'"],
  },
  {
    id: 'b', face: '端点面',
    scope: () => true,
    source: '/workbench|/library|/providers|/routing|/subscriptions|/engine|/desktop-update|/eac/|/models/(test|refresh)',
    positives: ['/models/test', '${PREFIX}/workbench/', '/eac/status', '/desktop-update', '/engine/ui', '/subscriptions/', "'src/providers/index.js'"],
  },
  {
    id: 'd', face: '符号面',
    scope: () => true,
    source: 'LITE_PAGES|liteNavigationPages|--full|hasDesktopBridge|--lite',
    positives: ['LITE_PAGES', 'liteNavigationPages', '--full', 'hasDesktopBridge', '--lite'],
  },
]

// 正例自检：pattern 本身必须能命中改前树已知的残留形态，否则 pattern 写错，直接中止。
for (const pattern of PATTERNS) {
  for (const positive of pattern.positives) {
    if (!new RegExp(pattern.source).test(positive)) {
      process.stderr.write(`pattern ${pattern.id} 自检失败：应命中正例 ${positive}\n`)
      process.exit(1)
    }
  }
}

// ── (c) 测试面：A6 处置集合复检（删除项不存在即零） ─────────────────────────
const deletedByA6 = [
  'scripts/workbench-test.mjs', 'scripts/workbench-library-test.mjs', 'scripts/workbench-management-test.mjs',
  'scripts/workbench-native-desktop-test.mjs', 'scripts/workbench-native-test.mjs', 'scripts/workbench-native-agents-test.mjs',
  'scripts/desktop-update-test.mjs', 'scripts/workbench-ui-test.mjs',
]

// ── 豁免登记（逐类留痕；判零 = 独立端产品面代码命中为零） ───────────────────
const standaloneFace = file =>
  file.startsWith('packages/standalone/')
  || /^scripts\/(standalone-|test-all|pack-standalone|build-standalone|release-standalone-npm|quota-routing)/.test(file)
const classify = (pattern, file, line, text, matchedText, matchIndex) => {
  // web/ 构建产物中的端点字符串来自 E-10 冻结快照（channels 分包编译
  // scripts/lib/standalone-shared-ui.source.js 的插件组件，源文件本身已豁免）；
  // 独立端自身源面（frontend/ 六页 + management）由 (a)/(b) 在源上判零。
  if (pattern.id === 'b' && file.startsWith('packages/standalone/web/')) {
    return '豁免：web 构建产物内嵌 E-10 冻结快照字符串（源=scripts/lib/standalone-shared-ui.source.js，已豁免；独立端源面判零）'
  }
  if (!standaloneFace(file)) {
    if (/\.md$/.test(file) || file.startsWith('docs/')) return '豁免：控制面文档 / 历史验证记录'
    if (file === 'scripts/lib/standalone-shared-ui.source.js') return '豁免：E-10 冻结快照（历史插件组件源）'
    if (/^vendor\//.test(file)) return '豁免：二进制 / 引擎资产'
    if (/^src\/|^worker\//.test(file)) return '豁免：共享内核与 worker 自有路径 / 方法名（非独立端管理 API）'
    return '豁免：共享内核 / 引擎 / EAC 接线测试（src·engine·eac-lane 自有路径，非独立端管理 API）'
  }
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) return '豁免：二进制内容误读'
  const trimmed = line.trimStart()
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '豁免：删除留痕注释（说明端点/旗标已删除）'
  if (pattern.id === 'b') {
    const rest = text.slice(matchIndex + matchedText.length)
    if (/^[-.]/.test(rest) || /^\/[\w.-]+\.(mjs|js|json|wasm|toml|txt)/.test(rest)) return '豁免：文件路径 token（如 src/subscriptions.js、src/engine-payload.js、src/providers/index.js），非 HTTP 端点'
    if (/https?:\/\/[^ '"`]*$/.test(text.slice(0, matchIndex))) return '豁免：EAC 接线 base URL（网关 /eac/v1 协议路径，推理链保留），非管理端点'
  }
  if (pattern.id === 'd' && file === 'scripts/standalone-nav-test.mjs') return '豁免：判零守恒断言字符串（nav 套件用这些符号名断言其不存在）'
  if (pattern.id === 'a' && file === 'scripts/standalone-nav-test.mjs') return '豁免：判零守恒断言字符串'
  return null
}

const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const lines = []
let violations = 0
let exemptions = 0

lines.push(`S12 残留判零审计（脚本 scripts/s12-zero-residual-audit.mjs；作用域 git ls-files ${files.length} 文件）`)
lines.push(`时点：${new Date().toISOString()}；HEAD：${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()}`)
lines.push('前置：web/assets.json 指纹一致性（build-standalone-ui --check）通过\n')

for (const pattern of PATTERNS) {
  lines.push(`── pattern (${pattern.id}) ${pattern.face} :: /${pattern.source}/g`)
  const scoped = files.filter(pattern.scope)
  const hits = []
  for (const file of scoped) {
    if (!fs.existsSync(path.join(root, file))) {
      // 追踪索引里仍有、工作树已删除（等待 git add 的中间态）：按内容缺失跳过并留痕。
      hits.push({ file, line: 0, text: '（工作树缺失：索引待更新）', raw: '', verdict: '豁免：索引中间态（文件已从工作树删除，待提交）', synthetic: true })
      continue
    }
    const bytes = fs.readFileSync(path.join(root, file))
    if (bytes.includes(0)) { continue }
    const source = bytes.toString('utf8')
    const regex = fresh(pattern.source)
    let match
    while ((match = regex.exec(source)) !== null) {
      const line = source.slice(0, match.index).split('\n').length
      const lineText = source.split('\n')[line - 1] ?? ''
      hits.push({ file, line, text: lineText.trim().slice(0, 160), match: match[0], raw: lineText, index: match.index + (source.slice(0, match.index).lastIndexOf('\n') >= 0 ? source.slice(0, match.index).lastIndexOf('\n') : 0) })
    }
  }
  // 重新精确定位每个命中在其行内的偏移（classify 需要行内上下文）
  const judged = hits.map(hit => {
    if (hit.synthetic) return hit
    const withinLine = hit.raw.indexOf(hit.match)
    const verdict = classify(pattern, hit.file, hit.raw, hit.raw, hit.match, withinLine)
    return { ...hit, verdict }
  })
  exemptions += judged.filter(hit => hit.verdict).length
  const exempt = judged.filter(hit => hit.verdict)
  const bad = judged.filter(hit => !hit.verdict)
  violations += bad.length
  lines.push(`   命中 ${judged.length}（豁免 ${exempt.length} / 违规 ${bad.length}）`)
  for (const hit of bad) lines.push(`   ✗ ${hit.file}:${hit.line}  ${hit.text}`)
  for (const hit of exempt) lines.push(`   - ${hit.file}:${hit.line}  ${hit.verdict}`)
  lines.push('')
}

lines.push('── pattern (c) 测试面 :: A6 处置集合复检（删除项不存在即零）')
let missing = 0
for (const file of deletedByA6) {
  const exists = files.includes(file)
  lines.push(`   ${exists ? '✗ 仍存在' : '- 已删除'}  ${file}`)
  if (exists) { violations++; missing++ }
}
lines.push(`   删除项残留 ${missing}（改写项按新断言面由 (a)/(b)/(d) 覆盖）\n`)

lines.push(`结论：违规命中 ${violations}（判零${violations === 0 ? '通过' : '未通过'}）；豁免 ${exemptions} 项已逐条留痕。`)
lines.push(`口径：独立端产品面 = packages/standalone/** + scripts/{standalone-*,test-all,pack-standalone,build-standalone*,release-standalone-npm,quota-routing}；`)
lines.push(`豁免类别：控制面文档 / E-10 冻结快照 / 共享内核与 worker 自有路径 / 文件路径 token / 删除留痕注释 / 判零守恒断言字符串 / 二进制资产。`)

fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, lines.join('\n') + '\n')
process.stdout.write(lines.filter(line => line.startsWith('──') || line.includes('命中') || line.startsWith('结论') || line.startsWith('   ✗')).join('\n') + '\n')
process.stdout.write(`工件已写入 ${path.relative(root, reportPath)}\n`)
process.exitCode = violations === 0 ? 0 : 1
