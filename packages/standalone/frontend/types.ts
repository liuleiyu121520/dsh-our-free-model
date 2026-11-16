export type Page = 'overview' | 'workspace' | 'agents' | 'providers' | 'library' | 'routing' | 'models' | 'usage' | 'channels' | 'eac' | 'settings' | 'updates' | 'connection' | 'requests' | 'smart'
export interface Model {
  id: string
  name: string
  channel: string
  routable: boolean
  hiddenByUser?: boolean
  hiddenByGroup?: boolean
  vision?: boolean
  reasoning?: boolean
  contextWindow?: number
  maxOutput?: number
  availabilitySource?: 'listing' | 'probe' | 'manual'
  detail?: string
  probedAt?: number
  latencyMs?: number
  availability?: string
  ttftMs?: number | null
}
export interface ModelTestResult { ok: boolean; text: string; latencyMs: number; ttftMs?: number; persisted?: boolean }
export interface ServiceSettings {
  enabled: boolean
  exposeRegionModels: boolean
  hiddenModelIds: string[]
  hideFreeModels: boolean
  hideEacModels: boolean
  streamRecovery: boolean
  standaloneProbe: boolean
  probeIntervalMinutes: number
  defaultMaxTokens: number
  /** 首次启动的「导入 DSH 账号」提示是否已问过。 */
  dshImportAsked?: boolean
}
export interface Summary {
  version: string
  baseUrl: string
  dataDir: string
  networkMode: string
  automaticRefresh: boolean
  /** 精简页面：只显示模型、渠道与网关三页。缺省视为 false。 */
  lite?: boolean
  catalogSyncedAt: number
  settings: ServiceSettings
  channels: { state: string; error?: string }
  eacAuth?: { local?: boolean; authorized?: boolean; login?: string }
  /** 智能调度徽标：池内模型数与当前可用（未当日耗尽）数。 */
  smart?: { pool: number; available: number }
  catalog: Model[]
}
export interface Stats {
  requests: number
  requestFailures: number
  requestFailuresEstimated?: boolean
  logicalEstimated?: boolean
  turns: number
  failedTurns: number
  recoveredTurns: number
  days: { day: string; total: number; models?: { model: string; input: number; output: number; reasoning: number; calls: number }[] }[]
  grand: { input: number; output: number; reasoning: number }
  models: UsageModel[]
  samples: { model?: string; ok?: boolean; error?: string; at?: number; ms?: number }[]
}
/** 智能调度：候选清单条目（GET /smart/state）。 */
export interface SmartCandidate {
  id: string
  provider: string
  model: string
  name?: string
  disabled: boolean
  dead: boolean
  accounts: { total: number; available: number }
}
/** 智能调度：池内单模型状态（invalid=失效 / exhausted=当日已跳过）。 */
export interface SmartStatus {
  modelId: string
  usable?: boolean
  reason?: 'invalid' | 'exhausted'
  resetAtMs?: number
  accounts: { total: number; available: number }
}
export interface SmartState {
  pool: string[]
  hit: string | null
  statuses: SmartStatus[]
  candidates: SmartCandidate[]
}
export interface UsageModel {
  model: string
  name: string
  calls: number
  turns: number
  input: number
  output: number
  reasoning: number
  failed: number
  failedTurns: number
  recoveredTurns: number
  avgTtftMs?: number | null
  tps?: number | null
}
export interface Snapshot { summary: Summary; stats: Stats }
export interface Host {
  navigate(page: Page): void
  refresh(): Promise<void>
  copy(value: string): Promise<void>
  getApiKey(): Promise<string>
  rotateKey(): Promise<string>
  logout(): Promise<void>
  error(error: Error): void
  testModel(model: string, signal: AbortSignal): Promise<ModelTestResult>
  refreshModels(probe: boolean, signal: AbortSignal): Promise<void>
  saveSettings(settings: Partial<ServiceSettings>): Promise<ServiceSettings>
  /** 智能调度：读取池状态与候选清单。 */
  smartState(): Promise<SmartState>
  /** 智能调度：保存调度池（校验在服务端），返回保存后的最新状态。 */
  saveSmartPool(models: string[]): Promise<SmartState>
}
