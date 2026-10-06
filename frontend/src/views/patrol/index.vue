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
          <th>异常标记</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.abnormal ? '异常' : '正常' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
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
          <td :colspan="columns.length + 3" class="empty-state">暂无巡查排查数据，可先登记巡查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡查排查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card">
        <header class="modal-head">
          <strong>巡查记录详情 #{{ detailRow.id }}</strong>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detailRow[column] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>
        <div class="detail-actions">
          <button
            v-for="action in availableActions(detailRow)"
            :key="action"
            class="btn"
            type="button"
            @click="runAction(action, detailRow)"
          >
            {{ action }}
          </button>
        </div>
        <SurveyPanel :items="detailSurveys" @resolved="reload" />
      </div>
    </div>
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

const meta = moduleMeta('patrol')
const columns = ["巡查编号", "隐患点编号", "巡查日期", "巡查人员", "巡查范围", "发现异常", "处置措施", "巡查状态"]
const statuses = ["待巡查", "已巡查", "发现异常", "已处置"]
const stats = [{"label": "本月巡查次数", "value": 0}, {"label": "发现异常数", "value": 0}, {"label": "待处置数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const detailRow = ref<EntryRow | null>(null)
const detailSurveys = ref<SurveyItem[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 状态只能沿 待巡查→已巡查→发现异常→已处置 推进，按钮也按当前状态收敛，避免越态操作。
function availableActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待巡查':
      return ['完成巡查']
    case '已巡查':
      return ['报告异常']
    case '发现异常':
      return ['确认处置']
    default:
      return []
  }
}

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

function openDetail(row: EntryRow) {
  detailRow.value = row
  refreshDetailSurveys(row)
}

function closeDetail() {
  detailRow.value = null
  detailSurveys.value = []
}

function refreshDetailSurveys(row: EntryRow) {
  detailSurveys.value = listSurveyItems({ moduleKey: 'patrol', sourceId: Number(row.id) })
}

async function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = await applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  if (detailRow.value && Number(detailRow.value.id) === Number(row.id)) {
    const refreshed = rows.value.find((item) => Number(item.id) === Number(row.id))
    if (refreshed) {
      detailRow.value = refreshed
    }
    refreshDetailSurveys(row)
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    if (detailRow.value) {
      const refreshed = rows.value.find((item) => Number(item.id) === Number(detailRow.value?.id))
      if (refreshed) {
        detailRow.value = refreshed
        refreshDetailSurveys(refreshed)
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡查排查列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 720px;
  max-width: calc(100vw - 32px);
  max-height: 86vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 110px 1fr 110px 1fr;
  gap: 6px 10px;
  margin: 0 0 10px;
  font-size: 13px;
}
.detail-grid dt {
  color: var(--muted);
}
.detail-grid dd {
  margin: 0;
}
.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
