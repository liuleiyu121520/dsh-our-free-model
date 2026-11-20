import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowUpRight, Calendar, ChevronDown, CircleAlert, Copy, Info, RefreshCw, Trash2, X, Zap } from 'lucide-react'
import { Button } from './components/ui'
import type { Host, Summary } from './types'
import './requests.css'
type Request = <T = any>(path: string, body?: unknown, timeoutMs?: number) => Promise<T>

/** content 字段统一转文本：字符串直取，分块数组拼 text、其余以类型占位。 */
const contentText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part === null || typeof part !== 'object') return String(part ?? '')
      const row = part as Record<string, unknown>
      if (row.type === 'text' && typeof row.text === 'string') return row.text
      return `[${typeof row.type === 'string' ? row.type : '块'}]`
    }).join('\n')
  }
  if (content === undefined || content === null) return ''
  return JSON.stringify(content)
}

const singleLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** 长正文默认折叠；「展开全文」落在渐隐截断处（视线落点），头部整行也可点击切换。 */
function DetailBlock({ role, text }: { role: string; text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 280 || text.split('\n').length > 6
  return <div className={`requests-block${expanded ? ' is-expanded' : ''}`}>
    <button type="button" className="requests-block-head" onClick={() => setExpanded(value => !value)}
      aria-expanded={expanded} title={expanded ? '点击收起' : '点击展开完整内容'}>
      <span className={`requests-block-role role-${role}`}>{role}</span>
      {!expanded && text !== '' && <span className="requests-block-preview">{singleLine(text).slice(0, 140)}</span>}
      {long && expanded && <span className="requests-block-toggle">收起</span>}
    </button>
    <div className="requests-block-body">
      <pre className={`requests-block-text${expanded || !long ? '' : ' is-clamped'}`}>{text === '' ? '（空）' : text}</pre>
      {long && <button type="button" className="requests-block-expand"
        onClick={event => { event.stopPropagation(); setExpanded(value => !value) }}>
        {expanded ? '收起' : '展开全文'}
      </button>}
    </div>
  </div>
}

interface LogRow {
  at: number
  model: string
  ok: boolean
  id?: string
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
interface LogDetail { id: string; at: number; input: string; output: string }

const number = (value?: number) => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN').format(value as number) : '—'
const time = (at: number) => new Date(at).toLocaleString('zh-CN', { hour12: false })
const duration = (ms?: number) => !Number.isFinite(ms) ? '—'
  : (ms as number) >= 1000 ? `${((ms as number) / 1000).toFixed(2)} s` : `${Math.round(ms as number)} ms`

/**
 * 网关请求日志页。
 *
 * 列表展示元数据（模型、耗时、token、成败）；点击一行在右侧抽屉（2/5 宽）里
 * 展示该次请求的输入与输出正文（2026-11-20 起，正文只保留 3 天；更早的记录
 * 点开时如实提示没有正文）。失败行保留短错误前缀，用来区分「上游拒绝」与
 * 「本地超时」。
 */
export function Requests({ summary, host, active, request }: {
  summary: Summary; host: Host; active: boolean; request: Request
}) {
  const [page, setPage] = useState<LogPage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState(100)
  const [drawer, setDrawer] = useState<LogRow | null>(null)
  const [tab, setTab] = useState<'overview' | 'messages' | 'raw'>('overview')
  const [detail, setDetail] = useState<LogDetail | undefined>(undefined)
  const [detailError, setDetailError] = useState('')
  const drawerRef = useRef<HTMLElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)

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

  // 抽屉正文：按 id 现取（列表载荷不含正文）。旧记录无 id → 直接提示。
  useEffect(() => {
    if (drawer === null) return
    setDetail(undefined)
    setDetailError('')
    setTab('overview')
    if (drawer.id === undefined) return
    let alive = true
    request<LogDetail>(`/requests/detail?id=${encodeURIComponent(drawer.id)}`, undefined, 20000)
      .then(value => { if (alive) setDetail(value) })
      .catch(reason => { if (alive) setDetailError(reason instanceof Error ? reason.message : '正文读取失败') })
    return () => { alive = false }
  }, [drawer, request])

  // 抽屉真 modal：Esc 关闭、Tab 圈禁、打开聚焦抽屉、关闭归还触发行（参照日历抽屉）。
  useEffect(() => {
    if (drawer === null) return
    lastFocusedRef.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => drawerRef.current?.focus())
    const element = drawerRef.current
    if (!element) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawer(null); return }
      if (event.key !== 'Tab') return
      const focusables = Array.from(element.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'))
      if (focusables.length === 0) { event.preventDefault(); return }
      const first = focusables[0], last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    element.addEventListener('keydown', onKeyDown)
    return () => element.removeEventListener('keydown', onKeyDown)
  }, [drawer])
  useEffect(() => {
    if (drawer === null && lastFocusedRef.current) { lastFocusedRef.current.focus(); lastFocusedRef.current = null }
  }, [drawer])

  // 输入按字段结构化：标量参数成 chips，messages/system 逐条成可折叠块（复制仍取原始全文）。
  const inputView = useMemo(() => {
    if (detail === undefined) return undefined
    try {
      const parsed = JSON.parse(detail.input) as unknown
      // 兼容两种落盘形态：结构化对象（含 model/参数 + messages）与旧记录的裸消息数组。
      const list: unknown[] | null = Array.isArray(parsed) ? parsed
        : Array.isArray((parsed as Record<string, unknown>)?.messages) ? (parsed as Record<string, unknown>).messages as unknown[]
        : null
      if (list !== null) {
        const scalars = Array.isArray(parsed) ? [] as [string, string][]
          : Object.entries(parsed as Record<string, unknown>)
            .filter(([key, value]) => key !== 'messages' && key !== 'system'
              && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
            .map(([key, value]) => [key, String(value)] as [string, string])
        const blocks: { role: string; text: string }[] = []
        const system = Array.isArray(parsed) ? undefined : (parsed as Record<string, unknown>).system
        if (typeof system === 'string' && system !== '') {
          blocks.push({ role: 'system', text: system })
        }
        for (const [index, message] of list.entries()) {
          const row = (message ?? {}) as Record<string, unknown>
          const role = typeof row.role === 'string' ? row.role : `#${index + 1}`
          blocks.push({ role, text: contentText(row.content) })
        }
        return { scalars, blocks }
      }
    } catch { /* 原文兜底 */ }
    return { scalars: [] as [string, string][], blocks: [{ role: '原文', text: detail.input }] }
  }, [detail])

  const copy = async (text: string | undefined) => {
    if (text === undefined || text === '') return
    await host.copy(text)
  }

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
        <p>{page ? `最近 ${number(page.total)} 条记录` : '正在读取…'} · 正文保留 3 天，点击行查看输入与输出</p></div>
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
        {page?.entries.map((row, index) => <div className={`requests-row is-clickable${row.ok ? '' : ' is-failed'}`} role="row" key={`${row.at}-${index}`}
          tabIndex={0}
          title="点击查看该请求的输入与输出"
          aria-label={`${time(row.at)} ${row.model} ${row.ok ? '成功' : '失败'}，查看详情`}
          onClick={() => setDrawer(row)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDrawer(row) } }}>
          <span className="requests-time">{time(row.at)}</span>
          <span className="requests-model" title={row.model}>{row.model}</span>
          <span>{row.ok ? <span className="requests-ok">成功</span> : <span className="requests-fail" title={row.error ?? ''}>{row.status ? `失败 ${row.status}` : '失败'}</span>}</span>
          <span>{duration(row.elapsedMs)}</span>
          <span>{duration(row.ttftMs)}</span>
          <span className="requests-tokens">{number(row.input)} → {number(row.output)}{row.reasoning ? ` (思考 ${number(row.reasoning)})` : ''}</span>
        </div>)}
      </div>}

    {drawer && <div className="requests-drawer-root" role="dialog" aria-modal="true" aria-label="请求详情">
      <div className="requests-drawer-backdrop" onClick={() => setDrawer(null)} />
      <aside className="requests-drawer" ref={drawerRef} tabIndex={-1}>
        <header className="rqd-header">
          <h2>模型调用详情</h2>
          <button type="button" className="rqd-close" aria-label="关闭详情" onClick={() => setDrawer(null)}><X size={16} /></button>
        </header>
        <div className="rqd-subtitle">
          <span className="rqd-route">{drawer.model.includes('→')
            ? <><span className="rqd-route-from">{drawer.model.split('→')[0]} → </span><strong>{drawer.model.split('→')[1]}</strong></>
            : <strong>{drawer.model}</strong>}</span>
          <span className={`rqd-badge${drawer.ok ? ' ok' : ' fail'}`}>
            {drawer.ok ? '成功' : `失败${drawer.status ? ` ${drawer.status}` : ''}`}
          </span>
        </div>
        <div className="rqd-chips">
          <span className="rqd-chip"><span className="rqd-chip-label">耗时</span>{duration(drawer.elapsedMs)}</span>
          <span className="rqd-chip"><span className="rqd-chip-label">Tokens</span>{number(drawer.input)} → {number(drawer.output)}</span>
          <span className="rqd-chip"><Calendar size={14} />{time(drawer.at)}</span>
          {drawer.id !== undefined && <span className="rqd-chip">{drawer.id.slice(0, 14)}…</span>}
        </div>
        <div className="rqd-tabs" role="tablist" aria-label="详情视图">
          <button type="button" role="tab" aria-selected={tab === 'overview'} className={`rqd-tab${tab === 'overview' ? ' active' : ''}`}
            onClick={() => setTab('overview')}>概览</button>
          <button type="button" role="tab" aria-selected={tab === 'messages'} className={`rqd-tab${tab === 'messages' ? ' active' : ''}`}
            onClick={() => setTab('messages')}>消息</button>
          <button type="button" role="tab" aria-selected={tab === 'raw'} className={`rqd-tab${tab === 'raw' ? ' active' : ''}`}
            onClick={() => setTab('raw')}>原始日志</button>
        </div>
        <div className="requests-drawer-body">
          {(tab === 'overview') && <div className="rqd-overview">
            <div className="rqd-stat-cards">
              <div className="rqd-stat-card"><span className="rqd-stat-label">模型</span><span className="rqd-stat-value">{drawer.model.split('→').pop()?.trim() ?? drawer.model}</span></div>
              <div className="rqd-stat-card"><span className="rqd-stat-label">耗时</span><span className="rqd-stat-value">{duration(drawer.elapsedMs)}</span></div>
              <div className="rqd-stat-card"><span className="rqd-stat-label">输入 Token</span><span className="rqd-stat-value">{number(drawer.input)}</span></div>
              <div className="rqd-stat-card"><span className="rqd-stat-label">输出 Token</span><span className="rqd-stat-value">{number(drawer.output)}</span></div>
              <div className="rqd-stat-card"><span className="rqd-stat-label">状态</span><span className="rqd-stat-value ok">{drawer.ok ? '成功' : '失败'}</span></div>
            </div>
            {detail !== undefined && <>
              <div className="rqd-section-card">
                <div className="rqd-section-head">
                  <Zap size={20} className="rqd-section-icon" />
                  <h3>模型思考</h3>
                  <Info size={16} className="rqd-section-info" />
                  <span className="rqd-section-actions">
                    <button type="button" onClick={() => void copy(detail.output)}><Copy size={14} />复制</button>
                  </span>
                </div>
                <div className="rqd-section-body rqd-thinking">
                  <pre>{detail.output.split('【回答】')[0]?.replace('【思考】', '').trim() || '（无思考内容）'}</pre>
                </div>
              </div>
              <div className="rqd-section-card">
                <div className="rqd-section-head">
                  <ArrowUpRight size={20} className="rqd-section-icon" />
                  <h3>最终回答</h3>
                  <span className="rqd-section-actions">
                    <button type="button" onClick={() => void copy(detail.output)}><Copy size={14} />复制</button>
                  </span>
                </div>
                <div className="rqd-section-body rqd-answer">
                  <pre>{detail.output.split('【回答】')[1]?.trim() || detail.output.trim() || '（空）'}</pre>
                </div>
              </div>
            </>}
            {drawer.id === undefined && <p className="requests-drawer-empty">该记录早于内容记录功能上线，无正文。</p>}
            {detail === undefined && drawer.id !== undefined && <p className="requests-drawer-empty">{detailError !== '' ? detailError : '正在读取正文…'}</p>}
          </div>}
          {(tab === 'messages') && (drawer.id === undefined
            ? <p className="requests-drawer-empty">该记录早于内容记录功能上线，无正文。</p>
            : detail === undefined
              ? <p className="requests-drawer-empty">{detailError !== '' ? detailError : '正在读取正文…'}</p>
              : <div className="requests-input-view">
                  {inputView !== undefined && inputView.scalars.length > 0
                    && <div className="requests-params">{inputView.scalars.map(([key, value]) =>
                      <span className="requests-param" key={key} title={`${key}: ${value}`}><b>{key}</b>{value}</span>)}</div>}
                  <div className="rqd-msg-section">
                    <div className="rqd-msg-head">
                      <span className="rqd-msg-icon" aria-hidden="true" />
                      <h3>输入消息</h3>
                      <span className="rqd-msg-count">共 {inputView?.blocks.length ?? 0} 条</span>
                    </div>
                    <div className="requests-timeline" role="list">
                      {inputView?.blocks.map((block, index) =>
                        <div className="requests-timeline-item" role="listitem" key={index}>
                          <span className="requests-timeline-seq" aria-hidden="true">{index + 1}</span>
                          <DetailBlock role={block.role} text={block.text} />
                        </div>)}
                    </div>
                  </div>
                </div>)}
          {(tab === 'raw') && (detail === undefined
            ? <p className="requests-drawer-empty">{detailError !== '' ? detailError : '正在读取正文…'}</p>
            : <div className="rqd-raw">
                <div className="rqd-raw-section">
                  <div className="rqd-raw-head">输入 JSON <button type="button" onClick={() => void copy(detail.input)}><Copy size={13} />复制</button></div>
                  <pre className="rqd-raw-pre">{detail.input}</pre>
                </div>
                <div className="rqd-raw-section">
                  <div className="rqd-raw-head">输出全文 <button type="button" onClick={() => void copy(detail.output)}><Copy size={13} />复制</button></div>
                  <pre className="rqd-raw-pre">{detail.output}</pre>
                </div>
              </div>)}
        </div>
      </aside>
    </div>}
  </div>
}
