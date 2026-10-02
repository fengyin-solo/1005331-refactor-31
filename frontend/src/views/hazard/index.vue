<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>隐患上报与办结</h2>
        <p class="page-desc">隐患上报入口与巡查入口共用同一套判定规则，处置结论完全一致。上报前必须先整改，上报之后不能回到巡查中；上报办结的批复自动生成验收台账。</p>
      </div>
    </header>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>巡查编号</span>
        <input v-model="codeFilter" placeholder="按巡查编号检索" />
      </label>
      <label class="filter-item">
        <span>隐患描述</span>
        <input v-model="descFilter" placeholder="按隐患描述检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>处置结论（来源）</th>
          <th>批复</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayValue(row, column) }}</td>
          <td>
            <strong :class="decisionOf(row).verdict === '合格' ? 'ok-text' : 'error-text'">
              {{ decisionOf(row).verdict }}
            </strong>
            <span class="source-tag">（{{ decisionOf(row).source }}）</span>
            <ul v-if="decisionOf(row).issues.length" class="issue-list">
              <li v-for="issue in decisionOf(row).issues" :key="issue.message">{{ issue.message }}</li>
            </ul>
          </td>
          <td>{{ row['批复结论'] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="availableActions(String(row.status)).length">
              <button
                v-for="action in availableActions(String(row.status))"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else-if="String(row.status) === '已办结'" class="muted-text">已办结</span>
            <span v-else class="muted-text">待巡查/巡查中（上报需先完成整改）</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无可上报的隐患记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条隐患记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="ledger-block">
      <header class="page-head">
        <div>
          <h2>隐患验收台账</h2>
          <p class="page-desc">隐患上报办结的批复驱动生成：每一次「批复办结」都在这里追加一条验收台账。</p>
        </div>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in ledgerColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledger" :key="entry['台账编号']">
            <td v-for="column in ledgerColumns" :key="column">{{ entry[column] }}</td>
          </tr>
          <tr v-if="!ledger.length">
            <td :colspan="ledgerColumns.length" class="empty-state">暂无验收台账：隐患上报办结批复后自动入账</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { filterRows } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  listAcceptanceLedger,
  hazardConclusion,
  hazardDescription,
  listSafetyRows,
  runHazardAction,
  type AcceptanceLedgerEntry,
} from '@/data/safety/service'

// 与巡查入口展示同一组字段，隐患描述走同一个读取函数，两个入口看到的内容一致。
const columns = ["巡查编号", "巡查区域", "巡查类别", "隐患描述", "整改措施", "巡查人", "巡查日期"]
const ledgerColumns = ["台账编号", "巡查编号", "隐患描述", "巡查类别", "验收结论", "批复结论", "办结日期"]
const statuses = ["待巡查", "巡查中", "已整改", "已上报", "已办结"]

const rows = ref<EntryRow[]>([])
const ledger = ref<AcceptanceLedgerEntry[]>([])
const total = ref(0)
const errorMessage = ref('')
const codeFilter = ref('')
const descFilter = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 上报入口可执行的动作。巡查中点「上报隐患」会被共用流转规则拦下（跳过整改）。
const STATUS_ACTIONS: Record<string, string[]> = {
  待巡查: [],
  巡查中: ['上报隐患'],
  已整改: ['上报隐患'],
  已上报: ['批复办结'],
  已办结: [],
}

function availableActions(status: string): string[] {
  return STATUS_ACTIONS[status] ?? []
}

// 与巡查入口完全相同的结论来源：共用规则 + 巡查原单留存优先。
function decisionOf(row: EntryRow) {
  return hazardConclusion(row)
}

function displayValue(row: EntryRow, column: string): string {
  if (column === '隐患描述') {
    return hazardDescription(row) || '—'
  }
  if (column === '整改措施' && String(row[column] ?? '').trim() === '') {
    return '未填写'
  }
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

function resetFilters() {
  codeFilter.value = ''
  descFilter.value = ''
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = runHazardAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const filters: Record<string, string> = {}
    if (codeFilter.value.trim() !== '') {
      filters['巡查编号'] = codeFilter.value.trim()
    }
    rows.value = filterRows(listSafetyRows(), filters).filter((row) =>
      descFilter.value.trim() === ''
        ? true
        : hazardDescription(row).includes(descFilter.value.trim()),
    )
    total.value = rows.value.length
    ledger.value = listAcceptanceLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患列表读取失败'
  }
}

onMounted(reload)
</script>
