import { commitAll, listRows } from './local-store'
import type { ActionResult, EntryRow, PatrolCase, SurveyTask } from './types'

// 巡查工作流：巡查列表、巡查详情、治理工程页的处置入口全部收敛到这里，
// 任何页面都不允许再绕开它直接改巡查状态或踏勘事项。
export const PATROL_KEY = 'patrol'
export const SURVEY_TASK_KEY = 'survey_task'

export const PATROL_STATUS = {
  TODO: '待巡查',
  PATROLLED: '已巡查',
  ABNORMAL: '发现异常',
  DISPOSED: '已处置',
} as const

export const TASK_STATUS = {
  PENDING: '待踏勘',
  DONE: '已处置',
} as const

// 唯一允许的状态推进路径：待巡查 -> 已巡查 -> 发现异常 -> 已处置，不能跳级、不能回退。
const NEXT_STATUS: Record<string, string> = {
  [PATROL_STATUS.TODO]: PATROL_STATUS.PATROLLED,
  [PATROL_STATUS.PATROLLED]: PATROL_STATUS.ABNORMAL,
  [PATROL_STATUS.ABNORMAL]: PATROL_STATUS.DISPOSED,
}

// 各状态下页面上可执行的动作；终态「已处置」没有任何可执行动作，历史结论保持不变。
const STATUS_ACTIONS: Record<string, string[]> = {
  [PATROL_STATUS.TODO]: ['完成巡查'],
  [PATROL_STATUS.PATROLLED]: ['报告异常'],
  [PATROL_STATUS.ABNORMAL]: ['确认处置'],
  [PATROL_STATUS.DISPOSED]: [],
}

export class WorkflowConflictError extends Error {}

// 同一巡查记录的处置互斥锁：并发确认只放行一次，其余直接判定为重复提交。
const disposalLocks = new Set<number>()

