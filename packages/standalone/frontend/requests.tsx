import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowUpRight, Box, Brain, CalendarDays, CheckCircle2, ChevronDown,
  ChevronUp, ChevronsUpDown, CircleAlert, Clock3, Copy, FileCode2, Filter,
  Layers3, Maximize2, MessageCircle, MessagesSquare, RefreshCw, SquareCode,
  Trash2, X, Zap,
} from 'lucide-react'
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

/** DEMO 还原：单条消息卡（角色胶囊 + 单行预览 + chevron 折叠/展开正文）。 */
function Message({ seq, role, text }: { seq: number; role: string; text: string }) {
  const [collapsed, setCollapsed] = useState(true)
  return <article className={`message${collapsed ? ' collapsed' : ''}`} data-role={role}>
    <span className="step">{seq}</span>
    <div className="message-card">
      <button type="button" className="message-head" onClick={() => setCollapsed(v => !v)}>
        <span className={`role ${role}`}>{role}</span>
        <span className="message-summary">{singleLine(text).slice(0, 100)}</span>
        <span className="message-toggle"><ChevronDown size={15} /></span>
      </button>
      {!collapsed && <div className="message-body">{text}</div>}
    </div>
  </article>
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
  const [tab, setTab] = useState<'overview' | 'messages' | 'output' | 'raw'>('overview')
  const [detail, setDetail] = useState<LogDetail | undefined>(undefined)
  const [expandedText, setExpandedText] = useState<string | null>(null)
  const [expandedTitle, setExpandedTitle] = useState('内容详情')
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

  // 抽屉正文：按 id 现取。只在 id 变化时重置/重拉（防 15s 轮询导致的 request
  // 函数身份变化触发重跑 → detail 归 undefined → Message 组件卸载重挂 → 展开
  // 状态丢失）。request 经 ref 引用，不进依赖数组。
  const requestRef = useRef(request)
  requestRef.current = request
  const drawerId = drawer?.id ?? null
  useEffect(() => {
    if (drawerId === null) return
    setDetail(undefined)
    setDetailError('')
    setTab('overview')
    let alive = true
    requestRef.current<LogDetail>(`/requests/detail?id=${encodeURIComponent(drawerId)}`, undefined, 20000)
      .then(value => { if (alive) setDetail(value) })
      .catch(reason => { if (alive) setDetailError(reason instanceof Error ? reason.message : '正文读取失败') })
    return () => { alive = false }
  }, [drawerId])

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

    {drawer && <div className="requests-drawer-root" role="dialog" aria-modal="true" aria-label="模型调用详情">
      <div className="requests-drawer-backdrop" onClick={() => setDrawer(null)} />
      <aside className="drawer" ref={drawerRef} tabIndex={-1}>
        <header className="drawer-header">
          <div className="header-top">
            <div className="title-wrap">
              <h2 className="drawer-title">模型调用详情</h2>
              <div className="model-line">
                <span className="route">{drawer.model}</span>
                <span className="status"><CheckCircle2 size={13} strokeWidth={2.6} />{drawer.ok ? '成功' : '失败'}</span>
              </div>
            </div>
            <button type="button" className="icon-btn" aria-label="关闭" onClick={() => setDrawer(null)}><X size={19} /></button>
          </div>
          <div className="meta-row">
            <div className="meta-chip"><Clock3 size={14} />耗时 {duration(drawer.elapsedMs)}</div>
            <div className="meta-chip"><Layers3 size={14} />Tokens {number(drawer.input)} → {number(drawer.output)}</div>
            <div className="meta-chip"><CalendarDays size={14} />{time(drawer.at)}</div>
            {drawer.id !== undefined && <div className="meta-chip id-chip" title={drawer.id}><SquareCode size={14} />{drawer.id.slice(0, 14)}…</div>}
          </div>
          <div className="tabs" role="tablist" aria-label="调用详情视图">
            {(['overview', 'messages', 'output', 'raw'] as const).map(t =>
              <button key={t} type="button" role="tab" aria-selected={tab === t}
                className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                {t === 'overview' ? '概览' : t === 'messages' ? '输入消息' : t === 'output' ? '输出结果' : '原始日志'}
              </button>)}
          </div>
        </header>
        <div className="drawer-scroll">
          {tab === 'overview' && <>
            <div className="summary-grid">
              <div className="metric"><div className="metric-icon"><Box size={17} /></div><div><div className="metric-label">模型</div><div className="metric-value">{drawer.model.split('→').pop()?.trim() ?? drawer.model}</div></div></div>
              <div className="metric"><div className="metric-icon"><Clock3 size={17} /></div><div><div className="metric-label">耗时</div><div className="metric-value">{duration(drawer.elapsedMs)}</div></div></div>
              <div className="metric compact"><div className="metric-icon"><Layers3 size={16} /></div><div><div className="metric-label">输入 Token</div><div className="metric-value">{number(drawer.input)}</div></div></div>
              <div className="metric compact"><div className="metric-icon"><Layers3 size={16} /></div><div><div className="metric-label">输出 Token</div><div className="metric-value">{number(drawer.output)}</div></div></div>
              <div className="metric compact status-metric"><div className="metric-icon"><CheckCircle2 size={16} /></div><div><div className="metric-label">状态</div><div className="metric-value">{drawer.ok ? '成功' : '失败'}</div></div></div>
            </div>
            {detail !== undefined && <>
              <section className="section-card" id="messagesSection">
                <div className="section-heading">
                  <div className="section-title"><MessageCircle size={18} />输入消息</div>
                  <div className="section-actions"><span className="count">共 {inputView?.blocks.length ?? 0} 条</span></div>
                </div>
                <div className="timeline">
                  {inputView?.blocks.map((b, i) => <Message key={i} seq={i + 1} role={b.role} text={b.text} />)}
                </div>
              </section>
              <section className="section-card reasoning-card">
                <div className="section-heading">
                  <div className="section-title"><Brain size={18} />模型思考</div>
                  <div className="section-actions">
                    <button onClick={() => void copy(detail.output)}><Copy size={14} /><span>复制</span></button>
                    <button onClick={() => { setExpandedText(detail.output); setExpandedTitle('模型思考') }}><Maximize2 size={14} /><span>展开</span></button>
                  </div>
                </div>
                <div className="reasoning-content"><span className="tag">[reasoning]</span>{detail.output.split('【回答】')[0]?.replace('【思考】', '').trim() || '（无思考内容）'}</div>
              </section>
              <section className="section-card answer-card">
                <div className="section-heading">
                  <div className="section-title"><Zap size={18} />最终回答</div>
                  <div className="section-actions">
                    <button onClick={() => void copy(detail.output)}><Copy size={14} /><span>复制</span></button>
                    <button onClick={() => { setExpandedText(detail.output); setExpandedTitle('最终回答') }}><Maximize2 size={14} /><span>展开</span></button>
                  </div>
                </div>
                <div className="answer-content">{detail.output.split('【回答】')[1]?.trim() || detail.output.trim() || '（空）'}</div>
              </section>
            </>}
            {drawer.id === undefined && <p className="messages-only-note">该记录早于内容记录功能上线，无正文。</p>}
            {detail === undefined && drawer.id !== undefined && <p className="messages-only-note">{detailError !== '' ? detailError : '正在读取正文…'}</p>}
          </>}
          {tab === 'messages' && (drawer.id === undefined
            ? <p className="messages-only-note">该记录早于内容记录功能上线，无正文。</p>
            : detail === undefined
              ? <p className="messages-only-note">{detailError !== '' ? detailError : '正在读取正文…'}</p>
              : <section className="section-card">
                  <div className="section-heading">
                    <div className="section-title"><MessagesSquare size={18} />输入消息</div>
                    <div className="section-actions"><span className="count">共 {inputView?.blocks.length ?? 0} 条</span></div>
                  </div>
                  <p className="messages-only-note">按模型实际接收顺序展示完整上下文，点击任意消息可展开或收起。</p>
                  <div className="timeline">
                    {inputView?.blocks.map((b, i) => <Message key={i} seq={i + 1} role={b.role} text={b.text} />)}
                  </div>
                </section>)}
          {tab === 'output' && (detail === undefined
            ? <p className="messages-only-note">{detailError !== '' ? detailError : '正在读取正文…'}</p>
            : <>
                <section className="section-card reasoning-card">
                  <div className="section-heading">
                    <div className="section-title"><Brain size={18} />模型思考</div>
                    <div className="section-actions">
                      <button onClick={() => void copy(detail.output)}><Copy size={14} /><span>复制</span></button>
                      <button onClick={() => { setExpandedText(detail.output); setExpandedTitle('模型思考') }}><Maximize2 size={14} /><span>展开</span></button>
                    </div>
                  </div>
                  <div className="reasoning-content"><span className="tag">[reasoning]</span>{detail.output.split('【回答】')[0]?.replace('【思考】', '').trim() || '（无思考内容）'}</div>
                </section>
                <section className="section-card answer-card">
                  <div className="section-heading">
                    <div className="section-title"><Zap size={18} />最终回答</div>
                    <div className="section-actions">
                      <button onClick={() => void copy(detail.output)}><Copy size={14} /><span>复制</span></button>
                      <button onClick={() => { setExpandedText(detail.output); setExpandedTitle('最终回答') }}><Maximize2 size={14} /><span>展开</span></button>
                    </div>
                  </div>
                  <div className="answer-content">{detail.output.split('【回答】')[1]?.trim() || detail.output.trim() || '（空）'}</div>
                </section>
              </>)}
          {tab === 'raw' && (detail === undefined
            ? <p className="messages-only-note">{detailError !== '' ? detailError : '正在读取正文…'}</p>
            : <section className="section-card">
                <div className="section-heading">
                  <div className="section-title"><FileCode2 size={18} />原始调用日志</div>
                  <div className="section-actions">
                    <button onClick={() => void copy(`${detail.input}\n---\n${detail.output}`)}><Copy size={14} /><span>复制</span></button>
                    <button onClick={() => { setExpandedText(`${detail.input}\n---\n${detail.output}`); setExpandedTitle('原始调用日志') }}><Maximize2 size={14} /><span>展开</span></button>
                  </div>
                </div>
                <pre className="raw-log">{detail.input}\n---\n{detail.output}</pre>
              </section>)}
        </div>
      </aside>
      {expandedText !== null && <div className="expanded-overlay open" onClick={e => { if (e.target === e.currentTarget) setExpandedText(null) }}>
        <div className="expanded-dialog">
          <div className="dialog-head"><span>{expandedTitle}</span><button onClick={() => setExpandedText(null)}>×</button></div>
          <pre>{expandedText}</pre>
        </div>
      </div>}
    </div>}
  </div>
}
