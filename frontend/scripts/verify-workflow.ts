// 逻辑验证脚本（不进构建产物）：用最小 localStorage 垫片跑通异常上报→踏勘→回写全链路。
const store = new Map<string, string>()
let failNextWrites = 0
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (failNextWrites > 0) {
        failNextWrites -= 1
        throw new Error('QuotaExceeded')
      }
      store.set(k, v)
    },
  },
}

import { runAction, listSurveyItems, resolveSurvey, listEntries } from '../src/api/local-service'
import { listSurveys, saveRows, storageKey } from '../src/data/local-store'

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}

function patrolStatus(id: number) {
  return listEntries('patrol').items.find((r) => r.id === id)!
}
function surveysOf(moduleKey: string, id: number) {
  return listSurveyItems({ moduleKey, sourceId: id })
}

async function main() {
  // 1. 巡查状态机：待巡查不能直接报异常
  console.log('1) 状态链顺序约束')
  const r0 = await runAction('patrol', 1, '报告异常')
  assert('待巡查直接报异常被拒', r0.ok === false)

  // 2. 正常链路 + 踏勘生成 + 幂等
  console.log('2) 已巡查→报告异常→生成踏勘（仅一条）')
  const a1 = await runAction('patrol', 2, '报告异常')
  assert('已巡查报异常成功', a1.ok, a1.message)
  assert('记录变为发现异常', patrolStatus(2).status === '发现异常', patrolStatus(2).status)
  assert('abnormal=true', patrolStatus(2).abnormal === true)
  const s1 = surveysOf('patrol', 2)
  assert('生成1条待踏勘事项', s1.length === 1 && s1[0].status === '待踏勘', JSON.stringify(s1))
  const a2 = await runAction('patrol', 2, '报告异常')
  assert('重复报异常被幂等拒绝', a2.ok === false)
  assert('踏勘事项未重复追加', surveysOf('patrol', 2).length === 1)

  // 3. 处置回写 + 重复确认
  console.log('3) 踏勘处置回写，重复处置不追加')
  const c1 = await runAction('patrol', 2, '确认处置')
  assert('确认处置成功', c1.ok, c1.message)
  assert('记录变为已处置', patrolStatus(2).status === '已处置', patrolStatus(2).status)
  assert('已处置 pending=false', patrolStatus(2).pending === false)
  assert('已处置 abnormal=false', patrolStatus(2).abnormal === false)
  assert('踏勘事项已踏勘', surveysOf('patrol', 2)[0].status === '已踏勘')
  const c2 = await resolveSurvey(surveysOf('patrol', 2)[0].id)
  assert('重复踏勘处置被拒绝', c2.ok === false)
  assert('踏勘事项仍只有1条', surveysOf('patrol', 2).length === 1)

  // 4. 已处置历史结论保持
  console.log('4) 历史已处置记录保持原结论')
  const hist = listEntries('patrol').items.find((r) => r.status === '已处置')!
  assert('已处置记录仍存在', !!hist)
  const bad = await runAction('patrol', hist.id, '报告异常')
  assert('已处置记录不能再报异常', bad.ok === false)

  // 5. 并发确认只允许一次成功
  console.log('5) 并发确认只一次成功')
  await runAction('patrol', 1, '完成巡查')
  await runAction('patrol', 1, '报告异常')
  const sid = surveysOf('patrol', 1)[0].id
  const results = await Promise.all([resolveSurvey(sid), resolveSurvey(sid), resolveSurvey(sid)])
  const oks = results.filter((r) => r.ok).length
  assert('3次并发确认仅1次成功', oks === 1, `成功${oks}次`)
  assert('并发后仅1条事项且已踏勘', surveysOf('patrol', 1).length === 1 && surveysOf('patrol', 1)[0].status === '已踏勘')

  // 6. 工程入口：状态不变，异常标记 + 同一条踏勘链路；历史异常自动补建事项
  console.log('6) 治理工程入口异常上报/回写')
  const engBefore = listEntries('engineering').items.find((r) => r.id === 2)!.status
  assert('历史工程异常已补建待踏勘事项', surveysOf('engineering', 2).length === 1 && surveysOf('engineering', 2)[0].pending)
  const engRow0 = listEntries('engineering').items.find((r) => r.id === 2)!
  assert('工程状态保持不变', engRow0.status === engBefore, engRow0.status)
  const e1 = await runAction('engineering', 2, '报告异常')
  assert('已存在事项时重复上报被拒', e1.ok === false)
  const ec = await runAction('engineering', 2, '确认处置')
  assert('工程踏勘处置成功', ec.ok, ec.message)
  const engAfter = listEntries('engineering').items.find((r) => r.id === 2)!
  assert('工程异常标记解除', engAfter.abnormal === false)
  assert('工程状态仍不变', engAfter.status === engBefore)

  // 干净的工程行：从无到有走一遍上报
  const eng3 = listEntries('engineering').items.find((r) => r.id === 3)!
  assert('施工中工程初始无事项', surveysOf('engineering', 3).length === 0)
  const e3 = await runAction('engineering', 3, '报告异常')
  assert('施工中工程报异常成功', e3.ok, e3.message)
  assert('工程状态仍为施工中', listEntries('engineering').items.find((r) => r.id === 3)!.status === '施工中')
  assert('生成1条工程踏勘事项', surveysOf('engineering', 3).length === 1)

  // 7. 写入失败双边回滚（插入隔离的干净行，不影响上面的断言）
  console.log('7) 任一写入失败，两边一起退回')
  saveRows('patrol', [
    ...listEntries('patrol').items,
    { id: 901, status: '已巡查', pending: true, abnormal: false, 巡查编号: 'PATR-0901', 隐患点编号: 'T-901' },
  ])
  failNextWrites = 1
  const f1 = await runAction('patrol', 901, '报告异常')
  assert('报异常落盘失败返回失败', f1.ok === false, f1.message)
  assert('来源状态回滚不变', patrolStatus(901).status === '已巡查', patrolStatus(901).status)
  assert('踏勘事项未残留', surveysOf('patrol', 901).length === 0)
  failNextWrites = 0
  const retry = await runAction('patrol', 901, '报告异常')
  assert('回滚后可重新上报', retry.ok, retry.message)
  failNextWrites = 1
  const f2 = await resolveSurvey(surveysOf('patrol', 901)[0].id)
  assert('处置落盘失败返回失败', f2.ok === false, f2.message)
  assert('处置回滚：来源仍发现异常', patrolStatus(901).status === '发现异常', patrolStatus(901).status)
  assert('处置回滚：事项仍待踏勘', surveysOf('patrol', 901)[0].status === '待踏勘')
  failNextWrites = 0

  console.log(`存储桶踏勘总数=${listSurveys().length}, storageKey=${storageKey()}`)
  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
