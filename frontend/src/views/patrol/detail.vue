<template>
  <section class="page" data-module="patrol-detail">
    <header class="page-head">
      <div>
        <h2>巡查记录详情</h2>
        <p class="page-desc">
          <router-link class="link" to="/patrol">← 返回巡查排查列表</router-link>
        </p>
      </div>
    </header>

    <div v-if="!detail" class="empty-card">
      <p>未找到该巡查记录。</p>
      <router-link class="link" to="/patrol">返回列表</router-link>
    </div>

    <template v-else>
      <div class="detail-head">
        <span class="legend-item">{{ detail.patrol.status }}</span>
        <span class="muted-text">编号 {{ detail.patrol.巡查编号 }}</span>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in meta.fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ detail.patrol[field] === '' ? '—' : (detail.patrol[field] ?? '—') }}</td>
          </tr>
        </tbody>
      </table>

      <article class="task-card">
        <h3>踏勘事项</h3>
        <p v-if="!detail.task" class="muted-text">
          {{ detail.patrol.status === PATROL_STATUS.DISPOSED
            ? '历史已处置记录，保持原结论，不补建事项。'
            : '暂无踏勘事项：完成巡查并报告异常后自动生成，且每条巡查记录只生成一次。' }}
        </p>
        <table v-else class="data-table">
          <tbody>
            <tr><th>事项编号</th><td>{{ detail.task.事项编号 }}</td></tr>
            <tr><th>隐患点编号</th><td>{{ detail.task.隐患点编号 }}</td></tr>
            <tr><th>异常情况</th><td>{{ detail.task.异常情况 }}</td></tr>
            <tr><th>事项状态</th><td>{{ detail.task.status }}</td></tr>
            <tr>
              <th>处置结论</th>
              <td>{{ detail.task.处置结论 === '' ? '待踏勘处置' : detail.task.处置结论 }}</td>
            </tr>
          </tbody>
        </table>
      </article>

      <article class="action-card">
        <h3>处置操作</h3>
        <p v-if="detail.patrol.status === PATROL_STATUS.DISPOSED" class="muted-text">
          该记录已处置，历史结论保持原结论，不允许再次处置或回退状态。
        </p>
        <div v-else class="action-form">
          <label v-if="noteLabel" class="filter-item">
            <span>{{ noteLabel }}</span>
            <textarea v-model="note" rows="3" :placeholder="noteLabel"></textarea>
          </label>
          <button
            v-for="action in availableActions(String(detail.patrol.status))"
            :key="action"
            class="btn"
            :class="{ primary: action === '确认处置' }"
            type="button"
            @click="runAction(action)"
          >
            {{ action }}
          </button>
        </div>
      </article>

      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { moduleMeta } from '@/api/local-service'
import {
  availableActions,
  getPatrolCase,
  PATROL_STATUS,
  runPatrolAction,
} from '@/data/patrol-workflow'
import type { PatrolCase } from '@/data/types'

const route = useRoute()
const meta = moduleMeta('patrol')

const detail = ref<PatrolCase | null>(null)
const errorMessage = ref('')
const note = ref('')

const recordId = computed(() => Number(route.params.id))
const noteLabel = computed(() => {
  const status = detail.value?.patrol.status
  if (status === PATROL_STATUS.PATROLLED) {
    return '异常情况'
  }
  if (status === PATROL_STATUS.ABNORMAL) {
    return '处置结论'
  }
  return ''
})

function runAction(action: string) {
  errorMessage.value = ''
  const result = runPatrolAction(action, recordId.value, note.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  note.value = ''
  reload()
}

function reload() {
  errorMessage.value = ''
  detail.value = getPatrolCase(recordId.value)
}

onMounted(reload)
</script>

<style scoped>
.detail-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.muted-text { color: var(--muted); font-size: 13px; }
.detail-table th { width: 140px; background: #f8fafc; }
.task-card,
.action-card {
  margin-top: 14px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.task-card h3,
.action-card h3 { margin: 0 0 10px; font-size: 15px; }
.action-form { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.action-form textarea {
  width: 360px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-family: inherit;
}
.empty-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  color: var(--muted);
}
</style>
