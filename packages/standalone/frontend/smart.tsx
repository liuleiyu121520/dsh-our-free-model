import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CircleSlash, GripVertical, Info, ListPlus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react'
import { Button, Card, Switch } from './components/ui'
import type { Host, SmartCandidate, SmartState, SmartStatus, Summary } from './types'
import './smart.css'

/** 解禁时刻按本地时区展示（NFR-10：modelRateLimits 固有 UTC+8 语义不改，仅展示本地化）。 */
const fmtReset = (ms?: number) => Number.isFinite(ms) && (ms as number) > 0
  ? new Date(ms as number).toLocaleString('zh-CN', { hour12: false })
  : ''

/** 「最早解禁 HH:mm」（FR-16.3）：本地时区、仅时分。 */
const fmtClock = (ms?: number) => Number.isFinite(ms) && (ms as number) > 0
  ? new Date(ms as number).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  : ''

const statusOf = (statuses: SmartStatus[] | undefined, modelId: string): SmartStatus | undefined =>
  statuses?.find(row => row.modelId === modelId)

const isInvalid = (statuses: SmartStatus[] | undefined, modelId: string) =>
  statusOf(statuses, modelId)?.reason === 'invalid'

/**
 * 候选行（FR-16.1/16.2）：默认视图只含启用中的模型；「显示已停用模型」开关
 * 开启后（showDisabled），停用条目灰显 + 仅「启用」动作（恢复路径，D32）。
 */
function CandidateRow({ candidate, busy, showDisabled, onAdd, onToggleDisabled }: { candidate: SmartCandidate; busy: boolean; showDisabled: boolean; onAdd(id: string): void; onToggleDisabled(candidate: SmartCandidate, disabled: boolean): void }) {
  const exhausted = candidate.accounts.total > 0 && candidate.accounts.available === 0
  const zeroAccounts = candidate.accounts.total === 0
  return <li className={`smart-candidate${candidate.disabled ? ' is-disabled' : ''}`}>
    <div className="smart-candidate-main">
      <span className="smart-candidate-id" title={candidate.id}>{candidate.id}</span>
      <span className="smart-candidate-name">{candidate.name && candidate.name !== candidate.model ? candidate.name : ''}</span>
    </div>
    <div className="smart-candidate-meta">
      <span className={`smart-accounts ${exhausted ? 'is-exhausted' : zeroAccounts ? 'is-neutral' : 'is-ok'}`}>
        {candidate.accounts.available}/{candidate.accounts.total} 账号可用
      </span>
      {showDisabled && candidate.disabled && <>
        <span className="smart-tag is-disabled-tag">已停用</span>
        <Button variant="ghost" size="sm" className="smart-toggle-btn"
          aria-label={`启用 ${candidate.id}`} title="启用（恢复进入候选与调度）"
          disabled={busy} onClick={() => onToggleDisabled(candidate, false)}>
          <CircleSlash size={14} />启用
        </Button>
      </>}
      {!candidate.disabled && <Button variant="ghost" size="sm" className="smart-add-btn" aria-label={`把 ${candidate.id} 加入调度池`}
        title="加入调度池" onClick={() => onAdd(candidate.id)}>
        <ListPlus size={15} />加入
      </Button>}
    </div>
  </li>
}

