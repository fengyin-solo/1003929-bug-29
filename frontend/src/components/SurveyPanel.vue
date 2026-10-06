<template>
  <div class="survey-panel">
    <div class="survey-head">
      <strong>踏勘事项</strong>
      <span class="survey-tip">异常上报后生成，同一记录仅生成一次；处置完成自动回写来源状态</span>
    </div>
    <table v-if="items.length" class="data-table survey-table">
      <thead>
        <tr>
          <th>事项编号</th>
          <th>来源</th>
          <th>隐患点编号</th>
          <th>状态</th>
          <th>生成时间</th>
          <th>处置时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>SK-{{ String(item.id).padStart(4, '0') }}</td>
          <td>{{ item.来源说明 }} #{{ item.sourceId }}</td>
          <td>{{ item.隐患点编号 || '—' }}</td>
          <td>{{ item.status }}</td>
          <td>{{ formatTime(item.createdAt) }}</td>
          <td>{{ item.completedAt ? formatTime(item.completedAt) : '—' }}</td>
          <td>
            <button
              v-if="item.pending"
              class="link"
              type="button"
              :disabled="resolving"
              @click="resolve(item)"
            >
              确认踏勘处置
            </button>
            <span v-else class="survey-done">已完成</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="survey-empty">暂无踏勘事项</p>
    <p v-if="message" :class="ok ? 'survey-msg' : 'error-text'">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { resolveSurvey } from '@/api/local-service'
import type { SurveyItem } from '@/data/types'

const props = defineProps<{ items: SurveyItem[] }>()
const emit = defineEmits<{ (event: 'resolved'): void }>()

const resolving = ref(false)
const message = ref('')
const ok = ref(false)

function formatTime(value: string): string {
  if (!value) {
    return '—'
  }
  return value.replace('T', ' ').slice(0, 16)
}

async function resolve(item: SurveyItem) {
  // 按钮防抖 + 服务层串行锁双保险：并发点击只允许一次成功。
  if (resolving.value) {
    return
  }
  resolving.value = true
  message.value = ''
  try {
    const result = await resolveSurvey(item.id)
    ok.value = result.ok
    message.value = result.message
    if (result.ok) {
      emit('resolved')
    }
  } finally {
    resolving.value = false
  }
}
</script>

<style scoped>
.survey-panel {
  margin-top: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.survey-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.survey-tip {
  font-size: 12px;
  color: var(--muted);
}
.survey-table {
  margin-bottom: 6px;
}
.survey-empty {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.survey-done {
  color: var(--muted);
  font-size: 13px;
}
.survey-msg {
  color: #15803d;
  font-size: 12px;
  margin: 6px 0 0;
}
</style>
