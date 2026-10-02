<template>
  <section class="page" data-module="safety">
    <header class="page-head">
      <div>
        <h2>安全巡查管理</h2>
        <p class="page-desc">巡查入口与隐患上报入口共用同一套判定：巡查编号重复、隐患描述为空、整改措施没写、巡查类别不对。环节单向推进，跳过整改的上报一律拦下。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记安全巡查记录</button>
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
          <th>处置结论（来源）</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayValue(row, column) }}</td>
          <td>
            <template v-if="String(row.status) === '待巡查'">—</template>
            <template v-else>
              <strong :class="decisionOf(row).verdict === '合格' ? 'ok-text' : 'error-text'">
                {{ decisionOf(row).verdict }}
              </strong>
              <span class="source-tag">（{{ decisionOf(row).source }}）</span>
            </template>
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
            <button
              v-if="canFillMeasure(row)"
              class="link"
              type="button"
              @click="openFillMeasure(row)"
            >
              补填整改措施
            </button>
            <span v-if="!hasAnyAction(row)" class="muted-text">已闭环</span>
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

    <!-- 登记巡查记录 -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记安全巡查记录</h3>
        <div class="form-grid">
          <label>
            <span>巡查编号</span>
            <input v-model="form['巡查编号']" placeholder="如 SAFE-0010" />
          </label>
          <label>
            <span>巡查区域</span>
            <input v-model="form['巡查区域']" placeholder="如 T0203 探方" />
          </label>
          <label>
            <span>巡查类别</span>
            <select v-model="form['巡查类别']">
              <option value="" disabled>请选择</option>
              <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
            </select>
          </label>
          <label>
            <span>巡查人</span>
            <input v-model="form['巡查人']" />
          </label>
          <label>
            <span>巡查日期</span>
            <input v-model="form['巡查日期']" type="date" />
          </label>
          <label class="full-span">
            <span>隐患描述</span>
            <textarea v-model="form['隐患描述']" rows="2"></textarea>
          </label>
          <label class="full-span">
            <span>整改措施（可在整改环节补填）</span>
            <textarea v-model="form['整改措施']" rows="2"></textarea>
          </label>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
          <button class="btn primary" type="submit">提交登记</button>
        </div>
      </form>
    </div>

    <!-- 补填整改措施 -->
    <div v-if="fillTarget" class="modal-overlay" @click.self="fillTarget = null">
      <form class="modal" @submit.prevent="submitFillMeasure">
        <h3>补填整改措施（{{ fillTarget['巡查编号'] }}）</h3>
        <label class="block-label">
          <span>整改措施</span>
          <textarea v-model="measureText" rows="3" placeholder="填写现场已落实的整改措施"></textarea>
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="fillTarget = null">取消</button>
          <button class="btn primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import {
  SAFETY_CATEGORIES,
  createSafetyRecord,
  fillRectificationMeasure,
  hazardConclusion,
  hazardDescription,
  runHazardAction,
} from '@/data/safety/service'

const meta = moduleMeta('safety')
const columns = ["巡查编号", "巡查区域", "巡查类别", "隐患描述", "整改措施", "巡查人", "巡查日期"]
const statuses = ["待巡查", "巡查中", "已整改", "已上报", "已办结"]
const categories = SAFETY_CATEGORIES
const stats = [{"label": "待巡查区域", "value": 0}, {"label": "待整改隐患", "value": 0}, {"label": "本月巡查次数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["巡查编号", "巡查区域", "巡查类别"]
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 每个环节在巡查入口可执行的动作。
// 巡查中也保留「上报隐患」按钮，用来明确演示「跳过整改」会被共用规则拦下。
const STATUS_ACTIONS: Record<string, string[]> = {
  待巡查: ['提交巡查'],
  巡查中: ['确认整改', '上报隐患'],
  已整改: ['上报隐患'],
  已上报: ['批复办结'],
  已办结: [],
}

function availableActions(status: string): string[] {
  return STATUS_ACTIONS[status] ?? []
}

function canFillMeasure(row: EntryRow): boolean {
  return (
    (String(row.status) === '巡查中' || String(row.status) === '已整改') &&
    String(row['整改措施'] ?? '').trim() === ''
  )
}

function hasAnyAction(row: EntryRow): boolean {
  return availableActions(String(row.status)).length > 0 || canFillMeasure(row)
}

// 处置结论由共用规则给出：巡查入口与上报入口调用的是同一个函数。
function decisionOf(row: EntryRow) {
  return hazardConclusion(row)
}

// 隐患描述的唯一读取口径。
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

const showCreate = ref(false)
const formError = ref('')
const emptyForm = () => ({
  巡查编号: '',
  巡查区域: '',
  巡查类别: '',
  隐患描述: '',
  整改措施: '',
  巡查人: '',
  巡查日期: new Date().toISOString().slice(0, 10),
})
const form = ref<Record<string, string>>(emptyForm())

function openCreate() {
  form.value = emptyForm()
  formError.value = ''
  showCreate.value = true
}

function submitCreate() {
  formError.value = ''
  const result = createSafetyRecord(form.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showCreate.value = false
  reload()
}

const fillTarget = ref<EntryRow | null>(null)
const measureText = ref('')

function openFillMeasure(row: EntryRow) {
  fillTarget.value = row
  measureText.value = ''
  formError.value = ''
}

function submitFillMeasure() {
  if (!fillTarget.value) {
    return
  }
  formError.value = ''
  const result = fillRectificationMeasure(Number(fillTarget.value.id), measureText.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  fillTarget.value = null
  reload()
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
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '安全巡查列表读取失败'
  }
}

onMounted(reload)
</script>
