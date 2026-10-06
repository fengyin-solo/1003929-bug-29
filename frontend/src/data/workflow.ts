import { MODULE_BY_KEY } from '@/data/modules'
import { SURVEY_KEY, commit, listRows, listSurveys } from '@/data/local-store'
import type { EntryRow, SurveyItem, Workflow } from '@/data/types'

/**
 * 跨模块状态机集中配置。
 *
 * 共享根因就在这里收口：巡查排查与治理工程页面的异常都走同一套
 * 「异常上报 → 生成踏勘事项 → 踏勘处置 → 回写来源」链路，
 * 状态前置条件、幂等键、并发锁也只有一份，页面不再各自直改状态。
 */
export const WORKFLOWS: Workflow[] = [
  {
    key: 'patrol',
    rules: [
      // 已巡查 → 发现异常：必须先完成巡查，不能从待巡查直接报异常。
      { action: '完成巡查', from: ['待巡查'] },
      { action: '报告异常', from: ['已巡查'], effect: 'reportAbnormal' },
      // 已处置只能由踏勘事项处置回写到达，页面上的确认动作转办给踏勘事项。
      { action: '确认处置', from: ['发现异常'], effect: 'confirmSurvey' },
    ],
  },
  {
    key: 'engineering',
    rules: [
      // 治理工程的招标/开工/验收仍沿自身状态链顺序推进。
      { action: '启动招标', from: ['待立项'] },
      { action: '开工确认', from: ['招标中'] },
      { action: '申请验收', from: ['施工中'] },
      // 工程入口上报异常：不改变项目生命周期状态，只挂异常标记并生成踏勘事项。
      { action: '报告异常', from: ['招标中', '施工中'], effect: 'reportAbnormal' },
      { action: '确认处置', from: ['招标中', '施工中'], effect: 'confirmSurvey' },
    ],
  },
  {
    // 这些模块的动作是「标到 actionTargets 目标态」，目标态可能在状态链上回跳（如恢复正常），
    // 因此显式登记前置状态；是否异常由目标态是否为正常态决定，而不是按动作名猜测。
    key: 'contract',
    rules: [
      { action: '暂停合作', from: ['正常'] },
      { action: '列入黑名单', from: ['正常', '暂停合作'] },
      { action: '恢复正常', from: ['暂停合作', '列入黑名单'] },
    ],
  },
  {
    key: 'device',
    rules: [
      { action: '报修设备', from: ['正常运行', '信号异常', '低电量'] },
      { action: '确认修复', from: ['信号异常', '低电量', '待维修'] },
      { action: '停用设备', from: ['正常运行', '信号异常', '低电量', '待维修'] },
    ],
  },
  {
    key: 'crack',
    rules: [
      { action: '记录数据', from: ['正常', '加速发展', '趋于稳定'] },
      { action: '标记加速', from: ['正常', '趋于稳定'] },
      { action: '确认稳定', from: ['正常', '加速发展'] },
    ],
  },
  {
    key: 'propaganda',
    rules: [
      { action: '开展活动', from: ['待开展'] },
      { action: '确认完成', from: ['进行中'] },
      { action: '取消活动', from: ['待开展', '进行中'] },
    ],
  },
]

export const WORKFLOW_BY_KEY: Map<string, Workflow> = new Map(
  WORKFLOWS.map((workflow) => [workflow.key, workflow]),
)

export const SURVEY_PENDING = '待踏勘'
export const SURVEY_DONE = '已踏勘'

function nextSurveyId(items: SurveyItem[]): number {
  return items.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
}

function sourceKeyOf(moduleKey: string, id: number): string {
  return `${moduleKey}:${id}`
}

function hazardCodeOf(row: EntryRow): string {
  const code = row['隐患点编号']
  return code === undefined || code === '' ? '' : String(code)
}

// 串行锁：处置类动作即使被并发点击，也排队执行，第二个请求看到的已是终态，只能有一次成功。
let actionChain: Promise<unknown> = Promise.resolve()

