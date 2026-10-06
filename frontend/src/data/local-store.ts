import { SEED_ROWS } from './seed'
import type { EntryRow, SurveyItem } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
// 踏勘事项与业务记录分开存放，但与业务记录在同一事务里一起提交/回滚。
export const SURVEY_KEY = 'survey'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type StoreData = Record<string, EntryRow[] | SurveyItem[]>

function seedData(): StoreData {
  return clone({ ...SEED_ROWS, [SURVEY_KEY]: [] as SurveyItem[] })
}

function readStorage(): StoreData {
  const fallback = seedData()
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrateLegacy(fallback)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = migrateLegacy(fallback)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as StoreData
    // 老版本本地缓存里没有踏勘事项桶，合并时补上空数组。
    const merged: StoreData = { ...fallback, ...parsed, [SURVEY_KEY]: parsed[SURVEY_KEY] ?? [] }
    return migrateLegacy(merged)
  } catch {
    const seeded = migrateLegacy(seedData())
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

/**
 * 老数据兼容：
 * - 历史「已处置」记录（含没有踏勘事项的）一律保持原结论，不补不删；
 * - 仅历史「发现异常/挂异常标记」却没有踏勘事项的记录，补建一条待踏勘事项，
 *   让它们能沿新链路处置；已存在事项或已处置的都不动。
 */
function migrateLegacy(data: StoreData): StoreData {
  const surveys = (data[SURVEY_KEY] ?? []) as SurveyItem[]
  let changed = false
  let nextId = surveys.reduce((max, item) => Math.max(max, Number(item.id)), 0)
  const hasSurvey = (moduleKey: string, id: number) =>
    surveys.some((item) => item.sourceModule === moduleKey && Number(item.sourceId) === id)

  const patrol = (data['patrol'] ?? []) as EntryRow[]
  const nextPatrol = patrol.map((row) => {
    if (String(row.status) === '发现异常' && !hasSurvey('patrol', Number(row.id))) {
      changed = true
      nextId += 1
      surveys.push({
        id: nextId,
        sourceKey: `patrol:${Number(row.id)}`,
        sourceModule: 'patrol',
        sourceId: Number(row.id),
        隐患点编号: String(row['隐患点编号'] ?? ''),
        来源说明: '巡查排查上报异常（历史数据补建）',
        status: '待踏勘',
        pending: true,
        createdAt: '',
        completedAt: '',
      })
      return { ...row, pending: true, abnormal: true }
    }
    return row
  })

  const engineering = (data['engineering'] ?? []) as EntryRow[]
  const nextEngineering = engineering.map((row) => {
    if (
      row.abnormal === true &&
      ['招标中', '施工中'].includes(String(row.status)) &&
      !hasSurvey('engineering', Number(row.id))
    ) {
      changed = true
      nextId += 1
      surveys.push({
        id: nextId,
        sourceKey: `engineering:${Number(row.id)}`,
        sourceModule: 'engineering',
        sourceId: Number(row.id),
        隐患点编号: String(row['隐患点编号'] ?? ''),
        来源说明: '治理工程上报异常（历史数据补建）',
        status: '待踏勘',
        pending: true,
        createdAt: '',
        completedAt: '',
      })
    }
    return row
  })

  if (!changed) {
    return data
  }
  const migrated: StoreData = {
    ...data,
    patrol: nextPatrol,
    engineering: nextEngineering,
    [SURVEY_KEY]: surveys,
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
  }
  return migrated
}

let cache: StoreData | null = null

export function allRows(): StoreData {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return (allRows()[key] ?? []) as EntryRow[]
}

export function listSurveys(): SurveyItem[] {
  return (allRows()[SURVEY_KEY] ?? []) as SurveyItem[]
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commit({ [key]: rows })
}

export function saveSurveys(items: SurveyItem[]): void {
  commit({ [SURVEY_KEY]: items })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/**
 * 多模块原子提交：把本次动作涉及的业务记录和踏勘事项一次性落盘。
 * 任何一个模块写入失败都整体退回提交前快照，绝不留下一边成功一边失败的数据。
 */
export function commit(patch: Partial<StoreData>): void {
  const snapshot = cache === null ? null : clone(allRows())
  const next: StoreData = { ...allRows(), ...patch } as StoreData
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
      // 落盘失败：内存与持久层一起回滚，由上层动作返回失败结论。
      cache = snapshot
      throw error instanceof Error ? error : new Error('数据写入失败')
    }
  }
}
