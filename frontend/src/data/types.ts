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

// 踏勘事项：巡查发现异常后跨模块生成，治理工程页作为处置入口消费。
export type SurveyTask = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
} & {
  事项编号: string
  来源模块: string
  来源记录: number
  巡查编号: string
  隐患点编号: string
  异常情况: string
  处置结论: string
}

// 一个巡查记录与它关联的踏勘事项的聚合视图：详情页与治理工程页共用。
export type PatrolCase = {
  patrol: EntryRow
  task: SurveyTask | null
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