export function runSerialized<T>(task: () => T): Promise<T> {
  const result = actionChain.then(task, task)
  // 链尾保留一个永不 reject 的 Promise，避免前一次失败把整条链带崩。
  actionChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export type ApplyOutcome = {
  ok: boolean
  message: string
}

type MutateContext = {
  moduleKey: string
  id: number
  action: string
}

/** 在已加锁的串行区内执行：跨模块改动通过一次 commit 原子提交。 */
export function executeAction(ctx: MutateContext): ApplyOutcome {
  const { moduleKey, id, action } = ctx
  const workflow = WORKFLOW_BY_KEY.get(moduleKey)
  const rule = workflow?.rules.find((item) => item.action === action)
  if (!workflow || !rule) {
    return { ok: false, message: `模块「${moduleKey}」未登记动作「${action}」` }
  }

  const rows = listRows(moduleKey)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的记录` }
  }
  const source = rows[index]
  const currentStatus = String(source.status)
  if (!rule.from.includes(currentStatus)) {
    return {
      ok: false,
      message: `当前状态「${currentStatus}」不能执行「${action}」，允许的前置状态：${rule.from.join('、')}`,
    }
  }

  const surveys = listSurveys()
  const linked = surveys.find((item) => item.sourceKey === sourceKeyOf(moduleKey, id))

  if (rule.effect === 'reportAbnormal') {
    return applyReportAbnormal({ moduleKey, rows, index, source, surveys, linked })
  }
  if (rule.effect === 'confirmSurvey') {
    return applyConfirmSurvey({ moduleKey, rows, index, source, surveys, linked })
  }
  const meta = MODULE_BY_KEY.get(moduleKey)
  const target = meta?.actionTargets[action]
  if (!target) {
    return { ok: false, message: `动作「${action}」未配置目标状态` }
  }
  return applyDirectTarget({ moduleKey, rows, index, source, action, target })
}

type ReportAbnormalContext = {
  moduleKey: string
  rows: EntryRow[]
  index: number
  source: EntryRow
  surveys: SurveyItem[]
  linked?: SurveyItem
}

function applyReportAbnormal(ctx: ReportAbnormalContext): ApplyOutcome {
  const { moduleKey, rows, index, source, surveys, linked } = ctx

  // 幂等：已有踏勘事项（含已处置）绝不重复追加，历史结论保持原样。
  if (linked) {
    return { ok: false, message: `该记录的踏勘事项已生成（${linked.status}），不能重复上报` }
  }

  const id = Number(source.id)
  const item: SurveyItem = {
    id: nextSurveyId(surveys),
    sourceKey: sourceKeyOf(moduleKey, id),
    sourceModule: moduleKey,
    sourceId: id,
    隐患点编号: hazardCodeOf(source),
    来源说明: moduleKey === 'patrol' ? '巡查排查上报异常' : '治理工程上报异常',
    status: SURVEY_PENDING,
    pending: true,
    createdAt: new Date().toISOString(),
    completedAt: '',
  }

  // 巡查：已巡查 → 发现异常；工程：生命周期状态不变，只挂异常标记。
  const updated: EntryRow =
    moduleKey === 'patrol'
      ? { ...source, status: '发现异常', pending: true, abnormal: true }
      : { ...source, abnormal: true }

  const nextRows = [...rows]
  nextRows[index] = updated

  try {
    commit({ [moduleKey]: nextRows, [SURVEY_KEY]: [...surveys, item] })
  } catch {
    return { ok: false, message: '踏勘事项生成失败，已全部回滚，请重试' }
  }
  return { ok: true, message: '已生成踏勘事项，等待现场踏勘处置' }
}

type ConfirmSurveyContext = {
  moduleKey: string
  rows: EntryRow[]
  index: number
  source: EntryRow
  surveys: SurveyItem[]
  linked?: SurveyItem
}

function applyConfirmSurvey(ctx: ConfirmSurveyContext): ApplyOutcome {
  const { moduleKey, rows, index, source, surveys, linked } = ctx
  if (!linked) {
    return { ok: false, message: '没有关联的踏勘事项，无法确认处置' }
  }
  return completeSurvey({ moduleKey, rows, index, source, surveys, survey: linked })
}

/** 踏勘处置入口（列表/详情/治理工程共用）：完成事项并回写来源状态。 */
export function completeSurveyById(surveyId: number): ApplyOutcome {
  const surveys = listSurveys()
  const survey = surveys.find((item) => Number(item.id) === Number(surveyId))
  if (!survey) {
    return { ok: false, message: `没有找到编号为 ${surveyId} 的踏勘事项` }
  }
  const moduleKey = survey.sourceModule
  const rows = listRows(moduleKey)
  const index = rows.findIndex((row) => Number(row.id) === Number(survey.sourceId))
  if (index < 0) {
    return { ok: false, message: '踏勘事项的来源记录不存在，已拒绝回写' }
  }
  return completeSurvey({ moduleKey, rows, index, source: rows[index], surveys, survey })
}

type CompleteContext = {
  moduleKey: string
  rows: EntryRow[]
  index: number
  source: EntryRow
  surveys: SurveyItem[]
  survey: SurveyItem
}

function completeSurvey(ctx: CompleteContext): ApplyOutcome {
  const { moduleKey, rows, index, source, surveys, survey } = ctx

  // 并发或重复点击时只有第一次能成功，后续在终态校验处全部被挡下。
  if (survey.status === SURVEY_DONE) {
    return { ok: false, message: '踏勘事项已处置，请勿重复确认' }
  }

  const completedSurvey: SurveyItem = {
    ...survey,
    status: SURVEY_DONE,
    pending: false,
    completedAt: new Date().toISOString(),
  }
  // 巡查：发现异常 → 已处置（终态）；工程：项目状态不变，解除异常标记。
  const updatedSource: EntryRow =
    moduleKey === 'patrol'
      ? { ...source, status: '已处置', pending: false, abnormal: false }
      : { ...source, abnormal: false }

  const nextRows = [...rows]
  nextRows[index] = updatedSource
  const nextSurveys = surveys.map((item) =>
    item.sourceKey === survey.sourceKey ? completedSurvey : item,
  )

  try {
    commit({ [moduleKey]: nextRows, [SURVEY_KEY]: nextSurveys })
  } catch {
    return { ok: false, message: '处置回写失败，踏勘事项与来源记录已一起退回' }
  }
  return {
    ok: true,
    message:
      moduleKey === 'patrol'
        ? '踏勘处置完成，巡查记录已回写为「已处置」'
        : '踏勘处置完成，治理工程异常标记已解除',
  }
}

type DirectTargetContext = {
  moduleKey: string
  rows: EntryRow[]
  index: number
  source: EntryRow
  action: string
  target: string
}

function applyDirectTarget(ctx: DirectTargetContext): ApplyOutcome {
  const { moduleKey, rows, index, source, action, target } = ctx
  const meta = MODULE_BY_KEY.get(moduleKey)
  if (!meta) {
    return { ok: false, message: `未登记模块「${moduleKey}」` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  // 回到「正常/正常运行/已完成」等正面状态时清除异常标记，其余按动作语义保留。
  const positiveStatuses = ['正常', '正常运行', '已完成', '验收通过', '已复核']
  const abnormal = positiveStatuses.includes(target) ? false : source.abnormal
  const updated: EntryRow = {
    ...source,
    status: target,
    pending: target !== lastStatus,
    abnormal,
  }
  const nextRows = [...rows]
  nextRows[index] = updated
  try {
    commit({ [moduleKey]: nextRows })
  } catch {
    return { ok: false, message: '状态更新失败，已回滚，请重试' }
  }
  return { ok: true, message: `已${action}，当前状态「${target}」` }
}
