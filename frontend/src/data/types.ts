/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 踏勘事项：异常上报后跨模块生成的处置载体，巡查与治理工程共用。 */
export type SurveyItem = {
  id: number
  /** 幂等键：同一来源只允许生成一条踏勘事项，处置回写靠它防重复。 */
  sourceKey: string
  sourceModule: string
  sourceId: number
  隐患点编号: string
  来源说明: string
  status: string
  pending: boolean
  createdAt: string
  completedAt: string
}

/**
 * 模块状态机覆盖配置：
 * - from 限定每个动作允许的前置状态（只允许沿状态链顺序流转）；
 * - effect 标记动作是否需要在改状态之外联动踏勘事项。
 */
export type WorkflowRule = {
  action: string
  from: string[]
  effect?: 'reportAbnormal' | 'confirmSurvey'
}

export type Workflow = {
  key: string
  rules: WorkflowRule[]
}
