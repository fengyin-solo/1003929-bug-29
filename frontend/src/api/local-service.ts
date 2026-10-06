import { MODULE_BY_KEY } from '@/data/modules'
import {
  SURVEY_KEY,
  allRows,
  listRows,
  listSurveys,
  resetRows,
  saveRows,
} from '@/data/local-store'
import {
  WORKFLOW_BY_KEY,
  completeSurveyById,
  executeAction,
  runSerialized,
} from '@/data/workflow'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SurveyItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/**
 * 巡查/治理工程走跨模块状态机（含踏勘事项的生成与回写、前置状态校验）；
 * 其余模块保留通用的顺序状态推进。所有写动作排队执行，并发确认只允许一次成功。
 */
export async function runAction(key: string, id: number, action: string): Promise<ActionResult> {
  return runSerialized(() => {
    if (WORKFLOW_BY_KEY.has(key)) {
      return executeAction({ moduleKey: key, id, action })
    }
    return runGenericAction(key, id, action)
  })
}

function runGenericAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  // 通用模块同样禁止跨态跳转：只允许沿状态链推进到下一状态。
  const currentIndex = meta.statuses.indexOf(String(rows[index].status))
  if (currentIndex < 0) {
    return { ok: false, message: `${meta.entity}当前状态不在登记的状态链内` }
  }
  const nextStatus = meta.statuses[currentIndex + 1]
  if (!nextStatus) {
    return { ok: false, message: `${meta.entity}已到链路末端，不能继续操作` }
  }
  if (nextStatus !== target) {
    return {
      ok: false,
      message: `${meta.entity}当前状态不能执行「${action}」，需先完成上一环节`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 列出踏勘事项，可按来源模块/来源记录过滤；待处置的排在前面。 */
export function listSurveyItems(filter: { moduleKey?: string; sourceId?: number } = {}): SurveyItem[] {
  return listSurveys()
    .filter((item) => (filter.moduleKey ? item.sourceModule === filter.moduleKey : true))
    .filter((item) =>
      filter.sourceId === undefined ? true : Number(item.sourceId) === Number(filter.sourceId),
    )
    .sort((a, b) => {
      if (a.pending !== b.pending) {
        return a.pending ? -1 : 1
      }
      return a.id - b.id
    })
}

/** 踏勘处置：列表、详情、治理工程三个入口共用，处置回写只认这一条路径。 */
export async function resolveSurvey(surveyId: number): Promise<ActionResult> {
  return runSerialized(() => completeSurveyById(surveyId))
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = (rows[meta.key] ?? []) as EntryRow[]
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const surveys = (rows[SURVEY_KEY] ?? []) as SurveyItem[]
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '待踏勘', value: surveys.filter((item) => item.pending).length },
  ]
  return { cards, modules }
}
