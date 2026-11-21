import { useState } from 'react'
import { AlertCircle, ArrowUpCircle, Check, Copy } from 'lucide-react'
import type { UpdateInfo, UpdateWait } from '../types'

/** 关闭记忆（FR-17.2/AC-46）：同版本本会话不再弹，状态仍可经 summary 查询。 */
const DISMISS_KEY = 'ofm-update-dismissed'
const readDismissed = () => {
  try { return sessionStorage.getItem(DISMISS_KEY) } catch { return null }
}

/**
 * 顶栏右上的自更新 messageTip（FR-17.2/17.3；AC-46/47/48/49/50）。
 *
 * 形态（由 summary.update + 本地会话记忆驱动）：
 * - updating/restarting 或用户已发起 → spinner 气泡（不可关闭）；
 * - failed / update/run 4xx / 探测总超时 → 错误气泡 + 重试（重走确认流）+ 关闭；
 * - hasUpdate && canSelfUpdate → 「发现新版本」+ 立即更新（内联二次确认，明示重启
 *   中断——不新增模态组件，与免责声明模态/hash 路由零耦合）；
 * - hasUpdate && !canSelfUpdate（源码/npx/本地/Windows）→ 仅版本号 + 手动升级
 *   命令 + 复制，「立即更新」不渲染（AC-49）。
 */
export function UpdateNotice({ update, wait, request, onWait, onWaitDone }: {
  update?: UpdateInfo
  wait: UpdateWait
  request: <T = any>(path: string, body?: unknown, timeoutMs?: number) => Promise<T>
  onWait(next: { phase: 'waiting'; target: string; from: string }): void
  onWaitDone(): void
}) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const [runError, setRunError] = useState('')
  const [dismissed, setDismissed] = useState(readDismissed)
  const [copied, setCopied] = useState(false)
  const info = update
  if (!info) return null
  // 关闭记忆版本：失败态按目标版本记（failed 气泡关闭后同版本不再弹）。
  const dismissVersion = info.state === 'failed' ? info.target ?? info.latest : info.latest
  const dismiss = () => {
    if (dismissVersion) {
      try { sessionStorage.setItem(DISMISS_KEY, dismissVersion) } catch { /* 存储不可用仅本次会话生效 */ }
      setDismissed(dismissVersion)
    }
    setRunError('')
    setStep('idle')
  }
  const confirmRun = async () => {
    if (!info.latest || step === 'busy') return
    setStep('busy')
    setRunError('')
    try {
      await request('/update/run', {}, 30000)
      onWait({ phase: 'waiting', target: info.latest, from: info.current })
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : '请求失败，请重试。')
      setStep('idle')
    }
  }
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(`npm i -g o-free-model@${info.latest}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* 剪贴板不可用：命令文本仍可直接选中复制 */ }
  }
  // ① 更新/重启进行中（服务端状态或用户已发起）：spinner、不可关闭。
  if (wait.phase === 'waiting' || info.state === 'updating' || info.state === 'restarting') {
    const version = wait.phase === 'waiting' ? wait.target : info.target ?? info.latest
    return <div className="update-notice" data-testid="update-notice" role="status">
      <span className="ui-spinner" aria-hidden="true" />
      <span className="update-notice-text">正在更新到 {version ?? '新版本'} 并重启服务，页面将自动刷新…</span>
    </div>
  }
  // 关闭记忆：同版本本会话不再弹（含失败态按 target 记忆；状态仍可经 summary 查询）。
  if (dismissVersion !== null && dismissed === dismissVersion) return null
  // ② 错误态：update/run 4xx、安装失败（lastError）、或 5 分钟探测总超时。
  if (wait.phase === 'timeout' || info.state === 'failed' || runError !== '') {
    const timeoutMessage = '等待服务重启超时（5 分钟）。请刷新页面查看状态；若服务未恢复，可在终端运行 ofm 启动新版本。'
    const errorMessage = wait.phase === 'timeout' ? timeoutMessage : runError || info.lastError
    return <div className="update-notice is-danger" data-testid="update-notice" role="alert">
      <AlertCircle size={15} aria-hidden="true" />
      <span className="update-notice-text">{errorMessage}</span>
      <button type="button" className="ui-button ui-button-default" onClick={() => { setRunError(''); if (wait.phase === 'timeout') onWaitDone(); setStep('confirm') }}>重试</button>
      <button type="button" className="text-button" onClick={() => { setRunError(''); if (wait.phase === 'timeout') onWaitDone(); else dismiss() }}>关闭</button>
    </div>
  }
  if (!info.hasUpdate || !info.latest) return null
  // ③ 非全局安装（源码/npx/本地/Windows）：只示新版本与手动命令（AC-49）。
  if (!info.canSelfUpdate) {
    return <div className="update-notice" data-testid="update-notice" role="status">
      <ArrowUpCircle size={15} aria-hidden="true" />
      <span className="update-notice-text">发现新版本 {info.latest}（当前 {info.current}）。当前安装方式不支持一键更新，可手动执行：</span>
      <code>npm i -g o-free-model@{info.latest}</code>
      <button type="button" className="ui-button ui-button-outline" onClick={() => void copyCommand()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制'}</button>
      <button type="button" className="text-button" onClick={dismiss}>关闭</button>
    </div>
  }
  // ④ 可自更新：气泡 → 内联二次确认（明示重启中断，AC-47/D36①）→ 确认后发起。
  if (step === 'confirm') {
    return <div className="update-notice" data-testid="update-notice" role="alertdialog" aria-label="确认更新">
      <AlertCircle size={15} aria-hidden="true" />
      <span className="update-notice-text">将重启服务以更新到 {info.latest}，进行中的调用会中断。确认继续？</span>
      <button type="button" className="ui-button ui-button-default" onClick={() => void confirmRun()}>确认更新</button>
      <button type="button" className="text-button" onClick={() => setStep('idle')}>取消</button>
    </div>
  }
  return <div className="update-notice" data-testid="update-notice" role="status">
    <ArrowUpCircle size={15} aria-hidden="true" />
    <span className="update-notice-text">发现新版本 {info.latest}（当前 {info.current}）</span>
    <button type="button" className="ui-button ui-button-default" onClick={() => setStep('confirm')}>立即更新</button>
    <button type="button" className="text-button" onClick={dismiss}>关闭</button>
  </div>
}