function findIndex(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

function taskCode(patrolId: number): string {
  return `SURV-${String(patrolId).padStart(4, '0')}`
}

// 踏勘事项与巡查记录一一对应：同一条巡查记录最多只有一条踏勘事项。
export function findSurveyTask(tasks: EntryRow[], patrolId: number): SurveyTask | null {
  const row = tasks.find(
    (item) => String(item.来源模块) === PATROL_KEY && Number(item.来源记录) === patrolId,
  )
  return (row as SurveyTask | undefined) ?? null
}

export function availableActions(status: string): string[] {
  return STATUS_ACTIONS[status] ?? []
}

export function listSurveyTasks(): SurveyTask[] {
  return listRows(SURVEY_TASK_KEY) as SurveyTask[]
}

// 巡查记录与其踏勘事项的聚合，详情页与工程入口读的是同一份事实。
export function patrolCases(): PatrolCase[] {
  const tasks = listRows(SURVEY_TASK_KEY)
  return listRows(PATROL_KEY).map((patrol) => ({
    patrol,
    task: findSurveyTask(tasks, Number(patrol.id)),
  }))
}

export function getPatrolCase(id: number): PatrolCase | null {
  return patrolCases().find((item) => Number(item.patrol.id) === id) ?? null
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

// 完成巡查：待巡查 -> 已巡查
export function completePatrol(id: number): ActionResult {
  const patrols = listRows(PATROL_KEY)
  const index = findIndex(patrols, id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的巡查记录`)
  }
  const current = String(patrols[index].status)
  if (current === PATROL_STATUS.PATROLLED) {
    return fail('该巡查记录已完成巡查，不用重复操作')
  }
  if (current !== PATROL_STATUS.TODO) {
    return fail(`当前状态为「${current}」，不能再执行完成巡查`)
  }
  try {
    commitAll((draft) => {
      const rows = draft[PATROL_KEY]
      const row = rows[findIndex(rows, id)]
      if (String(row.status) !== PATROL_STATUS.TODO) {
        throw new WorkflowConflictError('巡查状态已变化，请刷新后重试')
      }
      row.status = PATROL_STATUS.PATROLLED
      row.pending = true
      row.abnormal = false
    })
  } catch (error) {
    return fail(error instanceof WorkflowConflictError ? error.message : '巡查状态写入失败，已退回')
  }
  return { ok: true, message: '巡查已完成，当前状态「已巡查」' }
}

// 报告异常：已巡查 -> 发现异常，并跨模块幂等生成一条踏勘事项。
// 重复上报不会再追加事项；两边写入要么同时成功，要么同时退回。
export function reportAbnormal(id: number, detail: string): ActionResult {
  const description = detail.trim() || '巡查现场发现异常'
  const patrols = listRows(PATROL_KEY)
  const index = findIndex(patrols, id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的巡查记录`)
  }
  const current = String(patrols[index].status)
  if (current === PATROL_STATUS.ABNORMAL) {
    return fail('已生成踏勘事项，无需重复上报异常')
  }
  if (current === PATROL_STATUS.DISPOSED) {
    return fail('该巡查记录已处置，历史结论保持不变')
  }
  if (current !== PATROL_STATUS.PATROLLED) {
    return fail(`只有「已巡查」的记录才能报告异常，当前状态为「${current}」`)
  }

  try {
    commitAll((draft) => {
      const rows = draft[PATROL_KEY]
      const rowIndex = findIndex(rows, id)
      const row = rows[rowIndex]
      // CAS：进入事务后再确认一次状态，并发情况下只允许一次流转。
      if (String(row.status) !== PATROL_STATUS.PATROLLED) {
        throw new WorkflowConflictError('巡查状态已变化，请刷新后重试')
      }

      const tasks = (draft[SURVEY_TASK_KEY] ??= [])
      const existing = findSurveyTask(tasks, id)
      if (existing) {
        // 幂等：同一条巡查记录的踏勘事项已存在（任何状态），都不再追加。
        throw new WorkflowConflictError('踏勘事项已存在，不能重复生成')
      }

      row.status = PATROL_STATUS.ABNORMAL
      row.pending = true
      row.abnormal = true
      row.发现异常 = description

      const task: SurveyTask = {
        id,
        status: TASK_STATUS.PENDING,
        pending: true,
        abnormal: true,
        事项编号: taskCode(id),
        来源模块: PATROL_KEY,
        来源记录: id,
        巡查编号: String(row.巡查编号 ?? ''),
        隐患点编号: String(row.隐患点编号 ?? ''),
        异常情况: description,
        处置结论: '',
      }
      tasks.push(task)
    })
  } catch (error) {
    if (error instanceof WorkflowConflictError) {
      return fail(error.message)
    }
    return fail('异常上报写入失败，巡查状态与踏勘事项已一起退回')
  }
  return { ok: true, message: '已报告异常，当前状态「发现异常」，并生成踏勘事项' }
}

// 确认处置：发现异常 -> 已处置，同时关闭踏勘事项。列表、详情、工程页共用此入口。
export function confirmDisposal(id: number, conclusion: string): ActionResult {
  const result = String(conclusion).trim() || '现场踏勘处置完成，隐患已消除'
  if (disposalLocks.has(id)) {
    return fail('该记录正在处置，请勿重复提交')
  }

  const patrols = listRows(PATROL_KEY)
  const index = findIndex(patrols, id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的巡查记录`)
  }
  const current = String(patrols[index].status)
  if (current === PATROL_STATUS.DISPOSED) {
    return fail('历史已处置记录保持原结论，不能重复处置')
  }
  if (current !== PATROL_STATUS.ABNORMAL) {
    return fail(`只有「发现异常」的记录才能确认处置，当前状态为「${current}」`)
  }
  const task = findSurveyTask(listRows(SURVEY_TASK_KEY), id)
  if (!task) {
    return fail('关联踏勘事项缺失，数据不一致，未做任何写入')
  }
  if (String(task.status) !== TASK_STATUS.PENDING) {
    return fail('踏勘事项已处置，不能重复回写')
  }

  disposalLocks.add(id)
  try {
    commitAll((draft) => {
      const rows = draft[PATROL_KEY]
      const row = rows[findIndex(rows, id)]
      // CAS：事务内双重确认，保证并发确认只有一次能成功。
      if (String(row.status) !== PATROL_STATUS.ABNORMAL) {
        throw new WorkflowConflictError('巡查记录已被处置，本次确认无效')
      }
      const tasks = draft[SURVEY_TASK_KEY] ?? []
      const linked = tasks.find(
        (item) => String(item.来源模块) === PATROL_KEY && Number(item.来源记录) === id,
      )
      if (!linked || String(linked.status) !== TASK_STATUS.PENDING) {
        throw new WorkflowConflictError('踏勘事项状态已变化，本次回写无效')
      }
      row.status = PATROL_STATUS.DISPOSED
      row.pending = false
      row.abnormal = true
      row.处置措施 = result
      linked.status = TASK_STATUS.DONE
      linked.pending = false
      linked.abnormal = true
      linked.处置结论 = result
    })
  } catch (error) {
    if (error instanceof WorkflowConflictError) {
      return fail(error.message)
    }
    // 落盘失败时 commitAll 已把缓存整体退回，这里明确告知两边都未生效。
    return fail('处置回写失败，巡查记录与踏勘事项已一起退回')
  } finally {
    disposalLocks.delete(id)
  }
  return { ok: true, message: '处置已确认，当前状态「已处置」，踏勘事项同步关闭' }
}

export function runPatrolAction(action: string, id: number, payload = ''): ActionResult {
  if (action === '完成巡查') {
    return completePatrol(id)
  }
  if (action === '报告异常') {
    return reportAbnormal(id, payload)
  }
  if (action === '确认处置') {
    return confirmDisposal(id, payload)
  }
  return fail(`巡查记录没有登记「${action}」这个动作`)
}
