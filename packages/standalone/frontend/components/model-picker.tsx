import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { Model } from '../types'

/**
 * 模型下拉选择器。
 *
 * 1. 面板使用 absolute 绝对定位悬浮展开，脱离文档流，不撑开卡片布局。
 * 2. 配合外层卡片 overflow: visible 与 clip-path: none 确保不被裁剪。
 * 3. 键盘可达：Esc 收起，点击外部收起，aria-expanded 回传。
 * 4. 增强：带快速筛选输入框与元信息彩色徽章。
 */
export function ModelPicker({ models, selectedId, channelName, capacity, onSelect }: {
  models: Model[]
  selectedId?: string
  channelName(id: string): string
  capacity(value?: number): string
  onSelect(id: string): void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const current = models.find(row => row.id === selectedId) ?? models[0]

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      channelName(m.channel).toLowerCase().includes(q)
    )
  }, [models, query, channelName])

  if (!current) return null

  return <div className={`cx-picker${open ? ' is-open' : ''}`} ref={root}>
    <button type="button" className={`cx-picker-trigger${open ? ' is-open' : ''}`}
      aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="cx-picker-current">
        <span className="cx-picker-header-line">
          <span className="cx-picker-name">{current.name}</span>
          <span className="cx-picker-tag-channel">{channelName(current.channel)}</span>
        </span>
        <code className="cx-picker-id">{current.id}</code>
      </span>
      <ChevronDown size={16} className="cx-picker-chevron" aria-hidden="true" />
    </button>
    {open && <div className="cx-picker-panel" role="listbox" aria-label="选择模型">
      <div className="cx-picker-panel-head">
        <div className="cx-picker-search-field">
          <Search size={13} className="cx-picker-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="cx-picker-search-input"
            placeholder={`搜索 ${models.length} 个模型 (名称/ID/通道)...`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onClick={e => e.stopPropagation()}
            autoFocus
          />
        </div>
        <button type="button" className="cx-picker-close" onClick={() => { setOpen(false); setQuery('') }}>收起</button>
      </div>
      <div className="cx-picker-list">
        {filtered.map(row => <button type="button" key={row.id} role="option" aria-selected={row.id === current.id}
          className={`cx-picker-item${row.id === current.id ? ' is-selected' : ''}`}
          onClick={() => { onSelect(row.id); setOpen(false); setQuery('') }}>
          <span className="cx-picker-mark" aria-hidden="true">{row.id === current.id && <Check size={14} />}</span>
          <span className="cx-picker-item-name">{row.name}</span>
          <code className="cx-picker-item-id">{row.id}</code>
          <span className="cx-picker-item-meta">
            <span className="cx-pill-channel">{channelName(row.channel)}</span>
            {row.contextWindow ? <span className="cx-pill-ctx">{capacity(row.contextWindow)}</span> : null}
            {row.vision ? <span className="cx-pill-cap is-vision">视觉</span> : null}
            {row.reasoning ? <span className="cx-pill-cap is-reasoning">思考</span> : null}
          </span>
        </button>)}
        {filtered.length === 0 && <div className="cx-picker-empty">无匹配模型</div>}
      </div>
    </div>}
  </div>
}
