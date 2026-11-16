import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button, Card } from './components/ui'
import type { ClaimsQuery, Host, Stats } from './types'
import './calendar.css'

const pad2 = (value: number) => String(value).padStart(2, '0')

/** 本地时区 dayKey（与 stats / claims 同口径，NFR-10）。 */
const dayKeyOf = (at: number | Date) => {
  const date = at instanceof Date ? at : new Date(at)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

const fmtTokens = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K` : String(value)

const fmtClock = (at: number) => {
  const date = new Date(at)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 天桶 token 合计：input+output+reasoning（FR-7.2），模型行缺失时退回天桶 total。 */
const dayTokenTotal = (day?: { total: number; models?: { input: number; output: number; reasoning: number }[] }) => {
  if (!day) return 0
  if (day.models && day.models.length > 0) {
    return day.models.reduce((sum, row) => sum + row.input + row.output + row.reasoning, 0)
  }
  return day.total ?? 0
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function Calendar({ stats, host, active }: { summary?: unknown; stats: Stats; host: Host; active: boolean }) {
  const [viewMonth, setViewMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1) })
  const [claims, setClaims] = useState<ClaimsQuery | undefined>(undefined)
  const [claimsError, setClaimsError] = useState('')
  const [claimsLoading, setClaimsLoading] = useState(false)
  const [hoverDay, setHoverDay] = useState<string | null>(null)
  const [drawerDay, setDrawerDay] = useState<string | null>(null)
  const [rovingDay, setRovingDay] = useState<string | null>(null)
  const todayKey = dayKeyOf(new Date())
  const gridRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)

  // 切月一次拉取整月领取历史（AC-19）：窗口 = 该月 1 日至月末。
  useEffect(() => {
    if (!active) return
    let alive = true
    const year = viewMonth.getFullYear()
    const month = viewMonth.getMonth()
    const from = `${year}-${pad2(month + 1)}-01`
    const last = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${pad2(month + 1)}-${pad2(last)}`
    setClaimsLoading(true)
    setClaimsError('')
    host.claimsHistory(from, to)
      .then(value => { if (alive) setClaims(value) })
      .catch(reason => { if (alive) setClaimsError(reason instanceof Error ? reason.message : '领取历史读取失败，请重试。') })
      .finally(() => { if (alive) setClaimsLoading(false) })
    return () => { alive = false }
  }, [active, viewMonth, host])

  const statsByDay = useMemo(() => new Map(stats.days.map(day => [day.day, day])), [stats])

  // 月网格：周一起始；null = 空占位格。
  const cells = useMemo(() => {
    const year = viewMonth.getFullYear()
    const month = viewMonth.getMonth()
    const total = new Date(year, month + 1, 0).getDate()
    const lead = (new Date(year, month, 1).getDay() + 6) % 7
    const list: (string | null)[] = Array.from({ length: lead }, () => null)
    for (let day = 1; day <= total; day++) list.push(`${year}-${pad2(month + 1)}-${pad2(day)}`)
    while (list.length % 7 !== 0) list.push(null)
    return list
  }, [viewMonth])

  // 领取区三态：数值 / 0 / 「无数据」（该日早于记录起始且无记录，FR-7.5）。
  const claimsStateOf = (key: string): 'data' | 'zero' | 'unknown' => {
    if (claims?.days[key]) return 'data'
    if (claims?.since && key >= claims.since) return 'zero'
    return 'unknown'
  }

  const drawerClaims = drawerDay ? claims?.days[drawerDay] : undefined
  const drawerStats = drawerDay ? statsByDay.get(drawerDay) : undefined
  const drawerModels = useMemo(() => (drawerStats?.models ?? [])
    .map(row => ({ ...row, tokens: row.input + row.output + row.reasoning }))
    .sort((left, right) => right.tokens - left.tokens), [drawerStats])

  // roving tabindex：方向键按周网格移动焦点（仅活跃格 tabIndex=0，NFR-7 键盘可达）
  const focusCell = (key: string) => {
    setRovingDay(key)
    requestAnimationFrame(() => {
      const cell = gridRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)
      cell?.focus()
    })
  }
  const moveRoving = (key: string, deltaDays: number) => {
    const date = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) + deltaDays)
    const next = dayKeyOf(date)
    if (next.slice(0, 7) !== `${viewMonth.getFullYear()}-${pad2(viewMonth.getMonth() + 1)}`) return
    focusCell(next)
  }
  const onCellKeyDown = (key: string) => (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDrawerDay(key); return }
    const deltas: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }
    if (deltas[event.key] !== undefined) { event.preventDefault(); moveRoving(key, deltas[event.key]) }
  }

  // 真 modal（FR-7.4/NFR-7）：Esc 关闭、Tab 圈禁、打开聚焦抽屉、关闭归还触发格
  useEffect(() => {
    if (!drawerDay) return
    lastFocusedRef.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => drawerRef.current?.focus())
    const drawer = drawerRef.current
    if (!drawer) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawerDay(null); return }
      if (event.key !== 'Tab') return
      const focusables = Array.from(drawer.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'))
      if (focusables.length === 0) { event.preventDefault(); return }
      const first = focusables[0], last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    drawer.addEventListener('keydown', onKeyDown)
    return () => drawer.removeEventListener('keydown', onKeyDown)
  }, [drawerDay])
  useEffect(() => {
    if (drawerDay === null && lastFocusedRef.current) { lastFocusedRef.current.focus(); lastFocusedRef.current = null }
  }, [drawerDay])

  // 月份切换后 roving 焦点回落到当月锚点（今天在当月用今天，否则 1 日）
  useEffect(() => {
    const monthKey = `${viewMonth.getFullYear()}-${pad2(viewMonth.getMonth() + 1)}`
    setRovingDay(current => current && current.startsWith(monthKey) ? current
      : todayKey.startsWith(monthKey) ? todayKey : `${monthKey}-01`)
  }, [viewMonth, todayKey])

  if (!active) return null

  const monthLabel = `${viewMonth.getFullYear()} 年 ${viewMonth.getMonth() + 1} 月`
  const future = (key: string) => key > todayKey

  return <div className="calendar-browser" data-testid="calendar-ready">
    <header className="calendar-header">
      <div className="calendar-header-main">
        <h1><CalendarDays size={20} className="calendar-title-icon" aria-hidden="true" />用量日历</h1>
        <p className="calendar-header-sub">每天一格：各模型 token 消耗与完成领取的渠道数。领取历史从功能上线起记录，此前的日期如实标注「无数据」。</p>
      </div>
      <div className="calendar-month-nav">
        <Button variant="ghost" aria-label="上个月" title="上个月" onClick={() => setViewMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>
          <ChevronLeft size={16} />
        </Button>
        <span className="calendar-month-label">{monthLabel}</span>
        <Button variant="ghost" aria-label="下个月" title="下个月" onClick={() => setViewMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>
          <ChevronRight size={16} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => { const now = new Date(); setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1)) }}>今天</Button>
      </div>
    </header>

    {claimsError && <div className="notice error-notice" role="alert">{claimsError}<button className="text-button" onClick={() => setViewMonth(current => new Date(current))}>重试</button></div>}
    {claimsLoading && <p className="calendar-loading" role="status">正在读取领取历史…</p>}

    <Card className="calendar-card">
      <div className="calendar-week-labels" aria-hidden="true">
        {WEEK_LABELS.map((label, index) => <span key={label} className={`calendar-week-label${index >= 5 ? ' is-weekend' : ''}`}>{label}</span>)}
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${monthLabel}用量日历`} ref={gridRef}>
        {cells.map((key, index) => {
          const weekend = index % 7 >= 5
          if (key === null) return <div key={`blank-${index}`} className="calendar-cell is-blank" role="gridcell" aria-hidden="true" />
          const dayNumber = Number(key.slice(8, 10))
          const statRow = statsByDay.get(key)
          const tokens = dayTokenTotal(statRow)
          const modelCount = statRow?.models?.length ?? 0
          const isFuture = future(key)
          const isToday = key === todayKey
          const claimsState = claimsStateOf(key)
          const claimDay = claims?.days[key]
          const isSelected = drawerDay === key
          return <div key={key}
            role="gridcell"
            data-day={key}
            aria-selected={rovingDay === key}
            className={`calendar-cell${isFuture ? ' is-future' : ''}${isToday ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}${isSelected ? ' is-selected' : ''}${tokens > 0 || claimDay ? ' has-data' : ''}`}
            aria-label={`${key}：token ${tokens}，模型 ${modelCount} 个${isFuture ? '，未来日期' : ''}`}
            {...isFuture ? {} : {
              tabIndex: rovingDay === key ? 0 : -1,
              onClick: () => setDrawerDay(key),
              onMouseEnter: () => setHoverDay(key),
              onMouseLeave: () => setHoverDay(current => current === key ? null : current),
              onFocus: () => { setHoverDay(key); setRovingDay(key) },
              onBlur: () => setHoverDay(current => current === key ? null : current),
              onKeyDown: onCellKeyDown(key),
            }}>
            <span className="calendar-cell-day">{dayNumber}</span>
            {tokens > 0 && <span className="calendar-cell-tokens">{fmtTokens(tokens)}</span>}
            {modelCount > 0 && <span className="calendar-cell-models">{modelCount} 模型</span>}
            {!isFuture && <span className={`calendar-cell-claims is-${claimsState}`}>
              {claimsState === 'data' ? `${claimDay?.claimedCount ?? 0} 渠道领取` : claimsState === 'zero' ? '0 渠道领取' : '无数据'}
            </span>}
            {hoverDay === key && !isFuture && <div className="calendar-hover-card" role="tooltip">
              <strong>{key}{isToday ? ' · 今天' : ''}</strong>
              {tokens > 0 ? <>
                <span className="calendar-hover-line">token 合计 {tokens.toLocaleString()}</span>
                {(statRow?.models ?? []).slice(0, 6).map(row => <span key={row.model} className="calendar-hover-line">
                  {row.model}：{(row.input + row.output + row.reasoning).toLocaleString()}
                </span>)}
                {(statRow?.models?.length ?? 0) > 6 && <span className="calendar-hover-line">…共 {statRow?.models?.length} 个模型</span>}
              </> : <span className="calendar-hover-line">当日无 token 消耗</span>}
              <span className="calendar-hover-sep" aria-hidden="true" />
              {claimsState === 'data' ? <>
                <span className="calendar-hover-line">领取渠道 {claimDay?.claimedCount ?? 0} 个</span>
                {(claimDay?.events ?? []).slice(0, 4).map((event, order) => <span key={`${event.provider}-${order}`} className="calendar-hover-line">
                  {event.provider}：{event.text}
                </span>)}
                {(claimDay?.events.length ?? 0) > 4 && <span className="calendar-hover-line">…共 {claimDay?.events.length} 条记录</span>}
              </> : claimsState === 'zero' ? <span className="calendar-hover-line">当日无渠道领取</span>
                : <span className="calendar-hover-line">领取无数据（记录开始前）</span>}
              <span className="calendar-hover-hint">点击查看全天详情</span>
            </div>}
          </div>
        })}
      </div>
      <p className="calendar-legend">
        <span><span className="calendar-dot is-tokens" aria-hidden="true" />token 消耗</span>
        <span><span className="calendar-dot is-claims" aria-hidden="true" />渠道领取</span>
        <span>领取历史自功能上线起记录；悬停看明细，点击打开全天抽屉。</span>
      </p>
    </Card>

    {drawerDay && <div className="calendar-drawer-root" role="dialog" aria-modal="true" aria-label={`${drawerDay} 全天详情`}>
      <div className="calendar-drawer-backdrop" onClick={() => setDrawerDay(null)} />
      <aside className="calendar-drawer" ref={drawerRef} tabIndex={-1}>
        <header className="calendar-drawer-head">
          <h2>{drawerDay}{drawerDay === todayKey ? ' · 今天' : ''}</h2>
          <Button variant="ghost" aria-label="关闭详情" onClick={() => setDrawerDay(null)}><X size={16} /></Button>
        </header>
        <div className="calendar-drawer-body">
          <section className="calendar-drawer-section">
            <h3>token 明细</h3>
            {drawerModels.length === 0 ? <p className="calendar-drawer-empty">当日无 token 消耗。</p> : <>
              <ul className="calendar-model-rows">
                {drawerModels.map(row => <li key={row.model} className="calendar-model-row">
                  <span className="calendar-model-id" title={row.model}>{row.model}</span>
                  <span className="calendar-model-nums">
                    <span>{row.tokens.toLocaleString()} tok</span>
                    <span className="calendar-model-calls">{row.calls} 次</span>
                  </span>
                </li>)}
              </ul>
              <div className="calendar-sum-row">
                <span>当日合计</span>
                <span>{drawerModels.reduce((sum, row) => sum + row.tokens, 0).toLocaleString()} tok · {drawerModels.reduce((sum, row) => sum + row.calls, 0)} 次</span>
              </div>
            </>}
          </section>
          <section className="calendar-drawer-section">
            <h3>渠道领取明细</h3>
            {!drawerClaims ? <p className="calendar-drawer-empty">无数据：该日早于领取历史记录开始{claims?.since ? `（${claims.since} 起）` : ''}，无法回补。</p>
              : drawerClaims.events.length === 0 ? <p className="calendar-drawer-empty">当日无渠道领取记录。</p> : <>
                <ul className="calendar-claim-rows">
                  {drawerClaims.events.map((event, order) => <li key={`${event.provider}-${event.at}-${order}`} className="calendar-claim-row">
                    <span className="calendar-claim-provider">{event.provider}</span>
                    <span className="calendar-claim-text">{event.text}</span>
                    <span className="calendar-claim-meta">
                      <span className={`calendar-claim-tag is-${event.source}`}>{event.source === 'auto' ? '自动' : '手动'}</span>
                      {event.amount !== undefined && <span className="calendar-claim-amount">+{event.amount}{event.unit ? ` ${event.unit}` : ''}</span>}
                      <span className="calendar-claim-time">{fmtClock(event.at)}</span>
                    </span>
                  </li>)}
                </ul>
                <div className="calendar-sum-row">
                  <span>领取渠道</span>
                  <span>{drawerClaims.claimedCount} 个成功 · {drawerClaims.providers.length} 个有记录</span>
                </div>
              </>}
          </section>
        </div>
      </aside>
    </div>}
  </div>
}