function PoolRow({ modelId, index, total, statuses, dragging, onRemove, onMove, onDragStart, onDragOver, onDrop, onDragEnd }: {
  modelId: string
  index: number
  total: number
  statuses?: SmartStatus[]
  dragging: boolean
  onRemove(id: string): void
  onMove(index: number, delta: number): void
  onDragStart(index: number): void
  onDragOver(event: React.DragEvent): void
  onDrop(index: number): void
  onDragEnd(): void
}) {
  const status = statusOf(statuses, modelId)
  const invalid = status?.reason === 'invalid'
  const exhausted = status?.reason === 'exhausted'
  // 池行内联账号状态（FR-16.3）：M = total − available（已消耗）；M=N（全耗尽）且 N>0
  // 时同行给出「最早解禁 HH:mm」（本地时区；时刻取自 accounts.earliestResetAtMs，缺省不显示）。
  const accounts = status?.accounts
  const consumed = accounts && accounts.total > 0
    ? <>已消耗 {accounts.total - accounts.available}/{accounts.total}（账号）
      {accounts.available === 0 && accounts.earliestResetAtMs ? ` · 最早解禁 ${fmtClock(accounts.earliestResetAtMs)}` : ''}</>
    : null
  return <li className={`smart-pool-row${invalid ? ' is-invalid' : ''}${dragging ? ' is-dragging' : ''}`}
    draggable onDragStart={() => onDragStart(index)} onDragOver={onDragOver}
    onDrop={() => onDrop(index)} onDragEnd={onDragEnd}>
    <span className="smart-pool-order" aria-hidden="true">{index + 1}</span>
    <span className="smart-pool-grip" aria-hidden="true"><GripVertical size={14} /></span>
    <span className="smart-pool-id" title={modelId}>{modelId}</span>
    {consumed && <span className="smart-pool-accounts" title={accounts?.earliestResetAtMs ? `最早解禁 ${fmtReset(accounts.earliestResetAtMs)}` : undefined}>{consumed}</span>}
    {invalid && <span className="smart-tag is-invalid-tag">已失效</span>}
    {exhausted && <span className="smart-tag is-skipped-tag" title={fmtReset(status?.resetAtMs)}>当日已跳过{status?.resetAtMs ? ` · ${fmtReset(status.resetAtMs)} 解禁` : ''}</span>}
    {!invalid && !exhausted && <span className="smart-tag is-ok-tag">可用</span>}
    <span className="smart-pool-actions">
      <Button variant="ghost" size="sm" className="smart-move-btn" aria-label={`上移 ${modelId}`} title="上移"
        disabled={index === 0} onClick={() => onMove(index, -1)}><ArrowUp size={14} /></Button>
      <Button variant="ghost" size="sm" className="smart-move-btn" aria-label={`下移 ${modelId}`} title="下移"
        disabled={index === total - 1} onClick={() => onMove(index, 1)}><ArrowDown size={14} /></Button>
      <Button variant="ghost" size="sm" className="smart-remove-btn" aria-label={`从调度池移除 ${modelId}`} title="移除"
        onClick={() => onRemove(modelId)}><Trash2 size={14} /></Button>
    </span>
  </li>
}

