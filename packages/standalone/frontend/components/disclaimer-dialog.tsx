import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
// ⚠️ 独立服务用**自己的**免责声明（STANDALONE_*），不是插件那份。
// 插件版讲的是「本分支恢复了哪些渠道、上游为什么移除」——独立服务的用户根本
// 没装 DSH、也没见过上游，那套文案与他无关。两者版本号独立，互不影响确认状态。
import { STANDALONE_DISCLAIMER as DISCLAIMER, STANDALONE_DISCLAIMER_VERSION as DISCLAIMER_VERSION } from '../../../../src/disclaimer.js'
import { management } from '../management'
import '../disclaimer.css'

/**
 * The disclaimer, shown once on the first console visit and reopenable from the
 * sidebar afterwards.
 *
 * It is not a gate: acknowledging writes a settings key, and the model lanes
 * work whether or not it has been read. The copy lives in `src/disclaimer.js`,
 * but the console renders `STANDALONE_DISCLAIMER` — the standalone product has
 * its own story to tell (no DSH, local only, a gateway rather than a provider)
 * and must not repeat the plugin's branch-vs-upstream explanation.
 */
export function DisclaimerDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])
  if (!open) return null
  const dismiss = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await management('/disclaimer/ack', {})
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试。')
    } finally { setBusy(false) }
  }
  return createPortal(
    <dialog ref={dialog} className="ofm-disclaimer-dialog" aria-labelledby="ofm-disclaimer-title"
      onCancel={event => { event.preventDefault(); if (!busy) void dismiss() }}>
      <header>
        <span className="ofm-disclaimer-eyebrow">使用须知</span>
        <h2 id="ofm-disclaimer-title">{DISCLAIMER.title}</h2>
        <p>{DISCLAIMER.subtitle}</p>
      </header>
      <div className="ofm-disclaimer-body">
        <p className="ofm-disclaimer-intro">{DISCLAIMER.intro}</p>
        {DISCLAIMER.sections.map((section: { id: string; heading: string; body: string }) => (
          <section key={section.id}>
            <h3>{section.heading}</h3>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
      <footer>
        <span className="ofm-disclaimer-version">免责声明版本 v{DISCLAIMER_VERSION}</span>
        {error && <span className="ofm-disclaimer-error" role="alert">{error}</span>}
        <button type="button" className="primary" disabled={busy} onClick={() => void dismiss()}>
          {busy ? '保存中…' : DISCLAIMER.accept}
        </button>
      </footer>
    </dialog>,
    document.body,
  )
}
