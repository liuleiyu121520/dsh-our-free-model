import { useEffect, useState } from 'react'
import { Activity, CircleAlert, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from './components/ui'
import type { Host, Summary } from './types'

type Request = <T = any>(path: string, body?: unknown, timeoutMs?: number) => Promise<T>

interface LogRow {
  at: number
  model: string
  ok: boolean
  status?: number
  error?: string
  errorCode?: string
  input?: number
  output?: number
  reasoning?: number
  ttftMs?: number
  elapsedMs?: number
  attempt?: number
  origin?: string
}
interface LogPage { total: number; entries: LogRow[] }

const number = (value?: number) => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN').format(value as number) : '—'
const time = (at: number) => new Date(at).toLocaleString('zh-CN', { hour12: false })
const duration = (ms?: number) => !Number.isFinite(ms) ? '—'
  : (ms as number) >= 1000 ? `${((ms as number) / 1000).toFixed(2)} s` : `${Math.round(ms as number)} ms`

/**
 * 网关请求日志页。
 *
 * 只展示元数据（模型、耗时、token、成败），不展示 prompt 或回答内容 ——
 * 日志本身就不记录它们。失败行保留短错误前缀，用来区分「上游拒绝」与
 * 「本地超时」。
 */
export function Requests({ summary, host, active, request }: {
  summary: Summary; host: Host; active: boolean; request: Request
}) {
  const [page, setPage] = useState<LogPage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState(100)

  useEffect(() => {
    if (!active) return
    let alive = true
    setBusy(true)
    request<LogPage>(`/requests?limit=${limit}`)
      .then(value => { if (alive) { setPage(value); setError('') } })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : '日志读取失败') })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [active, limit, request])

  const clear = async () => {
    if (!window.confirm('清空全部请求日志？此操作不可恢复。')) return
    setBusy(true)
    try {
      await request('/requests/clear', {})
      setPage({ total: 0, entries: [] })
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清空失败')
    } finally {
      setBusy(false)
    }
  }

  if (!active) return null
  return <div className="requests-browser" data-testid="requests-ready">
    <header className="dashboard-heading">
      <div>
        <h1>请求日志</h1>
        <p>{page ? `最近 ${number(page.total)} 条记录` : '正在读取…'} · 只记录元数据，不含对话内容</p></div>
      <div className="actions">
        <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); request<LogPage>(`/requests?limit=${limit}`).then(setPage).catch(reason => setError(reason.message)).finally(() => setBusy(false)) }}>
          <RefreshCw size={15} className={busy ? 'spinning' : ''} />刷新
        </Button>
        <Button variant="outline" disabled={busy || !page?.total} onClick={() => void clear()}>
          <Trash2 size={15} />清空
        </Button>
      </div>
    </header>
    {error && <div className="channel-error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
    <div className="requests-toolbar">
      <label>显示条数
        <select value={limit} onChange={event => setLimit(Number(event.target.value))} aria-label="显示条数">
          {[50, 100, 200, 500, 1000].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </div>
    {page && page.entries.length === 0
      ? <div className="requests-empty"><Activity size={22} /><h2>还没有请求</h2>
        <p>网关接过一次调用后，这里会逐条记录模型、耗时与 token 用量。</p></div>
      : <div className="requests-table" role="table" aria-label="请求日志">
        <div className="requests-row requests-head" role="row">
          <span role="columnheader">时间</span><span role="columnheader">模型</span>
          <span role="columnheader">状态</span><span role="columnheader">耗时</span>
          <span role="columnheader">首字</span><span role="columnheader">Token</span>
        </div>
        {page?.entries.map((row, index) => <div className={`requests-row${row.ok ? '' : ' is-failed'}`} role="row" key={`${row.at}-${index}`}>
          <span className="requests-time">{time(row.at)}</span>
          <span className="requests-model" title={row.model}>{row.model}</span>
          <span>{row.ok ? <span className="requests-ok">成功</span> : <span className="requests-fail" title={row.error ?? ''}>{row.status ? `失败 ${row.status}` : '失败'}</span>}</span>
          <span>{duration(row.elapsedMs)}</span>
          <span>{duration(row.ttftMs)}</span>
          <span className="requests-tokens">{number(row.input)} → {number(row.output)}{row.reasoning ? ` (思考 ${number(row.reasoning)})` : ''}</span>
        </div>)}
      </div>}
  </div>
}