export function Smart({ host, active }: { summary: Summary; stats: unknown; host: Host; active: boolean }) {
  const [view, setView] = useState<SmartState | undefined>(undefined)
  const [draft, setDraft] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const [candidateQuery, setCandidateQuery] = useState('')
  const [showDisabled, setShowDisabled] = useState(false)
  const [busyCandidate, setBusyCandidate] = useState<string | undefined>(undefined)
  const dirty = useRef(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const next = await host.smartState()
      setView(next)
      if (!dirty.current) setDraft(next.pool)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取智能调度状态失败，请重试。')
    } finally { setLoading(false) }
  }, [host])

  useEffect(() => { if (active && !view) void load() }, [active, view, load])

  const statusList = view?.statuses
  // 候选默认过滤已停用（FR-16.1）：停用条目不参与调度，不占候选位；恢复路径 =
  // 「显示已停用模型」开关（showDisabled，FR-16.2/D32），开启后灰显 + 仅「启用」动作。
  // 已下架（dead）与已在池内的条目始终过滤。
  const candidates = useMemo(() => {
    const query = candidateQuery.trim().toLowerCase()
    return (view?.candidates ?? [])
      .filter(row => row.dead !== true && !draft.includes(row.id))
      .filter(row => showDisabled || row.disabled !== true)
      .filter(row => query === '' || row.id.toLowerCase().includes(query) || row.provider.toLowerCase().includes(query)
        || (row.name ?? '').toLowerCase().includes(query))
  }, [view, draft, candidateQuery, showDisabled])
  const hiddenDisabledCount = useMemo(() => (view?.candidates ?? [])
    .filter(row => row.dead !== true && !draft.includes(row.id) && row.disabled === true).length, [view, draft])
  const poolRows = draft.map(modelId => ({
    modelId,
    status: statusOf(statusList, modelId),
    invalid: isInvalid(statusList, modelId),
  }))
  const hasChannel = (view?.candidates.length ?? 0) > 0 || draft.length > 0

  const add = (id: string) => { dirty.current = true; setDraft(previous => previous.includes(id) ? previous : [...previous, id]) }
  const remove = (id: string) => { dirty.current = true; setDraft(previous => previous.filter(row => row !== id)) }
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= draft.length) return
    const next = [...draft]
    ;[next[index], next[target]] = [next[target], next[index]]
    dirty.current = true
    setDraft(next)
  }
  // 行内启停（FR-13.4 唯一入口）：调 model.setDisabled RPC（经 /channels/rpc），
  // 成功后重读调度状态——停用的条目不再进入候选与调度，启用即恢复。
  const toggleDisabled = async (candidate: SmartCandidate, disabled: boolean) => {
    if (busyCandidate !== undefined) return
    setBusyCandidate(candidate.id)
    setError('')
    try {
      await host.setModelDisabled(candidate.provider, candidate.model, disabled)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新模型启停失败，请重试。')
    } finally {
      setBusyCandidate(undefined)
    }
  }
  const save = async () => {
    setSaving(true); setNotice(''); setError('')
    try {
      const next = await host.saveSmartPool(draft)
      dirty.current = false
      setView(next)
      setDraft(next.pool)
      setNotice('调度池已保存，顺序与勾选已持久化。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存调度池失败，请重试。')
    } finally { setSaving(false) }
  }
  const revert = () => {
    dirty.current = false
    setDraft(view?.pool ?? [])
    setNotice('')
  }

  if (!active) return null

  const changed = dirty.current && draft.join('\n') !== (view?.pool ?? []).join('\n')
  return <div className="smart-browser" data-testid="smart-ready">
    <header className="smart-header">
      <div className="smart-header-main">
        <h1><Sparkles size={20} className="smart-title-icon" aria-hidden="true" />智能调度</h1>
        <p className="smart-header-sub">把常用渠道模型排成一条调度链，客户端只需配置 <code>auto</code> 一个模型名。</p>
      </div>
      <div className="smart-header-status">
        <span className="smart-hit-chip" title={view?.hit ?? ''}>
          <span className="smart-hit-dot" aria-hidden="true" />
          当前 auto 命中：<strong>{view?.hit ?? '—'}</strong>
        </span>
        <span className="smart-alias-note">别名 <code>ourfreemodel</code> 与 <code>auto</code> 等价</span>
      </div>
    </header>

    <Card className="smart-note-card">
      <span className="smart-note-icon" aria-hidden="true"><Info size={16} /></span>
      <p><strong>auto 的接力语义：</strong>网关按调度池顺序优先调用第一个可用模型，其内部多账号轮换规则不变；
        某模型当日配额全部耗尽后自动落到下一个，且当天不再重复尝试已耗尽的模型；
        全池耗尽时返回 429 并附各模型解禁时刻；非配额错误（网络、5xx 等）不接力。</p>
    </Card>

    {error && <div className="notice error-notice" role="alert">{error}<button className="text-button" onClick={() => void load()}>重试</button></div>}
    {notice && <div className="notice" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>关闭</button></div>}

    {loading && !view ? <p className="smart-loading" role="status">正在读取调度池状态…</p> : !hasChannel ? (
      <Card className="smart-empty">
        <Sparkles size={22} aria-hidden="true" />
        <h2>还没有可调度的渠道模型</h2>
        <p>先到「账号渠道」页登录免费渠道，模型会出现在这里；渠道不可用时此页会显示降级空态，不会白屏。</p>
        <Button variant="outline" onClick={() => void load()}><RefreshCw size={14} />重新读取</Button>
      </Card>
    ) : <div className="smart-grid">
      <Card className="smart-candidates-card">
        <div className="smart-card-head">
          <h2>候选模型</h2>
          <p>来自账号渠道的模型目录（默认只列启用中的模型，已下架不展示）。绑定账号数与可用账号数实时推导。</p>
          <div className="smart-filter-row">
            <label className="smart-filter-field">
              <Search size={13} aria-hidden="true" />
              <input type="search" value={candidateQuery} placeholder={`筛选 ${candidates.length} 个候选（id / 渠道）`}
                aria-label="筛选候选模型" onChange={event => setCandidateQuery(event.target.value)} />
            </label>
            <span className={`smart-toggle-view${showDisabled ? ' is-on' : ''}`}>
              <Switch checked={showDisabled} onCheckedChange={setShowDisabled} aria-label="显示已停用模型" />
              {/* 文案独立成按钮：Switch 的 {...props} 展开在内部 onClick 之后，外层
                  传 onClick 会覆盖其切换逻辑——文字与开关各走各的点击面，互不冒泡。 */}
              <button type="button" className="smart-toggle-view-text"
                onClick={() => setShowDisabled(!showDisabled)}>
                显示已停用模型{hiddenDisabledCount > 0 && !showDisabled ? `（${hiddenDisabledCount}）` : ''}
              </button>
            </span>
          </div>
        </div>
        {candidates.length === 0 ? <p className="smart-candidates-empty" role="status">
          {candidateQuery ? '没有匹配筛选条件的候选。'
            : view?.candidates.length ? (showDisabled ? '目录中的模型都已在池内或已下架。' : '没有启用中的候选：已停用模型不参与调度，可打开「显示已停用模型」查看并恢复。')
              : '渠道目录暂无模型，可稍后重试。'}
          <Button variant="ghost" size="sm" onClick={() => void load()}><RefreshCw size={13} />刷新</Button>
        </p> : <ul className="smart-candidate-list">
          {candidates.map(row => <CandidateRow key={row.id} candidate={row} busy={busyCandidate === row.id} showDisabled={showDisabled} onAdd={add} onToggleDisabled={(candidate, disabled) => void toggleDisabled(candidate, disabled)} />)}
        </ul>}
      </Card>

      <Card className="smart-pool-card">
        <div className="smart-card-head">
          <h2>调度池（{draft.length}/32）</h2>
          <p>按从上到下的顺序接力。支持拖拽排序，也可用上移 / 下移按钮（键盘可达）。</p>
        </div>
        {draft.length === 0 ? <p className="smart-pool-empty">池为空：保存后 <code>auto</code> 会返回配置指引（HTTP 400）。从左侧候选模型加入。</p> : <>
          <ul className="smart-pool-list">
            {poolRows.map((row, index) => <PoolRow key={row.modelId}
              modelId={row.modelId} index={index} total={poolRows.length} statuses={statusList}
              dragging={dragging === index}
              onRemove={remove} onMove={move}
              onDragStart={setDragging}
              onDragOver={event => event.preventDefault()}
              onDrop={target => {
                const source = dragging
                setDragging(undefined)
                if (source === undefined || source === target) return
                const next = [...draft]
                const [moved] = next.splice(source, 1)
                next.splice(target, 0, moved)
                dirty.current = true
                setDraft(next)
              }}
              onDragEnd={() => setDragging(undefined)} />
            )}
          </ul>
          <div className="smart-save-row">
            <Button className="smart-save-btn" disabled={saving || !changed} onClick={() => void save()}>
              {saving ? '保存中…' : '保存调度池'}
            </Button>
            <Button variant="ghost" disabled={saving || !changed} onClick={revert}><X size={14} />还原</Button>
            {!changed && <span className="smart-save-hint">改动后可保存；保存到 settings.json，重启不丢。</span>}
          </div>
        </>}
      </Card>
    </div>}
  </div>
}
