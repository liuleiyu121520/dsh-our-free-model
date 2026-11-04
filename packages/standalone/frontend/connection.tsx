import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Bot,
  Cable,
  Check,
  CircleCheck,
  Clock,
  Code2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LockKeyhole,
  Play,
  RotateCcw,
  ShieldAlert,
  Terminal,
  X,
  Zap,
} from 'lucide-react'
import { providers } from 'ofm-provider-list'
import { Badge, Button, Card, Spinner, Switch } from './components/ui'
import { ModelPicker } from './components/model-picker'
import type { Host, Summary } from './types'
import './connection.css'

/** 渠道 id → 展示名。与模型页同源。 */
const channelName = (id: string) => {
  const known: Record<string, string> = { anonymous: '匿名模型', kilo: 'Kilo 免费池', eac: 'EAC 协付' }
  return known[id] ?? providers.find(provider => provider.id === id)?.name ?? id
}

const capacity = (value?: number) => value && Number.isFinite(value) && value > 0
  ? value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(value) : '未知'

type TabType = 'curl' | 'python' | 'node' | 'presets'

interface TestResult {
  ok: boolean
  status: number
  duration: number
  content?: string
  error?: string
}

export function Connection({ summary, host, active }: { summary: Summary; host: Host; active: boolean }) {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [tab, setTab] = useState<TabType>('curl')
  const [fillKey, setFillKey] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [modelFlashing, setModelFlashing] = useState(false)

  // 模型选择：留空时自动落到第一个可接入的模型。
  const [picked, setPicked] = useState('')
  const routable = useMemo(() => summary.catalog.filter(row => row.routable), [summary.catalog])
  const selected = routable.find(row => row.id === picked) ?? routable[0]

  // 目录刷新后原选择可能消失：把 picked 校正回实际存在的 id
  useEffect(() => {
    if (picked !== '' && !routable.some(row => row.id === picked)) setPicked('')
  }, [picked, routable])

  // 当选择模型变动时，触发代码区域中模型 ID 的脉冲高光
  const prevSelectedId = useRef(selected?.id)
  useEffect(() => {
    if (selected?.id && selected.id !== prevSelectedId.current) {
      prevSelectedId.current = selected.id
      setModelFlashing(true)
      const timer = window.setTimeout(() => setModelFlashing(false), 700)
      return () => window.clearTimeout(timer)
    }
  }, [selected?.id])

  if (!active) return null

  const endpoint = `${summary.baseUrl}/v1`
  const model = selected?.id ?? 'MODEL_ID'
  const effectiveKey = fillKey && apiKey ? apiKey : 'YOUR_API_KEY'

  // 代码示例生成
  const curlCode = `curl -X POST ${summary.baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${effectiveKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [
      {
        "role": "user",
        "content": "你好，请用一句话介绍你自己。"
      }
    ]
  }'`

  const pythonCode = `from openai import OpenAI

# 初始化客户端，指向本地聚合网关
client = OpenAI(
    base_url="${endpoint}",
    api_key="${effectiveKey}",
)

completion = client.chat.completions.create(
    model="${model}",
    messages=[
        {"role": "user", "content": "你好，请用一句话介绍你自己。"},
    ],
)

print(completion.choices[0].message.content)`

  const nodeCode = `import OpenAI from 'openai'

// 初始化客户端，指向本地聚合网关
const client = new OpenAI({
  baseURL: '${endpoint}',
  apiKey: '${effectiveKey}',
})

const completion = await client.chat.completions.create({
  model: '${model}',
  messages: [{ role: 'user', content: '你好，请用一句话介绍你自己。' }],
})

console.log(completion.choices[0].message.content)`

  const currentCode = tab === 'curl' ? curlCode : tab === 'python' ? pythonCode : nodeCode

  const run = async (action: () => Promise<void>, message = '') => {
    setBusy(true); setNotice(''); setError('')
    try { await action(); if (message) setNotice(message) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试。') }
    finally { setBusy(false) }
  }

  const copy = async (id: string, text: string, message: string) => run(async () => {
    await host.copy(text)
    setCopied(id)
    window.setTimeout(() => setCopied(current => current === id ? '' : current), 1600)
  }, message)

  const toggleKey = () => void run(async () => {
    if (apiKey) { setApiKey(''); return }
    const loadedKey = await host.getApiKey()
    setApiKey(loadedKey)
  })

  const rotate = () => {
    if (!window.confirm('轮换后旧 API Key 会立即失效，确认继续吗？')) return
    void run(async () => setApiKey(await host.rotateKey()), '密钥已轮换，请更新所有客户端配置。')
  }

  // 当用户勾选"填入真实密钥"但当前密钥尚未加载时，自动拉取
  const handleFillKeyToggle = async (checked: boolean) => {
    setFillKey(checked)
    if (checked && !apiKey) {
      try {
        const key = await host.getApiKey()
        setApiKey(key)
      } catch {
        // 静默失败，保持占位符
      }
    }
  }

  // 在线即时测试请求
  const handleRunTest = async () => {
    setTesting(true)
    setTestResult(null)
    const startTime = Date.now()
    try {
      let key = apiKey
      if (!key) {
        key = await host.getApiKey()
        setApiKey(key)
      }
      const response = await fetch(`${summary.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '你好，请用一句话介绍你自己。' }],
        }),
      })
      const duration = Date.now() - startTime
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setTestResult({
          ok: false,
          status: response.status,
          duration,
          error: data?.error?.message || data?.error || `HTTP ${response.status}`,
        })
      } else {
        const reply = data?.choices?.[0]?.message?.content || JSON.stringify(data)
        setTestResult({
          ok: true,
          status: response.status,
          duration,
          content: reply,
        })
      }
    } catch (err) {
      setTestResult({
        ok: false,
        status: 0,
        duration: Date.now() - startTime,
        error: err instanceof Error ? err.message : '网络请求失败，请检查服务是否仍在运行。',
      })
    } finally {
      setTesting(false)
    }
  }

  return <div className="connection-browser" data-testid="connection-ready">
    {/* 页头：标题与实时服务状态徽章 */}
    <header className="cx-header">
      <div className="cx-header-main">
        <h1>API 接入与调用示例</h1>
        <p className="cx-header-sub">标准 OpenAI 兼容协议。将聚合的本地与多通道大模型直接接入你的 IDE、终端与应用。</p>
      </div>
      <div className="cx-status-pill">
        <span className="cx-status-dot" aria-hidden="true" />
        <span>本地网关活跃 · {summary.baseUrl}/v1</span>
      </div>
    </header>

    {notice && <p className="connection-feedback" role="status"><CircleCheck size={15} />{notice}</p>}
    {error && <p className="connection-error" role="alert"><ShieldAlert size={16} />{error}</p>}

    {/* 上半部分：连接凭据与目标模型卡片并排 */}
    <div className="cx-top-grid">
      {/* 凭据卡片 */}
      <Card className="cx-card">
        <div className="cx-card-head">
          <span className="cx-card-icon"><KeyRound size={17} /></span>
          <div className="cx-card-titles">
            <h2>连接凭据</h2>
            <p>管理会话与推理密钥隔离存储。</p>
          </div>
        </div>

        <div className="cx-field-group">
          <div className="cx-field-item">
            <div className="cx-field-label-row">
              <label htmlFor="connection-endpoint">API Base URL</label>
              <span className="cx-field-tag">OpenAI v1 兼容</span>
            </div>
            <div className="copy-field">
              <div className="cx-input-wrap">
                <Link2 size={14} aria-hidden="true" />
                <input id="connection-endpoint" readOnly value={endpoint} />
              </div>
              <Button
                variant="outline"
                className={copied === 'endpoint' ? 'cx-copied' : undefined}
                disabled={busy}
                onClick={() => void copy('endpoint', endpoint, '地址已复制。')}
              >
                {copied === 'endpoint' ? <Check size={14} /> : <Copy size={14} />}复制地址
              </Button>
            </div>
          </div>

          <div className="cx-field-item">
            <div className="cx-field-label-row">
              <label htmlFor="connection-key">API Key</label>
              <span className="cx-field-tag">Bearer 密钥</span>
            </div>
            <div className="copy-field">
              <div className={`cx-input-wrap${apiKey ? ' cx-revealed' : ''}`}>
                <LockKeyhole size={14} aria-hidden="true" />
                <input
                  id="connection-key"
                  type={apiKey ? 'text' : 'password'}
                  readOnly
                  value={apiKey}
                  placeholder="点击查看后显示"
                />
              </div>
              <Button variant="outline" disabled={busy} onClick={toggleKey}>
                {apiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                {apiKey ? '隐藏密钥' : '查看密钥'}
              </Button>
              <Button
                variant="outline"
                className={copied === 'key' ? 'cx-copied' : undefined}
                disabled={!apiKey || busy}
                onClick={() => void copy('key', apiKey, '密钥已复制。')}
              >
                {copied === 'key' ? <Check size={14} /> : <Copy size={14} />}复制
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* 目标模型卡片 */}
      <Card className="cx-card">
        <div className="cx-card-head">
          <span className="cx-card-icon"><Cable size={17} /></span>
          <div className="cx-card-titles">
            <h2>目标模型</h2>
            <p>{routable.length > 0 ? `共 ${routable.length} 个模型已接入，选中后下方示例即时响应。` : '暂无可用模型，请先在渠道页登录。'}</p>
          </div>
        </div>

        {routable.length > 0 && <ModelPicker
          models={routable}
          selectedId={selected?.id}
          channelName={channelName}
          capacity={capacity}
          onSelect={setPicked}
        />}

        {selected && <div className="cx-active-model-box">
          <div className="cx-active-row">
            <span className="cx-active-name" title={selected.name}>{selected.name}</span>
            <Button
              variant="ghost"
              size="sm"
              title="复制当前模型 ID"
              className={copied === 'model-id' ? 'cx-copied' : undefined}
              onClick={() => void copy('model-id', selected.id, '模型 ID 已复制。')}
            >
              {copied === 'model-id' ? <Check size={12} /> : <Copy size={12} />}
              复制 ID
            </Button>
          </div>
          <div className="cx-active-badges">
            <span className="cx-pill-channel">{channelName(selected.channel)}</span>
            {selected.contextWindow ? <span className="cx-pill-ctx">{capacity(selected.contextWindow)} 上下文</span> : null}
            {selected.vision ? <span className="cx-pill-cap is-vision">视觉支持</span> : null}
            {selected.reasoning ? <span className="cx-pill-cap is-reasoning">深度思考</span> : null}
          </div>
        </div>}
      </Card>
    </div>

    {/* 下半部分：调用示例与即时测试工作室 */}
    <Card className="cx-studio-card">
      <div className="cx-studio-toolbar">
        {/* 语言/配置选项卡 */}
        <div className="cx-tabs-group" role="tablist" aria-label="代码示例语言">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'curl'}
            className={`cx-tab-btn${tab === 'curl' ? ' is-active' : ''}`}
            onClick={() => setTab('curl')}
          >
            <Terminal size={14} /> cURL
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'python'}
            className={`cx-tab-btn${tab === 'python' ? ' is-active' : ''}`}
            onClick={() => setTab('python')}
          >
            <Code2 size={14} /> Python
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'node'}
            className={`cx-tab-btn${tab === 'node' ? ' is-active' : ''}`}
            onClick={() => setTab('node')}
          >
            <Zap size={14} /> Node.js
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'presets'}
            className={`cx-tab-btn${tab === 'presets' ? ' is-active' : ''}`}
            onClick={() => setTab('presets')}
          >
            <Bot size={14} /> 客户端配置
          </button>
        </div>

        {/* 动作群：填入真实密钥开关、运行测试、复制 */}
        <div className="cx-tools-group">
          {tab !== 'presets' && <label className="cx-key-toggle-label">
            <input
              type="checkbox"
              checked={fillKey}
              onChange={e => void handleFillKeyToggle(e.target.checked)}
            />
            <span>填入真实密钥</span>
          </label>}

          {tab !== 'presets' && <Button
            className="cx-run-btn"
            disabled={testing || !selected}
            onClick={handleRunTest}
          >
            {testing ? <Spinner /> : <Play size={13} fill="currentColor" />}
            {testing ? '调用中…' : '即时测试'}
          </Button>}

          <Button
            variant="outline"
            className={copied === 'example' ? 'cx-copied' : undefined}
            disabled={busy}
            onClick={() => void copy('example', currentCode, '示例已复制。')}
          >
            {copied === 'example' ? <Check size={14} /> : <Copy size={14} />}
            复制示例
          </Button>
        </div>
      </div>

      {tab !== 'presets' ? (
        <div className="cx-editor-frame">
          <div className="cx-editor-header">
            <div className="cx-editor-dots">
              <span className="cx-dot-red" />
              <span className="cx-dot-yellow" />
              <span className="cx-dot-green" />
            </div>
            <span className="cx-editor-filename">
              {tab === 'curl' ? 'terminal · bash' : tab === 'python' ? 'app.py · python' : 'client.ts · node'}
            </span>
            <span className="cx-editor-filename">{selected?.name ?? model}</span>
          </div>

          {/* 格式化带语法高亮的代码 */}
          <pre className="connection-example cx-code">
            {tab === 'curl' && <>
              <span className="tok-cmd">curl</span> <span className="tok-flag">-X</span> <span className="tok-method">POST</span> {summary.baseUrl}/v1/chat/completions \<br />
              {'  '}<span className="tok-flag">-H</span> <span className="tok-str">"Authorization: Bearer <span className="tok-key">{effectiveKey}</span>"</span> \<br />
              {'  '}<span className="tok-flag">-H</span> <span className="tok-str">"Content-Type: application/json"</span> \<br />
              {'  '}<span className="tok-flag">-d</span> <span className="tok-str">'&#123;</span><br />
              {'    '}<span className="tok-json-k">"model"</span>: <span className="tok-str">"<span className={`tok-model${modelFlashing ? ' is-flashing' : ''}`}>{model}</span>"</span>,<br />
              {'    '}<span className="tok-json-k">"messages"</span>: [<br />
              {'      '}&#123;<br />
              {'        '}<span className="tok-json-k">"role"</span>: <span className="tok-str">"user"</span>,<br />
              {'        '}<span className="tok-json-k">"content"</span>: <span className="tok-str">"你好，请用一句话介绍你自己。"</span><br />
              {'      '}&#125;<br />
              {'    '}]<br />
              {'  '}<span className="tok-str">&#125;'</span>
            </>}

            {tab === 'python' && <>
              <span className="tok-kw">from</span> openai <span className="tok-kw">import</span> <span className="tok-fn">OpenAI</span><br /><br />
              <span className="tok-comment"># 初始化客户端，指向本地聚合网关</span><br />
              client = <span className="tok-fn">OpenAI</span>(<br />
              {'    '}base_url=<span className="tok-str">"{endpoint}"</span>,<br />
              {'    '}api_key=<span className="tok-str">"<span className="tok-key">{effectiveKey}</span>"</span>,<br />
              )<br /><br />
              completion = client.chat.completions.<span className="tok-fn">create</span>(<br />
              {'    '}model=<span className="tok-str">"<span className={`tok-model${modelFlashing ? ' is-flashing' : ''}`}>{model}</span>"</span>,<br />
              {'    '}messages=[<br />
              {'        '}&#123;<span className="tok-str">"role"</span>: <span className="tok-str">"user"</span>, <span className="tok-str">"content"</span>: <span className="tok-str">"你好，请用一句话介绍你自己。"</span>&#125;,<br />
              {'    '}],<br />
              )<br /><br />
              <span className="tok-kw">print</span>(completion.choices[0].message.content)
            </>}

            {tab === 'node' && <>
              <span className="tok-kw">import</span> <span className="tok-fn">OpenAI</span> <span className="tok-kw">from</span> <span className="tok-str">'openai'</span><br /><br />
              <span className="tok-comment">// 初始化客户端，指向本地聚合网关</span><br />
              <span className="tok-kw">const</span> client = <span className="tok-kw">new</span> <span className="tok-fn">OpenAI</span>(&#123;<br />
              {'  '}baseURL: <span className="tok-str">'{endpoint}'</span>,<br />
              {'  '}apiKey: <span className="tok-str">'<span className="tok-key">{effectiveKey}</span>'</span>,<br />
              &#125;)<br /><br />
              <span className="tok-kw">const</span> completion = <span className="tok-kw">await</span> client.chat.completions.<span className="tok-fn">create</span>(&#123;<br />
              {'  '}model: <span className="tok-str">'<span className={`tok-model${modelFlashing ? ' is-flashing' : ''}`}>{model}</span>'</span>,<br />
              {'  '}messages: [&#123; role: <span className="tok-str">'user'</span>, content: <span className="tok-str">'你好，请用一句话介绍你自己。'</span> &#125;],<br />
              &#125;)<br /><br />
              <span className="tok-kw">console</span>.<span className="tok-fn">log</span>(completion.choices[0].message.content)
            </>}
          </pre>

          {/* 即时测试响应抽屉 */}
          {(testing || testResult) && <div className="cx-test-drawer">
            <div className="cx-test-header">
              <div className="cx-test-meta">
                {testResult ? (
                  <span className={`cx-test-badge ${testResult.ok ? 'is-ok' : 'is-err'}`}>
                    {testResult.ok ? '✓ 200 OK' : `✕ ${testResult.status || 'ERROR'}`}
                  </span>
                ) : (
                  <span className="cx-test-badge is-ok">
                    <Spinner /> 正在推理…
                  </span>
                )}
                {testResult && <span className="cx-test-duration">
                  <Clock size={12} /> {testResult.duration} ms
                </span>}
              </div>
              {testResult && <button
                type="button"
                className="cx-test-close"
                onClick={() => setTestResult(null)}
              >
                <X size={14} /> 关闭
              </button>}
            </div>

            <div className="cx-test-body">
              {testing && <div className="cx-test-loading">
                <Spinner /> 本地网关正在路由请求至「{selected?.name}」…
              </div>}
              {testResult?.content && <div className="cx-test-reply">
                {testResult.content}
              </div>}
              {testResult?.error && <div className="cx-test-error">
                {testResult.error}
              </div>}
            </div>
          </div>}
        </div>
      ) : (
        /* 客户端预设视图 */
        <div className="cx-presets-view">
          <div className="cx-presets-grid">
            {/* Cursor / Windsurf */}
            <div className="cx-preset-card">
              <div className="cx-preset-title">
                <span>Cursor / Windsurf</span>
                <Badge tone="blue">IDE 插件</Badge>
              </div>
              <div className="cx-preset-row">
                <span className="cx-preset-lbl">Override OpenAI Base URL</span>
                <div className="cx-preset-val-row">
                  <code>{endpoint}</code>
                  <button type="button" className="cx-preset-copy-btn" onClick={() => void copy('preset-cursor-url', endpoint, 'Base URL 已复制')}>
                    <Copy size={13} />
                  </button>
                </div>
              </div>
              <div className="cx-preset-row">
                <span className="cx-preset-lbl">API Key</span>
                <div className="cx-preset-val-row">
                  <code>{apiKey || '需先在上方查看并复制'}</code>
                  <button type="button" className="cx-preset-copy-btn" disabled={!apiKey} onClick={() => void copy('preset-cursor-key', apiKey, 'API Key 已复制')}>
                    <Copy size={13} />
                  </button>
                </div>
              </div>
              <div className="cx-preset-row">
                <span className="cx-preset-lbl">Model ID</span>
                <div className="cx-preset-val-row">
                  <code>{model}</code>
                  <button type="button" className="cx-preset-copy-btn" onClick={() => void copy('preset-cursor-model', model, 'Model ID 已复制')}>
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            </div>

            {/* Cline / Roo Code */}
            <div className="cx-preset-card">
              <div className="cx-preset-title">
                <span>Cline / Roo Code</span>
                <Badge tone="success">智能体</Badge>
              </div>
              <div className="cx-preset-row">
                <span className="cx-preset-lbl">API Provider</span>
                <div className="cx-preset-val-row">
                  <code>OpenAI Compatible</code>
                </div>
              </div>
              <div className="cx-preset-row">
                <span className="cx-preset-lbl">Base URL</span>
                <div className="cx-preset-val-row">
                  <code>{endpoint}</code>
                  <button type="button" className="cx-preset-copy-btn" onClick={() => void copy('preset-cline-url', endpoint, 'Base URL 已复制')}>
                    <Copy size={13} />
                  </button>
                </div>
              </div>
              <div className="cx-preset-row">
                <span className="cx-preset-lbl">Model ID</span>
                <div className="cx-preset-val-row">
                  <code>{model}</code>
                  <button type="button" className="cx-preset-copy-btn" onClick={() => void copy('preset-cline-model', model, 'Model ID 已复制')}>
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            </div>

            {/* Chatbox / NextChat */}
            <div className="cx-preset-card">
              <div className="cx-preset-title">
                <span>Chatbox / NextChat</span>
                <Badge tone="warning">对话客户端</Badge>
              </div>
              <div className="cx-preset-row">
                <span className="cx-preset-lbl">模型服务商</span>
                <div className="cx-preset-val-row">
                  <code>OpenAI API (自定义)</code>
                </div>
              </div>
              <div className="cx-preset-row">
                <span className="cx-preset-lbl">API 域名</span>
                <div className="cx-preset-val-row">
                  <code>{summary.baseUrl}</code>
                  <button type="button" className="cx-preset-copy-btn" onClick={() => void copy('preset-chatbox-url', summary.baseUrl, 'API 域名已复制')}>
                    <Copy size={13} />
                  </button>
                </div>
              </div>
              <div className="cx-preset-row">
                <span className="cx-preset-lbl">模型名称</span>
                <div className="cx-preset-val-row">
                  <code>{model}</code>
                  <button type="button" className="cx-preset-copy-btn" onClick={() => void copy('preset-chatbox-model', model, '模型名称已复制')}>
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>

    {/* 危险操作：密钥轮换 */}
    <Card className="connection-card connection-danger">
      <div className="connection-card-heading">
        <span className="cx-icon cx-icon-danger"><ShieldAlert size={16} /></span>
        <div>
          <h2>轮换 API Key</h2>
          <p>轮换后旧密钥立即失效，需要更新所有客户端。</p>
        </div>
      </div>
      <Button
        variant="outline"
        className="cx-danger-btn"
        disabled={busy}
        onClick={rotate}
      >
        <RotateCcw size={15} />轮换密钥
      </Button>
    </Card>
  </div>
}
