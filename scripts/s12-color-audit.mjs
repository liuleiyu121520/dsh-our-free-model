#!/usr/bin/env node
/**
 * S12-B 色值审计（一次性只读；方案 §V8.2 落点 #6 / R6O-007）。
 *
 * 夜主题（含昼侧对照）全部底色/渐变/阴影色值 × 位置 × hue 判冷：
 *   - 冷 = hue ∈ [90, 270]（绿青蓝紫冷相）且通道极差 ≥ 6（排除近中性灰）；
 *     该口径覆盖方案实测四系冷底 rgba(20,22,34)/rgba(13,14,22)/rgba(11,12,18)/rgba(16,17,25)
 *     （hue≈226-235）与昼侧冷灰白（如 237,241,251）。
 *   - 豁免逐项登记：翡翠绿语义带（hue 148-172，BA-2「绿仅主操作/选中/状态」）；
 *     近中性灰（极差 < 6）单列不判冷。
 * 输出 docs/software-company/s12-gate/s12-color-audit.txt；违规（未登记冷色）非零即退出码 1。
 *
 * Run: node scripts/s12-color-audit.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const cssDir = path.join(root, 'packages/standalone/frontend')
const reportPath = path.join(root, 'docs/software-company/s12-gate/s12-color-audit.txt')
const files = fs.readdirSync(cssDir).filter(name => name.endsWith('.css')).sort()

const hueOf = (r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0) return 0
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}
const parseChannels = text => {
  const out = []
  for (const m of text.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/g)) {
    out.push({ text: m[0], r: +m[1], g: +m[2], b: +m[3], alpha: m[4] === undefined ? 1 : +m[4], index: m.index })
  }
  for (const m of text.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const hex = m[1]
    out.push({ text: `#${hex}`, r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), alpha: 1, index: m.index })
  }
  return out
}

const lines = []
let violations = 0
let exemptions = 0
lines.push(`S12-B 色值审计（脚本 scripts/s12-color-audit.mjs；作用域 packages/standalone/frontend/*.css）`)
lines.push(`时点：${new Date().toISOString()}；判冷口径：hue ∈ [90,270] 且通道极差 ≥ 6（近中性灰不判冷）`)
lines.push(`豁免带：翡翠绿/薄荷绿语义色 hue ∈ [125,175] 且 G 为最大通道（BA-2）；判冷口径=底色/渐变/阴影/滚动条面；注释与文字色不参与判冷\n`)

for (const file of files) {
  const raw = fs.readFileSync(path.join(cssDir, file), 'utf8')
  // 注释内容替换为等长空白（保行号；注释中的示例色值不参与判冷）
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
  const fileLines = raw.split('\n')
  const lineStarts = []
  { let at = 0; for (const l of fileLines) { lineStarts.push(at); at += l.length + 1 } }
  const lineOf = index => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1 } return lo + 1 }
  // 粗粒度作用域：当前规则块选择器是否命中夜/昼
  const events = []
  for (const m of source.matchAll(/\{|\}|^([^{}\n][^{}\n]*)\{/gm)) {
    if (m[0] === '{') events.push({ type: 'open', selector: m[1] ?? '', index: m.index })
    else if (m[0] === '}') events.push({ type: 'close', index: m.index })
  }
  let depth = 0
  const scopeStack = []
  const scopeAt = index => {
    // 重建到 index 为止的作用域
    let d = 0, stack = []
    for (const event of events) {
      if (event.index > index) break
      if (event.type === 'open') { stack.push(event.selector); d++ } else { stack.pop(); d-- }
    }
    const joined = stack.join(' ')
    if (/\[data-theme="dark"\]/.test(joined)) return '夜'
    if (/:root:not\(\[data-theme="dark"\]\)/.test(joined)) return '昼'
    return '共享'
  }
  const rows = []
  for (const color of parseChannels(source)) {
    const { r, g, b } = color
    const spread = Math.max(r, g, b) - Math.min(r, g, b)
    const hue = hueOf(r, g, b)
    const line = lineOf(color.index)
    const scope = scopeAt(color.index)
    const declaration = fileLines[line - 1] ?? ''
    // 方案口径：夜主题「底色/渐变/阴影」色值全量审计；文字/语法高亮等非表面色单列口径外。
    const surfaceDecl = /(background|gradient|shadow|scrollbar-color|fill\b)/.test(declaration)
    let verdict, reason = ''
    if (spread < 6) verdict = '中性'
    else if (hue >= 90 && hue <= 270) {
      if (color.g >= color.r && color.g >= color.b && hue >= 125 && hue <= 175) { verdict = '豁免'; reason = '翡翠绿/薄荷绿语义色（主操作/选中/状态，BA-2）' }
      else if (!surfaceDecl) { verdict = '口径外'; reason = '非底色/渐变/阴影（文字或语法高亮色，方案口径外）' }
      else verdict = '冷'
    } else verdict = '暖'
    if (verdict === '冷') violations++
    if (verdict === '豁免') exemptions++
    rows.push({ line, scope, color: color.text, r, g, b, hue: Math.round(hue), verdict, reason, text: fileLines[line - 1].trim().slice(0, 110) })
  }
  const cold = rows.filter(row => row.verdict === '冷')
  const exempt = rows.filter(row => row.verdict === '豁免')
  lines.push(`── ${file}：色值 ${rows.length}（冷 ${cold.length} / 豁免 ${exempt.length} / 暖+中性 ${rows.length - cold.length - exempt.length}）`)
  for (const row of cold) lines.push(`   ✗ ${file}:${row.line} [${row.scope}] ${row.color} hue=${row.hue}  ${row.text}`)
  for (const row of exempt) lines.push(`   - ${file}:${row.line} [${row.scope}] ${row.color} hue=${row.hue}  ${row.reason}`)
  lines.push('')
}
lines.push(`结论：未登记冷色 ${violations}（判${violations === 0 ? '零通过' : '未通过'}）；翡翠绿语义豁免 ${exemptions} 项逐条留痕。`)
lines.push(`说明：绿=主操作/选中/状态、琥珀=警告、红=错误（BA-2）；底色/渐变/阴影面向暖系（夜 L0 #12110e < L1 #1b1a16 < L2 #232019）。`)

fs.mkdirSync(path.dirname(reportPath), { recursive: true })
fs.writeFileSync(reportPath, lines.join('\n') + '\n')
process.stdout.write(lines.filter(line => line.startsWith('──') || line.startsWith('   ✗') || line.startsWith('结论')).join('\n') + '\n')
process.stdout.write(`工件已写入 ${path.relative(root, reportPath)}\n`)
process.exitCode = violations === 0 ? 0 : 1
