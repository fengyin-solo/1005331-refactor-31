<template>
  <section class="page" data-module="hazard-report">
    <header class="page-head">
      <div>
        <h2>隐患上报与批复</h2>
        <p class="page-desc">隐患上报入口与安全巡查入口共用同一套判定规则，两处读到的隐患描述、处置结论完全一致。环节单向推进，跳过整改的上报会被拦下。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/safety">返回巡查入口</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待上报隐患</span>
        <strong class="stat-value">{{ countByStatus('已整改') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待批复办结</span>
        <strong class="stat-value">{{ countByStatus('已上报') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已办结</span>
        <strong class="stat-value">{{ countByStatus('已办结') }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>巡查编号</span>
        <input v-model="codeFilter" placeholder="按巡查编号检索" />
      </label>
      <button class="btn" type="submit">查询</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>巡查编号</th>
          <th>巡查类别</th>
          <th>隐患描述</th>
          <th>整改措施</th>
          <th>处置结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in visibleRows" :key="String(row.id)">
          <td>{{ row['巡查编号'] ?? '—' }}</td>
          <td>{{ row['巡查类别'] ?? '—' }}</td>
          <td>{{ hazardText(row) || '—' }}</td>
          <td>{{ row['整改措施'] || '—' }}</td>
          <td>
            {{ conclusionOf(row).conclusion }}
            <span v-if="conclusionOf(row).frozen" class="frozen-tag" title="以巡查原单留存结论为准">原单留存</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!rowActions(row).length" class="muted">本入口暂不可操作</span>
          </td>
        </tr>
        <tr v-if="!visibleRows.length">
          <td colspan="7" class="empty-state">暂无可上报的隐患</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listEntries } from '@/api/local-service'
import {
  SAFETY_KEY,
  conclusionSnapshot,
  executeSafetyAction,
  readHazardDescription,
} from '@/domain/safety'
import type { EntryRow } from '@/data/types'

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const codeFilter = ref('')

const visibleRows = computed(() =>
  codeFilter.value.trim()
    ? rows.value.filter((row) =>
        String(row['巡查编号'] ?? '').includes(codeFilter.value.trim()),
      )
    : rows.value,
)
// 模板里直接遍历过滤结果。

function countByStatus(status: string): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

// 上报入口只能从「已整改」往后走：跳过整改（巡查中/待巡查）的上报一律不露出、不受理。
function rowActions(row: EntryRow): string[] {
  if (String(row.status) === '已整改') {
    return ['上报隐患']
  }
  if (String(row.status) === '已上报') {
    return ['批复办结']
  }
  return []
}

function hazardText(row: EntryRow): string {
  // 与巡查入口读同一字段、同一函数，两处隐患描述必然一致。
  return readHazardDescription(row)
}

function conclusionOf(row: EntryRow) {
  return conclusionSnapshot(row, rows.value)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = executeSafetyAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(SAFETY_KEY)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患上报列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.frozen-tag {
  margin-left: 6px;
  font-size: 11px;
  color: #1f6feb;
  background: #eef2f7;
  border-radius: 999px;
  padding: 0 8px;
}
.muted {
  color: #94a3b8;
  font-size: 12px;
}
</style>
