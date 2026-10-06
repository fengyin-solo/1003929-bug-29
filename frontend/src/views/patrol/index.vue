<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>巡查排查管理</h2>
        <p class="page-desc">维护巡查记录，围绕巡查编号、隐患点编号、巡查日期、巡查人员做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡查记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡查排查清单</button>
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
          <td v-for="column in columns" :key="column">
            <router-link v-if="column === '巡查编号'" class="link" :to="`/patrol/${row.id}`">
              {{ row[column] ?? '—' }}
            </router-link>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(String(row.status))"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!availableActions(String(row.status)).length" class="muted-text">无</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无巡查排查数据，可先登记巡查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡查排查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  availableActions,
  PATROL_STATUS,
  runPatrolAction,
} from '@/data/patrol-workflow'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡查编号", "隐患点编号", "巡查日期", "巡查人员", "巡查范围", "发现异常", "处置措施", "巡查状态"]
const statuses = ["待巡查", "已巡查", "发现异常", "已处置"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
// 指标随列表实时计算：异常量只看异常/已处置，待处置只看「发现异常」。
const stats = computed(() => [
  { label: '本月巡查次数', value: rows.value.length },
  {
    label: '发现异常数',
    value: rows.value.filter((row) => row.abnormal === true).length,
  },
  {
    label: '待处置数',
    value: rows.value.filter((row) => String(row.status) === PATROL_STATUS.ABNORMAL).length,
  },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡查记录登记入口尚未接入审批流'
}

// 异常情况与处置结论允许在列表上快速补充；取消输入不做任何写入。
function askPayload(action: string): string | null {
  if (action === '报告异常') {
    return window.prompt('请填写异常情况（留空使用默认描述）', '') ?? null
  }
  if (action === '确认处置') {
    return window.prompt('请填写处置结论（留空使用默认结论）', '') ?? null
  }
  return ''
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const payload = askPayload(action)
  if (payload === null) {
    return
  }
  const result = runPatrolAction(action, Number(row.id), payload)
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡查排查列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.muted-text { color: var(--muted); font-size: 12px; }
</style>
