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
          <th>异常标记</th>
          <th>踏勘事项</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.abnormal ? '异常' : '正常' }}</td>
          <td>
            <button class="link" type="button" @click="toggleSurvey(row)">
              {{ surveyOpenId === Number(row.id) ? '收起' : '查看' }}
            </button>
          </td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
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
          <td :colspan="columns.length + 4" class="empty-state">暂无治理工程数据，可先登记治理工程项目</td>
        </tr>
      </tbody>
    </table>

    <SurveyPanel
      v-if="surveyRow"
      :items="surveyItems"
      @resolved="reload"
    />

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
  listSurveyItems,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import SurveyPanel from '@/components/SurveyPanel.vue'
import type { EntryRow, SurveyItem } from '@/data/types'

const meta = moduleMeta('engineering')
const columns = ["项目编号", "隐患点编号", "治理方案", "承建方", "合同金额", "开工日期", "计划工期", "项目状态"]
const statuses = ["待立项", "招标中", "施工中", "已竣工", "待验收"]
const stats = [{"label": "项目总数", "value": 0}, {"label": "施工中数", "value": 0}, {"label": "待验收数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const surveyOpenId = ref<number | null>(null)
const surveyItems = ref<SurveyItem[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const surveyRow = computed(() =>
  surveyOpenId.value === null
    ? null
    : rows.value.find((row) => Number(row.id) === surveyOpenId.value) ?? null,
)

// 工程状态沿自身链路推进；只有招标中/施工中可上报异常或处置踏勘，且不改变项目状态。
function availableActions(row: EntryRow): string[] {
  const actions: string[] = []
  switch (String(row.status)) {
    case '待立项':
      actions.push('启动招标')
      break
    case '招标中':
      actions.push('开工确认')
      actions.push(row.abnormal ? '确认处置' : '报告异常')
      break
    case '施工中':
      actions.push('申请验收')
      actions.push(row.abnormal ? '确认处置' : '报告异常')
      break
    default:
      break
  }
  return actions
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

function toggleSurvey(row: EntryRow) {
  if (surveyOpenId.value === Number(row.id)) {
    surveyOpenId.value = null
    surveyItems.value = []
    return
  }
  surveyOpenId.value = Number(row.id)
  refreshSurveyItems()
}

function refreshSurveyItems() {
  if (surveyOpenId.value === null) {
    surveyItems.value = []
    return
  }
  surveyItems.value = listSurveyItems({ moduleKey: 'engineering', sourceId: surveyOpenId.value })
}

async function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = await applyAction(meta.key, Number(row.id), action)
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
    refreshSurveyItems()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '治理工程列表读取失败'
  }
}

onMounted(reload)
</script>
