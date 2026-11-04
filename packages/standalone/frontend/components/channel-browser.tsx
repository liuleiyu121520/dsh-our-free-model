import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, Network, ShieldCheck } from 'lucide-react'
import { providers } from 'ofm-provider-list'
import { shared } from 'ofm-shared-client'
import { Button } from './ui'
import type { Summary } from '../types'

interface Status { closed?: boolean; accounts?: { total: number; enabled: number }; models?: { total: number; disabled: number } }
type Rpc = (method: string, payload?: object) => Promise<any>
const t = Object.assign((key: string) => shared.DICT.zh[key] ?? key, { locale: 'zh' })

export function ChannelBrowser({ rpc, summary }: { rpc: Rpc; summary: Summary & { reload?(): void } }) {
  const [statuses, setStatuses] = useState<Record<string, Status>>()
  const [error, setError] = useState('')
  const [auto, setAuto] = useState<{ enabled: boolean; running?: boolean; ranToday?: boolean }>()
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const started = ++sequence.current
    try {
      const value = await rpc('provider.status', { providers: providers.map(row => row.id) })
      if (!mounted.current || started !== sequence.current) return
      setStatuses(value.statuses ?? {})
      setError('')
    } catch (failure) {
      if (mounted.current && started === sequence.current) setError((failure as Error).message)
    }
  }, [rpc])
  useEffect(() => {
    mounted.current = true
    void reload()
    void rpc('usage.autoCheckin', {}).then(value => {
      if (mounted.current) setAuto(value.autoCheckin)
    }).catch(() => {})
    const timer = setInterval(() => { if (!document.hidden) void reload() }, 45000)
    return () => { mounted.current = false; sequence.current++; clearInterval(timer) }
  }, [rpc, reload])
  const onChanged = useCallback(() => {
    void reload()
    window.dispatchEvent(new CustomEvent('ofm:channels'))
    summary.reload?.()
  }, [reload, summary.reload])
  const onError = useCallback((_provider: unknown, failure: Error) => { if (mounted.current) setError(failure.message) }, [])
  const connected = providers.filter(provider => statuses?.[provider.id]?.accounts?.enabled && !statuses[provider.id].closed).length
  const accounts = Object.values(statuses ?? {}).reduce((sum, row) => sum + (row.accounts?.total ?? 0), 0)
  // 展平：渠道按「已接入优先、其余按 provider 顺序」直接铺在列表上，
  // 每个卡片自带账号/模型折叠，点开即操作，不再进二级页。
  const rows = providers
  return <>
    <div className="channel-summary-strip">
      <div className="ch-metric"><span className="ch-metric-icon"><Network size={16} /></span>
        <div className="ch-metric-body"><span className="ch-metric-label">已接入渠道</span>
          <strong className="ch-metric-value">{statuses ? connected : <span className="ch-skeleton" />}<small> / {providers.length}</small></strong></div></div>
      <div className="ch-metric"><span className="ch-metric-icon"><ShieldCheck size={16} /></span>
        <div className="ch-metric-body"><span className="ch-metric-label">本机账号</span>
          <strong className="ch-metric-value">{statuses ? accounts : <span className="ch-skeleton" />}</strong></div></div>
      <div className="checkin-control"><span className="status-dot" /><span>{auto?.running ? '签到进行中' : auto?.ranToday ? '今日签到已执行' : '每日自动签到'}</span>
        <button type="button" role="switch" aria-label="每日自动签到" aria-checked={auto?.enabled === true}
          className={`ui-switch ${auto?.enabled ? 'on' : ''}`} disabled={!auto || busy} onClick={() => {
            setBusy(true)
            void rpc('usage.autoCheckin', { enabled: !auto?.enabled }).then(value => { if (mounted.current) setAuto(value.autoCheckin) })
              .catch(failure => { if (mounted.current) setError(failure.message) }).finally(() => { if (mounted.current) setBusy(false) })
          }}><span /></button>
      </div>
    </div>
    {error && <div className="channel-error" role="alert"><CircleAlert size={16} /><span>{error}</span><Button variant="ghost" onClick={() => { void reload() }}>重试</Button></div>}
    <div className="channel-flat-list">
      {rows.map(provider => {
        const status = statuses?.[provider.id]
        return <shared.ChannelCard key={provider.id} channel={provider} status={status} rpc={rpc} t={t}
          onChanged={onChanged} onError={onError} compact />
      })}
    </div>
  </>
}
