<template>
  <section class="page" data-module="engineering">
    <header class="page-head">
      <div>
        <h2>治理工程管理</h2>
        <p class="page-desc">维护治理工程项目，围绕项目编号、隐患点编号、治理方案、承建方做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记治理工程项目</button>
        <button class="btn" type="button" @click="exportRows">导出治理工程清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <article class="task-panel">
      <div class="task-panel-head">
        <h3>巡查踏勘待办</h3>
        <span class="muted-text">待踏勘 {{ pendingTasks.length }} 条 · 已处置 {{ doneTasks.length }} 条</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>事项编号</th>
            <th>巡查编号</th>
            <th>隐患点编号</th>
            <th>异常情况</th>
            <th>状态</th>
            <th>处置操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in surveyTasks" :key="task.事项编号">
            <td>
              <router-link class="link" :to="`/patrol/${task.来源记录}`">{{ task.事项编号 }}</router-link>
            </td>
            <td>{{ task.巡查编号 }}</td>
            <td>{{ task.隐患点编号 }}</td>
            <td>{{ task.异常情况 }}</td>
            <td>{{ task.status }}</td>
            <td class="row-actions">
              <button
                v-if="task.status === TASK_STATUS.PENDING"
                class="link"
                type="button"
                @click="disposeTask(task)"
              >
                确认处置
              </button>
              <span v-else class="muted-text">已关闭</span>
            </td>
          </tr>
          <tr v-if="!surveyTasks.length">
            <td colspan="6" class="empty-state">暂无巡查踏勘事项</td>
          </tr>
        </tbody>
      </table>
    </article>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无治理工程数据，可先登记治理工程项目</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条治理工程记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { confirmDisposal, listSurveyTasks, TASK_STATUS } from '@/data/patrol-workflow'
import type { EntryRow, SurveyTask } from '@/data/types'

const meta = moduleMeta('engineering')
const columns = ["项目编号", "隐患点编号", "治理方案", "承建方", "合同金额", "开工日期", "计划工期", "项目状态"]
const actions = ["启动招标", "开工确认", "申请验收"]
const statuses = ["待立项", "招标中", "施工中", "已竣工", "待验收"]
const stats = [{"label": "项目总数", "value": 0}, {"label": "施工中数", "value": 0}, {"label": "待验收数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const surveyTasks = ref<SurveyTask[]>([])
const pendingTasks = computed(() => surveyTasks.value.filter((task) => task.status === TASK_STATUS.PENDING))
const doneTasks = computed(() => surveyTasks.value.filter((task) => task.status === TASK_STATUS.DONE))
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 工程页的踏勘处置与巡查详情走同一个确认入口：并发/重复只成功一次，回写不追加事项。
function disposeTask(task: SurveyTask) {
  errorMessage.value = ''
  const conclusion = window.prompt('请填写踏勘处置结论（留空使用默认结论）', '')
  if (conclusion === null) {
    return
  }
  const result = confirmDisposal(Number(task.来源记录), conclusion)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '治理工程项目登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    surveyTasks.value = listSurveyTasks()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '治理工程列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.task-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.task-panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.task-panel-head h3 { margin: 0; font-size: 15px; }
.muted-text { color: var(--muted); font-size: 12px; }
</style>
