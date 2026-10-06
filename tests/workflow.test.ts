import { SEED_ROWS } from '../frontend/src/data/seed'

// 在导入被测模块前装好 localStorage 桩，让数据层走真实的持久化分支。
type Store = Record<string, string>
const backing: Store = {
  'geohazard-monitor-prevention:entries': JSON.stringify(SEED_ROWS),
}
let failNextWrites = 0
const localStorageStub = {
  getItem: (key: string) => backing[key] ?? null,
  setItem: (key: string, value: string) => {
    if (failNextWrites > 0) {
      failNextWrites -= 1
      throw new Error('模拟 localStorage 写入失败（配额超限）')
    }
    backing[key] = value
  },
}
;(globalThis as { window?: unknown }).window = { localStorage: localStorageStub }

async function main() {
const {
  completePatrol,
  reportAbnormal,
  confirmDisposal,
  runPatrolAction,
  availableActions,
  patrolCases,
  listSurveyTasks,
  PATROL_STATUS,
  TASK_STATUS,
  PATROL_KEY,
  SURVEY_TASK_KEY,
} = await import('../frontend/src/data/patrol-workflow')
const { resetRows } = await import('../frontend/src/data/local-store')

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}
function patrol(id: number) {
  return patrolCases().find((item) => Number(item.patrol.id) === id)!
}

// 每个场景开始前恢复种子，保证相互独立。
function reset() {
  resetRows(PATROL_KEY)
  resetRows(SURVEY_TASK_KEY)
  backing['geohazard-monitor-prevention:entries'] = JSON.stringify(SEED_ROWS)
  failNextWrites = 0
}

console.log('场景一：严格线性状态机 待巡查→已巡查→发现异常→已处置')
reset()
check('待巡查记录不能直接报告异常', reportAbnormal(1, 'x').ok === false)
check('已巡查记录不能直接确认处置', !confirmDisposal(2, '结论').ok)
check('待巡查先完成巡查成功', completePatrol(1).ok)
check('完成后状态为已巡查', patrol(1).patrol.status === PATROL_STATUS.PATROLLED)
check('已巡查不能再完成巡查', completePatrol(1).ok === false)
check('待巡查不能直接确认处置', confirmDisposal(1, '越级').ok === false)
check('报告异常成功', reportAbnormal(1, '坡脚鼓胀').ok)
check('报告后状态为发现异常', patrol(1).patrol.status === PATROL_STATUS.ABNORMAL)
check('发现异常记录 abnormal=true', patrol(1).patrol.abnormal === true)
check('生成了一条待踏勘事项', (() => {
  const t = patrol(1).task
  return Boolean(t && t.status === TASK_STATUS.PENDING && t.事项编号 === 'SURV-0001' && t.异常情况 === '坡脚鼓胀')
})())
check('事项数量随上报 +1', listSurveyTasks().length === 3)
check('确认处置成功', confirmDisposal(1, '清淤+裂缝填埋').ok)
check('处置后状态为已处置', patrol(1).patrol.status === PATROL_STATUS.DISPOSED)
check('处置后 pending=false', patrol(1).patrol.pending === false)
check('处置结论已回写', String(patrol(1).patrol.处置措施) === '清淤+裂缝填埋')
check('踏勘事项同步关闭', patrol(1).task?.status === TASK_STATUS.DONE)
check('踏勘事项处置结论一致', patrol(1).task?.处置结论 === '清淤+裂缝填埋')

console.log('场景二：重复上报不追加事项；历史已处置保持原结论')
reset()
check('对发现异常记录重复上报被拒绝', reportAbnormal(3, '再来一次').ok === false)
check('踏勘事项仍只有种子数量（未追加）', listSurveyTasks().length === 2)
const beforeConclusion = patrol(4).patrol.处置措施
check('历史已处置记录可用动作为空', availableActions(PATROL_STATUS.DISPOSED).length === 0)
check('对已处置记录再确认被拒绝', confirmDisposal(4, '改结论').ok === false)
check('历史处置结论保持不变', patrol(4).patrol.处置措施 === beforeConclusion)
check('历史事项仍为已处置', patrol(4).task?.status === TASK_STATUS.DONE)
check('已处置事项数量仍为 2（不追加）', listSurveyTasks().length === 2)

console.log('场景三：并发/重复确认只允许一次成功')
reset()
const r1 = confirmDisposal(3, '第一次结论')
const r2 = confirmDisposal(3, '第二次结论')
check('第一次确认成功', r1.ok === true, r1.message)
check('第二次确认失败', r2.ok === false, r2.message)
check('最终状态只到已处置', patrol(3).patrol.status === PATROL_STATUS.DISPOSED)
check('保留第一次的结论', String(patrol(3).patrol.处置措施) === '第一次结论')
check('只有一条踏勘事项', listSurveyTasks().filter((t) => Number(t.来源记录) === 3).length === 1)

console.log('场景四：任一写入失败，巡查记录与踏勘事项一起退回')
reset()
completePatrol(2)
reportAbnormal(2, '异常描述')
failNextWrites = 1 // 下一次落盘必定失败
const failedConfirm = confirmDisposal(2, '本应退回的结论')
check('失败时返回未成功', failedConfirm.ok === false, failedConfirm.message)
check('巡查记录退回在发现异常', patrol(2).patrol.status === PATROL_STATUS.ABNORMAL)
check('踏勘事项退回在待踏勘', patrol(2).task?.status === TASK_STATUS.PENDING)
check('处置结论未写入', String(patrol(2).patrol.处置措施) === '')
const persisted = JSON.parse(backing['geohazard-monitor-prevention:entries'])
check('localStorage 中也没有半截写入', (() => {
  const p = persisted[PATROL_KEY].find((r: { id: number }) => r.id === 2)
  const t = persisted[SURVEY_TASK_KEY].find((r: { 来源记录: number }) => Number(r.来源记录) === 2)
  return p.status === PATROL_STATUS.ABNORMAL && t.status === TASK_STATUS.PENDING
})())
check('存储恢复后可正常处置', confirmDisposal(2, '恢复后处置').ok === true)
check('恢复后状态为已处置', patrol(2).patrol.status === PATROL_STATUS.DISPOSED)

console.log('场景五：上报环节失败同样两边退回（状态不卡在已巡查之外）')
reset()
completePatrol(1)
failNextWrites = 1
const failedReport = reportAbnormal(1, '应退回的异常')
check('上报失败返回未成功', failedReport.ok === false)
check('巡查记录停留在已巡查', patrol(1).patrol.status === PATROL_STATUS.PATROLLED)
check('没有生成踏勘事项', patrol(1).task === null)

console.log('场景六：工程入口与巡查详情是同一个处置入口')
reset()
const fromEngineering = confirmDisposal(3, '工程页处置结论')
check('工程页确认处置成功', fromEngineering.ok)
check('工程页处置后事项关闭', patrol(3).task?.status === TASK_STATUS.DONE)
const repeatFromDetail = runPatrolAction('确认处置', 3, '详情页再来一次')
check('详情页重复处置被拒绝', repeatFromDetail.ok === false)
check('结论以第一次为准', patrol(3).task?.处置结论 === '工程页处置结论')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
