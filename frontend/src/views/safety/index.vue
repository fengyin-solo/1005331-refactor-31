<template>
  <section class="page" data-module="safety">
    <header class="page-head">
      <div>
        <h2>安全巡查管理</h2>
        <p class="page-desc">维护安全巡查记录，围绕巡查编号、巡查区域、巡查类别、隐患描述做登记、筛选与状态流转。巡查与隐患上报共用同一套判定规则。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn primary" to="/hazard-report">进入隐患上报入口</RouterLink>
        <button class="btn" type="button" @click="exportRows">导出安全巡查清单</button>
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
          <th>处置结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ conclusionOf(row).conclusion }}
            <span v-if="conclusionOf(row).frozen" class="frozen-tag" title="巡查原单留存结论，不因规则重构重算">原单留存</span>
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
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无安全巡查数据，可先登记安全巡查记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条安全巡查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  SAFETY_STATUSES,
  conclusionSnapshot,
  executeSafetyAction,
} from '@/domain/safety'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('safety')
const columns = ["巡查编号", "巡查区域", "巡查类别", "隐患描述", "整改措施", "巡查人", "巡查日期", "巡查状态"]
const stats = [{"label": "待巡查区域", "value": 0}, {"label": "待整改隐患", "value": 0}, {"label": "本月巡查次数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  SAFETY_STATUSES.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 环节单向推进：每个状态只露出「往下一格」的动作；已上报之后不再允许任何回退操作。
const NEXT_ACTION: Record<string, string> = {
  待巡查: '提交巡查',
  巡查中: '确认整改',
  已整改: '上报隐患',
  已上报: '批复办结',
}

function rowActions(row: EntryRow): string[] {
  const action = NEXT_ACTION[String(row.status)]
  return action ? [action] : []
}

function conclusionOf(row: EntryRow) {
  return conclusionSnapshot(row, rows.value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = executeSafetyAction(Number(row.id), action)
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
    errorMessage.value = error instanceof Error ? error.message : '安全巡查列表读取失败'
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
</style>
