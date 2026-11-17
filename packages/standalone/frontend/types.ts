export type Page = 'channels' | 'smart' | 'connection' | 'calendar' | 'requests' | 'settings'
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
  catalogSyncedAt: number
  settings: ServiceSettings
  channels: { state: string; error?: string }
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
/** 领取历史：单条事件（GET /claims/history）。 */
export interface ClaimsEvent {
  at: number
  provider: string
  text: string
  kind: string
  source: 'manual' | 'auto'
  amount?: number
  unit?: string
}
/** 领取历史：按日聚合（providers=触达渠道、claimedCount=领取成功渠道数）。 */
export interface ClaimsDay { providers: string[]; claimedCount: number; events: ClaimsEvent[] }
export interface ClaimsQuery { schema: string; since: string | null; days: Record<string, ClaimsDay> }
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
  /** 渠道模型启停（FR-13.4 唯一入口）：经 /channels/rpc 调 model.setDisabled。 */
  setModelDisabled(provider: string, modelId: string, disabled: boolean): Promise<void>
  saveSettings(settings: Partial<ServiceSettings>): Promise<ServiceSettings>
  /** 智能调度：读取池状态与候选清单。 */
  smartState(): Promise<SmartState>
  /** 智能调度：保存调度池（校验在服务端），返回保存后的最新状态。 */
  saveSmartPool(models: string[]): Promise<SmartState>
  /** 领取历史：按可视月份一次拉取整月（AC-19）。 */
  claimsHistory(from: string, to: string): Promise<ClaimsQuery>
}
