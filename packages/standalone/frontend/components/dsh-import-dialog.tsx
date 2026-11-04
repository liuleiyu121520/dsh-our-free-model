import { useEffect, useState } from 'react'
import { Button } from './ui'

type Request = <T = any>(path: string, body?: unknown) => Promise<T>

interface Detected {
  available: boolean
  existing?: number
  reason?: string
  accounts: number
  providers: Record<string, number>
  expired: number
  skipped: number
}

const PROVIDER_NAMES: Record<string, string> = {
  qoder: 'Qoder', qodercn: 'Qoder 国内版', trae: 'TRAE', cline: 'Cline', gemini: 'Gemini',
  zcode: 'ZCode', minimax: 'MiniMax', workbuddy: 'WorkBuddy 国际版', buddy: 'WorkBuddy 国内版',
  loomy: 'Loomy', codearts: 'CodeArts', raccoon: 'Raccoon',
}
const providerName = (id: string) => PROVIDER_NAMES[id] ?? id

/**
 * 首次启动的「把 DSH 里已有的账号渠道导进来」提示。
 *
 * 弹出条件由后端判定（`available`）：本机确实有可导入的 DSH 账号，**且**本服务
 * 自己还没有任何账号。后者比「问过一次」可靠 —— 用户点过「稍后」、却没有真正
 * 导入时不会被永久跳过；而已经有账号时也不该再问，因为导入是整体替换，
 * 会冲掉用户现在的登录状态。
 *
 * `dshImportAsked` 仍然保留：它只用于「探测本身失败/没有可导入账号」这种
 * 连提示都不该出现的情形，避免每次打开都白跑一次探测。
 *
 * 载荷含明文凭据，因此本组件从不把它渲染到界面上，只统计数字。
 */
export function DshImportDialog({ request, onDone }: {
  request: Request
  onDone(): void
}) {
  const [detected, setDetected] = useState<Detected>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ accountsImported?: number; skipped?: number }>()

  useEffect(() => {
    // ⚠️ 这里不再用 `dshImportAsked` 提前 return。唯一的判据是后端给的
    // `available`（= DSH 侧有可导账号 且 本服务还没有任何账号）。用设置位
    // 提前短路会出两种错：用户删掉全部账号后想再导入却被永久挡住；反过来
    // 已导入过的机器换了数据目录，也永远等不到提示。
    // `dshImportAsked` 只保留给「探测本身没结果」这一种情形（见下面两个分支）。
    let alive = true
    request<Detected>('/dsh/import')
      .then(value => {
        if (!alive) return
        setDetected(value)
        // 后端已经把「本服务还没有任何账号」并进 `available`，所以这里直接信它：
        // 有可导入账号就弹；没有就不弹，也不必写设置位（每次启动重新判断即可，
        // 代价只是一次本地文件读取）。
        if (value.available) setOpen(true)
      })
      // 探测失败不该拦住界面，也不该写设置位把提示永久关掉：下次启动再试。
      .catch(() => {})
    return () => { alive = false }
  }, [request])

  if (!open || !detected) return null

  const providers = Object.entries(detected.providers).sort((left, right) => right[1] - left[1])

  const finish = async () => {
    // 只是这一次不导：不写 `dshImportAsked`，下次启动（本服务仍无账号时）
    // 还会再问一次。用户真想永久跳过，渠道页不再提示即可 —— 与其悄悄
    // 把提示关掉，不如让「有账号可导」这件事保持可见。
    setOpen(false)
    onDone()
  }
  const importNow = async () => {
    setBusy(true); setError('')
    try {
      const value = await request<any>('/dsh/import', { confirm: true })
      setResult(value?.value ?? {})
      // 真正导入成功才算「问过」：下次进来不会再弹。
      await request('/settings', { dshImportAsked: true }).catch(() => {})
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return <div className="dsh-import-backdrop" role="dialog" aria-modal="true" aria-labelledby="dsh-import-title">
    <div className="dsh-import-dialog">
      {result ? <>
        <h2 id="dsh-import-title">已导入</h2>
        <p className="dsh-import-lead">
          成功导入 <strong>{result.accountsImported ?? detected.accounts}</strong> 个账号
          {result.skipped ? `，跳过 ${result.skipped} 个` : ''}。
        </p>
        <p className="dsh-import-note">凭据已复制到本独立服务的数据目录，DSH 那边的原账号不受影响。</p>
        <div className="dsh-import-actions"><Button onClick={() => void finish()}>完成</Button></div>
      </> : <>
        <h2 id="dsh-import-title">发现 {detected.accounts} 个已有账号</h2>
        <p className="dsh-import-lead">
          这台机器上的 DSH 插件里已经登录过免费账号渠道。要把它们一键导入这台独立服务吗？
        </p>
        <div className="dsh-import-providers">
          {providers.map(([id, count]) => <span className="dsh-import-chip" key={id}>
            {providerName(id)}<strong>{count}</strong></span>)}
        </div>
        {detected.expired > 0 && <p className="dsh-import-warn">
          其中 {detected.expired} 个账号的凭据已过期，导入后需要重新登录。
        </p>}
        <p className="dsh-import-note">
          导入会「整体替换」本服务当前的账号列表，插件里的原账号不受影响。
          凭据只写到本机数据目录，不会上传。
        </p>
        {error && <p className="dsh-import-error" role="alert">{error}</p>}
        <div className="dsh-import-actions">
          <Button variant="outline" disabled={busy} onClick={() => void finish()}>稍后</Button>
          <Button disabled={busy} onClick={() => void importNow()}>{busy ? '正在导入…' : '一键导入'}</Button>
        </div>
      </>}
    </div>
  </div>
}
